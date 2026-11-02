import fs from 'fs';
import busboy from 'busboy';
import { prisma } from '../services/prisma.js';
import { isValidUuid } from '../utils/validators.js';
import { sanitizeFilename, resolveSafeStoragePath, deleteStoredFile } from '../services/storageService.js';
import { streamAssetToTempFile, moveToPermanentAssetStorage } from '../services/assetStorageService.js';
import { withUserLock } from '../utils/userLock.js';

function sanitizeAsset(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    userId: asset.userId,
    assetType: asset.assetType,
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    isActive: asset.isActive,
    metadata: asset.metadata,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

/**
 * POST /api/assets/backgrounds
 * Upload a private reading background (JPEG, PNG, WebP, MP4 up to 50 MB).
 */
export async function uploadBackgroundAsset(req, res, next) {
  const userId = req.userId;

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
  let originalFilename = 'background';

  try {
    const bb = busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: 50 * 1024 * 1024, // 50 MB limit
        fields: 10,
        parts: 20,
      },
    });

    bb.on('filesLimit', () => {
      limitError = { statusCode: 400, message: 'Only a single file can be uploaded per request.', code: 'TOO_MANY_FILES' };
    });

    bb.on('fieldsLimit', () => {
      limitError = { statusCode: 400, message: 'Too many form fields.', code: 'TOO_MANY_FIELDS' };
    });

    bb.on('partsLimit', () => {
      limitError = { statusCode: 400, message: 'Too many multipart parts.', code: 'TOO_MANY_PARTS' };
    });

    bb.on('file', (name, fileStream, info) => {
      fileCount++;
      if (fileCount > 1 || limitError) {
        fileStream.resume(); // drain
        return;
      }

      originalFilename = sanitizeFilename(info.filename || 'background');
      filePromise = streamAssetToTempFile(fileStream, { maxSizeBytes: 50 * 1024 * 1024 });
    });

    bb.on('close', async () => {
      if (limitError) {
        return res.status(limitError.statusCode).json({
          error: {
            message: limitError.message,
            code: limitError.code,
          },
        });
      }

      if (!filePromise) {
        return res.status(400).json({
          error: {
            message: 'No file was provided in the multipart request body.',
            code: 'FILE_REQUIRED',
          },
        });
      }

      let tempFilePath = null;
      let newStoragePath = null;

      try {
        const streamResult = await filePromise;
        tempFilePath = streamResult.tempFilePath;
        const { bytesWritten, sha256, mimeType, ext, assetType } = streamResult;

        // Move to permanent private storage under backgrounds/<userId>/<uuid>.<ext>
        const moveRes = await moveToPermanentAssetStorage(tempFilePath, userId, ext);
        newStoragePath = moveRes.storagePath;
        const assetId = moveRes.assetId;

        // Save UserAsset in database
        const assetRecord = await prisma.userAsset.create({
          data: {
            id: assetId,
            userId,
            assetType,
            storagePath: newStoragePath,
            filename: originalFilename,
            mimeType,
            sizeBytes: BigInt(bytesWritten),
            isActive: true,
            metadata: {
              originalFilename,
              detectedMimeType: mimeType,
              sha256,
            },
          },
        });

        return res.status(201).json({
          message: 'Background asset uploaded successfully.',
          asset: sanitizeAsset(assetRecord),
        });
      } catch (err) {
        // Cleanup temp file if still present
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch {}
        }
        // Cleanup permanent file if error occurred during DB write
        if (newStoragePath) {
          await deleteStoredFile(newStoragePath);
        }

        return res.status(err.statusCode || 400).json({
          error: {
            message: err.message || 'Asset upload failed.',
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
 * GET /api/assets
 * List all active assets owned by the authenticated user.
 */
export async function listAssets(req, res, next) {
  try {
    const userId = req.userId;
    const { type } = req.query;

    const where = { userId, isActive: true };
    if (type && ['BACKGROUND_IMAGE', 'BACKGROUND_VIDEO', 'CUSTOM_MARKER'].includes(type.toUpperCase())) {
      where.assetType = type.toUpperCase();
    }

    const assets = await prisma.userAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      assets: assets.map(sanitizeAsset),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/assets/:assetId
 * Retrieve metadata for a single owned asset.
 */
export async function getAssetMetadata(req, res, next) {
  try {
    const { assetId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(assetId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid asset ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const asset = await prisma.userAsset.findFirst({
      where: { id: assetId, userId, isActive: true },
    });

    if (!asset) {
      return res.status(404).json({
        error: {
          message: 'Asset not found or access denied.',
          code: 'ASSET_NOT_FOUND',
        },
      });
    }

    return res.status(200).json({
      asset: sanitizeAsset(asset),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/assets/:assetId/file
 * Stream a private asset file (supports HTTP Range for video streaming).
 */
export async function streamAssetFile(req, res, next) {
  try {
    const { assetId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(assetId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid asset ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    const asset = await prisma.userAsset.findFirst({
      where: { id: assetId, userId, isActive: true },
    });

    if (!asset) {
      return res.status(404).json({
        error: {
          message: 'Asset not found or access denied.',
          code: 'ASSET_NOT_FOUND',
        },
      });
    }

    const filePath = resolveSafeStoragePath(asset.storagePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: {
          message: 'Asset storage file missing on disk.',
          code: 'STORAGE_FILE_MISSING',
        },
      });
    }

    const stat = await fs.promises.stat(filePath);
    const totalSize = stat.size;
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

      if (start === undefined && end !== undefined) {
        start = Math.max(0, totalSize - end);
        end = totalSize - 1;
      } else if (start !== undefined && end === undefined) {
        end = totalSize - 1;
      }

      if (start === undefined || end === undefined || start >= totalSize || start > end) {
        res.setHeader('Content-Range', `bytes */${totalSize}`);
        return res.status(416).json({
          error: {
            message: 'Requested Range Not Satisfiable.',
            code: 'RANGE_NOT_SATISFIABLE',
          },
        });
      }

      if (end >= totalSize) {
        end = totalSize - 1;
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asset.filename)}"`);

      const fileStream = fs.createReadStream(filePath, { start, end });
      fileStream.on('error', (err) => {
        if (!res.headersSent) next(err);
      });
      fileStream.pipe(res);
    } else {
      res.status(200);
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Content-Length', totalSize);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asset.filename)}"`);

      const fileStream = fs.createReadStream(filePath);
      fileStream.on('error', (err) => {
        if (!res.headersSent) next(err);
      });
      fileStream.pipe(res);
    }
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/assets/:assetId
 * Delete an owned asset. Verifies the asset is not currently referenced
 * in user or book preferences (both background atmosphere and custom markers) before removing.
 * Serialized per user via withUserLock to eliminate race conditions with concurrent preference updates.
 */
export async function deleteAsset(req, res, next) {
  try {
    const { assetId } = req.params;
    const userId = req.userId;

    if (!isValidUuid(assetId)) {
      return res.status(400).json({
        error: {
          message: 'Invalid asset ID format. Expected UUID.',
          code: 'INVALID_ID_FORMAT',
        },
      });
    }

    return await withUserLock(userId, async () => {
      const asset = await prisma.userAsset.findFirst({
        where: { id: assetId, userId },
      });

      if (!asset) {
        return res.status(404).json({
          error: {
            message: 'Asset not found or access denied.',
            code: 'ASSET_NOT_FOUND',
          },
        });
      }

      // 1. Check if asset is actively referenced by UserPreference (atmosphere or custom markers)
      const userPref = await prisma.userPreference.findUnique({ where: { userId } });
      if (userPref) {
        const atmo = userPref.atmosphereConfig || {};
        if (
          atmo.customMediaId === assetId ||
          atmo.customMediaMeta?.id === assetId ||
          atmo.customMediaMeta?.assetId === assetId
        ) {
          return res.status(409).json({
            error: {
              message: 'Cannot delete an asset that is currently set as an active reading background. Change your background preference before deleting this asset.',
              code: 'ASSET_IN_USE',
            },
          });
        }

        const annotations = userPref.annotationsConfig || {};
        if (
          annotations.customMarkerId === assetId ||
          (typeof annotations.customMarkerUrl === 'string' && annotations.customMarkerUrl.includes(assetId))
        ) {
          return res.status(409).json({
            error: {
              message: 'Cannot delete an asset that is currently set as an active custom bookmark marker. Change your marker preference before deleting this asset.',
              code: 'ASSET_IN_USE',
            },
          });
        }
      }

      // 2. Check if asset is referenced by any BookPreference (atmosphere or custom markers)
      const bookPrefs = await prisma.bookPreference.findMany({ where: { userId } });
      for (const bp of bookPrefs) {
        const cfg = bp.config || {};
        const atmo = cfg.atmosphere || cfg.atmosphereConfig || {};
        if (
          atmo.customMediaId === assetId ||
          atmo.customMediaMeta?.id === assetId ||
          atmo.customMediaMeta?.assetId === assetId
        ) {
          return res.status(409).json({
            error: {
              message: 'Cannot delete an asset that is currently set as an active reading background in one of your books.',
              code: 'ASSET_IN_USE',
            },
          });
        }

        const annotations = cfg.annotations || cfg.annotationsConfig || {};
        if (
          annotations.customMarkerId === assetId ||
          (typeof annotations.customMarkerUrl === 'string' && annotations.customMarkerUrl.includes(assetId))
        ) {
          return res.status(409).json({
            error: {
              message: 'Cannot delete an asset that is currently set as an active custom bookmark marker in one of your books.',
              code: 'ASSET_IN_USE',
            },
          });
        }
      }

      const storagePath = asset.storagePath;

      // 3. Database deletion first
      await prisma.userAsset.delete({
        where: { id: assetId },
      });

      // 4. Physical file cleanup after database commit succeeds
      try {
        await deleteStoredFile(storagePath);
      } catch (fileErr) {
        console.error(
          `[AssetDeletion] Database deletion succeeded for asset ${assetId}, but physical file cleanup failed for path ${storagePath}:`,
          fileErr.message
        );
      }

      return res.status(200).json({
        message: 'Asset deleted successfully.',
        id: assetId,
      });
    });
  } catch (err) {
    next(err);
  }
}

