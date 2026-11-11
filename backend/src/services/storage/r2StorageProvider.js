/**
 * Cloudflare R2 Storage Provider for Aks (अक्स)
 *
 * Implements S3-compatible private object storage for Cloudflare R2:
 * - Uses @aws-sdk/client-s3 with SigV4 authentication.
 * - Streams uploads directly from local temp file.
 * - Supports HTTP Range byte requests via GetObjectCommand Range header.
 * - Enforces private bucket access; never exposes credentials or public URLs.
 * - Accepts an optional custom s3Client instance for dependency injection and mocking.
 */

import fs from 'fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { BaseStorageProvider } from './baseStorageProvider.js';
import { env } from '../../config/env.js';

export class R2StorageProvider extends BaseStorageProvider {
  /**
   * @param {Object} [config]
   * @param {string} [config.bucket]
   * @param {string} [config.accountId]
   * @param {string} [config.accessKeyId]
   * @param {string} [config.secretAccessKey]
   * @param {string} [config.endpoint]
   * @param {S3Client} [config.s3Client] - Optional injected client for testing
   */
  constructor(config = {}) {
    super();
    this.bucket = config.bucket || env.R2_BUCKET_NAME;

    if (config.s3Client) {
      this.client = config.s3Client;
    } else {
      const endpoint =
        config.endpoint ||
        env.R2_ENDPOINT ||
        (env.R2_ACCOUNT_ID
          ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
          : undefined);

      const accessKeyId = config.accessKeyId || env.R2_ACCESS_KEY_ID;
      const secretAccessKey = config.secretAccessKey || env.R2_SECRET_ACCESS_KEY;

      if (!accessKeyId || !secretAccessKey || !endpoint) {
        // Do not throw at instantiation to allow app boot in development when R2 is inactive
        this.client = null;
        this.configError = 'Cloudflare R2 credentials (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID/ENDPOINT) are not fully configured.';
      } else {
        this.client = new S3Client({
          region: 'auto',
          endpoint,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        });
        this.configError = null;
      }
    }
  }

  _ensureClient() {
    if (!this.client) {
      const err = new Error(this.configError || 'Cloudflare R2 storage client is not configured.');
      err.statusCode = 500;
      err.code = 'R2_CONFIG_ERROR';
      throw err;
    }
    return this.client;
  }

  /**
   * Normalizes an R2 object key (strips any leading scheme or slashes).
   */
  normalizeKey(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string.');
    }
    return key.replace(/^r2:\/\//, '').replace(/^\/+/, '');
  }

  async uploadFile(localTempPath, key, mimeType = 'application/octet-stream') {
    const client = this._ensureClient();
    const objectKey = this.normalizeKey(key);

    const stat = await fs.promises.stat(localTempPath);
    const fileStream = fs.createReadStream(localTempPath);

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: fileStream,
        ContentLength: stat.size,
        ContentType: mimeType,
      });

      await client.send(command);

      // Clean up temporary local file once successfully committed to R2
      try {
        if (fs.existsSync(localTempPath)) {
          await fs.promises.unlink(localTempPath);
        }
      } catch {}

      return {
        storagePath: `r2://${objectKey}`,
        sizeBytes: stat.size,
      };
    } catch (err) {
      fileStream.destroy();
      console.error(`[R2StorageProvider] Upload failed for ${objectKey}:`, err.message);
      const uploadErr = new Error(`Cloud storage upload failed: ${err.message}`);
      uploadErr.statusCode = 502;
      uploadErr.code = 'R2_UPLOAD_ERROR';
      throw uploadErr;
    }
  }

  async getMetadata(key) {
    const client = this._ensureClient();
    const objectKey = this.normalizeKey(key);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      });

      const response = await client.send(command);
      return {
        sizeBytes: Number(response.ContentLength || 0),
        mimeType: response.ContentType,
        exists: true,
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return { sizeBytes: 0, exists: false };
      }
      console.error(`[R2StorageProvider] HeadObject failed for ${objectKey}:`, err.message);
      throw err;
    }
  }

  async getStream(key, options = {}) {
    const client = this._ensureClient();
    const objectKey = this.normalizeKey(key);

    const commandInput = {
      Bucket: this.bucket,
      Key: objectKey,
    };

    if (typeof options.start === 'number' && typeof options.end === 'number') {
      commandInput.Range = `bytes=${options.start}-${options.end}`;
    } else if (typeof options.start === 'number') {
      commandInput.Range = `bytes=${options.start}-`;
    }

    try {
      const command = new GetObjectCommand(commandInput);
      const response = await client.send(command);
      return response.Body; // Node.js Readable stream
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        const notFoundErr = new Error('File not found in cloud storage.');
        notFoundErr.statusCode = 404;
        notFoundErr.code = 'STORAGE_FILE_MISSING';
        throw notFoundErr;
      }
      console.error(`[R2StorageProvider] GetObject failed for ${objectKey}:`, err.message);
      throw err;
    }
  }

  async deleteFile(key) {
    const client = this._ensureClient();
    const objectKey = this.normalizeKey(key);

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      });
      await client.send(command);
      return true;
    } catch (err) {
      console.error(`[R2StorageProvider] DeleteObject failed for ${objectKey}:`, err.message);
      return false;
    }
  }

  async exists(key) {
    try {
      const meta = await this.getMetadata(key);
      return meta.exists;
    } catch {
      return false;
    }
  }
}

