/**
 * BookSpread.jsx
 * Aks Physical Book Mode — Fixed-viewport stationary book with realistic
 * 3D paper page-turning animations around a central spine.
 *
 * Architecture:
 *   BookViewport (stationary, centered, overflow: hidden)
 *     └── FixedBookFrame (desktop 2-page spread / mobile single page)
 *           ├── LeftPage (stationary or revealing page underneath)
 *           ├── CentralSpine (desktop only)
 *           ├── RightPage (stationary or revealing page underneath)
 *           └── PageTurnLayer (active only during 3D turn animation)
 *
 * Navigation:
 *   - Spread 0: Left = Endpaper, Right = Page 1 (Cover)
 *   - Spread 1: Left = Page 2, Right = Page 3
 *   - Spread 2: Left = Page 4, Right = Page 5
 *   - Odd end: Left = Page N, Right = Colophon
 *
 * Interactions:
 *   - Click Next/Prev floating arrows
 *   - Click right/left page surfaces
 *   - Click interactive dog-ear bottom corners
 *   - Deliberate mouse-wheel / trackpad gesture (debounced, non-scrolling)
 *   - Arrow keys (Left/Right)
 *   - Horizontal touch swipe gestures on mobile
 */
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import PdfCanvas from './PdfCanvas';
import { getPageDimensions } from '../../services/pdfService';
import {
  calculateBookFrameDimensions,
  getSpreadForIndex,
  getSpreadIndexForPage,
  getTotalSpreadsCount,
} from '../../utils/bookDimensions';
import {
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  CornerDownLeft,
  BookOpen,
  BookX,
} from 'lucide-react';
import PeacockBookmark from './PeacockBookmark';
import BookCover from '../BookCover';
import peacockImg from '../../assets/peacock.png';
import { playPageTurnSound } from '../../services/soundService';

export { calculateBookFrameDimensions };

const BookSpread = forwardRef(function BookSpread(
  {
    pdfDoc,
    currentPage = 1,
    totalPages = 1,
    scale = 1.0,
    onPageChange,
    isSampleBook = false,
    animationEnabled = true,
    animationSpeed = 'normal',
    highlights = [],
    onAddHighlight,
    onDeleteHighlight,
    bookId,
    preferredHighlightColor = 'gold',
    bookmarks = [],
    book = null,
    isClosingBook = false,
    isBookClosed = false,
    onCloseBook = null,
    onBack = null,
    bookmarkClosingState = null,
    retractingBookmarkPage = null,
    flyingBookmarkPage = null,
    onFlightComplete = null,
    onRemoveBookmark = null,
    pageTurnSoundEnabled = true,
    activeSearchMatch = null,
    allSearchMatches = [],
    onSelectSearchMatch = null,
  },
  ref
) {
  const viewportRef = useRef(null);
  const bookFrameRef = useRef(null);
  const leftPageRef = useRef(null);
  const rightPageRef = useRef(null);
  const peacockLeftRegionRef = useRef(null);
  const peacockLeftImgRef = useRef(null);
  const leftPagePeacockRef = useRef(null);
  const rightPagePeacockRef = useRef(null);
  const pagePeacockRef = useRef(null);
  const flightRafRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const wheelLockRef = useRef(false);
  const wheelAccumulatorRef = useRef(0);
  const wheelTimerRef = useRef(null);
  const turnTimerRef = useRef(null);
  const wheelLockTimerRef = useRef(null);

  const [peacockFlight, setPeacockFlight] = useState(null);

  // ── Animation Duration & Enablement ───────────────────────────────────────
  const animDuration = useMemo(() => {
    if (animationSpeed === 'slow') return 800;
    if (animationSpeed === 'fast') return 250;
    return 500;
  }, [animationSpeed]);

  // ── 3D Turn Animation State ───────────────────────────────────────────────
  const [turnState, setTurnState] = useState(null);

  // ── Viewport / Responsive State ───────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768;
    }
    return false;
  });

  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  const [pdfDimensions, setPdfDimensions] = useState({
    width: 595,
    height: 842,
    aspectRatio: 595 / 842,
  });

  // Query PDF.js for page 1 dimensions at scale 1.0 only when pdfDoc first becomes available.
  // We intentionally do NOT re-query on every currentPage change — that would change bookDimensions
  // mid-read and cause the book frame to shift/shake during page turns.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    const fetchDims = async () => {
      try {
        // Always measure page 1 to get a stable reference dimension for the entire document.
        const dims = await getPageDimensions(pdfDoc, 1);
        if (!cancelled && dims && dims.width > 0 && dims.height > 0) {
          setPdfDimensions({
            width: dims.width,
            height: dims.height,
            aspectRatio: dims.width / dims.height,
          });
        }
      } catch (err) {
        console.warn('[BookSpread] Failed to fetch PDF page dimensions:', err);
      }
    };

    fetchDims();

    return () => {
      cancelled = true;
    };
  // Only re-run when the document itself changes, NOT when currentPage changes.
  }, [pdfDoc]);

  useEffect(() => {
    let rafId = null;

    const updateSize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const vp = viewportRef.current;
        const width = vp && vp.clientWidth > 0 ? vp.clientWidth : window.innerWidth;
        const height = vp && vp.clientHeight > 0 ? vp.clientHeight : window.innerHeight;
        const mobile = width <= 768;

        setViewportSize((prev) => {
          if (Math.abs(prev.width - width) < 2 && Math.abs(prev.height - height) < 2) {
            return prev;
          }
          return { width, height };
        });

        setIsMobile((prev) => {
          if (prev !== mobile) {
            // Cancel any in-flight turn animation safely if layout mode changes
            if (turnTimerRef.current) {
              clearTimeout(turnTimerRef.current);
              turnTimerRef.current = null;
            }
            setTurnState(null);
            return mobile;
          }
          return prev;
        });
      });
    };

    updateSize();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && viewportRef.current) {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(viewportRef.current);
    }
    window.addEventListener('resize', updateSize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateSize);
      if (turnTimerRef.current) {
        clearTimeout(turnTimerRef.current);
        turnTimerRef.current = null;
      }
      if (wheelLockTimerRef.current) {
        clearTimeout(wheelLockTimerRef.current);
        wheelLockTimerRef.current = null;
      }
    };
  }, []);

  // ── Calculate PDF-Aware Responsive Dimensions ─────────────────────────────
  const bookDimensions = useMemo(() => {
    // When the decorative peacock artwork is displayed beside the book on desktop/tablet,
    // reserve dedicated clearance for the peacock artwork so the book spread sizes to fill
    // the available centre/right space without causing horizontal overflow.
    const peacockReservedWidth = isMobile
      ? 0
      : viewportSize.width >= 1200
      ? Math.min(180, Math.round(viewportSize.width * 0.115)) + 120
      : viewportSize.width >= 768
      ? 110 + 64
      : 0;

    return calculateBookFrameDimensions({
      viewportWidth: viewportSize.width - peacockReservedWidth,
      viewportHeight: viewportSize.height,
      pdfWidth: pdfDimensions.width,
      pdfHeight: pdfDimensions.height,
      isMobile,
      safeMarginX: isMobile ? 12 : 24,
      safeMarginY: isMobile ? 12 : 10,
    });
  }, [viewportSize, pdfDimensions, isMobile]);

  // Check prefers-reduced-motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Realistic Physical Book Opening Animation on Mount ────────────────────
  const [isOpeningSpread, setIsOpeningSpread] = useState(
    () => animationEnabled && !prefersReducedMotion
  );
  useEffect(() => {
    if (animationEnabled && !prefersReducedMotion) {
      const timer = setTimeout(() => {
        setIsOpeningSpread(false);
      }, 550);
      return () => clearTimeout(timer);
    }
  }, [animationEnabled, prefersReducedMotion]);

  // ── Spread Calculations ───────────────────────────────────────────────────
  const totalSpreads = useMemo(() => {
    return isMobile ? totalPages : getTotalSpreadsCount(totalPages);
  }, [isMobile, totalPages]);

  const coverPlacement = useMemo(() => {
    return (
      book?.coverPlacement ||
      book?.colorScheme?.coverPlacement ||
      book?.coverTheme?.coverPlacement ||
      'right'
    );
  }, [book?.coverPlacement, book?.colorScheme?.coverPlacement, book?.coverTheme?.coverPlacement]);

  const customCoverPage = useMemo(() => {
    const hasCustom = Boolean(book?.hasCustomCover || book?.colorScheme?.hasCustomCover);
    if (!hasCustom) return null;
    return book?.customCoverPage || book?.colorScheme?.customCoverPage || null;
  }, [book?.hasCustomCover, book?.colorScheme?.hasCustomCover, book?.customCoverPage, book?.colorScheme?.customCoverPage]);

  const currentSpreadIdx = useMemo(() => {
    if (isMobile) {
      return Math.max(0, Math.min(totalPages - 1, currentPage - 1));
    }
    return Math.max(
      0,
      Math.min(totalSpreads - 1, getSpreadIndexForPage(currentPage, coverPlacement, customCoverPage))
    );
  }, [isMobile, currentPage, totalPages, totalSpreads, coverPlacement, customCoverPage]);

  const currentSpread = useMemo(() => {
    if (isMobile) {
      return {
        index: currentSpreadIdx,
        left: currentSpreadIdx + 1,
        right: null,
        mainPage: currentSpreadIdx + 1,
      };
    }
    return getSpreadForIndex(currentSpreadIdx, totalPages, coverPlacement, customCoverPage);
  }, [isMobile, currentSpreadIdx, totalPages, coverPlacement, customCoverPage]);

  // ── Navigation Boundaries ─────────────────────────────────────────────────
  const canGoBack = isMobile ? currentPage > 1 : currentSpreadIdx > 0;
  const canGoForward = isMobile
    ? currentPage < totalPages
    : currentSpreadIdx < totalSpreads - 1;

  // ── Trigger 3D Page Turn Animation ────────────────────────────────────────
  const triggerPageTurn = useCallback(
    (direction) => {
      if (turnState?.active) return;

      if (direction === 'next' && !canGoForward) return;
      if (direction === 'prev' && !canGoBack) return;

      if (isMobile) {
        // Mobile single-page navigation
        const targetPage =
          direction === 'next'
            ? Math.min(totalPages, currentPage + 1)
            : Math.max(1, currentPage - 1);

        if (targetPage === currentPage) return;

        // Play realistic physical paper turn sound
        playPageTurnSound({ enabled: pageTurnSoundEnabled });

        if (prefersReducedMotion || !animationEnabled) {
          onPageChange(targetPage);
          return;
        }

        setTurnState({
          active: true,
          direction,
          frontPage: currentPage,
          backPage: targetPage,
          targetPage,
        });

        if (turnTimerRef.current) {
          clearTimeout(turnTimerRef.current);
          turnTimerRef.current = null;
        }

        turnTimerRef.current = setTimeout(() => {
          onPageChange(targetPage);
          setTurnState(null);
          turnTimerRef.current = null;
        }, animDuration);
        return;
      }

      // Desktop 2-page spread navigation
      const targetSpreadIdx =
        direction === 'next' ? currentSpreadIdx + 1 : currentSpreadIdx - 1;
      const targetSpread = getSpreadForIndex(targetSpreadIdx, totalPages, coverPlacement, customCoverPage);

      // Determine the primary page to report to parent
      const targetPage =
        targetSpreadIdx === 0
          ? 1
          : targetSpread.left || targetSpread.right || 1;

      // Play realistic physical paper turn sound
      playPageTurnSound({ enabled: pageTurnSoundEnabled });

      if (prefersReducedMotion || !animationEnabled) {
        onPageChange(targetPage);
        return;
      }

      // Determine pages on the turning leaf
      let frontPage = null;
      let backPage = null;

      if (direction === 'next') {
        // Leaf turns from right to left around central spine:
        // Front face of leaf is the turning right page (currentSpread.right)
        // Back face of leaf is the landing left page (targetSpread.left)
        frontPage = currentSpread.right;
        backPage = targetSpread.left;
      } else {
        // Leaf turns from left to right around central spine:
        // Front face of leaf is the lifting left page (currentSpread.left)
        // Back face of leaf is the landing right page (targetSpread.right)
        frontPage = currentSpread.left;
        backPage = targetSpread.right;
      }

      setTurnState({
        active: true,
        direction,
        frontPage,
        backPage,
        targetSpread,
        targetPage,
      });

      // Duration matches configured animation speed
      if (turnTimerRef.current) {
        clearTimeout(turnTimerRef.current);
        turnTimerRef.current = null;
      }

      turnTimerRef.current = setTimeout(() => {
        onPageChange(targetPage);
        setTurnState(null);
        turnTimerRef.current = null;
      }, animDuration);
    },
    [
      turnState,
      canGoForward,
      canGoBack,
      isMobile,
      totalPages,
      currentPage,
      currentSpreadIdx,
      currentSpread,
      coverPlacement,
      customCoverPage,
      prefersReducedMotion,
      animationEnabled,
      animDuration,
      onPageChange,
      pageTurnSoundEnabled,
    ]
  );

  const handlePrev = useCallback(() => {
    if (canGoBack && !turnState?.active) {
      triggerPageTurn('prev');
    }
  }, [canGoBack, turnState, triggerPageTurn]);

  const handleNext = useCallback(() => {
    if (canGoForward && !turnState?.active) {
      triggerPageTurn('next');
    }
  }, [canGoForward, turnState, triggerPageTurn]);

  // Expose methods for toolbar / keyboard shortcuts
  useImperativeHandle(
    ref,
    () => ({
      triggerPrev: handlePrev,
      triggerNext: handleNext,
      canGoBack,
      canGoForward,
    }),
    [handlePrev, handleNext, canGoBack, canGoForward]
  );

  // ── Keyboard Navigation (Arrow keys within book surface) ──────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrev, handleNext]);

  // ── Deliberate Mouse-Wheel / Trackpad Gesture (No Page Stacking) ───────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      // Prevent browser default window scrolling entirely
      e.preventDefault();

      if (wheelLockRef.current || turnState?.active) return;

      wheelAccumulatorRef.current += e.deltaY;

      // Require a deliberate gesture threshold (>= 38px)
      if (Math.abs(wheelAccumulatorRef.current) >= 38) {
        if (wheelAccumulatorRef.current > 0 && canGoForward) {
          wheelLockRef.current = true;
          handleNext();
          if (wheelLockTimerRef.current) clearTimeout(wheelLockTimerRef.current);
          wheelLockTimerRef.current = setTimeout(() => {
            wheelLockRef.current = false;
            wheelAccumulatorRef.current = 0;
            wheelLockTimerRef.current = null;
          }, 650);
        } else if (wheelAccumulatorRef.current < 0 && canGoBack) {
          wheelLockRef.current = true;
          handlePrev();
          if (wheelLockTimerRef.current) clearTimeout(wheelLockTimerRef.current);
          wheelLockTimerRef.current = setTimeout(() => {
            wheelLockRef.current = false;
            wheelAccumulatorRef.current = 0;
            wheelLockTimerRef.current = null;
          }, 650);
        } else {
          wheelAccumulatorRef.current = 0;
        }
      }

      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => {
        wheelAccumulatorRef.current = 0;
      }, 200);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      clearTimeout(wheelTimerRef.current);
      if (wheelLockTimerRef.current) {
        clearTimeout(wheelLockTimerRef.current);
        wheelLockTimerRef.current = null;
      }
    };
  }, [canGoForward, canGoBack, turnState, handleNext, handlePrev]);

  // ── Touch Swipe Gestures (Mobile & Tablet) ────────────────────────────────
  const handleTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchEnd = (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;

    // Check for clear horizontal swipe
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      if (deltaX < 0 && canGoForward) {
        handleNext();
      } else if (deltaX > 0 && canGoBack) {
        handlePrev();
      }
    }
  };

  // ── Determine what pages are rendered in base frame ───────────────────────
  // During turnState:
  // Next: base left shows current left; base right displays target right underneath leaf
  // Prev: base left displays target left underneath leaf; base right shows current right
  let baseLeftPage = currentSpread.left;
  let baseRightPage = currentSpread.right;

  if (turnState?.active) {
    if (turnState.direction === 'next') {
      baseLeftPage = currentSpread.left;
      baseRightPage = turnState.targetSpread?.right ?? null;
    } else {
      baseLeftPage = turnState.targetSpread?.left ?? null;
      baseRightPage = currentSpread.right;
    }
  }

  // ── Physical Bookmark Marker Resolution (Protruding from left outer frame) ──
  const closingStage = isBookClosed
    ? 'closed'
    : isClosingBook
    ? 'closing'
    : bookmarkClosingState?.active
    ? bookmarkClosingState.stage
    : null;
  const closingPage = bookmarkClosingState?.page ?? null;

  // ── Page-Anchored Bookmark Resolution ──────────────────────────────────────
  const getBookmarkForPage = useCallback(
    (pageNum) => {
      if (!pageNum || !Array.isArray(bookmarks) || bookmarks.length === 0) return null;
      return bookmarks.find((bm) => bm.page === pageNum) || null;
    },
    [bookmarks]
  );

  const leftBookmark = !isMobile ? getBookmarkForPage(baseLeftPage) : null;
  const rightBookmark = !isMobile ? getBookmarkForPage(baseRightPage) : null;
  const mobileBookmark = isMobile ? getBookmarkForPage(currentPage) : null;
  const turnFrontBookmark = turnState?.active
    ? getBookmarkForPage(turnState.frontPage)
    : null;
  const turnBackBookmark = turnState?.active
    ? getBookmarkForPage(turnState.backPage)
    : null;

  const isCurrentSpreadBookmarked = Boolean(leftBookmark || rightBookmark || mobileBookmark);
  const showLeftPeacock = !isCurrentSpreadBookmarked && !peacockFlight;

  // ── Forward Flight Animation: Left Region -> Bookmarked Page ───────────────
  useEffect(() => {
    if (!flyingBookmarkPage) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReduced) {
      onFlightComplete?.();
      return;
    }

    const startEl = peacockLeftImgRef.current || peacockLeftRegionRef.current;
    const isTargetRight = !isMobile && flyingBookmarkPage === baseRightPage;
    const targetPageEl = isTargetRight ? rightPageRef.current : leftPageRef.current;

    if (!startEl || !targetPageEl) {
      onFlightComplete?.();
      return;
    }

    const startRect = startEl.getBoundingClientRect();
    const pageRect = targetPageEl.getBoundingClientRect();
    const flightWidth = startRect.width > 0 ? startRect.width : 150;
    const flightHeight = startRect.height > 0 ? startRect.height : 225;

    let destX = 0;
    let destY = 0;

    if (isTargetRight) {
      destX = pageRect.right - flightWidth - 20;
      destY = pageRect.top - 24;
    } else if (isMobile) {
      destX = pageRect.right - flightWidth - 16;
      destY = pageRect.top - 16;
    } else {
      destX = pageRect.left + 20;
      destY = pageRect.top - 24;
    }

    const startX = startRect.left;
    const startY = startRect.top;
    const duration = 680;
    const startTime = performance.now();
    const arcHeight = Math.min(50, Math.max(30, pageRect.height * 0.08));

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const curX = startX + (destX - startX) * ease;
      const lift = Math.sin(t * Math.PI) * arcHeight;
      const curY = startY + (destY - startY) * ease - lift;

      const angle = -Math.sin(t * Math.PI) * 7;
      const scale = 1.0 + Math.sin(t * Math.PI) * 0.08;

      setPeacockFlight({
        x: curX,
        y: curY,
        width: flightWidth,
        height: flightHeight,
        angle,
        scale,
        opacity: 1,
        direction: 'to-page',
      });

      if (t < 1) {
        flightRafRef.current = requestAnimationFrame(animate);
      } else {
        flightRafRef.current = null;
        setPeacockFlight(null);
        onFlightComplete?.();
      }
    };

    flightRafRef.current = requestAnimationFrame(animate);

    return () => {
      if (flightRafRef.current) {
        cancelAnimationFrame(flightRafRef.current);
        flightRafRef.current = null;
      }
    };
  }, [flyingBookmarkPage, baseRightPage, isMobile, onFlightComplete]);

  // ── Reverse Flight Animation: Bookmarked Page -> Left Region ───────────────
  useEffect(() => {
    if (!retractingBookmarkPage) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReduced) return;

    const isRetractingRight = !isMobile && retractingBookmarkPage === baseRightPage;
    const startEl = isRetractingRight
      ? (rightPagePeacockRef.current || rightPageRef.current)
      : (leftPagePeacockRef.current || pagePeacockRef.current || leftPageRef.current);
    const leftRegionEl = peacockLeftRegionRef.current;

    const startRect = startEl?.getBoundingClientRect();
    const leftRect = leftRegionEl?.getBoundingClientRect();

    const flightWidth = startRect?.width || 150;
    const flightHeight = startRect?.height || 225;

    const startX = startRect ? startRect.left : 400;
    const startY = startRect ? startRect.top : 100;

    const destX = leftRect
      ? leftRect.left + (leftRect.width - flightWidth) / 2
      : 60;
    const destY = leftRect
      ? leftRect.top + (leftRect.height - flightHeight) / 2
      : 100;

    const duration = 620;
    const startTime = performance.now();
    const arcHeight = 40;

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const curX = startX + (destX - startX) * ease;
      const lift = Math.sin(t * Math.PI) * arcHeight;
      const curY = startY + (destY - startY) * ease - lift;

      const angle = Math.sin(t * Math.PI) * 6;
      const scale = 1.0 + Math.sin(t * Math.PI) * 0.06;

      setPeacockFlight({
        x: curX,
        y: curY,
        width: flightWidth,
        height: flightHeight,
        angle,
        scale,
        opacity: 1,
        direction: 'to-left',
      });

      if (t < 1) {
        flightRafRef.current = requestAnimationFrame(animate);
      } else {
        flightRafRef.current = null;
        setPeacockFlight(null);
      }
    };

    flightRafRef.current = requestAnimationFrame(animate);

    return () => {
      if (flightRafRef.current) {
        cancelAnimationFrame(flightRafRef.current);
        flightRafRef.current = null;
      }
    };
  }, [retractingBookmarkPage]);

  // Helper to safely handle clicking on page surfaces without flipping when selecting text
  const handlePageSurfaceClick = (e, action) => {
    if (e.defaultPrevented) return;

    // If text was selected by cursor dragging, do not turn page!
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
      return;
    }
    // If clicked inside popover or highlight marker, do not turn page!
    if (
      e.target.closest('.highlight-popover') ||
      e.target.closest('.pdf-highlight-mark') ||
      e.target.closest('.highlight-color-dot') ||
      e.target.closest('.highlight-action-btn') ||
      e.target.closest('.modal-close-icon-btn')
    ) {
      return;
    }
    action();
  };

  // Helper to render page content (PDF Canvas, Endpaper, Colophon, or Sample)
  const renderPageContent = (pageNum, side, isTurning = false) => {
    if (!pageNum) {
      if (side === 'left') {
        return <BookEndpaper side="left" />;
      }
      if (currentSpreadIdx === 0 || (turnState?.active && turnState?.targetSpread?.index === 0)) {
        return <BookEndpaper side="right" />;
      }
      return <BookColophon />;
    }

    if (isSampleBook) {
      return <SamplePagePlaceholder page={pageNum} side={side} />;
    }

    if (pdfDoc) {
      return (
        <PdfCanvas
          key={`page-canvas-${pageNum}`}
          pdfDoc={pdfDoc}
          pageNumber={pageNum}
          scale={1.0}
          fitToContainer={true}
          bookId={bookId}
          highlights={highlights}
          onAddHighlight={onAddHighlight}
          onDeleteHighlight={onDeleteHighlight}
          preferredHighlightColor={preferredHighlightColor}
          knownWidth={bookDimensions.pageWidth}
          knownHeight={bookDimensions.pageHeight}
          renderTextLayerEnabled={!isTurning}
          activeSearchMatch={activeSearchMatch}
          allSearchMatches={allSearchMatches}
          onSelectSearchMatch={onSelectSearchMatch}
        />
      );
    }

    return <PageLoadingPlaceholder />;
  };

  // ── CLOSED state: show the book cover resting closed, until user clicks Back ──
  if (isBookClosed) {
    return (
      <div className="book-mode-container book-mode-container--closed" aria-label="Book closed">
        <div className="book-closed-view">
          <div
            className="book-closed-cover-wrap"
            style={{
              width: `${Math.round(bookDimensions.pageWidth * 0.85)}px`,
              height: `${bookDimensions.frameHeight}px`,
            }}
          >
            <BookCover
              title={book?.title || 'Untitled Book'}
              theme={book?.coverTheme || book?.theme || {}}
              coverUrl={book?.coverUrl}
              coverImage={book?.coverImage}
              size="large"
            />
          </div>
          {onBack && (
            <button
              className="book-closed-back-btn"
              onClick={onBack}
              aria-label="Return to library"
              autoFocus
            >
              <BookOpen size={17} />
              Back to Library
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="book-mode-container"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-label="Physical book reading room. Use Next/Previous controls, arrow keys, or trackpad gesture to turn pages."
    >
      {/* ── Left Floating Page-Turn Arrow ──────────────────────────────────── */}
      <button
        className="book-floating-arrow book-floating-arrow--left"
        onClick={handlePrev}
        disabled={!canGoBack || turnState?.active}
        aria-label="Turn to previous page"
        title="Turn page backward (←)"
      >
        <ChevronLeft size={22} />
      </button>

      {/* ── Stationary Book Viewport ────────────────────────────────────────── */}
      <div
        className="book-viewport"
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label="Book reading area"
        style={{
          '--book-frame-width': `${bookDimensions.frameWidth}px`,
          '--book-frame-height': `${bookDimensions.frameHeight}px`,
        }}
      >
        {/* ── Left Region: Large Decorative Peacock Artwork ────────────────── */}
        {!isMobile && (
          <div
            className="reading-room-peacock-region"
            ref={peacockLeftRegionRef}
            aria-hidden={!showLeftPeacock}
          >
            {showLeftPeacock && (
              <img
                ref={peacockLeftImgRef}
                src={peacockImg}
                alt="Aks Peacock Sanctuary Artwork"
                className="reading-room-peacock-img"
                draggable={false}
              />
            )}
          </div>
        )}

        {/* Fixed Stationary Book Frame */}
        <div
          ref={bookFrameRef}
          className={`fixed-book-frame ${
            turnState?.active ? 'fixed-book-frame--animating' : ''
          } ${isMobile ? 'fixed-book-frame--mobile' : ''} ${
            closingStage === 'closing' || closingStage === 'closed'
              ? 'fixed-book-frame--closing'
              : ''
          }`}
          style={{
            width: `${bookDimensions.frameWidth}px`,
            height: `${bookDimensions.frameHeight}px`,
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          {/* ── Left Page (or single page on mobile) ────────────────────────── */}
          <div
            ref={leftPageRef}
            className={`book-page book-page--left ${
              !baseLeftPage ? 'book-page--endpaper' : ''
            } ${
              isClosingBook
                ? isMobile
                  ? 'book-page--closing-mobile'
                  : 'book-page--closing-active-left'
                : ''
            } ${isOpeningSpread ? 'book-page--opening-left' : ''}`}
            style={{
              width: `${bookDimensions.pageWidth}px`,
              height: `${bookDimensions.pageHeight}px`,
              flex: isMobile ? '1 1 auto' : `0 0 ${bookDimensions.pageWidth}px`,
            }}
            onClick={(e) => {
              if (canGoBack && !turnState?.active && !isClosingBook) {
                handlePageSurfaceClick(e, handlePrev);
              }
            }}
            title={canGoBack ? 'Click left page to turn backward' : ''}
          >
            {/* Page-Anchored Large Peacock Bookmark on Left Page (Desktop) */}
            {!isMobile && leftBookmark && !peacockFlight && (
              <div
                ref={leftPagePeacockRef}
                className="book-page-large-peacock book-page-large-peacock--left"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBookmark?.(leftBookmark);
                }}
                title={`Page ${leftBookmark.page} bookmarked. Click to remove.`}
                role="button"
                tabIndex={0}
              >
                <img
                  src={peacockImg}
                  alt={`Peacock bookmark on page ${leftBookmark.page}`}
                  className="book-page-large-peacock-img"
                  draggable={false}
                />
              </div>
            )}

            {/* Page-Anchored Large Peacock Bookmark on Mobile Page */}
            {isMobile && mobileBookmark && !peacockFlight && !turnState?.active && (
              <div
                ref={leftPagePeacockRef}
                className="book-page-large-peacock book-page-large-peacock--mobile"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBookmark?.(mobileBookmark);
                }}
                title={`Page ${mobileBookmark.page} bookmarked. Click to remove.`}
                role="button"
                tabIndex={0}
              >
                <img
                  src={peacockImg}
                  alt={`Peacock bookmark on page ${mobileBookmark.page}`}
                  className="book-page-large-peacock-img"
                  draggable={false}
                />
              </div>
            )}

            <div
              className="book-page-content"
              style={{
                padding: `${bookDimensions.pagePad}px`,
              }}
            >
              {renderPageContent(baseLeftPage, 'left')}
            </div>

            {/* Closing shadow overlay that darkens page surface as pages shut */}
            {(closingStage === 'closing' || closingStage === 'closed') && (
              <div
                className="book-closing-shadow book-closing-shadow--left"
                aria-hidden="true"
              />
            )}

            {baseLeftPage && (
              <span
                className="book-page-number book-page-number--left"
                onClick={(e) => {
                  e.stopPropagation();
                  onPageChange?.(baseLeftPage);
                }}
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                title={`Select page ${baseLeftPage}`}
              >
                {baseLeftPage}
              </span>
            )}

            {/* Dog-ear curl on bottom-left corner */}
            {canGoBack && !closingStage && (
              <div
                className="book-dogear-curl book-dogear-curl--left"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                title="Turn page backward"
                role="button"
                aria-label="Turn page backward"
              >
                <CornerDownLeft size={12} className="book-dogear-icon" />
              </div>
            )}
          </div>

          {/* ── Central Spine (Desktop only) ───────────────────────────────── */}
          {!isMobile && (
            <div
              className="book-spine"
              style={{
                width: `${bookDimensions.spineWidth}px`,
                flex: `0 0 ${bookDimensions.spineWidth}px`,
              }}
              aria-hidden="true"
            >
              <div className="book-spine-shadow-left" />
              <div className="book-spine-center-stitch" />
              <div className="book-spine-shadow-right" />
            </div>
          )}

          {/* ── Right Page (Desktop only) ──────────────────────────────────── */}
          {!isMobile && (
            <div
              ref={rightPageRef}
              className={`book-page book-page--right ${
                !baseRightPage
                  ? currentSpreadIdx === 0
                    ? 'book-page--endpaper'
                    : 'book-page--colophon'
                  : ''
              } ${
                closingStage === 'closing' || closingStage === 'closed'
                  ? 'book-page--closing-right'
                  : ''
              } ${isOpeningSpread ? 'book-page--opening-right' : ''}`}
              style={{
                width: `${bookDimensions.pageWidth}px`,
                height: `${bookDimensions.pageHeight}px`,
                flex: `0 0 ${bookDimensions.pageWidth}px`,
              }}
              onClick={(e) => {
                if (canGoForward && !turnState?.active && !isClosingBook) {
                  handlePageSurfaceClick(e, handleNext);
                }
              }}
              title={canGoForward ? 'Click right page to turn forward' : ''}
            >
              {/* Page-Anchored Large Peacock Bookmark on Right Page (Desktop) */}
              {!isMobile && rightBookmark && !peacockFlight && (
                <div
                  ref={rightPagePeacockRef}
                  className="book-page-large-peacock book-page-large-peacock--right"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveBookmark?.(rightBookmark);
                  }}
                  title={`Page ${rightBookmark.page} bookmarked. Click to remove.`}
                  role="button"
                  tabIndex={0}
                >
                  <img
                    src={peacockImg}
                    alt={`Peacock bookmark on page ${rightBookmark.page}`}
                    className="book-page-large-peacock-img"
                    draggable={false}
                  />
                </div>
              )}

              <div
                className="book-page-content"
                style={{
                  padding: `${bookDimensions.pagePad}px`,
                }}
              >
                {renderPageContent(baseRightPage, 'right')}
              </div>

              {/* Closing shadow overlay that darkens page surface as pages shut */}
              {(closingStage === 'closing' || closingStage === 'closed') && (
                <div
                  className="book-closing-shadow book-closing-shadow--right"
                  aria-hidden="true"
                />
              )}

              {baseRightPage && (
                <span
                  className="book-page-number book-page-number--right"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageChange?.(baseRightPage);
                  }}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  title={`Select page ${baseRightPage}`}
                >
                  {baseRightPage}
                </span>
              )}

              {/* Dog-ear curl on bottom-right corner */}
              {canGoForward && !closingStage && (
                <div
                  className="book-dogear-curl book-dogear-curl--right"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNext();
                  }}
                  title="Turn page forward"
                  role="button"
                  aria-label="Turn page forward"
                >
                  <CornerDownRight size={12} className="book-dogear-icon" />
                </div>
              )}
            </div>
          )}

          {/* ── Realistic Sequential Book Closing Overlay (Left to Right to Front Cover) ── */}
          {isClosingBook && (
            <div
              className={`book-closing-sequence-overlay ${
                isMobile ? 'book-closing-sequence-overlay--mobile' : ''
              }`}
              aria-hidden="true"
            >
              {/* Leaf 1: Current open left page folds across to the right */}
              <div className="book-closing-leaf book-closing-leaf--1">
                <div className="book-closing-face book-closing-face--front">
                  <div
                    className="book-page-content"
                    style={{ padding: `${bookDimensions.pagePad}px` }}
                  >
                    {renderPageContent(baseLeftPage, 'left')}
                  </div>
                  <div className="book-closing-shadow-overlay" />
                </div>
                <div className="book-closing-face book-closing-face--back">
                  <div className="book-page-content book-page-content--parchment">
                    <div className="book-closing-inner-lines" />
                  </div>
                  <div className="book-closing-shadow-overlay book-closing-shadow-overlay--back" />
                </div>
              </div>

              {/* Leaf 2: Interior parchment leaf folds across sequentially */}
              <div className="book-closing-leaf book-closing-leaf--2">
                <div className="book-closing-face book-closing-face--front">
                  <div className="book-page-content book-page-content--parchment">
                    <div className="book-closing-inner-lines" />
                  </div>
                  <div className="book-closing-shadow-overlay" />
                </div>
                <div className="book-closing-face book-closing-face--back">
                  <div className="book-page-content book-page-content--parchment">
                    <div className="book-closing-inner-lines" />
                  </div>
                  <div className="book-closing-shadow-overlay book-closing-shadow-overlay--back" />
                </div>
              </div>

              {/* Leaf 3: Front Endpaper folds across sequentially */}
              <div className="book-closing-leaf book-closing-leaf--3">
                <div className="book-closing-face book-closing-face--front">
                  <BookEndpaper />
                  <div className="book-closing-shadow-overlay" />
                </div>
                <div className="book-closing-face book-closing-face--back">
                  <div className="book-cover-inside-velvet" />
                  <div className="book-closing-shadow-overlay book-closing-shadow-overlay--back" />
                </div>
              </div>

              {/* Leaf 4: Front Cover closes across and lands face-up on top */}
              <div className="book-closing-leaf book-closing-leaf--cover">
                <div className="book-closing-face book-closing-face--front">
                  <div className="book-cover-inside-velvet" />
                  <div className="book-closing-shadow-overlay" />
                </div>
                <div className="book-closing-face book-closing-face--back book-closing-face--real-cover">
                  <BookCover
                    title={book?.title || 'Untitled Book'}
                    theme={book?.coverTheme || book?.theme || {}}
                    coverUrl={book?.coverUrl}
                    coverImage={book?.coverImage}
                    size="medium"
                  />
                  <div className="book-closing-shadow-overlay book-closing-shadow-overlay--back" />
                </div>
              </div>
            </div>
          )}

          {/* ── PageTurnLayer: 3D Paper Page Turn Animation Overlay ─────────── */}
          {turnState?.active && (
            <div
              className={`book-turn-overlay book-turn-overlay--${
                turnState.direction
              } ${isMobile ? 'book-turn-overlay--mobile' : ''}`}
              aria-hidden="true"
            >
              <div
                className={`book-turn-leaf book-turn-leaf--${turnState.direction}`}
              >
                {/* Front Face of Turning Leaf */}
                <div
                  className={`book-turn-face book-turn-face--front book-turn-face--${
                    turnState.direction === 'next' ? 'right' : 'left'
                  }`}
                >
                  <div
                    className="book-page-content"
                    style={{
                      width: `${bookDimensions.pageWidth}px`,
                      height: `${bookDimensions.pageHeight}px`,
                      padding: `${bookDimensions.pagePad}px`,
                      flex: `0 0 ${bookDimensions.pageWidth}px`,
                    }}
                  >
                    {renderPageContent(
                      turnState.frontPage,
                      turnState.direction === 'next' ? 'right' : 'left',
                      true
                    )}
                  </div>
                  {/* Turning leaf front bookmark (lifts and turns with front face) */}
                  {turnFrontBookmark && !peacockFlight && (
                    <div
                      className={`book-page-large-peacock ${
                        isMobile
                          ? 'book-page-large-peacock--mobile'
                          : turnState.direction === 'next'
                          ? 'book-page-large-peacock--right'
                          : 'book-page-large-peacock--left'
                      }`}
                      aria-hidden="true"
                    >
                      <img
                        src={peacockImg}
                        alt={`Peacock bookmark on page ${turnFrontBookmark.page}`}
                        className="book-page-large-peacock-img"
                        draggable={false}
                      />
                    </div>
                  )}
                  {turnState.frontPage && (
                    <span
                      className={`book-page-number book-page-number--${
                        turnState.direction === 'next' ? 'right' : 'left'
                      }`}
                    >
                      {turnState.frontPage}
                    </span>
                  )}
                  <div className="book-turn-shadow-overlay book-turn-shadow--front" />
                </div>

                {/* Back Face of Turning Leaf (sweeps over to opposite side) */}
                <div
                  className={`book-turn-face book-turn-face--back book-turn-face--${
                    turnState.direction === 'next' ? 'left' : 'right'
                  }`}
                >
                  <div
                    className="book-page-content"
                    style={{
                      width: `${bookDimensions.pageWidth}px`,
                      height: `${bookDimensions.pageHeight}px`,
                      padding: `${bookDimensions.pagePad}px`,
                      flex: `0 0 ${bookDimensions.pageWidth}px`,
                    }}
                  >
                    {renderPageContent(
                      turnState.backPage,
                      turnState.direction === 'next' ? 'left' : 'right',
                      true
                    )}
                  </div>
                  {/* Turning leaf back bookmark (lands on new side with back face) */}
                  {turnBackBookmark && !peacockFlight && (
                    <div
                      className={`book-page-large-peacock ${
                        isMobile
                          ? 'book-page-large-peacock--mobile'
                          : turnState.direction === 'next'
                          ? 'book-page-large-peacock--left'
                          : 'book-page-large-peacock--right'
                      }`}
                      aria-hidden="true"
                    >
                      <img
                        src={peacockImg}
                        alt={`Peacock bookmark on page ${turnBackBookmark.page}`}
                        className="book-page-large-peacock-img"
                        draggable={false}
                      />
                    </div>
                  )}
                  {turnState.backPage && (
                    <span
                      className={`book-page-number book-page-number--${
                        turnState.direction === 'next' ? 'left' : 'right'
                      }`}
                    >
                      {turnState.backPage}
                    </span>
                  )}
                  <div className="book-turn-shadow-overlay book-turn-shadow--back" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Separate Close Book Control (Outside Right) ──────────────────────── */}
      {onCloseBook && (
        <button
          className="book-close-control"
          onClick={onCloseBook}
          disabled={isClosingBook || turnState?.active}
          title="Close Book"
          aria-label="Close Book"
        >
          <span className="book-close-control-icon">
            <BookX size={15} />
          </span>
          <span className="book-close-control-label">Close Book</span>
        </button>
      )}

      {/* ── Right Floating Page-Turn Arrow ─────────────────────────────────── */}
      <button
        className="book-floating-arrow book-floating-arrow--right"
        onClick={handleNext}
        disabled={!canGoForward || turnState?.active}
        aria-label="Turn to next page"
        title="Turn page forward (→)"
      >
        <ChevronRight size={22} />
      </button>

      {/* ── In-Flight Animated Large Peacock Bookmark Layer ── */}
      {peacockFlight && (
        <div
          className="reading-room-peacock-flight"
          style={{
            width: `${peacockFlight.width}px`,
            height: `${peacockFlight.height}px`,
            transform: `translate3d(${peacockFlight.x.toFixed(1)}px, ${peacockFlight.y.toFixed(1)}px, 0) rotate(${peacockFlight.angle.toFixed(1)}deg) scale(${peacockFlight.scale.toFixed(2)})`,
            opacity: peacockFlight.opacity ?? 1,
          }}
        >
          <img
            src={peacockImg}
            alt="Flying Peacock Bookmark"
            className="reading-room-peacock-flight-img"
            draggable={false}
          />
        </div>
      )}
    </div>
  );
});

export default BookSpread;

/**
 * High-grade ivory laid paper endpaper rendered inside front cover.
 */
function BookEndpaper({ side = 'left' }) {
  return (
    <div
      className={`book-endpaper book-endpaper--${side}`}
      aria-label={side === 'left' ? 'Inside front cover' : 'Opposite inside cover'}
    >
      <div className="book-endpaper-frame">
        <div className="book-endpaper-crest">
          <BookOpen size={30} className="book-endpaper-crest-icon" />
        </div>
        <div className="book-endpaper-divider" />
        <span className="book-endpaper-motto">EX LIBRIS</span>
        <span className="book-endpaper-title">AKS SANCTUARY</span>
        <span className="book-endpaper-sub">Private Reading Collection</span>
        <div className="book-endpaper-watermark">Aks Edition</div>
      </div>
    </div>
  );
}

/**
 * Colophon flourish rendered on the final page of odd-count volumes.
 */
function BookColophon() {
  return (
    <div className="book-colophon" aria-label="End of document">
      <div className="book-colophon-content">
        <div className="book-colophon-ornament">✦ · · ✦ · · ✦</div>
        <p className="book-colophon-finis">FINIS</p>
        <p className="book-colophon-sub">End of Volume</p>
        <div className="book-colophon-seal">Aks · Reading Room</div>
      </div>
    </div>
  );
}

function PageLoadingPlaceholder() {
  return (
    <div className="book-page-loading" aria-hidden="true">
      <div className="book-skeleton-line" style={{ width: '85%' }} />
      <div className="book-skeleton-line" style={{ width: '100%' }} />
      <div className="book-skeleton-line" style={{ width: '70%' }} />
      <div className="book-skeleton-line" style={{ width: '92%' }} />
      <div className="book-skeleton-line" style={{ width: '78%' }} />
    </div>
  );
}

function SamplePagePlaceholder({ page, side }) {
  return (
    <div className={`book-sample-page book-sample-page--${side}`}>
      <p className="book-sample-page-num">Page {page}</p>
      <p className="book-sample-intro">
        {side === 'left'
          ? 'The literary sanctuary opens onto ivory laid paper. A stationary, physical open book with realistic paper turns creates an authentic reading experience.'
          : 'Reading continues seamlessly across the physical spread. Real PDF documents imported through Aks render faithfully on these surfaces.'}
      </p>
      <div className="book-sample-lines">
        {[...Array(14)].map((_, i) => (
          <div
            key={i}
            className="book-sample-line"
            style={{ width: `${58 + ((i * 19 + 7) % 39)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
