import fs from 'fs';
import busboy from 'busboy';
import { prisma } from '../services/prisma.js';
import { env } from '../config/env.js';
import { OcrJobService } from '../services/ocrJobService.js';
import { QuotaService } from '../services/quotaService.js';
import { withUserLock } from '../utils/userLock.js';
import {
  sanitizeFilename,
  resolveSafeStoragePath,
  streamToTempFile,
  validatePdfStructure,
  moveToPermanentStorage,
  deleteStoredFile,
  storageAdapter,
} from '../services/storageService.js';

/**
 * Controller for Private Book File Storage & PDF Streaming in Aks (अक्स)
 */

import { withBookLock } from '../utils/bookLock.js';
export { withBookLock };


/**
 * POST /api/books/:bookId/file
 * Upload and attach a validated PDF to an owned book.
 */
export async function uploadBookFile(req, res, next) {
  const { bookId } = req.params;
  const userId = req.userId;

  if (!bookId) {
    return res.status(400).json({
      error: {
        message: 'Book ID is required in URL parameters.',
        code: 'BOOK_ID_REQUIRED',
      },
    });
  }

  // 1. Verify book exists and is owned by the authenticated user
  const book = await prisma.book.findFirst({
    where: {
      id: bookId,
      userId,
    },
    include: {
      file: true,
    },
  });

  if (!book) {
    return res.status(404).json({
      error: {
        message: 'Book not found or access denied.',
        code: 'BOOK_NOT_FOUND',
      },
    });
  }

  // 2. Verify multipart content type
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return res.status(400).json({
      error: {
        message: 'Invalid request content type. Expected multipart/form-data.',
        code: 'INVALID_CONTENT_TYPE',
      },
    });
  }

  // Early check on Content-Length header if provided (fast-fail before streaming)
  const declaredContentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (declaredContentLength > env.MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
    return res.status(413).json({
      error: {
        message: `File exceeds maximum permitted size of ${env.MAX_UPLOAD_SIZE_MB} MB.`,
        code: 'FILE_TOO_LARGE',
      },
    });
  }

  let limitError = null;
  let fileCount = 0;
  let fileProcessed = false;
  let filePromise = null;
  let originalFilename = 'document.pdf';

  try {
    const bb = busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fields: 10,
        parts: 20,
      },
    });

    const handleLimitViolation = (message, code) => {
      if (!limitError) {
        limitError = new Error(message);
        limitError.statusCode = 400;
        limitError.code = code;
      }
    };

    bb.on('filesLimit', () => {
      handleLimitViolation('Too many files uploaded. Only 1 file is permitted.', 'LIMIT_FILE_COUNT');
    });

    bb.on('fieldsLimit', () => {
      handleLimitViolation('Too many fields uploaded. Maximum permitted fields count is 10.', 'LIMIT_FIELD_COUNT');
    });

    bb.on('partsLimit', () => {
      handleLimitViolation('Too many multipart parts uploaded. Maximum permitted parts count is 20.', 'LIMIT_PART_COUNT');
    });

    bb.on('file', (name, fileStream, info) => {
      fileCount++;
      if (fileCount > 1 || limitError) {
        handleLimitViolation('Too many files uploaded. Only 1 file is permitted.', 'LIMIT_FILE_COUNT');
        fileStream.resume(); // Drain stream
        return;
      }

      fileProcessed = true;
      originalFilename = sanitizeFilename(info?.filename);
      // Initiate streaming write to disk
      filePromise = streamToTempFile(fileStream);
    });

    bb.on('close', async () => {
      if (res.headersSent) return;

      // Handle multipart limit violations with safe HTTP 400 response and cleanup
      if (limitError) {
        if (filePromise) {
          try {
            const uploadResult = await filePromise;
            if (uploadResult?.tempFilePath && fs.existsSync(uploadResult.tempFilePath)) {
              fs.unlinkSync(uploadResult.tempFilePath);
            }
          } catch {
            // ignore
          }
        }
        return res.status(limitError.statusCode || 400).json({
          error: {
            message: limitError.message,
            code: limitError.code || 'LIMIT_EXCEEDED',
          },
        });
      }

      if (!fileProcessed || !filePromise) {
        return res.status(400).json({
          error: {
            message: 'No file was uploaded in the request.',
            code: 'FILE_REQUIRED',
          },
        });
      }

      let tempFilePath = null;
      let newStoragePath = null;

      try {
        // Wait for streaming and magic-byte validation to complete
        const uploadResult = await filePromise;
        tempFilePath = uploadResult.tempFilePath;
        const { bytesWritten, sha256 } = uploadResult;

        // 3. Validate structural integrity of completed PDF before permanent placement
        await validatePdfStructure(tempFilePath);

        // 4. Safely move to permanent storage and update DB inside per-book and per-user serialization locks
        // utilizing PostgreSQL transaction row-level locking for multi-instance distributed safety
        const bookFile = await withBookLock(book.id, async () => {
          return await withUserLock(userId, async () => {
            return await QuotaService.withUserRowLock(userId, async (tx) => {
              // Re-verify that the book still exists before proceeding with promotion
              const currentBook = await tx.book.findFirst({
                where: { id: book.id, userId },
              });
              if (!currentBook) {
                const err = new Error('Book not found or access denied.');
                err.statusCode = 404;
                err.code = 'BOOK_NOT_FOUND';
                throw err;
              }

              // Query latest BookFile to avoid race conditions during concurrent replacements
              const currentBookFile = await tx.bookFile.findUnique({
                where: { bookId: book.id },
              });
              const oldStoragePath = currentBookFile?.storagePath || null;
              const oldSizeBytes = currentBookFile ? Number(currentBookFile.fileSizeBytes) : 0;

              // Enforce account storage quota against trusted server-measured bytesWritten within locked tx
              await QuotaService.assertQuotaAvailable(userId, bytesWritten, {
                replacingBytes: oldSizeBytes,
                client: tx,
              });

              // Move validated temp file to user's permanent private storage
              const moveRes = await moveToPermanentStorage(tempFilePath, userId);
              newStoragePath = moveRes.storagePath;

              // Safely update BookFile record in PostgreSQL
              const record = await tx.bookFile.upsert({
                where: {
                  bookId: book.id,
                },
                update: {
                  storagePath: newStoragePath,
                  filename: originalFilename,
                  fileSizeBytes: BigInt(bytesWritten),
                  fileSha256: sha256,
                  mimeType: 'application/pdf',
                },
                create: {
                  bookId: book.id,
                  userId,
                  storagePath: newStoragePath,
                  filename: originalFilename,
                  fileSizeBytes: BigInt(bytesWritten),
                  fileSha256: sha256,
                  mimeType: 'application/pdf',
                },
              });

              return { record, oldStoragePath };
            });
          });
        });

        const finalRecord = bookFile.record;

        // Post-commit cleanup: remove obsolete physical file safely
        if (bookFile.oldStoragePath && bookFile.oldStoragePath !== newStoragePath) {
          await deleteStoredFile(bookFile.oldStoragePath);
        }

        // 5. Automatically enqueue background indexing for the uploaded book
        let indexingInfo = { enqueued: false };
        try {
          const jobResult = await OcrJobService.requestJob({
            userId,
            bookId: book.id,
            language: 'en',
          });
          indexingInfo = {
            enqueued: true,
            jobId: jobResult.job?.id,
            isExisting: jobResult.isExisting,
          };
        } catch (enqueueErr) {
          console.warn(`[uploadBookFile] Background indexing enqueue failed for book ${book.id}:`, enqueueErr.message);
          indexingInfo = {
            enqueued: false,
            error: enqueueErr.message || 'Failed to automatically enqueue indexing',
            recoverable: true,
          };
        }

        return res.status(200).json({
          message: 'PDF file uploaded and attached successfully.',
          file: {
            id: finalRecord.id,
            bookId: finalRecord.bookId,
            filename: finalRecord.filename,
            mimeType: finalRecord.mimeType,
            fileSizeBytes: Number(finalRecord.fileSizeBytes),
            fileSha256: finalRecord.fileSha256,
            createdAt: finalRecord.createdAt,
            updatedAt: finalRecord.updatedAt,
          },
          indexing: indexingInfo,
        });
      } catch (err) {
        // Cleanup temp file or unreferenced permanent file if an error occurred during or after stream
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch {
            // ignore
          }
        }
        if (newStoragePath) {
          await deleteStoredFile(newStoragePath);
        }

        return res.status(err.statusCode || 400).json({
          error: {
            message: err.message,
            code: err.code || 'UPLOAD_FAILED',
          },
        });
      }
    });

    bb.on('error', (err) => {
      if (res.headersSent) return;
      res.status(400).json({
        error: {
          message: err.message || 'Multipart form parse error.',
          code: 'UPLOAD_PARSE_ERROR',
        },
      });
    });

    req.pipe(bb);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:bookId/file
 * Stream an owned book's PDF with HTTP Range request support for PDF.js.
 */
export async function streamBookFile(req, res, next) {
  const { bookId } = req.params;
  const userId = req.resourceUserId || req.userId;

  if (!bookId) {
    return res.status(400).json({
      error: {
        message: 'Book ID is required in URL parameters.',
        code: 'BOOK_ID_REQUIRED',
      },
    });
  }

  try {
    // 1. Verify book and file ownership
    const book = await prisma.book.findFirst({
      where: {
        id: bookId,
        userId,
      },
      include: {
        file: true,
      },
    });

    if (!book) {
      return res.status(404).json({
        error: {
          message: 'Book not found or access denied.',
          code: 'BOOK_NOT_FOUND',
        },
      });
    }

    if (!book.file) {
      return res.status(404).json({
        error: {
          message: 'No PDF file is currently attached to this book.',
          code: 'FILE_NOT_FOUND',
        },
      });
    }

    // 2. Stream using storage adapter (supports Local and Cloudflare R2 with RFC 7233 byte-range support)
    return storageAdapter.streamRangeResponse(req, res, next, {
      storagePath: book.file.storagePath,
      filename: book.file.filename,
      mimeType: book.file.mimeType || 'application/pdf',
    });
  } catch (err) {
    next(err);
  }
}
