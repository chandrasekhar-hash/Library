/**
 * PdfCanvas.jsx
 * Renders a single PDF page using pdfjs-dist with:
 * 1. High-DPI graphical canvas for sharp reading
 * 2. 1:1 aligned PDF.js TextLayer for native cursor text selection
 * 3. Normalized percentage highlight layer that scales seamlessly with zoom/resize
 * 4. In-place highlight creation and deletion popovers
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Loader2, Highlighter, Trash2, X, Info } from 'lucide-react';
import {
  renderPageToCanvas,
  renderTextLayer,
  getPageDimensions,
  getCachedPageDimensions,
  getCachedPageCanvas,
} from '../../services/pdfService';
import { convertSearchBboxToPercent } from '../../utils/searchCoordinates';

export const HIGHLIGHT_COLORS = [
  { id: 'gold', label: 'Champagne Gold', bg: '#E7C18A' },
  { id: 'teal', label: 'Peacock Teal', bg: '#2DD4BF' },
  { id: 'emerald', label: 'Emerald Mint', bg: '#4ADE80' },
  { id: 'amber', label: 'Honey Amber', bg: '#FBBF24' },
  { id: 'indigo', label: 'Royal Indigo', bg: '#818CF8' },
  { id: 'rose', label: 'Dusty Rose', bg: '#FB7185' },
];

export default function PdfCanvas({
  pdfDoc,
  pageNumber,
  scale = 1.5,
  fitToContainer = false,
  className = '',
  bookId = null,
  highlights = [],
  onAddHighlight = null,
  onDeleteHighlight = null,
  preferredHighlightColor = 'gold',
  // Optional: when caller already knows container's pixel dimensions (e.g. book mode),
  // pass them here to skip ResizeObserver round-trip and render immediately on mount.
  knownWidth = null,
  knownHeight = null,
  renderTextLayerEnabled = true,
  activeSearchMatch = null,
  allSearchMatches = [],
  onSelectSearchMatch = null,
}) {
  const containerRef = useRef(null);
  const pageBoxRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);

  const canvasTaskRef = useRef(null);
  const textLayerTaskRef = useRef(null);
  const isMouseDownRef = useRef(false);
  const lastSelectionTimeRef = useRef(0);

  // 1. Synchronously seed containerDimensions if knownWidth/Height provided
  const [containerDimensions, setContainerDimensions] = useState(() => {
    if (knownWidth > 0 && knownHeight > 0) {
      return { width: knownWidth, height: knownHeight };
    }
    return null;
  });

  // 2. Synchronously seed pageSize if dimensions are already cached
  const [pageSize, setPageSize] = useState(() => {
    if (!pdfDoc || !pageNumber) return null;
    const dims = getCachedPageDimensions(pdfDoc, pageNumber);
    if (!dims) return null;
    let effectiveScale = scale || 1.5;
    if (fitToContainer) {
      const cw = knownWidth > 0 ? knownWidth : null;
      const ch = knownHeight > 0 ? knownHeight : null;
      if (!cw || !ch) return null;
      effectiveScale = Math.min(cw / dims.width, ch / dims.height);
    }
    return {
      width: Math.round(dims.width * effectiveScale),
      height: Math.round(dims.height * effectiveScale),
      effectiveScale,
    };
  });

  // 3. Synchronously initialize isRendering: false if rendered canvas is already cached
  const [isRendering, setIsRendering] = useState(() => {
    if (!pdfDoc || !pageNumber || !pageSize) return true;
    const cached = getCachedPageCanvas(pdfDoc, pageNumber, pageSize.effectiveScale);
    return !cached;
  });

  const [renderError, setRenderError] = useState(null);

  // Floating popovers state
  const [selectionPopup, setSelectionPopup] = useState(null); // { x, y, text, rects, chosenColor }
  const [activeHighlightPopup, setActiveHighlightPopup] = useState(null); // { x, y, highlight }

  // Filter highlights specifically for this page
  const pageHighlights = useMemo(() => {
    if (!Array.isArray(highlights)) return [];
    return highlights.filter((h) => Number(h.page) === Number(pageNumber));
  }, [highlights, pageNumber]);

  // Compute transient search result highlight rect for the active match
  const searchHighlightRect = useMemo(() => {
    if (!activeSearchMatch || Number(activeSearchMatch.pageNumber) !== Number(pageNumber)) {
      return null;
    }
    if (!activeSearchMatch.bbox || !Array.isArray(activeSearchMatch.bbox)) {
      return null;
    }
    const dims = getCachedPageDimensions(pdfDoc, pageNumber);
    const unscaledWidth = dims?.width || (pageSize?.effectiveScale ? pageSize.width / pageSize.effectiveScale : null);
    const unscaledHeight = dims?.height || (pageSize?.effectiveScale ? pageSize.height / pageSize.effectiveScale : null);
    if (!unscaledWidth || !unscaledHeight) {
      return null;
    }
    return convertSearchBboxToPercent(
      activeSearchMatch.bbox,
      activeSearchMatch.source,
      unscaledWidth,
      unscaledHeight,
      250,
      dims?.rotation || 0
    );
  }, [activeSearchMatch, pageNumber, pdfDoc, pageSize]);

  // Compute all highlight rects for this page to distinguish multiple matches on the same page
  const pageSearchHighlights = useMemo(() => {
    const dims = getCachedPageDimensions(pdfDoc, pageNumber);
    const unscaledWidth = dims?.width || (pageSize?.effectiveScale ? pageSize.width / pageSize.effectiveScale : null);
    const unscaledHeight = dims?.height || (pageSize?.effectiveScale ? pageSize.height / pageSize.effectiveScale : null);

    if (!Array.isArray(allSearchMatches) || allSearchMatches.length === 0) {
      return searchHighlightRect
        ? [
            {
              ...activeSearchMatch,
              rect: searchHighlightRect,
              isActive: true,
              key: `active-match-${pageNumber}-${activeSearchMatch?.lineIndex ?? 0}`,
              totalOnPage: 1,
              matchIndexOnPage: 1,
            },
          ]
        : [];
    }

    if (!unscaledWidth || !unscaledHeight) return [];

    const matchesOnThisPage = allSearchMatches.filter(
      (m) => Number(m.pageNumber) === Number(pageNumber) && m.bbox && Array.isArray(m.bbox)
    );

    return matchesOnThisPage
      .map((m, idx) => {
        const rect = convertSearchBboxToPercent(
          m.bbox,
          m.source,
          unscaledWidth,
          unscaledHeight,
          250,
          dims?.rotation || 0
        );
        if (!rect) return null;

        const isActive = Boolean(
          activeSearchMatch &&
            Number(activeSearchMatch.pageNumber) === Number(pageNumber) &&
            (activeSearchMatch === m ||
              (activeSearchMatch._resultIndex !== undefined &&
                activeSearchMatch._resultIndex === m._resultIndex) ||
              (activeSearchMatch.lineIndex !== null &&
                activeSearchMatch.lineIndex !== undefined &&
                activeSearchMatch.lineIndex === m.lineIndex) ||
              (activeSearchMatch.matchCharIndex === m.matchCharIndex &&
                activeSearchMatch.matchedTerm === m.matchedTerm))
        );

        return {
          ...m,
          rect,
          isActive,
          key: `page-match-${m.pageNumber}-${m.lineIndex ?? idx}-${idx}`,
          totalOnPage: matchesOnThisPage.length,
          matchIndexOnPage: idx + 1,
        };
      })
      .filter(Boolean);
  }, [allSearchMatches, activeSearchMatch, searchHighlightRect, pageNumber, pdfDoc, pageSize]);

  // ── Synchronous Immediate Paint from Cache (Zero-Flash Page Turn) ─────────
  useEffect(() => {
    if (!canvasRef.current || !pageSize || !pdfDoc || !pageNumber) return;
    const cached = getCachedPageCanvas(pdfDoc, pageNumber, pageSize.effectiveScale);
    if (cached?.canvas) {
      const canvas = canvasRef.current;
      canvas.width = cached.width;
      canvas.height = cached.height;
      canvas.style.width = `${cached.logicalWidth}px`;
      canvas.style.height = `${cached.logicalHeight}px`;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(cached.canvas, 0, 0);
    }
  }, [pdfDoc, pageNumber, pageSize]);

  // ── 1. Measure Container Dimensions for Fit Mode (Book Mode) ──────────────────
  useEffect(() => {
    if (!fitToContainer || !containerRef.current) return;

    if (knownWidth > 0 && knownHeight > 0) {
      setContainerDimensions((prev) => {
        if (
          prev &&
          Math.abs(prev.width - knownWidth) < 2 &&
          Math.abs(prev.height - knownHeight) < 2
        ) {
          return prev;
        }
        return { width: knownWidth, height: knownHeight };
      });
    }

    const measure = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      if (clientWidth > 0 && clientHeight > 0) {
        setContainerDimensions((prev) => {
          if (
            prev &&
            Math.abs(prev.width - clientWidth) < 2 &&
            Math.abs(prev.height - clientHeight) < 2
          ) {
            return prev;
          }
          return { width: clientWidth, height: clientHeight };
        });
      }
    };

    if (!(knownWidth > 0 && knownHeight > 0)) {
      measure();
    }
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fitToContainer, knownWidth, knownHeight]);

  // ── 2. Compute Effective Scale & Page Size ──────────────────────────────────
  useEffect(() => {
    if (!pdfDoc || !pageNumber) return;

    let cancelled = false;

    const computeSize = async () => {
      try {
        const dims = await getPageDimensions(pdfDoc, pageNumber);
        if (cancelled || !dims) return;

        let effectiveScale = scale || 1.5;

        if (fitToContainer) {
          if (!containerDimensions || containerDimensions.width <= 0 || containerDimensions.height <= 0) {
            return;
          }
          const fitScale = Math.min(
            containerDimensions.width / dims.width,
            containerDimensions.height / dims.height
          );
          effectiveScale = fitScale;
        }

        const width = Math.round(dims.width * effectiveScale);
        const height = Math.round(dims.height * effectiveScale);

        if (!cancelled) {
          setPageSize((prev) => {
            if (
              prev &&
              prev.width === width &&
              prev.height === height &&
              Math.abs(prev.effectiveScale - effectiveScale) < 0.001
            ) {
              return prev;
            }
            return { width, height, effectiveScale };
          });
        }
      } catch (err) {
        console.warn('[PdfCanvas] computeSize error:', err);
      }
    };

    computeSize();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, scale, fitToContainer, containerDimensions]);

  // ── 3. Render Graphical Canvas + Aligned Text Layer ────────────────────────
  useEffect(() => {
    if (!pdfDoc || !pageNumber || !pageSize || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    const cached = getCachedPageCanvas(pdfDoc, pageNumber, pageSize.effectiveScale);
    if (!cached) {
      setIsRendering(true);
    }
    setRenderError(null);
    setSelectionPopup(null);
    setActiveHighlightPopup(null);

    // Cancel any previous in-flight tasks
    if (canvasTaskRef.current) {
      try {
        canvasTaskRef.current.cancel();
      } catch (_) {}
      canvasTaskRef.current = null;
    }
    if (textLayerTaskRef.current) {
      try {
        textLayerTaskRef.current.cancel();
      } catch (_) {}
      textLayerTaskRef.current = null;
    }

    const doRender = async () => {
      try {
        const { effectiveScale } = pageSize;

        const tasks = [
          renderPageToCanvas(
            pdfDoc,
            pageNumber,
            canvasRef.current,
            effectiveScale,
            (task) => {
              canvasTaskRef.current = task;
            }
          ),
        ];

        if (renderTextLayerEnabled && textLayerRef.current) {
          tasks.push(
            renderTextLayer(
              pdfDoc,
              pageNumber,
              textLayerRef.current,
              effectiveScale,
              (task) => {
                textLayerTaskRef.current = task;
              }
            )
          );
        }

        await Promise.all(tasks);

        if (!cancelled) {
          setIsRendering(false);
          canvasTaskRef.current = null;
          textLayerTaskRef.current = null;
        }
      } catch (err) {
        if (err?.name === 'RenderingCancelledException' || err?.name === 'AbortException') return;
        if (!cancelled) {
          console.warn('[PdfCanvas] Render error on page', pageNumber, err);
          setRenderError(`Page ${pageNumber} could not be rendered.`);
          setIsRendering(false);
          canvasTaskRef.current = null;
          textLayerTaskRef.current = null;
        }
      }
    };

    doRender();

    return () => {
      cancelled = true;
      if (canvasTaskRef.current) {
        try {
          canvasTaskRef.current.cancel();
        } catch (_) {}
        canvasTaskRef.current = null;
      }
      if (textLayerTaskRef.current) {
        try {
          textLayerTaskRef.current.cancel();
        } catch (_) {}
        textLayerTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNumber, pageSize]);

  // ── 4. Handle Native Text Selection ─────────────────────────────────────────
  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length === 0) {
      return;
    }

    if (!textLayerRef.current || !pageBoxRef.current) {
      return;
    }

    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);

    // Verify selection intersects this page's textLayer
    const commonNode = range.commonAncestorContainer;
    const isInside =
      textLayerRef.current.contains(commonNode) ||
      textLayerRef.current.contains(selection.anchorNode) ||
      textLayerRef.current.contains(selection.focusNode);

    if (!isInside) return;

    try {
      const clientRects = Array.from(range.getClientRects());
      if (clientRects.length === 0) return;

      const pageRect = pageBoxRef.current.getBoundingClientRect();
      if (pageRect.width <= 0 || pageRect.height <= 0) return;

      const rects = clientRects
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => {
          const l = Math.max(0, Math.min(100, ((r.left - pageRect.left) / pageRect.width) * 100));
          const t = Math.max(0, Math.min(100, ((r.top - pageRect.top) / pageRect.height) * 100));
          const w = Math.max(0.1, Math.min(100 - l, (r.width / pageRect.width) * 100));
          const h = Math.max(0.1, Math.min(100 - t, (r.height / pageRect.height) * 100));
          return { left: l, top: t, width: w, height: h };
        });

      if (rects.length === 0) return;

      lastSelectionTimeRef.current = Date.now();

      // Position popover centered above the first client rect relative to pageBox
      const first = clientRects[0];
      const popX = first.left + first.width / 2 - pageRect.left;
      const popY = first.top - pageRect.top;

      setSelectionPopup({
        x: Math.max(50, Math.min(pageRect.width - 50, popX)),
        y: Math.max(15, popY),
        text,
        rects,
        chosenColor: preferredHighlightColor || 'gold',
      });
      setActiveHighlightPopup(null);
    } catch (err) {
      console.warn('[PdfCanvas] selection calculation error:', err);
    }
  }, [preferredHighlightColor]);

  // Global mouseup listener so dragging to select text works even if mouseup occurs in margins
  useEffect(() => {
    const onGlobalMouseUp = () => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      handleTextSelection();
    };

    window.addEventListener('mouseup', onGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', onGlobalMouseUp);
    };
  }, [handleTextSelection]);

  // ── 5. Confirm & Save Highlight ────────────────────────────────────────────
  const handleCreateHighlight = (colorId) => {
    if (!selectionPopup || !onAddHighlight) return;
    const colorObj =
      HIGHLIGHT_COLORS.find((c) => c.id === colorId) || HIGHLIGHT_COLORS[0];

    const newHl = {
      id: `hl-${bookId || 'pdf'}-p${pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bookId,
      page: pageNumber,
      text: selectionPopup.text,
      color: colorObj.id,
      colorHex: colorObj.bg,
      createdAt: new Date().toISOString(),
      rects: selectionPopup.rects,
    };

    onAddHighlight(newHl);
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  // ── 6. Click & Hover on Page Box (Highlight inspection / dismissal) ──────────
  const handlePageBoxClick = (e) => {
    // If clicked inside popover, ignore
    if (e.target.closest('.highlight-popover')) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
      return;
    }

    if (!pageBoxRef.current) return;
    const pageRect = pageBoxRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - pageRect.left) / pageRect.width) * 100;
    const yPct = ((e.clientY - pageRect.top) / pageRect.height) * 100;

    // Check if clicked inside any existing highlight for this page
    const hitHl = pageHighlights.find((hl) =>
      hl.rects?.some(
        (r) =>
          xPct >= r.left - 0.5 &&
          xPct <= r.left + r.width + 0.5 &&
          yPct >= r.top - 0.5 &&
          yPct <= r.top + r.height + 0.5
      )
    );

    if (hitHl) {
      e.stopPropagation();
      setActiveHighlightPopup({
        x: Math.max(50, Math.min(pageRect.width - 50, e.clientX - pageRect.left)),
        y: Math.max(15, e.clientY - pageRect.top),
        highlight: hitHl,
      });
      setSelectionPopup(null);
    } else {
      if (selectionPopup || activeHighlightPopup) {
        setSelectionPopup(null);
        setActiveHighlightPopup(null);
      }
    }
  };

  const handlePageBoxMouseMove = (e) => {
    if (activeHighlightPopup || selectionPopup || isMouseDownRef.current) return;
    if (!pageBoxRef.current || !textLayerRef.current) return;
    const pageRect = pageBoxRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - pageRect.left) / pageRect.width) * 100;
    const yPct = ((e.clientY - pageRect.top) / pageRect.height) * 100;
    const isOverHl = pageHighlights.some((hl) =>
      hl.rects?.some(
        (r) => xPct >= r.left && xPct <= r.left + r.width && yPct >= r.top && yPct <= r.top + r.height
      )
    );
    textLayerRef.current.style.cursor = isOverHl ? 'pointer' : 'text';
  };

  return (
    <div
      ref={containerRef}
      className={`pdf-canvas-wrapper ${className}`}
      aria-label={`PDF page ${pageNumber}`}
    >
      {isRendering && !renderError && (
        <div className="pdf-canvas-loading" aria-hidden="true">
          <Loader2 size={22} className="rdr-spin" />
        </div>
      )}

      {renderError && (
        <div className="pdf-canvas-error" role="alert">
          <span>{renderError}</span>
        </div>
      )}

      {pageSize && (
        <div
          ref={pageBoxRef}
          className="pdf-page-inner"
          style={{
            width: `${pageSize.width}px`,
            height: `${pageSize.height}px`,
            position: 'relative',
          }}
          onClick={handlePageBoxClick}
          onMouseMove={handlePageBoxMouseMove}
        >
          {/* 1. Underlying High-DPI Graphical Canvas */}
          <canvas
            ref={canvasRef}
            className="pdf-canvas-el"
            aria-label={`Rendered content of page ${pageNumber}`}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              opacity: isRendering ? 0 : 1,
              transition: 'opacity 0.2s ease',
            }}
          />

          {/* 2. Persistent Highlight Markers Layer */}
          <div
            className="pdf-highlights-layer"
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {pageHighlights.map((hl) =>
              hl.rects?.map((rect, idx) => (
                <mark
                  key={`${hl.id}-${idx}`}
                  className="pdf-highlight-mark"
                  style={{
                    position: 'absolute',
                    left: `${rect.left}%`,
                    top: `${rect.top}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                    backgroundColor: hl.colorHex || '#E7C18A',
                    opacity: 0.42,
                  }}
                  title={`"${hl.text}" (${new Date(hl.createdAt).toLocaleDateString()})`}
                />
              ))
            )}

            {/* Transient Search Highlights Layer (Never saved as permanent annotation) */}
            {pageSearchHighlights.map((match) => (
              <div
                key={match.key}
                className={`pdf-search-highlight-box ${match.isActive ? 'pdf-search-highlight-box--active' : 'pdf-search-highlight-box--inactive'}`}
                style={{
                  position: 'absolute',
                  left: `${match.rect.left}%`,
                  top: `${match.rect.top}%`,
                  width: `${match.rect.width}%`,
                  height: `${match.rect.height}%`,
                  cursor: match.isActive ? 'default' : 'pointer',
                  pointerEvents: match.isActive ? 'none' : 'auto',
                }}
                onClick={(e) => {
                  if (!match.isActive && onSelectSearchMatch) {
                    e.stopPropagation();
                    onSelectSearchMatch(match);
                  }
                }}
                aria-label={`Search match ${match.matchIndexOnPage || 1} of ${match.totalOnPage || 1}: ${match.matchedTerm || ''}`}
              >
                {match.totalOnPage > 1 && (
                  <span className={`pdf-search-highlight-pill ${match.isActive ? 'pdf-search-highlight-pill--active' : ''}`}>
                    {match.matchIndexOnPage || 1}/{match.totalOnPage}
                  </span>
                )}
              </div>
            ))}

            {/* Clear visual indication when coordinates are unavailable for active match on this page */}
            {activeSearchMatch &&
              Number(activeSearchMatch.pageNumber) === Number(pageNumber) &&
              !searchHighlightRect && (
                <div
                  className="pdf-search-no-bbox-notice"
                  role="status"
                  aria-live="polite"
                >
                  <Info size={13} className="flex-shrink-0" />
                  <span>Exact visual highlighting unavailable for this match</span>
                </div>
              )}
          </div>

          {/* 3. Transparent PDF.js Text Layer for native mouse text selection */}
          <div
            ref={textLayerRef}
            className="textLayer"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              pointerEvents: isRendering ? 'none' : 'auto',
            }}
            onMouseDown={() => {
              isMouseDownRef.current = true;
            }}
            onTouchEnd={handleTextSelection}
          />

          {/* 4. Floating Highlight Creator Popover */}
          {selectionPopup && (
            <div
              className="highlight-popover"
              style={{
                position: 'absolute',
                left: selectionPopup.x,
                top: selectionPopup.y,
              }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Create text highlight"
            >
              <div className="highlight-color-picker">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    className={`highlight-color-dot ${
                      selectionPopup.chosenColor === c.id ? 'active' : ''
                    }`}
                    style={{ backgroundColor: c.bg }}
                    onClick={() => handleCreateHighlight(c.id)}
                    title={`Highlight with ${c.label}`}
                    aria-label={c.label}
                  />
                ))}
              </div>

              <button
                className="highlight-action-btn highlight-action-btn--primary"
                onClick={() => handleCreateHighlight(selectionPopup.chosenColor)}
                title="Highlight selected passage"
              >
                <Highlighter size={13} />
                <span>Highlight</span>
              </button>

              <button
                className="modal-close-icon-btn"
                style={{ width: '20px', height: '20px', padding: 0 }}
                onClick={() => setSelectionPopup(null)}
                aria-label="Dismiss highlight menu"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* 5. Existing Highlight Details & Deletion Popover */}
          {activeHighlightPopup && (
            <div
              className="highlight-popover"
              style={{
                position: 'absolute',
                left: activeHighlightPopup.x,
                top: activeHighlightPopup.y,
              }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Highlight actions"
            >
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-ivory, #F4E9D7)',
                  maxWidth: '160px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                “{activeHighlightPopup.highlight.text}”
              </span>

              {onDeleteHighlight && (
                <button
                  className="highlight-action-btn highlight-action-btn--delete"
                  onClick={() => {
                    onDeleteHighlight(activeHighlightPopup.highlight.id);
                    setActiveHighlightPopup(null);
                  }}
                  title="Delete this highlight"
                >
                  <Trash2 size={12} />
                  <span>Delete</span>
                </button>
              )}

              <button
                className="modal-close-icon-btn"
                style={{ width: '20px', height: '20px', padding: 0 }}
                onClick={() => setActiveHighlightPopup(null)}
                aria-label="Close"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
