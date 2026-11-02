/**
 * mediaStorage.js
 * Dedicated IndexedDB storage for Aks custom background media (photos & videos).
 * Completely isolated from reading-data stores (FolioSanctuaryDB).
 */

const DB_NAME = 'AksMediaStorageDB';
const DB_VERSION = 1;
const STORE_NAME = 'backgroundMedia';
const KEY_NAME = 'current_custom_background';

let dbInstance = null;

function openMediaDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onversionchange = () => {
        try {
          dbInstance.close();
        } catch (_) {}
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[MediaStorage] Failed to open IndexedDB:', event.target.error);
      reject(event.target.error || new Error('Could not open MediaStorage DB'));
    };
  });
}

/**
 * Stores a custom photo or video file in IndexedDB.
 * @param {File|Blob} file
 * @param {'image'|'video'} type
 * @param {string} name
 * @returns {Promise<{id: string, type: string, name: string, size: number, mimeType: string}>}
 */
export async function saveCustomBackgroundMedia(file, type, name) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        id: KEY_NAME,
        blob: file,
        type: type || (file.type?.startsWith('video/') ? 'video' : 'image'),
        name: name || file.name || 'custom_background',
        size: file.size || 0,
        mimeType: file.type || (type === 'video' ? 'video/mp4' : 'image/jpeg'),
        updatedAt: Date.now(),
      };

      const request = store.put(record);

      request.onsuccess = () => {
        resolve({
          id: record.id,
          type: record.type,
          name: record.name,
          size: record.size,
          mimeType: record.mimeType,
        });
      };

      request.onerror = (event) => {
        console.error('[MediaStorage] Error storing media:', event.target.error);
        reject(event.target.error || new Error('Failed to save background media.'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieves the stored custom photo or video file from IndexedDB.
 * @returns {Promise<{id: string, blob: Blob, type: string, name: string, size: number, mimeType: string}|null>}
 */
export async function getCustomBackgroundMedia() {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(KEY_NAME);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = (event) => {
        console.error('[MediaStorage] Error loading media:', event.target.error);
        reject(event.target.error);
      };
    });
  } catch (err) {
    console.warn('[MediaStorage] Could not load background media from IndexedDB:', err);
    return null;
  }
}

/**
 * Deletes the stored custom background file from IndexedDB.
 * @returns {Promise<boolean>}
 */
export async function deleteCustomBackgroundMedia() {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(KEY_NAME);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('[MediaStorage] Error deleting media:', event.target.error);
        reject(event.target.error);
      };
    });
  } catch (err) {
    console.warn('[MediaStorage] Could not delete background media from IndexedDB:', err);
    return false;
  }
}
