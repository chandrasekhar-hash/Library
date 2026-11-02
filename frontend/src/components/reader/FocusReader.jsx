/**
 * FocusReader.jsx
 * Focus Mode — comfortable reading layout.
 * Extracts text from the current PDF page via pdfjs and displays it in a
 * typographically pleasant format. Falls back to showing the page canvas
 * if the page has no text layer (scanned/image-based PDF).
 */
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Loader2, AlertCircle, BookOpen } from 'lucide-react';
import { extractPageText } from '../../services/pdfService';
import PdfCanvas from './PdfCanvas';

const FONT_SIZES = [
  { label: 'S', value: '0.95rem' },
  { label: 'M', value: '1.1rem' },
  { label: 'L', value: '1.25rem' },
  { label: 'XL', value: '1.4rem' },
];

const BG_THEMES = [
  { id: 'navy', label: 'Night', bg: 'rgba(8,14,25,0.97)', text: '#EBE0CC' },
  { id: 'cream', label: 'Cream', bg: '#FAF6EF', text: '#2C1F0E' },
  { id: 'slate', label: 'Slate', bg: '#1A2232', text: '#CBD5E1' },
  { id: 'sepia', label: 'Sepia', bg: '#F5ECD7', text: '#3D2B1F' },
];

export default function FocusReader({
  pdfDoc,
  currentPage,
  totalPages,
  isSampleBook,
  onPageChange,
  typographyPrefs,
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasText, setHasText] = useState(true);

  const initialTheme = useMemo(() => {
    if (typographyPrefs?.surfaceTheme) {
      const match = BG_THEMES.find((t) => t.id === typographyPrefs.surfaceTheme);
      if (match) return match;
    }
    return BG_THEMES[0];
  }, [typographyPrefs?.surfaceTheme]);

  const [fontSize, setFontSize] = useState(() => {
    if (typographyPrefs?.fontSize) {
      return `${typographyPrefs.fontSize}px`;
    }
    return '1.1rem';
  });
  const [bgTheme, setBgTheme] = useState(initialTheme);
  const prevPageRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (isSampleBook) {
      setText(SAMPLE_TEXT);
      setHasText(true);
      setLoading(false);
      return;
    }

    if (!pdfDoc || !currentPage) return;
    if (prevPageRef.current === currentPage) return;
    prevPageRef.current = currentPage;

    setLoading(true);
    extractPageText(pdfDoc, currentPage)
      .then((extracted) => {
        const cleaned = extracted.trim();
        if (cleaned.length > 20) {
          setText(cleaned);
          setHasText(true);
        } else {
          setText('');
          setHasText(false);
        }
      })
      .catch(() => {
        setText('');
        setHasText(false);
      })
      .finally(() => setLoading(false));
  }, [pdfDoc, currentPage, isSampleBook]);

  // Scroll to top when page changes
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [currentPage]);

  return (
    <div className="focus-reader-outer">
      {/* ── Focus controls bar ──────────────────────────────────────────────── */}
      <div className="focus-controls-bar" aria-label="Focus mode controls">
        <div className="focus-control-group" aria-label="Font size">
          {FONT_SIZES.map((f) => (
            <button
              key={f.label}
              className={`focus-ctrl-btn ${fontSize === f.value ? 'focus-ctrl-btn--active' : ''}`}
              onClick={() => setFontSize(f.value)}
              aria-pressed={fontSize === f.value}
              title={`Font size ${f.label}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="focus-control-group" aria-label="Reading background">
          {BG_THEMES.map((t) => (
            <button
              key={t.id}
              className={`focus-theme-dot ${bgTheme.id === t.id ? 'focus-theme-dot--active' : ''}`}
              style={{ background: t.bg, border: `2px solid ${bgTheme.id === t.id ? 'var(--accent-gold)' : 'transparent'}` }}
              onClick={() => setBgTheme(t)}
              title={`${t.label} background`}
              aria-label={`${t.label} background`}
              aria-pressed={bgTheme.id === t.id}
            />
          ))}
        </div>

        <span className="focus-page-indicator" aria-live="polite">
          Page {currentPage} of {totalPages}
        </span>
      </div>

      {/* ── Reading area ─────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="focus-reader-scroll"
        style={{ background: bgTheme.bg }}
      >
        <div className="focus-reader-body">
          {loading ? (
            <div className="focus-loading-state" aria-busy="true">
              <Loader2 size={24} className="rdr-spin" />
              <span>Extracting text…</span>
            </div>
          ) : hasText ? (
            <div
              className="focus-text-content"
              style={{
                fontSize,
                color: bgTheme.text,
                lineHeight: typographyPrefs?.lineHeight || '1.85',
                fontFamily:
                  typographyPrefs?.fontFamily === 'serif'
                    ? 'var(--font-serif, "Playfair Display", Georgia, serif)'
                    : typographyPrefs?.fontFamily === 'sans'
                    ? 'var(--font-sans, "Plus Jakarta Sans", sans-serif)'
                    : typographyPrefs?.fontFamily === 'mono'
                    ? 'monospace'
                    : 'inherit',
              }}
            >
              <p className="focus-page-heading" style={{ color: bgTheme.text, opacity: 0.5 }}>
                — Page {currentPage} —
              </p>
              {text.split('\n\n').filter(Boolean).map((para, i) => (
                <p key={i}>{para.replace(/\n/g, ' ')}</p>
              ))}
            </div>
          ) : (
            /* No text layer: show canvas render instead */
            <div className="focus-no-text-fallback">
              <div className="focus-notice-banner" role="status">
                <AlertCircle size={16} />
                <span>
                  This page appears to be image-based (no selectable text). Showing
                  the original PDF render.
                </span>
              </div>
              {pdfDoc ? (
                <PdfCanvas pdfDoc={pdfDoc} pageNumber={currentPage} scale={1.2} />
              ) : (
                <div className="focus-sample-placeholder">
                  <BookOpen size={32} style={{ opacity: 0.3 }} />
                  <p>No content available for this page.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Page nav (bottom) ───────────────────────────────────────────────── */}
      <div className="focus-bottom-nav">
        <button
          className="focus-nav-btn"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          ← Previous
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          {currentPage} / {totalPages}
        </span>
        <button
          className="focus-nav-btn"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

const SAMPLE_TEXT = `The afternoon light fell obliquely through the study window, casting long amber rectangles across the floor. She had always preferred to read in this hour — the golden hour, her grandmother called it — when the world seemed to pause before the inevitable decline into evening.

The pages before her were worn at the corners, the paper gone soft with handling. She had read this passage before, perhaps many times, but each return revealed something new, some shift in emphasis that she had not noticed previously. That was the nature of great books, she thought. They grew with you.

Outside, the garden was turning. Leaves, still clinging to their branches, had taken on that particular amber glow that presaged their fall. The old oak at the garden's edge had dropped half its canopy already; the rest would follow within the week.

She turned the page carefully, mindful of the binding's fragility. The smell of old paper rose to meet her — that particular scent that no digital reproduction had yet managed to approximate. There was something irreducibly physical about a book, she reflected. Its weight in the hand. The resistance of paper under the thumb. The sound of turning pages in a quiet room.

She read on, losing herself in the prose, the garden forgotten, the declining light unnoticed until the words grew too dim to follow without strain.`;
