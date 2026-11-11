import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { storagePaths } from '../config/storage.js';
import { resolveSafeStoragePath, deleteStoredFile, storageAdapter } from './storageService.js';

/**
 * Service for private user asset storage (reading backgrounds, media).
 *
 * Supported formats:
 * - JPEG (image/jpeg)
 * - PNG (image/png)
 * - WebP (image/webp)
 * - MP4 (video/mp4)
 *
 * Enforces:
 * - 50 MB maximum file size limit
 * - Magic byte inspection (not trusting file extension or client MIME)
 * - 0700 private user directory permissions and 0600 file permissions
 * - Zero path traversal
 * - Safe streaming to temporary storage with cleanup on failure
 */

const MAX_ASSET_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Validates magic bytes for supported asset types (JPEG, PNG, WebP, MP4).
 *
 * @param {Buffer} buffer - First >= 12 bytes of the file
 * @returns {{ mimeType: string, ext: string, assetType: 'BACKGROUND_IMAGE' | 'BACKGROUND_VIDEO' } | null}
 */
export function detectAssetTypeAndValidateMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return {
      mimeType: 'image/jpeg',
      ext: 'jpg',
      assetType: 'BACKGROUND_IMAGE',
    };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return {
      mimeType: 'image/png',
      ext: 'png',
      assetType: 'BACKGROUND_IMAGE',
    };
  }

  // 3. WebP: RIFF (bytes 0-3) + WEBP (bytes 8-11)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return {
      mimeType: 'image/webp',
      ext: 'webp',
      assetType: 'BACKGROUND_IMAGE',
    };
  }

  // 4. MP4: ftyp at bytes 4-7 (66 74 79 70)
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return {
      mimeType: 'video/mp4',
      ext: 'mp4',
      assetType: 'BACKGROUND_VIDEO',
    };
  }

  return null;
}

/**
 * Streams an incoming multipart asset to a temporary file, verifying magic bytes
 * and strictly enforcing the 50 MB size limit.
 *
 * @param {import('stream').Readable} fileStream
 * @param {Object} [options]
 * @param {number} [options.maxSizeBytes]
 * @returns {Promise<{ tempFilePath: string, bytesWritten: number, sha256: string, mimeType: string, ext: string, assetType: string }>}
 */
export async function streamAssetToTempFile(fileStream, options = {}) {
  const maxBytes = options.maxSizeBytes || MAX_ASSET_SIZE_BYTES;
  const tempFilename = `asset_upload_${crypto.randomUUID()}.tmp`;
  const tempFilePath = path.join(storagePaths.temp, tempFilename);

  // Ensure temp directory exists with 0700 permissions
  if (!fs.existsSync(storagePaths.temp)) {
    fs.mkdirSync(storagePaths.temp, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(storagePaths.temp, 0o700);
  } catch {}

  return new Promise((resolve, reject) => {
    let writeStream = null;
    const hash = crypto.createHash('sha256');

    let bytesWritten = 0;
    let headerBuffer = Buffer.alloc(0);
    let detectedInfo = null;
    let aborted = false;

    const cleanup = () => {
      if (writeStream) {
        writeStream.destroy();
      }
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {}
      }
    };

    fileStream.on('data', (chunk) => {
      if (aborted) return;

      bytesWritten += chunk.length;
      hash.update(chunk);

      // Check file size limit
      if (bytesWritten > maxBytes) {
        aborted = true;
        cleanup();
        fileStream.resume(); // drain
        const err = new Error(`File size exceeds maximum allowed limit of ${maxBytes / (1024 * 1024)} MB.`);
        err.statusCode = 413;
        err.code = 'FILE_TOO_LARGE';
        return reject(err);
      }

      // Collect initial bytes for magic byte validation
      if (!detectedInfo) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);

        if (headerBuffer.length >= 12) {
          detectedInfo = detectAssetTypeAndValidateMagicBytes(headerBuffer);

          if (!detectedInfo) {
            aborted = true;
            cleanup();
            fileStream.resume();
            const err = new Error('Invalid file signature. Only JPEG, PNG, WebP, and MP4 files are supported.');
            err.statusCode = 400;
            err.code = 'UNSUPPORTED_ASSET_TYPE';
            return reject(err);
          }

          // Magic bytes verified; allocate temporary file with 0600 permissions
          try {
            writeStream = fs.createWriteStream(tempFilePath, { mode: 0o600 });
            writeStream.on('error', (wErr) => {
              aborted = true;
              cleanup();
              reject(wErr);
            });
            writeStream.write(headerBuffer);
          } catch (initErr) {
            aborted = true;
            cleanup();
            return reject(initErr);
          }
        }
      } else if (writeStream) {
        writeStream.write(chunk);
      }
    });

    fileStream.on('end', () => {
      if (aborted) return;

      if (!detectedInfo) {
        cleanup();
        const err = new Error('Uploaded file is too small or incomplete to verify signature.');
        err.statusCode = 400;
        err.code = 'FILE_TOO_SHORT';
        return reject(err);
      }

      if (writeStream) {
        writeStream.end(async () => {
          try {
            fs.chmodSync(tempFilePath, 0o600);
          } catch {}

          const sha256 = hash.digest('hex');
          resolve({
            tempFilePath,
            bytesWritten,
            sha256,
            mimeType: detectedInfo.mimeType,
            ext: detectedInfo.ext,
            assetType: detectedInfo.assetType,
          });
        });
      } else {
        cleanup();
        const err = new Error('File stream ended without writing data.');
        err.statusCode = 400;
        err.code = 'STREAM_EMPTY';
        reject(err);
      }
    });

    fileStream.on('error', (err) => {
      aborted = true;
      cleanup();
      reject(err);
    });
  });
}

/**
 * Moves a verified temporary asset file to permanent private storage for the authenticated user.
 *
 * @param {string} tempFilePath
 * @param {string} userId
 * @param {string} ext
 * @returns {Promise<{ storagePath: string, physicalPath: string, assetId: string }>}
 */
export async function moveToPermanentAssetStorage(tempFilePath, userId, ext) {
  const result = await storageAdapter.savePermanentFile(tempFilePath, 'backgrounds', userId, ext);
  const physicalPath = storageAdapter.isR2(result.storagePath) ? null : resolveSafeStoragePath(result.storagePath);
  const assetId = path.basename(storageAdapter.cleanKey(result.storagePath), `.${ext}`);
  return { storagePath: result.storagePath, physicalPath, assetId };
}
