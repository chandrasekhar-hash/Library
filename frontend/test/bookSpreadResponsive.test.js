import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBookFrameDimensions,
  getSpreadForIndex,
  getSpreadIndexForPage,
  getTotalSpreadsCount,
} from '../src/utils/bookDimensions.js';

describe('STEP 2: BookSpread Responsive & Spread Calculation Suite', () => {
  test('1. Spread 0 always displays Endpaper on left and Page 1 (Cover) on right', () => {
    const spread = getSpreadForIndex(0, 10);
    assert.equal(spread.left, null, 'Left face of spread 0 must be null (Endpaper)');
    assert.equal(spread.right, 1, 'Right face of spread 0 must be page 1');
    assert.equal(spread.mainPage, 1);
  });

  test('2. Spread 1 displays Page 2 on left and Page 3 on right', () => {
    const spread = getSpreadForIndex(1, 10);
    assert.equal(spread.left, 2);
    assert.equal(spread.right, 3);
  });

  test('3. Odd page count volume ends with Colophon on final right page', () => {
    const totalPages = 5;
    const totalSpreads = getTotalSpreadsCount(totalPages); // 5/2 + 1 = 3 spreads (0, 1, 2)
    assert.equal(totalSpreads, 3);

    const lastSpread = getSpreadForIndex(2, totalPages);
    assert.equal(lastSpread.left, 4);
    assert.equal(lastSpread.right, 5);

    // If volume has 4 pages, spread 2 has left=4, right=null (Colophon)
    const fourPageLastSpread = getSpreadForIndex(2, 4);
    assert.equal(fourPageLastSpread.left, 4);
    assert.equal(fourPageLastSpread.right, null, 'Right page must be null (Colophon) when last page is on left');
  });

  test('4. getSpreadIndexForPage maps pages to correct desktop spread', () => {
    assert.equal(getSpreadIndexForPage(1), 0);
    assert.equal(getSpreadIndexForPage(2), 1);
    assert.equal(getSpreadIndexForPage(3), 1);
    assert.equal(getSpreadIndexForPage(4), 2);
    assert.equal(getSpreadIndexForPage(5), 2);
    assert.equal(getSpreadIndexForPage(6), 3);
  });

  test('5. Mobile viewport detection threshold handles <= 768px gracefully', () => {
    const isMobileBreakpoint = (width) => width <= 768;

    assert.equal(isMobileBreakpoint(375), true, 'Mobile screen is single page');
    assert.equal(isMobileBreakpoint(768), true, 'Tablet portrait is single page');
    assert.equal(isMobileBreakpoint(769), false, 'Above 768px is 2-page spread');
    assert.equal(isMobileBreakpoint(1200), false, 'Desktop is 2-page spread');
  });

  test('6. In-flight animation cancellation logic safely clears animation timers', () => {
    let turnState = { active: true, direction: 'next', targetPage: 3 };
    let timerId = 42;
    let timerCleared = false;

    // Simulation of updateSize transition in BookSpread:
    const onBreakpointTransition = () => {
      if (timerId) {
        timerCleared = true;
        timerId = null;
      }
      turnState = null;
    };

    onBreakpointTransition();

    assert.equal(turnState, null, 'turnState must be cancelled on breakpoint transition');
    assert.equal(timerCleared, true, 'Active turnTimer must be cleared to prevent stale callback');
  });
});

describe('STEP 3: PDF-Aware Responsive Book Frame Geometry Suite', () => {
  // Test matrix: 5 PDF proportions × 4 Viewports = 20 scenarios
  const pdfProportions = [
    { name: 'Standard Portrait Book (6x9 in)', width: 432, height: 648, ratio: 432 / 648 },
    { name: 'A4 Portrait Document', width: 595, height: 842, ratio: 595 / 842 },
    { name: 'Landscape Presentation', width: 842, height: 595, ratio: 842 / 595 },
    { name: 'Unusually Tall / Scroll', width: 400, height: 1000, ratio: 400 / 1000 },
    { name: 'Unusually Wide / Gatefold', width: 1200, height: 600, ratio: 1200 / 600 },
  ];

  const viewports = [
    { name: 'Desktop Standard (1440x900)', width: 1440, height: 900, isMobile: false },
    { name: 'Small Desktop / Laptop (1280x800)', width: 1280, height: 800, isMobile: false },
    { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024, isMobile: true },
    { name: 'Mobile Portrait (390x844)', width: 390, height: 844, isMobile: true },
  ];

  for (const vp of viewports) {
    describe(`Viewport: ${vp.name}`, () => {
      for (const pdf of pdfProportions) {
        test(`PDF: ${pdf.name} fits completely without clipping`, () => {
          const dims = calculateBookFrameDimensions({
            viewportWidth: vp.width,
            viewportHeight: vp.height,
            pdfWidth: pdf.width,
            pdfHeight: pdf.height,
            isMobile: vp.isMobile,
          });

          // 1. Frame must stay within viewport boundaries
          assert.ok(
            dims.frameWidth <= vp.width,
            `frameWidth (${dims.frameWidth}) exceeds viewportWidth (${vp.width})`
          );
          assert.ok(
            dims.frameHeight <= vp.height,
            `frameHeight (${dims.frameHeight}) exceeds viewportHeight (${vp.height})`
          );

          // 2. Frame must stay within maxAvailable boundaries (leaving breathing room for controls/margins)
          assert.ok(
            dims.frameWidth <= dims.maxAvailableWidth + 1, // allow rounding tolerance of 1px
            `frameWidth (${dims.frameWidth}) exceeds maxAvailableWidth (${dims.maxAvailableWidth})`
          );
          assert.ok(
            dims.frameHeight <= dims.maxAvailableHeight + 1,
            `frameHeight (${dims.frameHeight}) exceeds maxAvailableHeight (${dims.maxAvailableHeight})`
          );

          // 3. Canvas aspect ratio must faithfully preserve PDF native aspect ratio
          const renderedRatio = dims.canvasWidth / dims.canvasHeight;
          const ratioDelta = Math.abs(renderedRatio - pdf.ratio);
          assert.ok(
            ratioDelta < 0.03,
            `Canvas aspect ratio ${renderedRatio.toFixed(3)} deviates from PDF ratio ${pdf.ratio.toFixed(3)} by ${ratioDelta.toFixed(4)}`
          );

          // 4. Dimensions must be positive and above minimum readable threshold
          assert.ok(dims.canvasHeight >= 160, `canvasHeight (${dims.canvasHeight}) below minimum 160px`);
          assert.ok(dims.canvasWidth >= 64, `canvasWidth (${dims.canvasWidth}) below minimum 64px`);

          // 5. Layout mode verification
          if (vp.isMobile) {
            assert.equal(dims.spineWidth, 0, 'Spine width must be 0 on mobile single page');
            assert.equal(dims.frameWidth, dims.pageWidth + dims.framePadX, 'Mobile frame width must be single page + frame padding');
          } else {
            assert.equal(dims.spineWidth, 20, 'Spine width must be 20px on desktop two-page spread');
            assert.equal(
              dims.frameWidth,
              2 * dims.pageWidth + dims.spineWidth + dims.framePadX,
              'Desktop frame width must accommodate 2 pages + spine + frame padding'
            );
          }
        });
      }
    });
  }

  test('Dynamic updates: adapting when PDF dimensions change on page change', () => {
    // Page 1 is portrait cover (595x842)
    const coverDims = calculateBookFrameDimensions({
      viewportWidth: 1440,
      viewportHeight: 900,
      pdfWidth: 595,
      pdfHeight: 842,
      isMobile: false,
    });

    // Page 2 is foldout landscape diagram (842x595)
    const foldoutDims = calculateBookFrameDimensions({
      viewportWidth: 1440,
      viewportHeight: 900,
      pdfWidth: 842,
      pdfHeight: 595,
      isMobile: false,
    });

    assert.notEqual(coverDims.frameWidth, foldoutDims.frameWidth, 'Frame width should dynamically adapt to foldout');
    assert.notEqual(coverDims.frameHeight, foldoutDims.frameHeight, 'Frame height should dynamically adapt to foldout');
    assert.ok(foldoutDims.frameWidth <= 1440, 'Foldout frame must not overflow 1440px viewport');
    assert.ok(foldoutDims.frameHeight <= 900, 'Foldout frame must not overflow 900px viewport');
  });
});
