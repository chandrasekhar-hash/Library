/**
 * Python OCR Engine HTTP Client for Aks (अक्स)
 *
 * Communicates with the self-hosted Python FastAPI OCR Worker over loopback:
 * - Sends authenticated Bearer token from backend environment (never exposed to frontend).
 * - Enforces timeouts and handles HTTP 429 concurrency rejections gracefully.
 * - Parses line-level bounding box coordinates and confidence metrics.
 */

import http from 'http';
import { env } from '../config/env.js';

/**
 * Loopback HTTP request helper.
 * Replaces global fetch to avoid WHATWG "bad port" restrictions on port 5060 (SIP).
 */
function loopbackRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: {
            get: (name) => res.headers[name.toLowerCase()] || null,
          },
          json: async () => JSON.parse(data || '{}'),
          text: async () => data,
        });
      });
    });

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return reject(err);
      }
      options.signal.addEventListener('abort', () => {
        req.destroy();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

export class OcrClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'OcrClientError';
    this.statusCode = options.statusCode || 500;
    this.code = options.code || 'OCR_CLIENT_ERROR';
    this.retryAfter = options.retryAfter || null;
    this.details = options.details || null;
  }
}

export class OcrClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || env.OCR_WORKER_URL).replace(/\/+$/, '');
    this.token = options.token || env.OCR_WORKER_TOKEN;
    this.defaultTimeoutMs = options.timeoutMs || env.OCR_WORKER_TIMEOUT_MS;
  }

  /**
   * Non-blocking health check against the OCR engine.
   *
   * @param {number} [timeoutMs=2000]
   * @returns {Promise<{ isHealthy: boolean, details?: Object, error?: string }>}
   */
  async checkHealth(timeoutMs = 2000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await loopbackRequest(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          isHealthy: false,
          error: `Worker returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = await res.json();
      return {
        isHealthy: data.status === 'healthy',
        details: data,
      };
    } catch (err) {
      const isAbort = err.name === 'AbortError';
      return {
        isHealthy: false,
        error: isAbort ? 'Health check timed out' : `Connection failed: ${err.message}`,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Request OCR processing for a PDF document or page range.
   *
   * @param {Object} params
   * @param {string} params.pdfPath - Absolute path to PDF file
   * @param {string} [params.lang='en'] - 'en' | 'hi' | 'sa' | 'devanagari'
   * @param {number} [params.dpi=250] - 200 to 300 DPI
   * @param {number} [params.startPage=0] - 0-based start page index
   * @param {number} [params.maxPages=1] - Number of pages to process
   * @param {boolean} [params.isolated=true] - Run in isolated subprocess
   * @param {number} [params.timeoutMs] - Request timeout in milliseconds
   * @returns {Promise<Object>} Processed OCR document results
   */
  async processPdf(params) {
    const {
      pdfPath,
      lang = 'en',
      dpi = 250,
      startPage = 0,
      maxPages = 1,
      isolated = true,
      timeoutMs = this.defaultTimeoutMs,
    } = params;

    if (!pdfPath) {
      throw new OcrClientError('pdfPath is required for OCR processing', {
        code: 'INVALID_ARGUMENT',
        statusCode: 400,
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const payload = {
        pdf_path: pdfPath,
        lang,
        dpi,
        start_page: startPage,
        max_pages: maxPages,
        isolated,
      };

      const res = await loopbackRequest(`${this.baseUrl}/ocr/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: payload,
        signal: controller.signal,
      });

      if (res.status === 429) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
        let detail = 'OCR worker is currently at maximum concurrency capacity';
        try {
          const body = await res.json();
          detail = body.detail || detail;
        } catch {
          // ignore
        }
        throw new OcrClientError(detail, {
          code: 'OCR_WORKER_BUSY',
          statusCode: 429,
          retryAfter: retryAfterSeconds,
        });
      }

      if (res.status === 401 || res.status === 403) {
        throw new OcrClientError('OCR worker authentication failed. Check internal token configuration.', {
          code: 'OCR_AUTH_ERROR',
          statusCode: res.status,
        });
      }

      if (res.status === 404) {
        throw new OcrClientError(`PDF file not found by OCR worker: ${pdfPath}`, {
          code: 'FILE_NOT_FOUND',
          statusCode: 404,
        });
      }

      if (res.status === 422) {
        let detail = 'PDF cannot be processed or is corrupted';
        try {
          const body = await res.json();
          detail = body.detail || detail;
        } catch {
          // ignore
        }
        throw new OcrClientError(detail, {
          code: 'UNPROCESSABLE_PDF',
          statusCode: 422,
        });
      }

      if (!res.ok) {
        let detail = `OCR worker error (HTTP ${res.status})`;
        try {
          const body = await res.json();
          detail = body.detail || detail;
        } catch {
          // ignore
        }
        throw new OcrClientError(detail, {
          code: 'OCR_WORKER_ERROR',
          statusCode: res.status,
        });
      }

      return await res.json();
    } catch (err) {
      if (err instanceof OcrClientError) {
        throw err;
      }

      if (err.name === 'AbortError') {
        throw new OcrClientError(`OCR request timed out after ${timeoutMs}ms`, {
          code: 'OCR_TIMEOUT',
          statusCode: 504,
        });
      }

      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new OcrClientError(
          `Cannot connect to OCR worker at ${this.baseUrl}. Service may be stopped or restarting.`,
          {
            code: 'OCR_WORKER_UNAVAILABLE',
            statusCode: 503,
          }
        );
      }

      throw new OcrClientError(`OCR request failed: ${err.message}`, {
        code: 'OCR_UNKNOWN_ERROR',
        statusCode: 500,
        details: err,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const ocrClient = new OcrClient();

