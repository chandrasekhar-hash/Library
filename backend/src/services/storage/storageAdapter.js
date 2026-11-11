/**
 * Unified Storage Adapter for Aks (अक्स)
 *
 * Provides a clean abstraction over Local Filesystem and Cloudflare R2 storage:
 * - Selects provider via `env.STORAGE_PROVIDER` ('local' default or 'r2').
 * - Preserves 100% backward compatibility: paths starting with 'r2://' route to R2;
 *   all existing plain relative paths (e.g. 'pdfs/{userId}/{id}.pdf') route to Local storage.
 * - Centralizes HTTP Range streaming (HTTP 200 / 206 / 416) uniformly across both providers.
 * - Provides `withLocalFile` for local file consumers (e.g. PDF text extraction & OCR).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { env } from '../../config/env.js';
import { storagePaths } from '../../config/storage.js';
import { LocalStorageProvider } from './localStorageProvider.js';
import { R2StorageProvider } from './r2StorageProvider.js';

class StorageAdapter {
  constructor() {
    this.localProvider = new LocalStorageProvider();
    this.r2Provider = new R2StorageProvider();
    this.defaultProviderName = (env.STORAGE_PROVIDER || 'local').toLowerCase();
  }

  /**
   * Override provider for testing/mocking.
   */
  setR2Provider(provider) {
    this.r2Provider = provider;
  }

  setLocalStorageProvider(provider) {
    this.localProvider = provider;
  }

  setDefaultProvider(name) {
    this.defaultProviderName = (name || 'local').toLowerCase();
  }

  /**
   * Determine whether a storagePath represents a Cloudflare R2 object.
   * R2 objects strictly use the 'r2://' scheme prefix.
   */
  isR2(storagePath) {
    return typeof storagePath === 'string' && storagePath.startsWith('r2://');
  }

  /**
   * Strips the 'r2://' prefix to yield the canonical object key.
   */
  cleanKey(storagePath) {
    if (!storagePath || typeof storagePath !== 'string') return '';
    return storagePath.replace(/^r2:\/\//, '').replace(/^\/+/, '');
  }

  /**
   * Selects the appropriate provider for an existing stored path.
   * If path has 'r2://', uses R2; otherwise uses Local.
   */
  getProviderForPath(storagePath) {
    if (this.isR2(storagePath)) {
      return this.r2Provider;
    }
    return this.localProvider;
  }

  /**
   * Gets the active default provider for new file uploads.
   */
  getActiveUploadProvider() {
    if (this.defaultProviderName === 'r2') {
      return this.r2Provider;
    }
    return this.localProvider;
  }

  /**
   * Uploads/promotes a verified local temp file to permanent storage.
   *
   * @param {string} tempFilePath - Local verified temporary file path
   * @param {string} category - Storage category ('pdfs', 'covers', 'backgrounds')
   * @param {string} userId - Owner user ID
   * @param {string} [extension="pdf"] - File extension
   * @param {string} [mimeType="application/octet-stream"]
   * @returns {Promise<{ storagePath: string, sizeBytes: number }>}
   */
  async savePermanentFile(tempFilePath, category, userId, extension = 'pdf', mimeType = 'application/octet-stream') {
    const provider = this.getActiveUploadProvider();
    const fileId = crypto.randomUUID();
    const key = path.posix.join(category, userId, `${fileId}.${extension}`);

    return provider.uploadFile(tempFilePath, key, mimeType);
  }

  /**
   * Retrieves metadata (size, mimeType, existence) for a stored file.
   */
  async getMetadata(storagePath) {
    const provider = this.getProviderForPath(storagePath);
    const key = this.cleanKey(storagePath);
    return provider.getMetadata(key);
  }

  /**
   * Retrieves a readable stream for a stored file, optionally bounded by range.
   */
  async getStream(storagePath, options = {}) {
    const provider = this.getProviderForPath(storagePath);
    const key = this.cleanKey(storagePath);
    return provider.getStream(key, options);
  }

  /**
   * Deletes a stored file from either R2 or local filesystem.
   */
  async deleteStoredFile(storagePath) {
    if (!storagePath) return false;
    const provider = this.getProviderForPath(storagePath);
    const key = this.cleanKey(storagePath);
    return provider.deleteFile(key);
  }

  /**
   * Checks existence of a stored file.
   */
  async fileExists(storagePath) {
    if (!storagePath) return false;
    const provider = this.getProviderForPath(storagePath);
    const key = this.cleanKey(storagePath);
    return provider.exists(key);
  }

  /**
   * Provides a verified local file path for local processing (e.g. PDF text extraction, OCR).
   * For local files, passes the resolved safe path.
   * For R2 files, streams into a temporary local file, passes to callback, and cleans up.
   *
   * @param {string} storagePath
   * @param {(localFilePath: string) => Promise<any>} callback
   * @returns {Promise<any>}
   */
  async withLocalFile(storagePath, callback) {
    if (!this.isR2(storagePath)) {
      const localPath = this.localProvider.resolveSafePath(storagePath);
      return callback(localPath);
    }

    // R2 Object: Stream to ephemeral temp file
    const tempFilename = `r2cache_${crypto.randomUUID()}.tmp`;
    const tempFilePath = path.join(storagePaths.temp, tempFilename);

    if (!fs.existsSync(storagePaths.temp)) {
      await fs.promises.mkdir(storagePaths.temp, { recursive: true, mode: 0o700 });
    }

    const r2Stream = await this.getStream(storagePath);
    const writeStream = fs.createWriteStream(tempFilePath, { mode: 0o600 });

    try {
      await pipeline(r2Stream, writeStream);
      return await callback(tempFilePath);
    } finally {
      try {
        if (fs.existsSync(tempFilePath)) {
          await fs.promises.unlink(tempFilePath);
        }
      } catch {}
    }
  }

  /**
   * Centralized HTTP Range request streaming helper.
   * Complies strictly with RFC 7233 (HTTP 200, 206, and 416 responses).
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   * @param {Object} fileInfo
   * @param {string} fileInfo.storagePath
   * @param {string} fileInfo.filename
   * @param {string} [fileInfo.mimeType="application/pdf"]
   */
  async streamRangeResponse(req, res, next, fileInfo) {
    const { storagePath, filename, mimeType = 'application/pdf' } = fileInfo;

    try {
      const meta = await this.getMetadata(storagePath);
      if (!meta.exists) {
        return res.status(404).json({
          error: {
            message: 'Stored file could not be found.',
            code: 'STORAGE_FILE_MISSING',
          },
        });
      }

      const totalSize = meta.sizeBytes;
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
        if (!match) {
          res.setHeader('Content-Range', `bytes */${totalSize}`);
          return res.status(416).json({
            error: {
              message: 'Requested Range Not Satisfiable.',
              code: 'RANGE_NOT_SATISFIABLE',
            },
          });
        }

        let start = match[1] ? parseInt(match[1], 10) : undefined;
        let end = match[2] ? parseInt(match[2], 10) : undefined;

        // Suffix range: "bytes=-500" (last 500 bytes)
        if (start === undefined && end !== undefined) {
          start = Math.max(0, totalSize - end);
          end = totalSize - 1;
        } else if (start !== undefined && end === undefined) {
          end = totalSize - 1;
        }

        // Check range validity
        if (start === undefined || end === undefined || start >= totalSize || start > end) {
          res.setHeader('Content-Range', `bytes */${totalSize}`);
          return res.status(416).json({
            error: {
              message: 'Requested Range Not Satisfiable.',
              code: 'RANGE_NOT_SATISFIABLE',
            },
          });
        }

        // Clamp end boundary to EOF
        if (end >= totalSize) {
          end = totalSize - 1;
        }

        const chunkSize = end - start + 1;

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', chunkSize);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename || 'file')}"`);

        const stream = await this.getStream(storagePath, { start, end });
        stream.on('error', (err) => {
          if (!res.headersSent) next(err);
        });
        stream.pipe(res);
      } else {
        // Full File Request (HTTP 200 OK)
        res.status(200);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', totalSize);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename || 'file')}"`);

        const stream = await this.getStream(storagePath);
        stream.on('error', (err) => {
          if (!res.headersSent) next(err);
        });
        stream.pipe(res);
      }
    } catch (err) {
      if (!res.headersSent) {
        next(err);
      }
    }
  }
}

export const storageAdapter = new StorageAdapter();

