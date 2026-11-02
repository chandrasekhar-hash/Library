/**
 * bookDimensions.js
 * Pure utility functions for calculating responsive, PDF-aware book frame geometry.
 * Sizing ensures the physical book frame and pages adapt dynamically to the
 * native dimensions and aspect ratio of any PDF, completely eliminating clipping.
 */

/**
 * Calculates responsive, PDF-aware book frame dimensions.
 *
 * @param {Object} params
 * @param {number} params.viewportWidth - Available viewport width in px
 * @param {number} params.viewportHeight - Available viewport height in px
 * @param {number} [params.pdfWidth] - PDF page width at scale 1.0 (in points/pixels)
 * @param {number} [params.pdfHeight] - PDF page height at scale 1.0 (in points/pixels)
 * @param {boolean} [params.isMobile] - Whether layout is mobile single-page (width <= 768px)
 * @param {number} [params.safeMarginX] - Outer horizontal safety margin
 * @param {number} [params.safeMarginY] - Outer vertical safety margin
 * @returns {Object}
 */
export function calculateBookFrameDimensions({
  viewportWidth,
  viewportHeight,
  pdfWidth = 595,
  pdfHeight = 842,
  isMobile = false,
  safeMarginX = isMobile ? 12 : 28,
  safeMarginY = isMobile ? 12 : 10,
}) {
  const safePdfWidth = pdfWidth > 0 ? pdfWidth : 595;
  const safePdfHeight = pdfHeight > 0 ? pdfHeight : 842;
  const aspectRatio = safePdfWidth / safePdfHeight;

  const vpW = Math.max(260, viewportWidth || 1200);
  const vpH = Math.max(260, viewportHeight || 800);

  const spineWidth = isMobile ? 0 : 20;
  const framePadX = isMobile ? 16 : 20; // total outer frame padding X (left + right)
  const framePadY = isMobile ? 20 : 24; // total outer frame padding Y (top + bottom)
  const pagePad = isMobile ? 6 : 8; // internal padding inside each book page around canvas

  // Available space inside viewport after safety margins
  const maxAvailableWidth = Math.max(220, vpW - safeMarginX * 2);
  const maxAvailableHeight = Math.max(220, vpH - safeMarginY * 2);

  let maxCanvasH;
  let isWidthConstrained = false;
  let isHeightConstrained = false;

  if (isMobile) {
    // Single page layout:
    // frameWidth = canvasW + 2 * pagePad + framePadX <= maxAvailableWidth
    // => canvasH * aspectRatio + 2 * pagePad + framePadX <= maxAvailableWidth
    const heightFromWidth = (maxAvailableWidth - 2 * pagePad - framePadX) / aspectRatio;
    const heightFromHeight = maxAvailableHeight - 2 * pagePad - framePadY;

    if (heightFromWidth < heightFromHeight) {
      maxCanvasH = heightFromWidth;
      isWidthConstrained = true;
    } else {
      maxCanvasH = heightFromHeight;
      isHeightConstrained = true;
    }
  } else {
    // Two-page spread layout:
    // frameWidth = 2 * (canvasW + 2 * pagePad) + spineWidth + framePadX <= maxAvailableWidth
    // => 2 * (canvasH * aspectRatio + 2 * pagePad) + spineWidth + framePadX <= maxAvailableWidth
    // => 2 * canvasH * aspectRatio + 4 * pagePad + spineWidth + framePadX <= maxAvailableWidth
    const heightFromWidth = (maxAvailableWidth - 4 * pagePad - spineWidth - framePadX) / (2 * aspectRatio);
    const heightFromHeight = maxAvailableHeight - 2 * pagePad - framePadY;

    if (heightFromWidth < heightFromHeight) {
      maxCanvasH = heightFromWidth;
      isWidthConstrained = true;
    } else {
      maxCanvasH = heightFromHeight;
      isHeightConstrained = true;
    }
  }

  // Ensure minimum canvas height
  const canvasHeight = Math.max(160, Math.floor(maxCanvasH));
  const canvasWidth = Math.round(canvasHeight * aspectRatio);

  const pageWidth = canvasWidth + 2 * pagePad;
  const pageHeight = canvasHeight + 2 * pagePad;

  const frameWidth = isMobile
    ? pageWidth + framePadX
    : 2 * pageWidth + spineWidth + framePadX;
  const frameHeight = pageHeight + framePadY;

  return {
    frameWidth,
    frameHeight,
    pageWidth,
    pageHeight,
    canvasWidth,
    canvasHeight,
    aspectRatio,
    spineWidth,
    framePadX,
    framePadY,
    pagePad,
    maxAvailableWidth,
    maxAvailableHeight,
    isWidthConstrained,
    isHeightConstrained,
  };
}

/**
 * Maps a spread index to its left and right page numbers.
 * Spread 0:
 *   If coverPlacement === 'left': left = cover (1 or customCoverPage), right = null (endpaper)
 *   If coverPlacement === 'right' (default): left = null (endpaper), right = cover (1 or customCoverPage)
 * Spread k (k >= 1): left = 2*k, right = 2*k + 1 (if <= totalPages, else null)
 */
export function getSpreadForIndex(spreadIdx, totalPages, coverPlacement = 'right', customCoverPage = null) {
  if (spreadIdx === 0) {
    const coverPage =
      customCoverPage && customCoverPage <= totalPages
        ? customCoverPage
        : totalPages >= 1
        ? 1
        : null;

    if (coverPlacement === 'left') {
      return {
        index: 0,
        left: coverPage,
        right: null,
        mainPage: coverPage || 1,
      };
    }
    return {
      index: 0,
      left: null,
      right: coverPage,
      mainPage: coverPage || 1,
    };
  }
  const left = 2 * spreadIdx;
  const right = left + 1 <= totalPages ? left + 1 : null;
  return {
    index: spreadIdx,
    left: left <= totalPages ? left : null,
    right,
    mainPage: left,
  };
}

/**
 * Returns the spread index corresponding to a given page number.
 */
export function getSpreadIndexForPage(page, coverPlacement = 'right', customCoverPage = null) {
  const coverPage = customCoverPage || 1;
  if (!page || page <= 1 || page === coverPage) return 0;
  return Math.floor(page / 2);
}

/**
 * Total number of spreads for a given total page count.
 */
export function getTotalSpreadsCount(totalPages) {
  if (!totalPages || totalPages <= 1) return 1;
  return Math.floor(totalPages / 2) + 1;
}
