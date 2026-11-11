/**
 * Local Filesystem Storage Provider for Aks (अक्स)
 *
 * Preserves existing private filesystem behavior:
 * - Stores files in `STORAGE_ROOT` with restrictive 0700/0600 permissions.
 * - Enforces path traversal verification on all operations.
 * - Streams Range requests directly using `fs.createReadStream`.
 */

import fs from 'fs';
import path from 'path';
import { BaseStorageProvider } from './baseStorageProvider.js';
import { storagePaths } from '../../config/storage.js';

export class LocalStorageProvider extends BaseStorageProvider {
  constructor(rootPath = storagePaths.root) {
    super();
    this.root = rootPath;
  }

  /**
   * Resolves and verifies safe absolute path within storage root.
   * Prevents path traversal attempts.
   */
  resolveSafePath(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string.');
    }
    const rootPrefix = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    const absolutePath = path.resolve(this.root, key);

    if (!absolutePath.startsWith(rootPrefix) && absolutePath !== this.root) {
      throw new Error('Access denied: Path traversal detected.');
    }
    return absolutePath;
  }

  async uploadFile(localTempPath, key) {
    const destinationPath = this.resolveSafePath(key);
    const parentDir = path.dirname(destinationPath);

    if (!fs.existsSync(parentDir)) {
      await fs.promises.mkdir(parentDir, { recursive: true, mode: 0o700 });
    }
    try {
      await fs.promises.chmod(parentDir, 0o700);
    } catch {}

    // Move validated temp file to permanent destination
    await fs.promises.rename(localTempPath, destinationPath);
    try {
      await fs.promises.chmod(destinationPath, 0o600);
    } catch {}

    const stat = await fs.promises.stat(destinationPath);
    return {
      storagePath: key,
      sizeBytes: stat.size,
    };
  }

  async getMetadata(key) {
    const filePath = this.resolveSafePath(key);
    if (!fs.existsSync(filePath)) {
      return { sizeBytes: 0, exists: false };
    }
    const stat = await fs.promises.stat(filePath);
    return {
      sizeBytes: stat.size,
      exists: true,
    };
  }

  async getStream(key, options = {}) {
    const filePath = this.resolveSafePath(key);
    if (!fs.existsSync(filePath)) {
      const err = new Error('File not found in local storage.');
      err.statusCode = 404;
      err.code = 'STORAGE_FILE_MISSING';
      throw err;
    }

    const streamOptions = {};
    if (typeof options.start === 'number') streamOptions.start = options.start;
    if (typeof options.end === 'number') streamOptions.end = options.end;

    return fs.createReadStream(filePath, streamOptions);
  }

  async deleteFile(key) {
    try {
      const filePath = this.resolveSafePath(key);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch (err) {
      console.error(`[LocalStorageProvider] Failed to delete ${key}:`, err.message);
      return false;
    }
  }

  async exists(key) {
    try {
      const filePath = this.resolveSafePath(key);
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }
}
