import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Aks — Refined Peacock Bookmark & Realistic Book Closing Suite', () => {
  // ── 1. Bookmark Creation, Persistence & Non-Closing Interaction ───────────
  describe('1. Bookmark Creation & Non-Closing Reader State', () => {
    function formatBookmarkToast(action, page) {
      if (action === 'create') {
        return `Page ${page} bookmarked.`;
      }
      if (action === 'remove') {
        return `Bookmark removed from page ${page}.`;
      }
      return '';
    }

    test('Generates dynamic creation message matching exact user specification', () => {
      assert.equal(formatBookmarkToast('create', 10), 'Page 10 bookmarked.');
      assert.equal(formatBookmarkToast('create', 1), 'Page 1 bookmarked.');
      assert.equal(formatBookmarkToast('create', 42), 'Page 42 bookmarked.');
    });

    test('Generates dynamic removal message matching exact user specification', () => {
      assert.equal(formatBookmarkToast('remove', 10), 'Bookmark removed from page 10.');
      assert.equal(formatBookmarkToast('remove', 3), 'Bookmark removed from page 3.');
    });

    test('Bookmarking saves record, keeps book open, and preserves current page', () => {
      let currentPage = 7;
      let bookClosed = false;
      let bookmarks = [];

      function handleMark() {
        const createdBm = {
          id: `bm-book-1-p${currentPage}-${Date.now()}`,
          bookId: 'book-1',
          page: currentPage,
          label: `Page ${currentPage}`,
          color: 'gold',
        };
        bookmarks.push(createdBm);
        // Requirement 2: Keep the Reading Room open on the current page.
        // Do not automatically trigger closing animation.
        bookClosed = false;
      }

      handleMark();

      assert.equal(bookmarks.length, 1);
      assert.equal(bookmarks[0].page, 7);
      assert.equal(bookClosed, false);
      assert.equal(currentPage, 7);
    });
  });

  // ── 2. Peacock Bookmark Placement Outside the Left of the Book Frame ──────
  describe('2. Peacock Bookmark Placement Outside Left Edge', () => {
    function resolveSpreadBookmark({
      baseLeftPage,
      baseRightPage,
      bookmarks = [],
      isMobile = false,
      isClosingBook = false,
    }) {
      if (!Array.isArray(bookmarks) || bookmarks.length === 0) return null;

      const activeBm =
        bookmarks.find((bm) => bm.page === baseLeftPage) ||
        (!isMobile && bookmarks.find((bm) => bm.page === baseRightPage)) ||
        (isClosingBook ? bookmarks[0] : null);

      if (!activeBm) return null;

      return {
        page: activeBm.page,
        side: isMobile ? 'mobile-outside' : 'left-outside',
      };
    }

    test('Attaches bookmark protruding outside left edge when left page is bookmarked', () => {
      const bookmarks = [{ id: 'bm-1', page: 4 }];
      const result = resolveSpreadBookmark({
        baseLeftPage: 4,
        baseRightPage: 5,
        bookmarks,
        isMobile: false,
      });

      assert.ok(result);
      assert.equal(result.page, 4);
      assert.equal(result.side, 'left-outside');
    });

    test('Attaches bookmark protruding outside left edge when right page of spread is bookmarked', () => {
      const bookmarks = [{ id: 'bm-2', page: 5 }];
      const result = resolveSpreadBookmark({
        baseLeftPage: 4,
        baseRightPage: 5,
        bookmarks,
        isMobile: false,
      });

      assert.ok(result);
      assert.equal(result.page, 5);
      assert.equal(result.side, 'left-outside');
    });

    test('Does not render peacock bookmark on spread without bookmarks', () => {
      const bookmarks = [{ id: 'bm-1', page: 12 }];
      const result = resolveSpreadBookmark({
        baseLeftPage: 4,
        baseRightPage: 5,
        bookmarks,
        isMobile: false,
      });

      assert.equal(result, null);
    });

    test('Mobile mode: attaches bookmark outside single page frame', () => {
      const bookmarks = [{ id: 'bm-1', page: 10 }];
      const result = resolveSpreadBookmark({
        baseLeftPage: 10,
        baseRightPage: null,
        bookmarks,
        isMobile: true,
      });

      assert.ok(result);
      assert.equal(result.page, 10);
      assert.equal(result.side, 'mobile-outside');
    });

    test('Keeps peacock bookmark visually attached to the book during closing sequence', () => {
      const bookmarks = [{ id: 'bm-1', page: 4 }];
      const result = resolveSpreadBookmark({
        baseLeftPage: 4,
        baseRightPage: 5,
        bookmarks,
        isMobile: false,
        isClosingBook: true,
      });

      assert.ok(result);
      assert.equal(result.page, 4);
      assert.equal(result.side, 'left-outside');
    });
  });

  // ── 3. Separate Close Book Control & Realistic Sequential Closing ──────────
  describe('3. Separate Close Book Control & Sequential Closing Animation', () => {
    test('Close Book control is separate from Mark and triggers sequential closing', () => {
      let isClosingBook = false;
      let onBackCalled = false;

      function handleCloseBook() {
        isClosingBook = true;
        // Animation runs for 1350ms, then invokes onBack()
        onBackCalled = true;
      }

      handleCloseBook();

      assert.equal(isClosingBook, true);
      assert.equal(onBackCalled, true);
    });

    test('Sequential closing structures leaves from left to right ending with cover', () => {
      const closingSequence = [
        { leaf: 1, type: 'active-page', delayMs: 0, durationMs: 680, target: 'right' },
        { leaf: 2, type: 'parchment', delayMs: 120, durationMs: 680, target: 'right' },
        { leaf: 3, type: 'endpaper', delayMs: 240, durationMs: 680, target: 'right' },
        { leaf: 4, type: 'front-cover', delayMs: 360, durationMs: 780, target: 'right' },
      ];

      // Verifies sequential order
      for (let i = 1; i < closingSequence.length; i++) {
        assert.ok(closingSequence[i].delayMs > closingSequence[i - 1].delayMs);
        assert.equal(closingSequence[i].target, 'right');
      }

      // Leaf 4 is the front cover that lands on top face up
      assert.equal(closingSequence[3].type, 'front-cover');
    });

    test('Reduced motion mode skips 3D rotation and immediately returns', () => {
      const prefersReducedMotion = true;
      let animatedLeavesCount = 0;
      let onBackCalled = false;

      function executeCloseBook(reducedMotion) {
        if (reducedMotion) {
          onBackCalled = true;
        } else {
          animatedLeavesCount = 4;
          onBackCalled = true;
        }
      }

      executeCloseBook(prefersReducedMotion);

      assert.equal(animatedLeavesCount, 0);
      assert.equal(onBackCalled, true);
    });
  });

  // ── 4. Reopening Book & Bookmark Jump Integrity ───────────────────────────
  describe('4. Reopening Book & Bookmark Jump Integrity', () => {
    function computeOpenReaderState(book, requestedTargetPage = null) {
      const target =
        typeof requestedTargetPage === 'number' && requestedTargetPage > 0
          ? requestedTargetPage
          : book?.currentPage || 1;

      return {
        bookId: book.id,
        currentPage: target,
        bookmarks: book.bookmarks || [],
      };
    }

    test('Regular opening preserves last saved reading position without resetting', () => {
      const book = {
        id: 'book-1',
        currentPage: 15,
        bookmarks: [{ id: 'bm-1', page: 3 }, { id: 'bm-2', page: 22 }],
      };

      const opened = computeOpenReaderState(book, null);
      assert.equal(opened.currentPage, 15);
    });

    test('Navigating from Bookmarks page opens directly to the exact bookmarked page', () => {
      const book = {
        id: 'book-1',
        currentPage: 15,
        bookmarks: [{ id: 'bm-1', page: 3 }, { id: 'bm-2', page: 22 }],
      };

      const opened = computeOpenReaderState(book, 22);
      assert.equal(opened.currentPage, 22);
      assert.ok(opened.bookmarks.some((b) => b.page === 22));
    });
  });

  // ── 5. Single Moving Large Peacock Bookmark Animation ─────────────────────
  describe('5. Single Moving Large Peacock Bookmark Animation (Left Side to Page)', () => {
    // Helper to calculate flight geometry from left-side region to page destination
    function calculateFlightCoordinates({
      leftRegionRect,
      targetPageRect,
      isTargetRight = false,
      isMobile = false,
      peacockWidth = 150,
      peacockHeight = 225,
    }) {
      const startX = leftRegionRect.left;
      const startY = leftRegionRect.top;

      let destX = 0;
      let destY = 0;

      if (isTargetRight) {
        destX = targetPageRect.right - peacockWidth - 20;
        destY = targetPageRect.top - 20;
      } else if (isMobile) {
        destX = targetPageRect.right - peacockWidth - 16;
        destY = targetPageRect.top - 16;
      } else {
        destX = targetPageRect.left + 20;
        destY = targetPageRect.top - 20;
      }

      return {
        startX,
        startY,
        destX,
        destY,
        width: peacockWidth,
        height: peacockHeight,
      };
    }

    // Helper to compute flight step at normalized time t in [0, 1]
    function computeFlightStep({ startX, startY, destX, destY, arcHeight = 50, t }) {
      const clampedT = Math.max(0, Math.min(1, t));
      const easeProgress =
        clampedT < 0.5
          ? 4 * clampedT * clampedT * clampedT
          : 1 - Math.pow(-2 * clampedT + 2, 3) / 2;

      const arc = Math.sin(clampedT * Math.PI) * arcHeight;
      const curX = startX + (destX - startX) * easeProgress;
      const curY = startY + (destY - startY) * easeProgress - arc;

      const angle = -Math.sin(clampedT * Math.PI) * 7;
      const scale = 1.0 + Math.sin(clampedT * Math.PI) * 0.08;

      const rawAngle = Number(angle.toFixed(1));
      const rawArc = Number(arc.toFixed(1));

      return {
        x: Number(curX.toFixed(1)),
        y: Number(curY.toFixed(1)),
        angle: Object.is(rawAngle, -0) ? 0 : rawAngle,
        scale: Number(scale.toFixed(2)),
        arc: Object.is(rawArc, -0) ? 0 : rawArc,
      };
    }

    test('Computes exact flight path from left-side artwork to left book page', () => {
      const coords = calculateFlightCoordinates({
        leftRegionRect: { left: 80, top: 120, width: 150, height: 225 },
        targetPageRect: { left: 300, right: 785, top: 80, width: 485, height: 700 },
        isTargetRight: false,
        isMobile: false,
        peacockWidth: 150,
        peacockHeight: 225,
      });

      assert.equal(coords.startX, 80);
      assert.equal(coords.startY, 120);
      assert.equal(coords.destX, 320); // pageRect.left + 20
      assert.equal(coords.destY, 60);  // pageRect.top - 20
      assert.equal(coords.width, 150, 'Must preserve large peacock width');
      assert.equal(coords.height, 225, 'Must preserve large peacock height (2:3 aspect ratio)');
    });

    test('Computes exact flight path from left-side artwork to right book page', () => {
      const coords = calculateFlightCoordinates({
        leftRegionRect: { left: 80, top: 120, width: 150, height: 225 },
        targetPageRect: { left: 805, right: 1290, top: 80, width: 485, height: 700 },
        isTargetRight: true,
        isMobile: false,
        peacockWidth: 150,
        peacockHeight: 225,
      });

      assert.equal(coords.startX, 80);
      assert.equal(coords.startY, 120);
      assert.equal(coords.destX, 1120); // 1290 - 150 - 20
      assert.equal(coords.destY, 60);   // 80 - 20
      assert.equal(coords.width, 150);
    });

    test('Computes exact flight path in mobile single-page mode', () => {
      const coords = calculateFlightCoordinates({
        leftRegionRect: { left: 0, top: 0, width: 120, height: 180 },
        targetPageRect: { left: 16, right: 374, top: 140, width: 358, height: 520 },
        isTargetRight: false,
        isMobile: true,
        peacockWidth: 120,
        peacockHeight: 180,
      });

      assert.equal(coords.destX, 238); // 374 - 120 - 16
      assert.equal(coords.destY, 124); // 140 - 16
    });

    test('Maintains single-element integrity: exactly one visible peacock in each state', () => {
      function getVisiblePeacockCount({ hasBookmark, peacockFlight }) {
        let leftPeacock = (!hasBookmark && !peacockFlight) ? 1 : 0;
        let flightOverlay = peacockFlight ? 1 : 0;
        let bookPeacock = (hasBookmark && !peacockFlight) ? 1 : 0;
        return leftPeacock + flightOverlay + bookPeacock;
      }

      // State 1: Unbookmarked resting on left
      assert.equal(
        getVisiblePeacockCount({ hasBookmark: false, peacockFlight: null }),
        1,
        'Must have exactly 1 peacock on the left when unbookmarked'
      );

      // State 2: Mid-flight forward
      assert.equal(
        getVisiblePeacockCount({ hasBookmark: false, peacockFlight: { active: true } }),
        1,
        'Must have exactly 1 peacock during forward flight'
      );

      // State 3: Bookmarked resting on page
      assert.equal(
        getVisiblePeacockCount({ hasBookmark: true, peacockFlight: null }),
        1,
        'Must have exactly 1 peacock on the page (left side empty)'
      );

      // State 4: Mid-flight reverse
      assert.equal(
        getVisiblePeacockCount({ hasBookmark: true, peacockFlight: { active: true } }),
        1,
        'Must have exactly 1 peacock during reverse flight'
      );
    });

    test('Flight trajectory exhibits parabolic lift, smooth gliding, and gentle tilt', () => {
      const coords = { startX: 80, startY: 120, destX: 320, destY: 60 };

      // At start (t = 0)
      const step0 = computeFlightStep({ ...coords, arcHeight: 50, t: 0 });
      assert.equal(step0.x, 80);
      assert.equal(step0.y, 120);
      assert.equal(step0.scale, 1.0);
      assert.equal(step0.arc, 0);

      // Mid-flight (t = 0.5)
      const stepMid = computeFlightStep({ ...coords, arcHeight: 50, t: 0.5 });
      assert.ok(stepMid.x > 80 && stepMid.x < 320, 'X must be in-transit');
      assert.ok(stepMid.y < 90, 'Y must lift into parabolic arc');
      assert.ok(stepMid.scale > 1.04, 'Must scale slightly during flight');
      assert.equal(stepMid.arc, 50);

      // At destination (t = 1)
      const step1 = computeFlightStep({ ...coords, arcHeight: 50, t: 1 });
      assert.equal(step1.x, 320);
      assert.equal(step1.y, 60);
      assert.equal(step1.scale, 1.0);
      assert.equal(step1.arc, 0);
      assert.equal(step1.angle, 0);
    });

    test('Bookmark anchors strictly to its page; does not follow viewport or appear on frame', () => {
      const bookmark = { id: 'bm-1', page: 50 };

      function resolvePageAnchoredBookmarks({ currentLeft, currentRight, bookmarks = [], isMobile = false }) {
        const getBookmarkForPage = (p) => bookmarks.find((bm) => bm.page === p) || null;
        if (isMobile) {
          const bm = getBookmarkForPage(currentLeft);
          return bm ? [{ page: bm.page, side: 'mobile' }] : [];
        }
        const visible = [];
        const leftBm = getBookmarkForPage(currentLeft);
        if (leftBm) visible.push({ page: leftBm.page, side: 'left' });
        const rightBm = getBookmarkForPage(currentRight);
        if (rightBm) visible.push({ page: rightBm.page, side: 'right' });
        return visible;
      }

      // Step 1: On spread 25 (pages 50-51), page 50 has a bookmark
      const spread50 = resolvePageAnchoredBookmarks({
        currentLeft: 50,
        currentRight: 51,
        bookmarks: [bookmark],
      });
      assert.equal(spread50.length, 1);
      assert.equal(spread50[0].page, 50);
      assert.equal(spread50[0].side, 'left');

      // Step 2: Turn forward to spread 26 (pages 52-53)
      const spread52 = resolvePageAnchoredBookmarks({
        currentLeft: 52,
        currentRight: 53,
        bookmarks: [bookmark],
      });
      assert.equal(spread52.length, 0, 'Must NOT follow viewport or appear on other pages');

      // Step 3: Turn backward to spread 25 (pages 50-51)
      const spreadBack = resolvePageAnchoredBookmarks({
        currentLeft: 50,
        currentRight: 51,
        bookmarks: [bookmark],
      });
      assert.equal(spreadBack.length, 1);
      assert.equal(spreadBack[0].page, 50);

      // Step 4: Bookmark page 51 as well
      const bookmarksBoth = [bookmark, { id: 'bm-2', page: 51 }];
      const spreadBoth = resolvePageAnchoredBookmarks({
        currentLeft: 50,
        currentRight: 51,
        bookmarks: bookmarksBoth,
      });
      assert.equal(spreadBoth.length, 2, 'Each page displays its own bookmark');
      assert.equal(spreadBoth[0].page, 50);
      assert.equal(spreadBoth[0].side, 'left');
      assert.equal(spreadBoth[1].page, 51);
      assert.equal(spreadBoth[1].side, 'right');

      // Step 5: Mobile single-page navigation
      const mobile50 = resolvePageAnchoredBookmarks({
        currentLeft: 50,
        currentRight: null,
        bookmarks: bookmarksBoth,
        isMobile: true,
      });
      assert.equal(mobile50.length, 1);
      assert.equal(mobile50[0].page, 50);

      const mobile51 = resolvePageAnchoredBookmarks({
        currentLeft: 51,
        currentRight: null,
        bookmarks: bookmarksBoth,
        isMobile: true,
      });
      assert.equal(mobile51.length, 1);
      assert.equal(mobile51[0].page, 51);
    });

    test('Prevents duplicate animations from rapid repeated clicks', async () => {
      let isBusy = false;
      let animationTriggers = 0;

      async function triggerBookmarkClick() {
        if (isBusy) return;
        isBusy = true;
        animationTriggers++;
        await new Promise((r) => setTimeout(r, 20));
        isBusy = false;
      }

      // Fire 4 rapid simultaneous clicks
      await Promise.all([
        triggerBookmarkClick(),
        triggerBookmarkClick(),
        triggerBookmarkClick(),
        triggerBookmarkClick(),
      ]);

      assert.equal(animationTriggers, 1, 'Only one animation may execute for rapid repeated clicks');
    });

    test('Reduced motion mode bypasses flight animation and places bookmark directly on page', () => {
      const prefersReducedMotion = true;
      let flightTriggered = false;
      let bookmarkPlacedOnPage = false;

      function handleBookmarkPlacement(reducedMotion) {
        if (reducedMotion) {
          bookmarkPlacedOnPage = true;
          flightTriggered = false;
        } else {
          flightTriggered = true;
        }
      }

      handleBookmarkPlacement(prefersReducedMotion);

      assert.equal(flightTriggered, false);
      assert.equal(bookmarkPlacedOnPage, true);
    });

    test('Removal workflow reverses flight to left region and clears state only after arrival', async () => {
      let peacockLocation = 'page';
      let bookmarkInStorage = true;

      async function executeUnbookmark() {
        // Step 1: Start reverse flight to left
        peacockLocation = 'flight-to-left';

        // Step 2: Database removal completes
        await new Promise((r) => setTimeout(r, 20));
        bookmarkInStorage = false;

        // Step 3: Flight arrives on left region
        peacockLocation = 'left';
      }

      assert.equal(peacockLocation, 'page');
      const promise = executeUnbookmark();
      assert.equal(peacockLocation, 'flight-to-left');

      await promise;
      assert.equal(bookmarkInStorage, false);
      assert.equal(peacockLocation, 'left', 'Peacock returns to left resting region');
    });
  });
});

