import { prisma } from './prisma.js';
import { env } from '../config/env.js';

/**
 * Service for calculating and enforcing per-user storage quotas in Aks (अक्स).
 *
 * Enforces:
 * - Configurable account storage quota (default 250 MB)
 * - Accounting across all user-owned files:
 *   1. PDFs (BookFile.fileSizeBytes)
 *   2. Custom Background Assets (UserAsset.sizeBytes)
 *   3. Book Cover Thumbnails (Book.colorScheme cover sizes)
 * - Server-measured trusted byte sizes (ignoring client-supplied headers/claims)
 * - Deducting replaced file bytes during atomic updates
 * - Immediate quota release on book/asset/cover deletion
 * - Temporary OCR working files are never counted as user storage
 */
export class QuotaService {
  /**
   * Returns the configured storage limit in bytes.
   * @returns {number}
   */
  static getQuotaLimitBytes() {
    return env.MAX_USER_STORAGE_BYTES;
  }

  /**
   * Formats a byte count into a human-readable string (MB).
   * @param {number} bytes
   * @returns {string}
   */
  static formatBytes(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Calculates total stored bytes for an authenticated user across all storage categories.
   * Optionally accepts a Prisma interactive transaction client for atomic locking.
   *
   * @param {string} userId
   * @param {Object} [client=prisma] - Optional Prisma client or transaction client
   * @returns {Promise<{
   *   totalBytes: number,
   *   pdfBytes: number,
   *   assetBytes: number,
   *   coverBytes: number,
   *   quotaBytes: number,
   *   remainingBytes: number,
   *   usagePercent: number
   * }>}
   */
  static async getUserStorageUsage(userId, client = prisma) {
    if (!userId) {
      throw new Error('userId is required to calculate storage usage.');
    }

    // 1. Sum PDFs (BookFile.fileSizeBytes)
    const pdfAgg = await client.bookFile.aggregate({
      where: { userId },
      _sum: { fileSizeBytes: true },
    });
    const pdfBytes = Number(pdfAgg._sum.fileSizeBytes || 0n);

    // 2. Sum User Assets (UserAsset.sizeBytes)
    const assetAgg = await client.userAsset.aggregate({
      where: { userId, isActive: true },
      _sum: { sizeBytes: true },
    });
    const assetBytes = Number(assetAgg._sum.sizeBytes || 0n);

    // 3. Sum Book Covers from Book.colorScheme
    const booksWithScheme = await client.book.findMany({
      where: {
        userId,
        colorScheme: { not: null },
      },
      select: { id: true, colorScheme: true },
    });

    let coverBytes = 0;
    for (const b of booksWithScheme) {
      const scheme = b.colorScheme;
      if (scheme && typeof scheme === 'object') {
        if (typeof scheme.defaultCoverSizeBytes === 'number') {
          coverBytes += scheme.defaultCoverSizeBytes;
        } else if (scheme.defaultCoverPage || scheme.coverExt) {
          coverBytes += typeof scheme.coverSizeBytes === 'number' ? scheme.coverSizeBytes : 0;
        }

        if (typeof scheme.customCoverSizeBytes === 'number') {
          coverBytes += scheme.customCoverSizeBytes;
        }
      }
    }

    const quotaBytes = this.getQuotaLimitBytes();
    const totalBytes = pdfBytes + assetBytes + coverBytes;
    const remainingBytes = Math.max(0, quotaBytes - totalBytes);
    const usagePercent = quotaBytes > 0 ? Math.min(100, Math.round((totalBytes / quotaBytes) * 1000) / 10) : 0;

    return {
      totalBytes,
      pdfBytes,
      assetBytes,
      coverBytes,
      quotaBytes,
      remainingBytes,
      usagePercent,
    };
  }

  /**
   * Asserts that a proposed upload of newSizeBytes will not exceed the user's storage quota.
   * If replacingBytes is provided (e.g. replacing an existing PDF or cover), it is deducted from current usage.
   *
   * @param {string} userId
   * @param {number} newSizeBytes
   * @param {Object} [options]
   * @param {number} [options.replacingBytes=0]
   * @param {Object} [options.client=prisma] - Optional Prisma client or transaction client
   * @throws {Error} If quota would be exceeded
   * @returns {Promise<Object>} Current usage breakdown
   */
  static async assertQuotaAvailable(userId, newSizeBytes, options = {}) {
    const client = options.client || prisma;
    const replacingBytes = Number(options.replacingBytes || 0);
    const usage = await this.getUserStorageUsage(userId, client);
    const projectedUsage = usage.totalBytes - replacingBytes + newSizeBytes;

    if (projectedUsage > usage.quotaBytes) {
      const quotaStr = this.formatBytes(usage.quotaBytes);
      const remainingStr = this.formatBytes(usage.remainingBytes + replacingBytes);
      const neededStr = this.formatBytes(newSizeBytes);

      const err = new Error(
        `Account storage quota of ${quotaStr} exceeded. Available space: ${remainingStr}, upload requires: ${neededStr}.`
      );
      err.statusCode = 413;
      err.code = 'STORAGE_QUOTA_EXCEEDED';
      err.details = {
        quotaBytes: usage.quotaBytes,
        currentUsageBytes: usage.totalBytes,
        replacingBytes,
        newSizeBytes,
        projectedUsageBytes: projectedUsage,
        remainingBytes: usage.remainingBytes,
      };
      throw err;
    }

    return usage;
  }

  /**
   * Executes a callback within a PostgreSQL interactive transaction with an exclusive row lock
   * on the User record (SELECT ... FOR UPDATE).
   * Guarantees distributed multi-instance concurrency safety without requiring Redis.
   *
   * @param {string} userId
   * @param {Function} callback - async (tx) => Promise<any>
   * @returns {Promise<any>}
   */
  static async withUserRowLock(userId, callback) {
    if (!userId) {
      throw new Error('userId is required for withUserRowLock.');
    }
    return await prisma.$transaction(async (tx) => {
      // Acquire PostgreSQL exclusive row lock on the user record
      await tx.$executeRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      return await callback(tx);
    });
  }
}

