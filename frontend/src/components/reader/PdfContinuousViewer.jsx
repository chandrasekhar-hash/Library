/**
 * PdfContinuousViewer.jsx
 * Continuous vertical scrolling PDF viewer for PDF Mode.
 * Preserves original PDF layout, margins, and aspect ratio.
 * Tracks visible page via IntersectionObserver to update the toolbar indicator.
 */
import React, { useEffect, useRef } from 'react';
import PdfCanvas from './PdfCanvas';

export default function PdfContinuousViewer({
  pdfDoc,
  totalPages,
  scale = 1.5,
  currentPage,
  onPageChange,
  isSampleBook,
  book,
  highlights = [],
  onAddHighlight,
  onDeleteHighlight,
  bookId,
  preferredHighlightColor = 'gold',
  activeSearchMatch = null,
  allSearchMatches = [],
  onSelectSearchMatch = null,
}) {
  const containerRef = useRef(null);
  const pageRefs = useRef({});
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef(null);

  // Track which page is currently in view during natural vertical scrolling
  useEffect(() => {
    if (!containerRef.current || totalPages <= 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;

        // Find the entry with the highest intersection ratio
        let bestEntry = null;
        let maxRatio = 0;

        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            bestEntry = entry;
          }
        }

        if (bestEntry) {
          const pageNum = parseInt(bestEntry.target.dataset.pageNumber, 10);
          if (!isNaN(pageNum) && pageNum !== currentPage) {
            onPageChange(pageNum, false); // false = don't animate, natural scroll
          }
        }
      },
      {
        root: containerRef.current,
        threshold: [0.15, 0.4, 0.7],
        rootMargin: '-10% 0px -10% 0px',
      }
    );

    // Observe all page elements
    const elements = containerRef.current.querySelectorAll('.rdr-continuous-page-card');
    elements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, [totalPages, currentPage, onPageChange]);

  // Scroll to page when currentPage changes from an external source (toolbar, bookmarks, search)
  useEffect(() => {
    const targetEl = pageRefs.current[currentPage];
    if (targetEl && containerRef.current) {
      // Check if target is already reasonably in view
      const containerRect = containerRef.current.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();

      const isAlreadyVisible =
        targetRect.top >= containerRect.top - 80 &&
        targetRect.bottom <= containerRect.bottom + 80;

      if (!isAlreadyVisible) {
        isProgrammaticScrollRef.current = true;
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 650);
      }
    }
  }, [currentPage]);

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  if (isSampleBook || !pdfDoc) {
    return (
      <div className="rdr-pdf-scroll-container" ref={containerRef}>
        <div className="rdr-sample-placeholder">
          <div className="rdr-sample-paper">
            <div className="rdr-sample-header">
              <span className="rdr-sample-title">{book?.title || 'Aks Document'}</span>
              <span className="rdr-sample-pages">Page {currentPage} of {totalPages}</span>
            </div>
            <p className="rdr-sample-intro" style={{ margin: '20px 0', color: 'rgba(44,31,14,0.7)', fontStyle: 'italic' }}>
              Sample book mode. Import a real PDF via <em>Import Book</em> to scroll through genuine document pages.
            </p>
            <div className="rdr-sample-content-lines">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="rdr-sample-line"
                  style={{
                    width: `${60 + ((i * 13 + 5) % 38)}%`,
                    opacity: 0.25 + ((i % 4) * 0.12),
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rdr-pdf-scroll-container rdr-continuous-scroll"
      ref={containerRef}
      tabIndex={0}
      aria-label="Continuous PDF document view. Scroll vertically with trackpad or mouse wheel to read."
    >
      <div className="rdr-continuous-page-stack">
        {pageNumbers.map((pageNumber) => (
          <div
            key={pageNumber}
            ref={(el) => {
              if (el) pageRefs.current[pageNumber] = el;
            }}
            data-page-number={pageNumber}
            className={`rdr-continuous-page-card ${pageNumber === currentPage ? 'rdr-continuous-page-card--active' : ''}`}
            aria-label={`Document page ${pageNumber}`}
          >
            <div className="rdr-page-top-badge" aria-hidden="true">
              <span>{pageNumber}</span>
            </div>

            <div className="rdr-continuous-page-frame">
              <PdfCanvas
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                scale={scale}
                className="rdr-continuous-canvas"
                bookId={bookId || book?.id}
                highlights={highlights}
                onAddHighlight={onAddHighlight}
                onDeleteHighlight={onDeleteHighlight}
                preferredHighlightColor={preferredHighlightColor}
                activeSearchMatch={activeSearchMatch}
                allSearchMatches={allSearchMatches}
                onSelectSearchMatch={onSelectSearchMatch}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
