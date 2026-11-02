# Aks (अक्स) — Phase OCR-3C: Reading Room Search UI Integration Report

**Date**: October 29, 2026  
**Auditor/Engineer**: Aks Core Frontend & OCR Integration Team  
**Milestone**: Phase OCR-3C (Reading Room Search UI Integration)  
**Status**: **COMPLETE / APPROVED FOR TESTING**  

---

## Executive Summary

Phase OCR-3C connects the completed Phase OCR-3B multilingual search engine to the Aks Reading Room interface. Users can now search across all indexed pages—whether digital-born or scanned books processed by PaddleOCR—directly within the reading experience.

The implementation preserves Aks's premium literary design language, avoids disruptive layout reflows, strictly protects against stored Cross-Site Scripting (XSS), enforces multi-user and guest-mode boundaries, and accurately maps both OCR raster and native PDF bounding boxes to responsive page coordinates.

---

## 1. UI Components & Files Changed

| Component / File | Purpose & Changes Introduced |
| :--- | :--- |
| `frontend/src/components/reader/DocumentSearch.jsx` | **Upgraded Search Drawer**: Supports server-backed multilingual OCR search (`booksApi.searchBook`), 3-tier mode switching (`All`, `Exact`, `Normalized`, `Fuzzy`), debounced inputs with `AbortController` cancellation, unindexed pages warnings, safe snippet parsing, badge rendering, and pagination/load-more. |
| `frontend/src/utils/searchCoordinates.js` | **Coordinate Engine & Safe Snippet Parser**: Converts 250 DPI OCR raster coordinates and 72 DPI native PDF point coordinates to relative percentage rects; safely extracts `<mark>` tags into React-safe structured text tokens without HTML injection risk. |
| `frontend/src/components/reader/PdfCanvas.jsx` | **Transient Search Highlight Layer**: Injects `.pdf-search-highlight-box` percentage overlay onto the canvas when a search result with a valid bounding box is selected. Completely decoupled from permanent user annotations. |
| `frontend/src/components/reader/BookSpread.jsx` | **Spread Navigation**: Accepts `activeSearchMatch` prop, routes it to the correct left or right page's `PdfCanvas`, and maintains 2-page spread alignments. |
| `frontend/src/components/reader/PdfContinuousViewer.jsx` | **Continuous Scroll Viewer**: Accepts `activeSearchMatch` prop and passes it to individual continuous page cards. |
| `frontend/src/pages/ReaderPage.jsx` | **Search Lifecycle & Keyboard Integration**: Coordinates `searchOpen` and `activeSearchMatch` state; implements conflict-free `Cmd+F` / `Ctrl+F` listeners that do not trigger fullscreen; connects drawer to reading surface. |
| `frontend/src/services/api.js` | **API Client Extension**: Added `booksApi.searchBook(bookId, params, options)` with support for query parameters (`q`, `page`, `limit`, `mode`) and `AbortSignal`. |
| `frontend/src/styles/reader.css` | **Literary Search Styles**: Styled segmented mode pills, indexing warning banners, match badges (`Exact`, `Normalized`, `Fuzzy`), OCR scan chips, and glowing pulse animations (`.pdf-search-highlight-box`). |
| `frontend/test/readingRoomSearch.test.js` | **Unit & Integration Suite**: 24 rigorous test cases covering all 16 required verification points. |

---

## 2. API Integration Details

The frontend client integrates with the endpoint finalized in Phase OCR-3B:
```
GET /api/books/:bookId/search?q=<query>&page=<page>&limit=20&mode=<mode>
```

### 2.1 Request Abstraction
Implemented in `frontend/src/services/api.js`:
```javascript
searchBook: async (bookId, params = {}, options = {}) => {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);
  if (params.mode) query.set('mode', params.mode);
  const qs = query.toString();
  return apiRequest(`/api/books/${bookId}/search${qs ? `?${qs}` : ''}`, options);
}
```

### 2.2 In-Flight Cancellation & Debouncing
- Typing is debounced by **320 ms**.
- Consecutive keystrokes or mode changes trigger `abortControllerRef.current.abort()`, cleanly cancelling outdated network requests.
- Submissions via **Enter** bypass the debounce timer and execute immediately.

---

## 3. Keyboard Shortcut Behavior

| Shortcut | Reading Room Context | Input / Textarea Context | Outside Reader |
| :--- | :--- | :--- | :--- |
| **`Cmd+F` / `Ctrl+F`** | Toggles the search drawer, auto-focuses search input. Prevents browser default search. | Toggles search drawer. | Unaffected (browser default). |
| **`f` / `F`** | Toggles reader fullscreen. | Ignored (types normal letter 'f'). | Unaffected. |
| **`Escape`** | Closes search drawer without moving reader page. | Closes search drawer. | Unaffected. |
| **`Enter`** | Executes search immediately. | Executes search immediately. | Unaffected. |

> [!NOTE]
> Fixed a critical modifier key collision: previously, pressing `Cmd+F` evaluated `e.key === 'f'` before checking modifier flags, erroneously triggering fullscreen. The listener now explicitly inspects `(e.ctrlKey || e.metaKey)` upfront, separating search invocation from fullscreen toggles.

---

## 4. Search Navigation & Spread Layout Adaptation

When the user clicks a result card or uses the match navigation buttons ($\uparrow / \downarrow$):

1. **Target Page Identification**: Result carries 1-based `pageNumber`.
2. **Book Mode (Desktop Spread)**:
   - Aks calculates the spread index via `getSpreadIndexForPage(pageNumber, coverPlacement)`.
   - If the result is on Page 2 or 3, it displays Spread 1.
   - If the result is on Page 4 or 5, it displays Spread 2.
   - The reader automatically orients the spread without resetting reading progress.
3. **PDF Mode (Continuous Natural Scroll)**:
   - `PdfContinuousViewer` locates the target page DOM card via `pageRefs.current[pageNumber]`.
   - Triggers `scrollIntoView({ behavior: 'smooth', block: 'center' })`.
4. **Mobile Layout (Single Page)**:
   - Single-page viewport sets `currentPage = pageNumber` directly.
5. **Panel State Preservation**:
   - The search drawer remains open.
   - The results list and current scroll position are preserved, allowing the user to browse matches across multiple pages seamlessly.

---

## 5. Coordinate Conversion Implementation

Bounding box coordinates returned by OCR and native extraction differ fundamentally in scale and resolution. Aks standardizes all highlights into percentage units (`%`) relative to the page container:

### 5.1 Math & Formula
```
Given:
  bbox = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
  pageWidthPt, pageHeightPt = PDF page dimensions at 72 DPI

Case 1: OCR (Raster space at 250 DPI)
  W_base = pageWidthPt * (250 / 72)
  H_base = pageHeightPt * (250 / 72)

Case 2: NATIVE (PDF point space at 72 DPI)
  W_base = pageWidthPt
  H_base = pageHeightPt

Output Rect (%):
  left   = (min(X) / W_base) * 100
  top    = (min(Y) / H_base) * 100
  width  = ((max(X) - min(X)) / W_base) * 100
  height = ((max(Y) - min(Y)) / H_base) * 100
```

### 5.2 Strict Bounding Box Invariants
- **No Coordinate Invention**: When `bbox` is `null` or unmapped, `convertSearchBboxToPercent` returns `null`. The UI displays the snippet in the drawer and scrolls to the page, but **never draws fabricated boxes**.
- **Transient Lifecycle**: Search highlights are rendered in `.pdf-search-highlight-box` with a subtle amber-gold pulsing glow. They are **never** appended to `highlights` or persisted in IndexedDB or PostgreSQL.

---

## 6. Safe Snippet Rendering (XSS Prevention)

The backend provides `highlightedSnippet` with HTML entity escaping around `<mark>` tokens. To provide defense-in-depth and avoid `dangerouslySetInnerHTML`:

1. `parseSafeSnippetSegments` parses the snippet into token objects:
   ```javascript
   [
     { type: 'text', text: 'धनिया ने कहा कि ' },
     { type: 'mark', text: 'ज़रा' },
     { type: 'text', text: ' सोच-समझकर बात करो...' }
   ]
   ```
2. Tokens are rendered as standard React JSX nodes:
   ```jsx
   <p className="doc-search-result-preview">
     {segments.map((seg, idx) =>
       seg.type === 'mark' ? (
         <mark key={idx} className="doc-search-highlight">{seg.text}</mark>
       ) : (
         <React.Fragment key={idx}>{seg.text}</React.Fragment>
       )
     )}
   </p>
   ```
3. Any malicious payload (e.g. `<img src=x onerror=alert(1)>`) is strictly decoded into a harmless string text node.

---

## 7. Guest Mode & Account Isolation

- **Unsaved / Guest Books**: When an unauthenticated guest reads an imported PDF, or when an authenticated user reads an unsaved preview book, server-backed OCR search is disabled.
- **Informational Notice**: The search drawer renders:
  > *"Server-backed OCR search is unavailable for unsaved or guest books. Showing client-side text layer matches only."*
- **Client-Side Fallback**: If the PDF possesses a digital text stream, `searchDocument(pdfDoc, query)` performs local client-side scanning.
- **Account Switching & Book Isolation**: Switching books or logging out clears the query, active results, OCR status, and active bounding box immediately.

---

## 8. Verification & Test Results

### 8.1 Frontend Test Suite
Executed via `npm --prefix frontend test`:
```
ℹ tests 172
ℹ suites 50
ℹ pass 172
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 186.27ms
```
*Includes 24 dedicated tests in `frontend/test/readingRoomSearch.test.js` covering coordinate math, XSS prevention, keyboard shortcuts, badges, spread calculations, and guest mode.*

### 8.2 Production Build Verification
Executed via `npm --prefix frontend run build`:
```
✓ 2000 modules transformed.
✓ built in 248ms with zero errors.
```

### 8.3 Backend Regression Test Suite
Executed via `npm --prefix backend test`:
```
ℹ tests 210
ℹ suites 51
ℹ pass 210
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 15112.05ms
```

---

## 9. Known Limitations & Scope Boundaries

1. **Unindexed Page Scope**: Books currently undergoing background OCR processing display partial results accompanied by an alert banner (`ocrStatus.warning`). Search never triggers OCR jobs automatically.
2. **Classical Sanskrit De-Sandhi**: As established in Phase OCR-3B.1, pre-sandhi roots fully absorbed by sandhi rules (e.g. `अधिकार` in `कर्मण्येवाधिकारस्ते`) cannot match without an external morphological grammar parser.
3. **Low-Confidence OCR Line Bounding Boxes**: When PaddleOCR detects text but confidence is too low to demarcate individual line polygons, `bbox` defaults to `null`. The reader navigates to the page and highlights the snippet in the drawer.

---

## 10. Final Delivery & Next Steps

Phase OCR-3C is **fully implemented, tested, and verified**. All regression suites are green.

**Next Phase**: Phase OCR-3D / Review (Do not proceed without explicit user confirmation).

