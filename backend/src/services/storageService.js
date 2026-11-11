import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { storagePaths } from '../config/storage.js';
import { env } from '../config/env.js';
import { storageAdapter } from './storage/storageAdapter.js';

export { storageAdapter };

/**
 * Storage Service for Aks (अक्स) Private File Storage.
 *
 * Enforces:
 * - Streaming disk writes (zero full-file memory buffering)
 * - Strict size limit enforcement during streaming
 * - Magic byte inspection (%PDF-) before allocating disk files
 * - SHA-256 calculation during stream piping
 * - Path traversal protection
 * - Safe atomic file placement and cleanup
 */

const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const MAX_FILE_SIZE_BYTES = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024; // 150 MB default

/**
 * Sanitizes a client-provided filename.
 * Strips directory paths, null bytes, and non-printable characters.
 *
 * @param {string} originalName
 * @returns {string} Sanitized base filename
 */
export function sanitizeFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') {
    return 'document.pdf';
  }

  // Extract base filename only (stripping any / or \ directory traversal attempts)
  const baseName = path.basename(originalName).replace(/[\0\x00-\x1f\x7f-\x9f]/g, '').trim();

  return baseName.length > 0 ? baseName.slice(0, 255) : 'document.pdf';
}

/**
 * Resolves a relative storage path to an absolute path.
 * Strictly guarantees that the resolved path stays within the private storage root.
 *
 * @param {string} relativePath
 * @returns {string} Absolute verified file path
 */
export function resolveSafeStoragePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('Storage path must be a non-empty string.');
  }

  // If path is a Cloudflare R2 URI, return directly without local path resolution
  if (relativePath.startsWith('r2://')) {
    return relativePath;
  }

  const rootPrefix = storagePaths.root.endsWith(path.sep)
    ? storagePaths.root
    : storagePaths.root + path.sep;

  const absolutePath = path.resolve(storagePaths.root, relativePath);

  if (!absolutePath.startsWith(rootPrefix) && absolutePath !== storagePaths.root) {
    throw new Error('Access denied: Path traversal detected.');
  }

  return absolutePath;
}

/**
 * Processes an incoming multipart file stream and saves it to a temporary file.
 * Validates magic bytes, tracks bytes written, and calculates SHA-256 hash in a single pass.
 *
 * @param {import('stream').Readable} fileStream - Multipart file stream from busboy
 * @param {Object} options
 * @param {number} [options.maxSizeBytes]
 * @returns {Promise<{ tempFilePath: string, bytesWritten: number, sha256: string }>}
 */
export async function streamToTempFile(fileStream, options = {}) {
  const maxBytes = options.maxSizeBytes || MAX_FILE_SIZE_BYTES;
  const tempFilename = `upload_${crypto.randomUUID()}.tmp`;
  const tempFilePath = path.join(storagePaths.temp, tempFilename);

  // Ensure temp directory exists with 0700 permissions
  if (!fs.existsSync(storagePaths.temp)) {
    fs.mkdirSync(storagePaths.temp, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(storagePaths.temp, 0o700);
  } catch {
    // ignore
  }

  return new Promise((resolve, reject) => {
    let writeStream = null;
    const hash = crypto.createHash('sha256');

    let bytesWritten = 0;
    let headerBuffer = Buffer.alloc(0);
    let magicBytesVerified = false;
    let aborted = false;

    const cleanupTempFile = () => {
      if (writeStream) {
        writeStream.destroy();
        writeStream.on('close', () => {
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
          } catch {
            // ignore
          }
        });
      }
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch {
        // ignore
      }
    };

    fileStream.on('data', (chunk) => {
      if (aborted) return;

      bytesWritten += chunk.length;

      // 1. Check size limit while streaming
      if (bytesWritten > maxBytes) {
        aborted = true;
        fileStream.resume(); // Drain remaining incoming data
        cleanupTempFile();

        const err = new Error(`File exceeds maximum permitted size of ${env.MAX_UPLOAD_SIZE_MB} MB.`);
        err.statusCode = 413;
        err.code = 'FILE_TOO_LARGE';
        return reject(err);
      }

      // 2. Validate PDF signature (%PDF-) before or on first disk write
      if (!magicBytesVerified) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        if (headerBuffer.length >= 5) {
          const magicPrefix = headerBuffer.subarray(0, 5);
          if (!magicPrefix.equals(PDF_MAGIC_BYTES)) {
            aborted = true;
            fileStream.resume();
            cleanupTempFile();

            const err = new Error('Invalid file format. The uploaded file is not a valid PDF document.');
            err.statusCode = 400;
            err.code = 'INVALID_FILE_SIGNATURE';
            return reject(err);
          }
          magicBytesVerified = true;
          // Lazy create write stream with explicit 0600 mode only after magic bytes are verified!
          writeStream = fs.createWriteStream(tempFilePath, { mode: 0o600 });
          writeStream.on('error', (err) => {
            aborted = true;
            cleanupTempFile();
            reject(err);
          });
        } else {
          // Awaiting enough bytes to check header
          return;
        }
      }

      // 3. Update SHA-256 hash
      hash.update(chunk);

      // 4. Write chunk to disk
      if (writeStream) {
        writeStream.write(chunk);
      }
    });

    fileStream.on('end', () => {
      if (aborted) return;

      // Ensure minimum length and magic bytes were met
      if (bytesWritten === 0 || !magicBytesVerified) {
        cleanupTempFile();
        const err = new Error('File is empty or contains an invalid header.');
        err.statusCode = 400;
        err.code = 'INVALID_FILE_SIGNATURE';
        return reject(err);
      }

      if (writeStream) {
        writeStream.end(() => {
          try {
            fs.chmodSync(tempFilePath, 0o600);
          } catch {
            // ignore
          }
          const sha256 = hash.digest('hex');
          resolve({
            tempFilePath,
            bytesWritten,
            sha256,
          });
        });
      } else {
        cleanupTempFile();
        const err = new Error('Upload stream ended unexpectedly.');
        err.statusCode = 400;
        err.code = 'UPLOAD_FAILED';
        reject(err);
      }
    });

    fileStream.on('error', (err) => {
      aborted = true;
      cleanupTempFile();
      reject(err);
    });
  });
}

/**
 * Validates the structural integrity of a completed PDF file on disk.
 * Ensures the file can be parsed by a standard PDF engine, has valid catalog/pages trees,
 * and rejects truncated, corrupted, or synthetic non-PDF payloads.
 *
 * @param {string} filePath - Absolute path to temporary or stored PDF file
 * @returns {Promise<{ valid: boolean, pageCount: number }>}
 */
export async function validatePdfStructure(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    const err = new Error('File does not exist for structure validation.');
    err.statusCode = 400;
    err.code = 'INVALID_PDF_STRUCTURE';
    throw err;
  }

  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    if (fileBuffer.length === 0) {
      const err = new Error('Uploaded PDF file is empty.');
      err.statusCode = 400;
      err.code = 'INVALID_PDF_STRUCTURE';
      throw err;
    }

    const pdfDoc = await PDFDocument.load(fileBuffer, {
      ignoreEncryption: true,
    });

    const pageCount = pdfDoc.getPageCount();
    if (typeof pageCount !== 'number' || pageCount < 1) {
      const err = new Error('PDF document contains no valid readable pages.');
      err.statusCode = 400;
      err.code = 'INVALID_PDF_STRUCTURE';
      throw err;
    }

    return { valid: true, pageCount };
  } catch (err) {
    if (err.statusCode && err.code) {
      throw err;
    }
    const structureError = new Error(`Malformed or unreadable PDF: ${err.message}`);
    structureError.statusCode = 400;
    structureError.code = 'INVALID_PDF_STRUCTURE';
    throw structureError;
  }
}

/**
 * Moves/uploads a validated temporary file into permanent private storage for a user.
 * Supports both Local filesystem and Cloudflare R2 via storageAdapter.
 *
 * @param {string} tempFilePath
 * @param {string} userId
 * @returns {Promise<{ storagePath: string, fullPath: string | null }>}
 */
export async function moveToPermanentStorage(tempFilePath, userId) {
  const result = await storageAdapter.savePermanentFile(tempFilePath, 'pdfs', userId, 'pdf', 'application/pdf');
  const fullPath = storageAdapter.isR2(result.storagePath)
    ? null
    : resolveSafeStoragePath(result.storagePath);

  return {
    storagePath: result.storagePath,
    fullPath,
  };
}

/**
 * Safely removes a file from storage (Local or Cloudflare R2).
 *
 * @param {string} relativePath
 */
export async function deleteStoredFile(relativePath) {
  if (!relativePath) return;
  try {
    await storageAdapter.deleteStoredFile(relativePath);
  } catch (err) {
    console.error(`[StorageService] Failed to delete file at ${relativePath}:`, err.message);
  }
}
