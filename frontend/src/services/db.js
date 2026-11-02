import { initialLibraryBooks } from '../data/mockBooks';

const DB_NAME = 'FolioSanctuaryDB';
const DB_VERSION = 3;
const STORE_NAME = 'books';
const NOTES_STORE = 'notes';

let dbInstance = null;

/**
 * Open or initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbInstance) {
    if (
      dbInstance.objectStoreNames.contains(NOTES_STORE) &&
      dbInstance.objectStoreNames.contains(STORE_NAME) &&
      dbInstance.version >= DB_VERSION
    ) {
      return Promise.resolve(dbInstance);
    }
    try {
      dbInstance.close();
    } catch (_) {}
    dbInstance = null;
  }

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser environment.'));
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('IndexedDB connection timed out.'));
    }, 4000);

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      console.warn('[IndexedDB] Database upgrade blocked by another active connection. Closing stale instances.');
      if (dbInstance) {
        try {
          dbInstance.close();
        } catch (_) {}
        dbInstance = null;
      }
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Books object store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('dateAdded', 'dateAdded', { unique: false });
        store.createIndex('lastOpenedTimestamp', 'lastOpenedTimestamp', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('isUserImported', 'isUserImported', { unique: false });
      }

      // 2. Notes & Revision Notebook object store
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const notesStore = db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
        notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        notesStore.createIndex('createdAt', 'createdAt', { unique: false });
        notesStore.createIndex('bookId', 'bookId', { unique: false });
        notesStore.createIndex('type', 'type', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      clearTimeout(timeout);
      dbInstance = event.target.result;

      // Handle close or version change
      dbInstance.onversionchange = () => {
        try {
          dbInstance.close();
        } catch (_) {}
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      clearTimeout(timeout);
      console.error('Failed to open IndexedDB:', event.target.error);
      reject(event.target.error || new Error('Could not open IndexedDB'));
    };
  });
}

/**
 * Retrieve all books from IndexedDB.
 * If the database is completely empty on first run, seeds with initial sample books.
 * @returns {Promise<Array>}
 */
export async function getAllBooks() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      let books = request.result || [];

      // Filter out demo books without deleting real records from IndexedDB
      const demoIds = ['dsa-45', 'dm-80', 'os-120', 'cn-95', 'toc-65'];
      books = books.filter((b) => b && b.isUserImported === true && !demoIds.includes(b.id));

      resolve(books);
    };

    request.onerror = (event) => {
      console.error('Error fetching books from IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Seed initial sample books into the object store
 */
async function seedSampleBooks(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    initialLibraryBooks.forEach((book) => {
      store.put({
        ...book,
        isUserImported: false,
        dateAdded: new Date().toISOString(),
      });
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Save or insert a book in IndexedDB (including Blob)
 * @param {Object} book 
 * @returns {Promise<Object>}
 */
export async function saveBook(book) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const itemToSave = {
        ...book,
        isUserImported: book.isUserImported !== undefined ? book.isUserImported : true,
        highlights: Array.isArray(book.highlights) ? book.highlights : [],
        highlightsCount: Array.isArray(book.highlights) ? book.highlights.length : 0,
        bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
        bookmarksCount: Array.isArray(book.bookmarks) ? book.bookmarks.length : 0,
        notes: Array.isArray(book.notes) ? book.notes : [],
        notesCount: Array.isArray(book.notes) ? book.notes.length : 0,
        lastOpenedTimestamp: book.lastOpenedTimestamp || Date.now(),
        dateAdded: book.dateAdded || new Date().toISOString(),
      };

      store.put(itemToSave);

      transaction.oncomplete = () => {
        resolve(itemToSave);
      };

      transaction.onerror = (event) => {
        console.error('Error saving book to IndexedDB:', event.target.error || transaction.error);
        reject(event.target.error || transaction.error);
      };

      transaction.onabort = () => {
        reject(transaction.error || new Error('Save book transaction was aborted.'));
      };
    } catch (err) {
      console.error('Exception in saveBook:', err);
      reject(err);
    }
  });
}

/**
 * Retrieve a specific book by ID from IndexedDB
 * @param {string} id 
 * @returns {Promise<Object|null>}
 */
export async function getBook(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = (event) => {
      console.error('Error getting book from IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Update an existing book with partial properties.
 * Awaits full transaction completion so writes are safely flushed to disk.
 * @param {string} id 
 * @param {Object} updates 
 * @returns {Promise<Object>}
 */
export async function updateBook(id, updates) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    let finalUpdated = null;

    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      if (!existing) {
        reject(new Error(`Book with id ${id} not found in IndexedDB.`));
        return;
      }

      finalUpdated = {
        ...existing,
        ...updates,
      };

      store.put(finalUpdated);
    };

    getRequest.onerror = (e) => reject(e.target.error);

    transaction.oncomplete = () => {
      resolve(finalUpdated);
    };

    transaction.onerror = (event) => {
      console.error('Error updating book in IndexedDB:', event.target.error || transaction.error);
      reject(event.target.error || transaction.error);
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error('Update book transaction was aborted.'));
    };
  });
}

/**
 * Remove a book from IndexedDB
 * @param {string} id 
 * @returns {Promise<void>}
 */
export async function deleteBook(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(id);

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = (event) => {
      console.error('Error deleting book from IndexedDB:', event.target.error || transaction.error);
      reject(event.target.error || transaction.error);
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error('Delete book transaction was aborted.'));
    };
  });
}

/**
 * Save or update a highlight on a specific book.
 * Atomic readwrite transaction with deduplication and awaited transaction.oncomplete.
 * @param {string} bookId
 * @param {Object} highlight
 * @returns {Promise<Object>}
 */
export async function saveHighlight(bookId, highlight) {
  if (!bookId) throw new Error('Cannot save highlight: bookId is required.');
  if (!highlight || !highlight.id) throw new Error('Cannot save highlight: valid highlight with id is required.');

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(bookId);
    let finalBook = null;

    getRequest.onsuccess = () => {
      const book = getRequest.result;
      if (!book) {
        reject(new Error(`Book ${bookId} not found to save highlight.`));
        return;
      }

      const existingHighlights = Array.isArray(book.highlights) ? book.highlights : [];
      // Deduplicate: match by id or identical page + text
      const index = existingHighlights.findIndex(
        (h) => h.id === highlight.id || (Number(h.page) === Number(highlight.page) && h.text === highlight.text)
      );

      let updatedHighlights;
      if (index >= 0) {
        updatedHighlights = [...existingHighlights];
        updatedHighlights[index] = { ...existingHighlights[index], ...highlight };
      } else {
        updatedHighlights = [...existingHighlights, highlight];
      }

      finalBook = {
        ...book,
        highlights: updatedHighlights,
        highlightsCount: updatedHighlights.length,
      };

      store.put(finalBook);
    };

    getRequest.onerror = (e) => reject(e.target.error);

    transaction.oncomplete = () => {
      resolve({ highlight, book: finalBook });
    };

    transaction.onerror = (event) => {
      console.error('Error saving highlight to IndexedDB:', event.target.error || transaction.error);
      reject(event.target.error || transaction.error);
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error('Save highlight transaction was aborted.'));
    };
  });
}

/**
 * Remove a highlight from a book.
 * Atomic readwrite transaction that awaits transaction.oncomplete.
 * @param {string} bookId
 * @param {string} highlightId
 * @returns {Promise<Object>}
 */
export async function deleteHighlight(bookId, highlightId) {
  if (!bookId || !highlightId) throw new Error('bookId and highlightId are required to delete highlight.');

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(bookId);
    let finalBook = null;

    getRequest.onsuccess = () => {
      const book = getRequest.result;
      if (!book) {
        reject(new Error(`Book ${bookId} not found to delete highlight.`));
        return;
      }

      const existingHighlights = Array.isArray(book.highlights) ? book.highlights : [];
      const updatedHighlights = existingHighlights.filter((h) => h.id !== highlightId);

      finalBook = {
        ...book,
        highlights: updatedHighlights,
        highlightsCount: updatedHighlights.length,
      };

      store.put(finalBook);
    };

    getRequest.onerror = (e) => reject(e.target.error);

    transaction.oncomplete = () => {
      resolve({ highlightId, book: finalBook });
    };

    transaction.onerror = (event) => {
      console.error('Error deleting highlight from IndexedDB:', event.target.error || transaction.error);
      reject(event.target.error || transaction.error);
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error('Delete highlight transaction was aborted.'));
    };
  });
}

/**
 * Retrieve all highlights for a single book directly from IndexedDB
 * @param {string} bookId
 * @returns {Promise<Array>}
 */
export async function getBookHighlights(bookId) {
  if (!bookId) return [];
  const book = await getBook(bookId);
  return Array.isArray(book?.highlights) ? book.highlights : [];
}

/**
 * Retrieve all highlights across all stored books
 * @returns {Promise<Array>}
 */
export async function getAllHighlights() {
  const books = await getAllBooks();
  const allHighlights = [];
  books.forEach((book) => {
    if (Array.isArray(book.highlights)) {
      book.highlights.forEach((hl) => {
        allHighlights.push({
          ...hl,
          bookId: book.id,
          bookTitle: book.title,
          bookAuthor: book.author || 'Aks Edition',
          bookCategory: book.category || 'General',
        });
      });
    }
  });

  // Sort by createdAt descending
  allHighlights.sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  return allHighlights;
}

/**
 * Restore canonical sample books while keeping all user-imported books
 * @returns {Promise<Array>}
 */
export async function restoreSampleBooks() {
  return getAllBooks();
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTES & REVISION NOTEBOOK STORAGE (Page 6)
// ─────────────────────────────────────────────────────────────────────────────

export const initialSampleNotes = [
  {
    id: 'note-sample-dsa-1',
    title: 'Asymptotic Analysis & Master Theorem',
    content: `## Master Theorem Quick Reference

For divide-and-conquer recurrences of the form:
\`T(n) = a*T(n/b) + f(n)\`

- **Case 1**: If \`f(n) = O(n^(log_b(a) - ε))\`, then \`T(n) = Θ(n^(log_b(a)))\`
- **Case 2**: If \`f(n) = Θ(n^(log_b(a)))\`, then \`T(n) = Θ(n^(log_b(a)) * log n)\`
- **Case 3**: If \`f(n) = Ω(n^(log_b(a) + ε))\`, then \`T(n) = Θ(f(n))\`

### Key Invariants to Remember
1. Always confirm that \`a >= 1\` and \`b > 1\` before applying formulas.
2. In Case 3, verify the **regularity condition**: \`a*f(n/b) <= c*f(n)\` for some \`c < 1\`.

### Revision Checklist
- [x] Review merge sort recurrence proof (\`T(n) = 2T(n/2) + O(n)\`)
- [x] Check Strassen matrix multiplication case
- [ ] Practice substitution method proofs for non-standard bounds

> *"The master theorem provides a cookbook solution in asymptotic notation for recurrences that partition problems into equal subproblems."*`,
    text: `## Master Theorem Quick Reference\nFor divide-and-conquer recurrences of the form T(n) = a*T(n/b) + f(n)...`,
    bookId: 'dsa-45',
    bookTitle: 'Data Structures and Algorithms',
    page: 5,
    type: 'book',
    isSample: true,
    createdAt: '2026-10-18T10:20:00.000Z',
    updatedAt: '2026-10-21T15:30:00.000Z',
  },
  {
    id: 'note-sample-dsa-2',
    title: 'AVL Tree Balancing & Rotations',
    content: `### Tree Invariants & Balance Factors

In an **AVL Tree**, the balance factor of every node must be \`-1\`, \`0\`, or \`+1\`:
\`balanceFactor = height(leftSubtree) - height(rightSubtree)\`

#### Rotation Cases:
- **Left-Left (LL)**: Single Right Rotation on unbalance root.
- **Right-Right (RR)**: Single Left Rotation on unbalance root.
- **Left-Right (LR)**: Double rotation: Left rotate left child, then Right rotate root.
- **Right-Left (RL)**: Double rotation: Right rotate right child, then Left rotate root.

### Checklist
- [x] Trace insertion balance factor recalculation
- [ ] Draw double rotation pointer update diagrams
- [ ] Implement deletion rebalancing edge cases`,
    text: `### Tree Invariants & Balance Factors\nIn an AVL Tree, balance factor must be -1, 0, or +1...`,
    bookId: 'dsa-45',
    bookTitle: 'Data Structures and Algorithms',
    page: 12,
    type: 'book',
    isSample: true,
    createdAt: '2026-10-21T14:40:00.000Z',
    updatedAt: '2026-10-22T09:15:00.000Z',
  },
  {
    id: 'note-sample-standalone-1',
    title: 'Sanctuary Study & Reading Blueprint',
    content: `# Autumn 2026 Reading & Revision Goals

Dedicated study sessions in the reading sanctuary focusing on algorithmic theory and discrete systems:

### Core Topics
- **Algorithms**: Self-balancing trees, network flow, and amortized analysis.
- **Discrete Math**: First-order predicate calculus and graph coloring invariants.
- **Quantum Computing**: Qubit state vector representations and superposition principles.

### Study Schedule
- [x] Import foundational PDFs into Aks library
- [x] Establish chapter bookmarks for key theorem proofs
- [ ] Complete weekly revision note summaries
- [ ] Review AVL double rotation pointer diagrams

> *"Study without reflection is a waste of time; reflection without study is dangerous."*`,
    text: `# Autumn 2026 Reading & Revision Goals\nDedicated study sessions in the reading sanctuary...`,
    bookId: null,
    bookTitle: null,
    page: null,
    type: 'standalone',
    isSample: true,
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-22T11:45:00.000Z',
  },
];

/**
 * Seed initial sample notes into the notes store
 */
async function seedSampleNotes(db) {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([NOTES_STORE, STORE_NAME], 'readwrite');
      const notesStore = transaction.objectStore(NOTES_STORE);
      const booksStore = transaction.objectStore(STORE_NAME);

      initialSampleNotes.forEach((note) => {
        notesStore.put(note);
      });

      // Also migrate any existing book notes from booksStore into notesStore
      const booksReq = booksStore.getAll();
      booksReq.onsuccess = () => {
        const books = booksReq.result || [];
        books.forEach((b) => {
          if (Array.isArray(b.notes)) {
            b.notes.forEach((bn) => {
              notesStore.put({
                id: bn.id || `note-${b.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                title: bn.title || (bn.page ? `Page ${bn.page} Note` : `${b.title} Note`),
                content: bn.content || bn.text || '',
                text: bn.content || bn.text || '',
                bookId: b.id,
                bookTitle: b.title,
                page: bn.page || null,
                type: 'book',
                createdAt: bn.createdAt || new Date().toISOString(),
                updatedAt: bn.updatedAt || bn.createdAt || new Date().toISOString(),
              });
            });
          }
        });
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieve all notes from IndexedDB
 * @returns {Promise<Array>}
 */
export async function getAllNotes() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        resolve([]);
        return;
      }

      const transaction = db.transaction(NOTES_STORE, 'readonly');
      const store = transaction.objectStore(NOTES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        let notes = request.result || [];
        const demoNoteIds = ['note-sample-dsa-1', 'note-sample-dsa-2', 'note-sample-standalone-1'];
        const demoBookIds = ['dsa-45', 'dm-80', 'os-120', 'cn-95', 'toc-65'];
        notes = notes.filter(
          (n) => n && !n.isSample && !demoNoteIds.includes(n.id) && (!n.bookId || !demoBookIds.includes(n.bookId))
        );
        // Sort by updatedAt descending
        notes.sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
        );
        resolve(notes);
      };

      request.onerror = (e) => {
        console.error('Error fetching notes from IndexedDB:', e.target.error);
        reject(e.target.error || new Error('Could not fetch notes'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieve a specific note by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getNote(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        resolve(null);
        return;
      }

      const transaction = db.transaction(NOTES_STORE, 'readonly');
      const store = transaction.objectStore(NOTES_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieve notes associated with a specific book
 * @param {string} bookId
 * @returns {Promise<Array>}
 */
export async function getNotesByBookId(bookId) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        resolve([]);
        return;
      }

      const transaction = db.transaction(NOTES_STORE, 'readonly');
      const store = transaction.objectStore(NOTES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result || [];
        const filtered = all.filter((n) => n.bookId === bookId);
        filtered.sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
        );
        resolve(filtered);
      };

      request.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Save or update a note in IndexedDB (and sync with book record if linked)
 * @param {Object} note
 * @returns {Promise<Object>}
 */
export async function saveNote(note) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        reject(new Error(`Object store "${NOTES_STORE}" is not available in IndexedDB.`));
        return;
      }

      const storesToLock =
        note.bookId && db.objectStoreNames.contains(STORE_NAME)
          ? [NOTES_STORE, STORE_NAME]
          : [NOTES_STORE];

      const transaction = db.transaction(storesToLock, 'readwrite');
      const notesStore = transaction.objectStore(NOTES_STORE);

      const now = new Date().toISOString();
      const content = note.content !== undefined ? note.content : (note.text || '');

      const noteToSave = {
        ...note,
        id: note.id || `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: (note.title !== undefined && note.title !== null ? String(note.title) : '').trim() || 'Untitled Note',
        content,
        text: content, // backwards compatibility with reading drawer
        bookId: note.bookId || null,
        bookTitle: note.bookTitle || null,
        page: typeof note.page === 'number' && !isNaN(note.page) ? note.page : null,
        type: note.bookId ? 'book' : 'standalone',
        createdAt: note.createdAt || now,
        updatedAt: now,
      };

      notesStore.put(noteToSave);

      // If associated with a book, also update the book's notes array and notesCount
      if (noteToSave.bookId && db.objectStoreNames.contains(STORE_NAME)) {
        const booksStore = transaction.objectStore(STORE_NAME);
        const bookReq = booksStore.get(noteToSave.bookId);
        bookReq.onsuccess = () => {
          const book = bookReq.result;
          if (book) {
            const currentNotes = Array.isArray(book.notes) ? book.notes : [];
            const index = currentNotes.findIndex((n) => n.id === noteToSave.id);
            let updatedBookNotes;
            if (index >= 0) {
              updatedBookNotes = [...currentNotes];
              updatedBookNotes[index] = noteToSave;
            } else {
              updatedBookNotes = [noteToSave, ...currentNotes];
            }
            booksStore.put({
              ...book,
              notes: updatedBookNotes,
              notesCount: updatedBookNotes.length,
            });
          }
        };
      }

      transaction.oncomplete = () => resolve(noteToSave);
      transaction.onerror = (e) => reject(e.target.error || new Error('Transaction error while saving note'));
      transaction.onabort = (e) => reject(e.target.error || new Error('Transaction aborted while saving note'));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete a note from IndexedDB (and remove from associated book record if linked)
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteNote(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        resolve();
        return;
      }

      const storesToLock = db.objectStoreNames.contains(STORE_NAME)
        ? [NOTES_STORE, STORE_NAME]
        : [NOTES_STORE];

      const transaction = db.transaction(storesToLock, 'readwrite');
      const notesStore = transaction.objectStore(NOTES_STORE);

      const getReq = notesStore.get(id);

      getReq.onsuccess = () => {
        const note = getReq.result;
        notesStore.delete(id);

        if (note && note.bookId && db.objectStoreNames.contains(STORE_NAME)) {
          const booksStore = transaction.objectStore(STORE_NAME);
          const bookReq = booksStore.get(note.bookId);
          bookReq.onsuccess = () => {
            const book = bookReq.result;
            if (book && Array.isArray(book.notes)) {
              const updatedNotes = book.notes.filter((n) => n.id !== id);
              booksStore.put({
                ...book,
                notes: updatedNotes,
                notesCount: updatedNotes.length,
              });
            }
          };
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error || new Error('Delete note failed'));
      transaction.onabort = (e) => reject(e.target.error || new Error('Delete note aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

