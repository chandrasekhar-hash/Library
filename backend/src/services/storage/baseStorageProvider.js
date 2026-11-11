/**
 * Base Storage Provider Interface for Aks (अक्स)
 *
 * Defines the contract that both Local and Cloudflare R2 storage providers must satisfy.
 */

export class BaseStorageProvider {
  /**
   * Uploads or moves a local temporary file to permanent storage under the specified key.
   *
   * @param {string} localTempPath - Path to verified temporary file on disk
   * @param {string} key - Relative storage key (e.g. "pdfs/{userId}/{fileId}.pdf")
   * @param {string} [mimeType="application/octet-stream"]
   * @returns {Promise<{ storagePath: string, sizeBytes: number }>}
   */
  async uploadFile(localTempPath, key, mimeType = 'application/octet-stream') {
    throw new Error('Method uploadFile() must be implemented by storage provider.');
  }

  /**
   * Retrieves metadata for a stored file.
   *
   * @param {string} key - Relative storage key
   * @returns {Promise<{ sizeBytes: number, mimeType?: string, exists: boolean }>}
   */
  async getMetadata(key) {
    throw new Error('Method getMetadata() must be implemented by storage provider.');
  }

  /**
   * Retrieves a readable stream for a stored file, optionally bounded by byte range.
   *
   * @param {string} key - Relative storage key
   * @param {Object} [options]
   * @param {number} [options.start] - Start byte offset
   * @param {number} [options.end] - End byte offset (inclusive)
   * @returns {Promise<import('stream').Readable>}
   */
  async getStream(key, options = {}) {
    throw new Error('Method getStream() must be implemented by storage provider.');
  }

  /**
   * Deletes a stored file.
   *
   * @param {string} key - Relative storage key
   * @returns {Promise<boolean>}
   */
  async deleteFile(key) {
    throw new Error('Method deleteFile() must be implemented by storage provider.');
  }

  /**
   * Checks if a file exists in storage.
   *
   * @param {string} key - Relative storage key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    throw new Error('Method exists() must be implemented by storage provider.');
  }
}

