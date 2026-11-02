import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  AlertCircle,
  BookOpen,
  ArrowLeftRight,
} from 'lucide-react';
import { renderPageThumbnail } from '../../services/pdfService';
import BookCover from '../BookCover';

export default function ChangeCoverModal({
  isOpen,
  onClose,
  book,
  currentPage = 1,
  pdfDoc,
  onUpdateCover,
  onUpdateCoverPlacement,
  onResetCover,
}) {
  const [previewThumb, setPreviewThumb] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState(null);

  // Derive initial placement for this book (defaults to 'right')
  const initialPlacement =
    book?.coverPlacement ||
    book?.colorScheme?.coverPlacement ||
    book?.coverTheme?.coverPlacement ||
    'right';

  const [placement, setPlacement] = useState(initialPlacement);

  // Derive active cover status
  const hasCustomCover = Boolean(book?.hasCustomCover || book?.colorScheme?.hasCustomCover);
  const customCoverPage = book?.customCoverPage || book?.colorScheme?.customCoverPage || null;
  const activeCoverUrl = book?.coverUrl || book?.coverImage || book?.coverTheme?.coverUrl || null;
  const isCurrentPageAlreadyCover = hasCustomCover && customCoverPage === currentPage;
  const isPlacementChanged = placement !== initialPlacement;

  // Sync placement whenever modal opens or book changes
  useEffect(() => {
    if (isOpen) {
      setPlacement(
        book?.coverPlacement ||
          book?.colorScheme?.coverPlacement ||
          book?.coverTheme?.coverPlacement ||
          'right'
      );
    }
  }, [isOpen, book]);

  // Render thumbnail of currently displayed page when modal opens
  useEffect(() => {
    if (!isOpen) {
      setPreviewThumb(null);
      setError(null);
      return;
    }

    let isMounted = true;
    async function generatePreview() {
      if (!pdfDoc) return;
      try {
        setIsGenerating(true);
        setError(null);
        const thumb = await renderPageThumbnail(pdfDoc, currentPage, {
          targetWidth: 320,
          quality: 0.9,
        });
        if (isMounted) {
          setPreviewThumb(thumb);
        }
      } catch (err) {
        console.warn('[ChangeCoverModal] Could not render page preview:', err);
        if (isMounted) {
          setError('Could not render page preview. You can still set it as the cover.');
        }
      } finally {
        if (isMounted) {
          setIsGenerating(false);
        }
      }
    }

    generatePreview();

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentPage, pdfDoc]);

  if (!isOpen || !book) return null;

  // Selected cover image to display in the mini two-page book preview
  const displayCoverUrl =
    previewThumb?.dataUrl || activeCoverUrl || book?.coverUrl || book?.coverImage || null;

  // ── Primary Action: Set cover or update placement ──────────────────────────
  const handleSelectCover = async () => {
    if (isSaving || isResetting) return;

    try {
      setIsSaving(true);
      setError(null);

      // Case 1: Placement changed without needing a new page thumbnail
      if (isPlacementChanged) {
        if ((isCurrentPageAlreadyCover || !pdfDoc) && onUpdateCoverPlacement) {
          await onUpdateCoverPlacement(book.id, placement);
          onClose();
          return;
        }
      }

      // Case 2: Setting current page as book cover with chosen placement
      let thumb = previewThumb;
      if (!thumb && pdfDoc) {
        try {
          thumb = await renderPageThumbnail(pdfDoc, currentPage, {
            targetWidth: 400,
            quality: 0.92,
          });
        } catch (thumbErr) {
          console.warn('[ChangeCoverModal] Could not capture page thumbnail:', thumbErr);
        }
      }

      const coverBlob = thumb?.blob;
      if (!coverBlob && !thumb?.dataUrl) {
        // If thumbnail cannot be captured (e.g. sample book) but placement changed
        if (isPlacementChanged && onUpdateCoverPlacement) {
          await onUpdateCoverPlacement(book.id, placement);
          onClose();
          return;
        }
        throw new Error('Could not capture page image.');
      }

      if (onUpdateCover) {
        await onUpdateCover(book.id, coverBlob || thumb.dataUrl, currentPage, true, placement);
      }
      onClose();
    } catch (err) {
      console.error('[ChangeCoverModal] Failed to set cover / placement:', err);
      setError(err?.message || 'Failed to save cover. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Option B: "Leave as is" ─────────────────────────────────────────────
  const handleLeaveAsIs = () => {
    if (isSaving || isResetting) return;
    onClose();
  };

  // ── Separate Reset Action: Return to original PDF cover ─────────────────
  const handleReset = async () => {
    if (isSaving || isResetting || !onResetCover) return;

    try {
      setIsResetting(true);
      setError(null);

      // Render fresh page 1 thumbnail to guarantee original cover is available
      let defaultThumb = null;
      if (pdfDoc) {
        try {
          defaultThumb = await renderPageThumbnail(pdfDoc, 1, {
            targetWidth: 400,
            quality: 0.92,
          });
        } catch (thumbErr) {
          console.warn('[ChangeCoverModal] Could not regenerate page 1 thumbnail:', thumbErr);
        }
      }

      await onResetCover(book.id, defaultThumb);
      onClose();
    } catch (err) {
      console.error('[ChangeCoverModal] Failed to reset cover:', err);
      setError(err?.message || 'Failed to restore default cover. Please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      className="modal-backdrop cover-modal-backdrop"
      onClick={handleLeaveAsIs}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cover-modal-title"
    >
      <div
        className="cover-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="cover-modal-header">
          <div className="cover-header-title-box">
            <span className="cover-header-eyebrow">
              <Sparkles size={12} className="text-gold" />
              Volume Personalization
            </span>
            <h3 id="cover-modal-title" className="cover-modal-title">
              Change Book Cover
            </h3>
          </div>
          <button
            className="cover-close-btn"
            onClick={handleLeaveAsIs}
            aria-label="Close dialog"
            disabled={isSaving || isResetting}
          >
            <X size={18} />
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="cover-modal-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Section 1: Placement Selector & Interactive Two-Page Preview ── */}
        <div className="cover-placement-section">
          <div className="cover-placement-header">
            <div className="cover-placement-label-group">
              <span className="cover-placement-title">Cover Page Placement</span>
              <span className="cover-placement-desc">
                Select which page of the opening spread displays the book cover
              </span>
            </div>

            {/* Placement Options: Left Page vs Right Page */}
            <div
              className="cover-placement-toggle-group"
              role="radiogroup"
              aria-label="Book cover placement"
            >
              <button
                type="button"
                role="radio"
                aria-checked={placement === 'left'}
                className={`cover-placement-pill ${
                  placement === 'left' ? 'cover-placement-pill--active' : ''
                }`}
                onClick={() => setPlacement('left')}
                disabled={isSaving || isResetting}
                title="Display cover on the Left Page of the book"
              >
                <span className="cover-placement-pill-icon cover-placement-pill-icon--left" />
                <span>Left Page</span>
                {placement === 'left' && <Check size={13} className="cover-placement-check" />}
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={placement === 'right'}
                className={`cover-placement-pill ${
                  placement === 'right' ? 'cover-placement-pill--active' : ''
                }`}
                onClick={() => setPlacement('right')}
                disabled={isSaving || isResetting}
                title="Display cover on the Right Page of the book"
              >
                <span className="cover-placement-pill-icon cover-placement-pill-icon--right" />
                <span>Right Page</span>
                {placement === 'right' && <Check size={13} className="cover-placement-check" />}
              </button>
            </div>
          </div>

          {/* ── Miniature Two-Page Book Preview ── */}
          <div
            className="cover-spread-preview-wrap"
            aria-label={`Two-page preview showing cover on ${placement} page`}
          >
            <div className="cover-spread-preview-book">
              {/* Left Miniature Page */}
              <div
                className={`cover-spread-mini-page cover-spread-mini-page--left ${
                  placement === 'left'
                    ? 'cover-spread-mini-page--has-cover'
                    : 'cover-spread-mini-page--endpaper'
                }`}
                onClick={() => setPlacement('left')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPlacement('left');
                  }
                }}
                title="Click to place cover on Left Page"
              >
                {placement === 'left' ? (
                  <div className="mini-page-cover-content">
                    {displayCoverUrl ? (
                      <img
                        src={displayCoverUrl}
                        alt="Selected book cover preview"
                        className="mini-page-cover-img"
                      />
                    ) : (
                      <div className="mini-page-placeholder">
                        <BookOpen size={20} className="text-gold" />
                        <span>Cover</span>
                      </div>
                    )}
                    <div className="mini-page-badge mini-page-badge--cover">Cover Page</div>
                  </div>
                ) : (
                  <div className="mini-page-endpaper-content">
                    <div className="mini-endpaper-crest">
                      <BookOpen size={16} />
                    </div>
                    <div className="mini-endpaper-divider" />
                    <span className="mini-endpaper-motto">EX LIBRIS</span>
                    <span className="mini-endpaper-title">AKS</span>
                    <div className="mini-page-badge mini-page-badge--endpaper">Inside Cover</div>
                  </div>
                )}
              </div>

              {/* Central Spine Seam */}
              <div className="cover-spread-mini-spine" aria-hidden="true">
                <div className="mini-spine-shadow-left" />
                <div className="mini-spine-stitch" />
                <div className="mini-spine-shadow-right" />
              </div>

              {/* Right Miniature Page */}
              <div
                className={`cover-spread-mini-page cover-spread-mini-page--right ${
                  placement === 'right'
                    ? 'cover-spread-mini-page--has-cover'
                    : 'cover-spread-mini-page--endpaper'
                }`}
                onClick={() => setPlacement('right')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPlacement('right');
                  }
                }}
                title="Click to place cover on Right Page"
              >
                {placement === 'right' ? (
                  <div className="mini-page-cover-content">
                    {displayCoverUrl ? (
                      <img
                        src={displayCoverUrl}
                        alt="Selected book cover preview"
                        className="mini-page-cover-img"
                      />
                    ) : (
                      <div className="mini-page-placeholder">
                        <BookOpen size={20} className="text-gold" />
                        <span>Cover</span>
                      </div>
                    )}
                    <div className="mini-page-badge mini-page-badge--cover">Cover Page</div>
                  </div>
                ) : (
                  <div className="mini-page-endpaper-content">
                    <div className="mini-endpaper-crest">
                      <BookOpen size={16} />
                    </div>
                    <div className="mini-endpaper-divider" />
                    <span className="mini-endpaper-motto">EX LIBRIS</span>
                    <span className="mini-endpaper-title">AKS</span>
                    <div className="mini-page-badge mini-page-badge--endpaper">Inside Cover</div>
                  </div>
                )}
              </div>
            </div>

            <div className="cover-spread-preview-hint">
              <ArrowLeftRight size={12} className="text-gold" />
              <span>
                Cover will render on the{' '}
                <strong className="text-gold">
                  {placement === 'left' ? 'Left Page' : 'Right Page'}
                </strong>{' '}
                · Click either page to switch
              </span>
            </div>
          </div>
        </div>

        {/* ── Section 2: Active vs Current Page Comparison ── */}
        <div className="cover-comparison-grid">
          {/* Active Cover Column */}
          <div className="cover-preview-col">
            <span className="cover-col-label">
              Active Cover
              <span className="cover-status-chip">
                {hasCustomCover ? `Custom (Page ${customCoverPage})` : 'Default (Page 1)'}
              </span>
            </span>
            <div className="cover-thumb-container">
              <BookCover
                title={book.title}
                theme={book.coverTheme}
                coverUrl={activeCoverUrl}
                size="medium"
              />
            </div>
            <span className="cover-caption-text">
              {hasCustomCover
                ? `Custom cover selected from Page ${customCoverPage}`
                : 'Original PDF cover extracted from Page 1'}
            </span>
          </div>

          {/* Selected Page Preview Column */}
          <div className="cover-preview-col cover-preview-col--selected">
            <span className="cover-col-label">
              Selected Page
              <span className="cover-selected-chip">Page {currentPage} (Current)</span>
            </span>
            <div className="cover-thumb-container cover-thumb-container--active">
              {isGenerating ? (
                <div className="cover-generating-spinner">
                  <Loader2 size={24} className="rdr-spin text-gold" />
                  <span>Rendering Page {currentPage}…</span>
                </div>
              ) : previewThumb?.dataUrl ? (
                <BookCover
                  title={book.title}
                  theme={book.coverTheme}
                  coverUrl={previewThumb.dataUrl}
                  size="medium"
                />
              ) : (
                <div className="cover-generating-spinner">
                  <BookOpen size={24} className="text-gold" />
                  <span>Page {currentPage}</span>
                </div>
              )}
            </div>
            <span className="cover-caption-text">
              {isCurrentPageAlreadyCover
                ? isPlacementChanged
                  ? `Switch placement to ${placement === 'left' ? 'Left Page' : 'Right Page'}.`
                  : `Page ${currentPage} is already your active cover.`
                : `Set Page ${currentPage} as the permanent cover.`}
            </span>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="cover-actions-container">
          {/* Primary Action Button */}
          <button
            className={`cover-btn-primary ${
              isCurrentPageAlreadyCover && !isPlacementChanged ? 'cover-btn-primary--active' : ''
            }`}
            onClick={handleSelectCover}
            disabled={isSaving || isResetting || (isCurrentPageAlreadyCover && !isPlacementChanged)}
            aria-label="Set book cover and placement"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="rdr-spin" />
                <span>Saving Preferences…</span>
              </>
            ) : isPlacementChanged ? (
              <>
                <Check size={16} />
                <span>
                  Update Placement to {placement === 'left' ? 'Left Page' : 'Right Page'}
                </span>
              </>
            ) : isCurrentPageAlreadyCover ? (
              <>
                <CheckCircle2 size={16} />
                <span>
                  Page {currentPage} is Active Cover ({placement === 'left' ? 'Left' : 'Right'})
                </span>
              </>
            ) : (
              <>
                <Check size={16} />
                <span>
                  This is the book cover ({placement === 'left' ? 'Left Page' : 'Right Page'})
                </span>
              </>
            )}
          </button>

          {/* Secondary Action: Leave as is */}
          <button
            className="cover-btn-secondary"
            onClick={handleLeaveAsIs}
            disabled={isSaving || isResetting}
            aria-label="Leave current cover unchanged"
          >
            Leave as is
          </button>
        </div>

        {/* Separate Reset Action (Only displayed when custom cover is active) */}
        {hasCustomCover && (
          <div className="cover-reset-row">
            <button
              className="cover-reset-btn"
              onClick={handleReset}
              disabled={isSaving || isResetting}
              aria-label="Return to automatically generated original cover"
            >
              {isResetting ? (
                <>
                  <Loader2 size={13} className="rdr-spin" />
                  <span>Restoring Original Cover…</span>
                </>
              ) : (
                <>
                  <RotateCcw size={13} />
                  <span>Return to original PDF cover (Page 1)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
