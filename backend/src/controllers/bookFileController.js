import fs from 'fs';
import busboy from 'busboy';
import { prisma } from '../services/prisma.js';
import { OcrJobService } from '../services/ocrJobService.js';
import {
  sanitizeFilename,
  resolveSafeStoragePath,
  streamToTempFile,
  validatePdfStructure,
  moveToPermanentStorage,
  deleteStoredFile,
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

        // 4. Safely move to permanent storage and update DB inside per-book serialization lock
        const bookFile = await withBookLock(book.id, async () => {
          // Re-verify that the book still exists before proceeding with promotion
          const currentBook = await prisma.book.findFirst({
            where: { id: book.id, userId },
          });
          if (!currentBook) {
            const err = new Error('Book not found or access denied.');
            err.statusCode = 404;
            err.code = 'BOOK_NOT_FOUND';
            throw err;
          }

          // Query latest BookFile to avoid race conditions during concurrent replacements
          const currentBookFile = await prisma.bookFile.findUnique({
            where: { bookId: book.id },
          });
          const oldStoragePath = currentBookFile?.storagePath || null;

          // Move validated temp file to user's permanent private storage
          const moveRes = await moveToPermanentStorage(tempFilePath, userId);
          newStoragePath = moveRes.storagePath;

          // Safely update BookFile record in PostgreSQL
          const record = await prisma.bookFile.upsert({
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

          // Post-commit cleanup: remove obsolete physical file safely
          if (oldStoragePath && oldStoragePath !== newStoragePath) {
            await deleteStoredFile(oldStoragePath);
          }

          return record;
        });

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
            id: bookFile.id,
            bookId: bookFile.bookId,
            filename: bookFile.filename,
            mimeType: bookFile.mimeType,
            fileSizeBytes: Number(bookFile.fileSizeBytes),
            fileSha256: bookFile.fileSha256,
            createdAt: bookFile.createdAt,
            updatedAt: bookFile.updatedAt,
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
  const userId = req.userId;

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

    // 2. Resolve safe absolute file path
    const filePath = resolveSafeStoragePath(book.file.storagePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: {
          message: 'Stored PDF file could not be found on disk.',
          code: 'STORAGE_FILE_MISSING',
        },
      });
    }

    const stat = await fs.promises.stat(filePath);
    const totalSize = stat.size;

    // 3. Handle HTTP Range Requests (Essential for PDF.js streaming)
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

      // Handle suffix byte range: "bytes=-500" (last 500 bytes)
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
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(book.file.filename)}"`);

      const fileStream = fs.createReadStream(filePath, { start, end });

      fileStream.on('error', (err) => {
        console.error('[StreamError] Error streaming range:', err.message);
        if (!res.headersSent) {
          next(err);
        }
      });

      fileStream.pipe(res);
    } else {
      // 4. Normal Full-File Request (200 OK)
      res.status(200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', totalSize);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(book.file.filename)}"`);

      const fileStream = fs.createReadStream(filePath);

      fileStream.on('error', (err) => {
        console.error('[StreamError] Error streaming full file:', err.message);
        if (!res.headersSent) {
          next(err);
        }
      });

      fileStream.pipe(res);
    }
  } catch (err) {
    next(err);
  }
}
