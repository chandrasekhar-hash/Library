import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import busboy from 'busboy';
import { prisma } from '../services/prisma.js';
import { storagePaths } from '../config/storage.js';
import { resolveSafeStoragePath, deleteStoredFile, storageAdapter } from '../services/storageService.js';
import { sanitizeBook } from './bookController.js';
import { isValidUuid } from '../utils/validators.js';
import { QuotaService } from '../services/quotaService.js';
import { withUserLock } from '../utils/userLock.js';
import { env } from '../config/env.js';

const MAX_COVER_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB limit for cover thumbnail

/**
 * Validates magic bytes for supported cover image types (JPEG, PNG, WebP).
 * @param {Buffer} buffer - First >= 12 bytes of the file
 * @returns {{ mimeType: string, ext: string } | null}
 */
export function detectCoverImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
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
    return { mimeType: 'image/png', ext: 'png' };
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
    return { mimeType: 'image/webp', ext: 'webp' };
  }

  return null;
}

/**
 * Streams incoming cover image to temporary storage, verifying magic bytes.
 */
function streamCoverToTemp(fileStream) {
  const tempFilename = `cover_${crypto.randomUUID()}.tmp`;
  const tempFilePath = path.join(storagePaths.temp, tempFilename);

  if (!fs.existsSync(storagePaths.temp)) {
    fs.mkdirSync(storagePaths.temp, { recursive: true, mode: 0o700 });
  }

  return new Promise((resolve, reject) => {
    let writeStream = null;
    let bytesWritten = 0;
    let headerBuffer = Buffer.alloc(0);
    let detectedType = null;
    let aborted = false;

    const cleanup = () => {
      try {
        if (writeStream) writeStream.destroy();
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (_) {}
    };

    fileStream.on('data', (chunk) => {
      if (aborted) return;
      bytesWritten += chunk.length;

      if (bytesWritten > MAX_COVER_SIZE_BYTES) {
        aborted = true;
        fileStream.resume();
        cleanup();
        reject({
          statusCode: 400,
          message: 'Cover image exceeds the maximum allowed size of 5 MB.',
          code: 'FILE_TOO_LARGE',
        });
        return;
      }

      if (!detectedType) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        if (headerBuffer.length >= 12) {
          detectedType = detectCoverImageMagicBytes(headerBuffer);
          if (!detectedType) {
            aborted = true;
            fileStream.resume();
            cleanup();
            reject({
              statusCode: 400,
              message: 'Invalid cover image format. Supported formats: JPEG, PNG, WebP.',
              code: 'INVALID_FILE_TYPE',
            });
            return;
          }

          try {
            writeStream = fs.createWriteStream(tempFilePath, { mode: 0o600 });
            writeStream.write(headerBuffer);
          } catch (writeErr) {
            aborted = true;
            cleanup();
            reject({
              statusCode: 500,
              message: 'Failed to write cover image to disk.',
              code: 'STORAGE_WRITE_ERROR',
            });
            return;
          }
        }
      } else {
        if (writeStream) writeStream.write(chunk);
      }
    });

    fileStream.on('end', () => {
      if (aborted) return;

      if (!detectedType && headerBuffer.length < 12) {
        cleanup();
        reject({
          statusCode: 400,
          message: 'The uploaded file is empty or too small to be a valid image.',
          code: 'FILE_EMPTY',
        });
        return;
      }

      if (writeStream) {
        writeStream.end(() => {
          resolve({
            tempFilePath,
            bytesWritten,
            mimeType: detectedType.mimeType,
            ext: detectedType.ext,
          });
        });
      } else {
        cleanup();
        reject({
          statusCode: 400,
          message: 'No file data received.',
          code: 'NO_FILE_DATA',
        });
      }
    });

    fileStream.on('error', (err) => {
      cleanup();
      reject({
        statusCode: 500,
        message: err.message || 'Stream processing error.',
        code: 'STREAM_ERROR',
      });
    });
  });
}

/**
 * POST /api/books/:bookId/cover
 * Upload and save a book cover thumbnail (default or custom page).
 */
export async function uploadBookCover(req, res, next) {
  const { bookId } = req.params;
  const userId = req.userId;

  if (!isValidUuid(bookId)) {
    return res.status(400).json({
      error: {
        message: 'Invalid book ID format. Expected UUID.',
        code: 'INVALID_ID_FORMAT',
      },
    });
  }

  try {
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      include: { file: true, readingProgress: true },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({
        error: {
          message: 'Invalid request content type. Expected multipart/form-data.',
          code: 'INVALID_CONTENT_TYPE',
        },
      });
    }

    let limitError = null;
    let fileCount = 0;
    let filePromise = null;
    let coverType = 'custom';
    let targetPage = null;
    let targetPlacement = null;

    const bb = busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_COVER_SIZE_BYTES,
        fields: 10,
      },
    });

    bb.on('field', (name, val) => {
      if (name === 'type') {
        const cleanType = String(val).toLowerCase().trim();
        if (cleanType === 'default' || cleanType === 'custom') {
          coverType = cleanType;
        }
      } else if (name === 'page') {
        const parsedPage = parseInt(val, 10);
        if (!isNaN(parsedPage) && parsedPage >= 1) {
          targetPage = parsedPage;
        }
      } else if (name === 'placement' || name === 'coverPlacement') {
        const cleanPlacement = String(val).toLowerCase().trim();
        if (cleanPlacement === 'left' || cleanPlacement === 'right') {
          targetPlacement = cleanPlacement;
        }
      }
    });

    bb.on('file', (name, fileStream) => {
      fileCount++;
      if (fileCount > 1 || limitError) {
        fileStream.resume();
        return;
      }
      filePromise = streamCoverToTemp(fileStream);
    });

    bb.on('close', async () => {
      if (limitError) {
        return res.status(limitError.statusCode).json({
          error: { message: limitError.message, code: limitError.code },
        });
      }

      if (!filePromise) {
        return res.status(400).json({
          error: { message: 'No cover file was provided.', code: 'FILE_REQUIRED' },
        });
      }

      let tempFilePath = null;
      try {
        const uploadResult = await filePromise;
        tempFilePath = uploadResult.tempFilePath;

        // Target filename: e.g. {bookId}_{type}.jpg
        const filename = `${bookId}_${coverType}.${uploadResult.ext}`;
        const relativeStorageKey = path.posix.join('covers', userId, filename);

        const updatedBook = await withUserLock(userId, async () => {
          const currentScheme = (typeof book.colorScheme === 'object' && book.colorScheme) || {};
          const isCustom = coverType === 'custom';
          const replacingBytes = isCustom
            ? Number(currentScheme.customCoverSizeBytes || 0)
            : Number(currentScheme.defaultCoverSizeBytes || 0);

          // Assert storage quota with deduction for replaced cover
          await QuotaService.assertQuotaAvailable(userId, uploadResult.bytesWritten, { replacingBytes });

          // Upload/move using active storage provider
          await storageAdapter.getActiveUploadProvider().uploadFile(
            tempFilePath,
            relativeStorageKey,
            uploadResult.mimeType
          );

          // Update book colorScheme with cover metadata and server-measured byte size
          const updatedScheme = {
            ...currentScheme,
            hasCustomCover: isCustom ? true : currentScheme.hasCustomCover || false,
            customCoverPage: isCustom
              ? targetPage || currentScheme.customCoverPage || 1
              : currentScheme.customCoverPage || null,
            defaultCoverPage: !isCustom
              ? targetPage || currentScheme.defaultCoverPage || 1
              : currentScheme.defaultCoverPage || 1,
            coverExt: uploadResult.ext,
            coverPlacement: targetPlacement || currentScheme.coverPlacement || 'right',
            coverUpdatedAt: Date.now(),
            ...(isCustom
              ? { customCoverSizeBytes: uploadResult.bytesWritten }
              : { defaultCoverSizeBytes: uploadResult.bytesWritten }),
          };

          return await prisma.book.update({
            where: { id_userId: { id: bookId, userId } },
            data: { colorScheme: updatedScheme },
            include: {
              file: {
                select: {
                  id: true,
                  filename: true,
                  mimeType: true,
                  fileSizeBytes: true,
                  fileSha256: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
              readingProgress: {
                select: {
                  currentPage: true,
                  progressPercent: true,
                  lastOpenedAt: true,
                },
              },
              _count: {
                select: {
                  bookmarks: true,
                  notes: true,
                  highlights: true,
                },
              },
            },
          });
        });

        const isCustom = coverType === 'custom';
        return res.status(200).json({
          message: `${isCustom ? 'Custom' : 'Default'} cover updated successfully.`,
          book: sanitizeBook(updatedBook),
        });
      } catch (err) {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (_) {}
        }
        return res.status(err.statusCode || 500).json({
          error: {
            message: err.message || 'Failed to process cover upload.',
            code: err.code || 'COVER_UPLOAD_ERROR',
          },
        });
      }
    });

    req.pipe(bb);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/cover
 * Stream an owned book's active or requested cover thumbnail.
 */
export async function streamBookCover(req, res, next) {
  const { bookId } = req.params;
  const userId = req.resourceUserId || req.userId;

  if (!isValidUuid(bookId)) {
    return res.status(400).json({
      error: {
        message: 'Invalid book ID format. Expected UUID.',
        code: 'INVALID_ID_FORMAT',
      },
    });
  }

  try {
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      select: { id: true, userId: true, colorScheme: true },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const queryType = req.query.type ? String(req.query.type).toLowerCase().trim() : null;
    const scheme = (typeof book.colorScheme === 'object' && book.colorScheme) || {};
    const hasCustom = Boolean(scheme.hasCustomCover);

    // Determine target cover priority
    let targetCoverTypes = [];
    if (queryType === 'default') {
      targetCoverTypes = ['default'];
    } else if (queryType === 'custom') {
      targetCoverTypes = ['custom'];
    } else if (hasCustom) {
      targetCoverTypes = ['custom', 'default'];
    } else {
      targetCoverTypes = ['default'];
    }

    const extensions = ['jpg', 'webp', 'png'];
    let matchedFilePath = null;
    let matchedExt = 'jpg';
    let matchedStoragePath = null;

    for (const type of targetCoverTypes) {
      for (const ext of extensions) {
        const candidateRelative = path.posix.join('covers', userId, `${bookId}_${type}.${ext}`);
        // Check R2 first if running in R2, then check local
        if (await storageAdapter.fileExists(`r2://${candidateRelative}`)) {
          matchedStoragePath = `r2://${candidateRelative}`;
          matchedExt = ext;
          break;
        } else if (await storageAdapter.fileExists(candidateRelative)) {
          matchedStoragePath = candidateRelative;
          matchedExt = ext;
          break;
        }
      }
      if (matchedStoragePath) break;
    }

    if (!matchedStoragePath) {
      return res.status(404).json({
        error: {
          message: 'No cover thumbnail found for this book.',
          code: 'COVER_NOT_FOUND',
        },
      });
    }

    const mimeMap = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };
    const mimeType = mimeMap[matchedExt] || 'image/jpeg';
    const meta = await storageAdapter.getMetadata(matchedStoragePath);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', meta.sizeBytes);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', `"${meta.sizeBytes.toString(16)}"`);

    // Handle 304 Not Modified
    if (req.headers['if-none-match'] === `"${meta.sizeBytes.toString(16)}"`) {
      return res.status(304).end();
    }

    const readStream = await storageAdapter.getStream(matchedStoragePath);
    readStream.pipe(res);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/books/:bookId/cover/reset
 * Return to the automatically generated PDF cover (page 1) by clearing custom cover flag.
 */
export async function resetBookCover(req, res, next) {
  const { bookId } = req.params;
  const userId = req.userId;

  if (!isValidUuid(bookId)) {
    return res.status(400).json({
      error: {
        message: 'Invalid book ID format. Expected UUID.',
        code: 'INVALID_ID_FORMAT',
      },
    });
  }

  try {
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      include: { file: true, readingProgress: true },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const updatedBook = await withUserLock(userId, async () => {
      const currentScheme = (typeof book.colorScheme === 'object' && book.colorScheme) || {};
      const updatedScheme = {
        ...currentScheme,
        hasCustomCover: false,
        customCoverPage: null,
        customCoverSizeBytes: 0,
        coverUpdatedAt: Date.now(),
      };

      // Delete custom cover file from disk
      const extensions = ['jpg', 'webp', 'png'];
      for (const ext of extensions) {
        try {
          const customRel = path.join('covers', userId, `${bookId}_custom.${ext}`);
          await deleteStoredFile(customRel);
        } catch (_) {}
      }

      return await prisma.book.update({
        where: { id_userId: { id: bookId, userId } },
        data: { colorScheme: updatedScheme },
        include: {
          file: {
            select: {
              id: true,
              filename: true,
              mimeType: true,
              fileSizeBytes: true,
              fileSha256: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          readingProgress: {
            select: {
              currentPage: true,
              progressPercent: true,
              lastOpenedAt: true,
            },
          },
          _count: {
            select: {
              bookmarks: true,
              notes: true,
              highlights: true,
            },
          },
        },
      });
    });

    return res.status(200).json({
      message: 'Book cover reset to default successfully.',
      book: sanitizeBook(updatedBook),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/books/:bookId/cover/placement
 * Update the book's cover placement ('left' | 'right') without re-uploading the image.
 */
export async function updateCoverPlacement(req, res, next) {
  const { bookId } = req.params;
  const userId = req.userId;
  const { placement } = req.body || {};

  if (!isValidUuid(bookId)) {
    return res.status(400).json({
      error: {
        message: 'Invalid book ID format. Expected UUID.',
        code: 'INVALID_ID_FORMAT',
      },
    });
  }

  const cleanPlacement = String(placement || '').toLowerCase().trim();
  if (cleanPlacement !== 'left' && cleanPlacement !== 'right') {
    return res.status(400).json({
      error: {
        message: "Invalid cover placement. Expected 'left' or 'right'.",
        code: 'INVALID_PLACEMENT',
      },
    });
  }

  try {
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      include: { file: true, readingProgress: true },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    const currentScheme = (typeof book.colorScheme === 'object' && book.colorScheme) || {};
    const updatedScheme = {
      ...currentScheme,
      coverPlacement: cleanPlacement,
      coverUpdatedAt: Date.now(),
    };

    const updatedBook = await prisma.book.update({
      where: { id_userId: { id: bookId, userId } },
      data: { colorScheme: updatedScheme },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            mimeType: true,
            fileSizeBytes: true,
            fileSha256: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        readingProgress: {
          select: {
            currentPage: true,
            progressPercent: true,
            lastOpenedAt: true,
          },
        },
        _count: {
          select: {
            bookmarks: true,
            notes: true,
            highlights: true,
          },
        },
      },
    });

    return res.status(200).json({
      message: 'Cover placement updated successfully.',
      book: sanitizeBook(updatedBook),
    });
  } catch (err) {
    next(err);
  }
}

