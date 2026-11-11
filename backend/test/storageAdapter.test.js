import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { LocalStorageProvider } from '../src/services/storage/localStorageProvider.js';
import { R2StorageProvider } from '../src/services/storage/r2StorageProvider.js';
import { storageAdapter } from '../src/services/storage/storageAdapter.js';
import { storagePaths } from '../src/config/storage.js';

test('Aks — Cloud Storage Adapter & Cloudflare R2 Compatibility Suite', async (t) => {
  // Setup isolated temporary test directory
  const testStorageDir = path.join(storagePaths.temp, `test_storage_${crypto.randomUUID()}`);
  fs.mkdirSync(testStorageDir, { recursive: true, mode: 0o700 });

  // Cleanup after all tests
  t.after(() => {
    try {
      if (fs.existsSync(testStorageDir)) {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      }
    } catch {}
  });

  await t.test('1. Provider selection and missing configuration handling', () => {
    // Default provider is local
    assert.equal(storageAdapter.defaultProviderName, 'local');
    assert.equal(storageAdapter.isR2('pdfs/user-1/file-1.pdf'), false);
    assert.equal(storageAdapter.isR2('r2://pdfs/user-1/file-1.pdf'), true);

    // Clean key extraction
    assert.equal(storageAdapter.cleanKey('r2://pdfs/u1/f1.pdf'), 'pdfs/u1/f1.pdf');
    assert.equal(storageAdapter.cleanKey('pdfs/u1/f1.pdf'), 'pdfs/u1/f1.pdf');

    // Instantiating R2 without credentials handles configError cleanly without crashing server boot
    const unconfiguredR2 = new R2StorageProvider({
      accessKeyId: '',
      secretAccessKey: '',
      endpoint: '',
    });
    assert.throws(
      () => unconfiguredR2._ensureClient(),
      (err) => {
        assert.equal(err.code, 'R2_CONFIG_ERROR');
        return true;
      }
    );
  });

  await t.test('2. Local Storage Provider: Regression & Path Traversal Prevention', async () => {
    const localProvider = new LocalStorageProvider(testStorageDir);

    // Create a dummy source file
    const tempFilePath = path.join(testStorageDir, 'temp_upload.pdf');
    fs.writeFileSync(tempFilePath, '%PDF-1.4 test payload for local storage');

    // 1. Upload/move file
    const relativeKey = 'pdfs/user-123/doc.pdf';
    const uploadRes = await localProvider.uploadFile(tempFilePath, relativeKey);
    assert.equal(uploadRes.storagePath, relativeKey);
    assert.ok(uploadRes.sizeBytes > 0);

    // Temp file should have been moved/cleaned
    assert.equal(fs.existsSync(tempFilePath), false);

    // 2. Metadata check
    const meta = await localProvider.getMetadata(relativeKey);
    assert.equal(meta.exists, true);
    assert.equal(meta.sizeBytes, uploadRes.sizeBytes);

    // 3. Path Traversal rejection
    assert.throws(
      () => localProvider.resolveSafePath('../../etc/passwd'),
      (err) => {
        assert.match(err.message, /Path traversal detected/);
        return true;
      }
    );

    // 4. Delete file
    const deleted = await localProvider.deleteFile(relativeKey);
    assert.equal(deleted, true);
    const metaAfter = await localProvider.getMetadata(relativeKey);
    assert.equal(metaAfter.exists, false);
  });

  await t.test('3. Cloudflare R2 Provider: Mocked S3 Upload, Metadata, and Deletion', async () => {
    const mockStore = new Map();

    // Mock S3Client implementation
    const mockS3Client = {
      send: async (command) => {
        const cmdName = command.constructor.name;

        if (cmdName === 'PutObjectCommand') {
          const key = command.input.Key;
          // Consume stream into buffer
          const chunks = [];
          for await (const chunk of command.input.Body) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          mockStore.set(key, {
            body: buffer,
            length: buffer.length,
            contentType: command.input.ContentType,
          });
          return {};
        }

        if (cmdName === 'HeadObjectCommand') {
          const key = command.input.Key;
          if (!mockStore.has(key)) {
            const err = new Error('NoSuchKey');
            err.name = 'NoSuchKey';
            err.$metadata = { httpStatusCode: 404 };
            throw err;
          }
          const item = mockStore.get(key);
          return {
            ContentLength: item.length,
            ContentType: item.contentType,
          };
        }

        if (cmdName === 'GetObjectCommand') {
          const key = command.input.Key;
          if (!mockStore.has(key)) {
            const err = new Error('NoSuchKey');
            err.name = 'NoSuchKey';
            err.$metadata = { httpStatusCode: 404 };
            throw err;
          }
          const item = mockStore.get(key);
          let slice = item.body;

          if (command.input.Range) {
            // Parse "bytes=start-end"
            const match = command.input.Range.match(/^bytes=(\d+)-(\d*)$/);
            if (match) {
              const start = parseInt(match[1], 10);
              const end = match[2] ? parseInt(match[2], 10) : item.body.length - 1;
              slice = item.body.subarray(start, end + 1);
            }
          }

          return {
            Body: Readable.from(slice),
            ContentLength: slice.length,
            ContentType: item.contentType,
          };
        }

        if (cmdName === 'DeleteObjectCommand') {
          const key = command.input.Key;
          mockStore.delete(key);
          return {};
        }

        throw new Error(`Unhandled mock command: ${cmdName}`);
      },
    };

    const r2Provider = new R2StorageProvider({
      bucket: 'test-aks-bucket',
      s3Client: mockS3Client,
    });

    // Create temp file for upload test
    const tempFile = path.join(testStorageDir, 'temp_r2_upload.pdf');
    fs.writeFileSync(tempFile, '%PDF-1.4 Mock Cloudflare R2 Upload Payload');

    // 1. Upload to R2
    const uploadRes = await r2Provider.uploadFile(tempFile, 'pdfs/user-r2/sample.pdf', 'application/pdf');
    assert.equal(uploadRes.storagePath, 'r2://pdfs/user-r2/sample.pdf');
    assert.equal(fs.existsSync(tempFile), false, 'Temp file cleaned up after R2 upload');

    // 2. Metadata check
    const meta = await r2Provider.getMetadata('r2://pdfs/user-r2/sample.pdf');
    assert.equal(meta.exists, true);
    assert.equal(meta.sizeBytes, 42);
    assert.equal(meta.mimeType, 'application/pdf');

    // 3. Missing object metadata
    const missingMeta = await r2Provider.getMetadata('r2://pdfs/user-r2/missing.pdf');
    assert.equal(missingMeta.exists, false);
    assert.equal(missingMeta.sizeBytes, 0);

    // 4. Stream object from R2
    const stream = await r2Provider.getStream('r2://pdfs/user-r2/sample.pdf');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const retrieved = Buffer.concat(chunks).toString('utf-8');
    assert.equal(retrieved, '%PDF-1.4 Mock Cloudflare R2 Upload Payload');

    // 5. Delete object from R2
    const deleted = await r2Provider.deleteFile('r2://pdfs/user-r2/sample.pdf');
    assert.equal(deleted, true);
    assert.equal(await r2Provider.exists('r2://pdfs/user-r2/sample.pdf'), false);
  });

  await t.test('4. HTTP Range Request Streaming: RFC 7233 Compliance (HTTP 200, 206, 416)', async () => {
    // 100 bytes test payload: '0123456789...' repeated 10 times
    const payload100 = '0123456789'.repeat(10);
    const mockFile = path.join(testStorageDir, 'stream_test.pdf');
    fs.writeFileSync(mockFile, payload100);

    const relativeKey = `pdfs/test-stream/${Date.now()}.pdf`;
    await storageAdapter.localProvider.uploadFile(mockFile, relativeKey);

    // Mock Express Response helper
    function createMockRes() {
      return {
        statusCode: null,
        headers: {},
        bodyChunks: [],
        status(code) {
          this.statusCode = code;
          return this;
        },
        setHeader(name, val) {
          this.headers[name.toLowerCase()] = String(val);
        },
        json(data) {
          this.jsonData = data;
          return this;
        },
        write(chunk) {
          this.bodyChunks.push(Buffer.from(chunk));
        },
        end() {},
        // Mimic writable stream
        on(event, handler) {
          if (event === 'finish') this.finishHandler = handler;
          return this;
        },
        once() {
          return this;
        },
        emit() {},
      };
    }

    // A. Full File Request (HTTP 200 OK)
    const reqFull = { headers: {} };
    const resFull = createMockRes();
    let nextCalled = false;

    await storageAdapter.streamRangeResponse(reqFull, resFull, () => { nextCalled = true; }, {
      storagePath: relativeKey,
      filename: 'sample.pdf',
      mimeType: 'application/pdf',
    });

    assert.equal(resFull.statusCode, 200);
    assert.equal(resFull.headers['content-length'], '100');
    assert.equal(resFull.headers['accept-ranges'], 'bytes');
    assert.equal(resFull.headers['content-type'], 'application/pdf');

    // B. Valid Bounded Range: bytes=0-9 (first 10 bytes)
    const reqBounded = { headers: { range: 'bytes=0-9' } };
    const resBounded = createMockRes();

    await storageAdapter.streamRangeResponse(reqBounded, resBounded, () => {}, {
      storagePath: relativeKey,
      filename: 'sample.pdf',
    });

    assert.equal(resBounded.statusCode, 206);
    assert.equal(resBounded.headers['content-range'], 'bytes 0-9/100');
    assert.equal(resBounded.headers['content-length'], '10');

    // C. Valid Suffix Range: bytes=-15 (last 15 bytes)
    const reqSuffix = { headers: { range: 'bytes=-15' } };
    const resSuffix = createMockRes();

    await storageAdapter.streamRangeResponse(reqSuffix, resSuffix, () => {}, {
      storagePath: relativeKey,
      filename: 'sample.pdf',
    });

    assert.equal(resSuffix.statusCode, 206);
    assert.equal(resSuffix.headers['content-range'], 'bytes 85-99/100');
    assert.equal(resSuffix.headers['content-length'], '15');

    // D. Valid Open-ended Range: bytes=80- (from byte 80 to EOF)
    const reqOpen = { headers: { range: 'bytes=80-' } };
    const resOpen = createMockRes();

    await storageAdapter.streamRangeResponse(reqOpen, resOpen, () => {}, {
      storagePath: relativeKey,
      filename: 'sample.pdf',
    });

    assert.equal(resOpen.statusCode, 206);
    assert.equal(resOpen.headers['content-range'], 'bytes 80-99/100');
    assert.equal(resOpen.headers['content-length'], '20');

    // E. Invalid Range Syntax (HTTP 416)
    const reqInvalid = { headers: { range: 'bytes=invalid-range' } };
    const resInvalid = createMockRes();

    await storageAdapter.streamRangeResponse(reqInvalid, resInvalid, () => {}, {
      storagePath: relativeKey,
      filename: 'sample.pdf',
    });

    assert.equal(resInvalid.statusCode, 416);
    assert.equal(resInvalid.headers['content-range'], 'bytes */100');
    assert.equal(resInvalid.jsonData?.error?.code, 'RANGE_NOT_SATISFIABLE');

    // F. Unsatisfiable Out-of-Bounds Range (HTTP 416)
    const reqOutOfBounds = { headers: { range: 'bytes=200-300' } };
    const resOutOfBounds = createMockRes();

    await storageAdapter.streamRangeResponse(reqOutOfBounds, resOutOfBounds, () => {}, {
      storagePath: relativeKey,
      filename: 'sample.pdf',
    });

    assert.equal(resOutOfBounds.statusCode, 416);
    assert.equal(resOutOfBounds.headers['content-range'], 'bytes */100');

    // G. Missing File (HTTP 404)
    const reqMissing = { headers: {} };
    const resMissing = createMockRes();

    await storageAdapter.streamRangeResponse(reqMissing, resMissing, () => {}, {
      storagePath: 'pdfs/nonexistent/missing.pdf',
      filename: 'missing.pdf',
    });

    assert.equal(resMissing.statusCode, 404);
    assert.equal(resMissing.jsonData?.error?.code, 'STORAGE_FILE_MISSING');
  });

  await t.test('5. withLocalFile helper bridges cloud objects to local-path consumers', async () => {
    // A. Local file directly passes safe path without creating temp file
    const localKey = 'pdfs/test-local/doc.pdf';
    const localAbs = storageAdapter.localProvider.resolveSafePath(localKey);
    fs.mkdirSync(path.dirname(localAbs), { recursive: true, mode: 0o700 });
    fs.writeFileSync(localAbs, 'local file content');

    let receivedPath = null;
    await storageAdapter.withLocalFile(localKey, async (filePath) => {
      receivedPath = filePath;
      assert.equal(fs.readFileSync(filePath, 'utf-8'), 'local file content');
    });
    assert.equal(receivedPath, localAbs);

    // B. R2 file streams to temporary file and cleans up after callback
    const mockR2Store = new Map([
      ['pdfs/cloud/doc.pdf', Buffer.from('cloud object content from r2')],
    ]);
    const mockR2 = {
      getStream: async (key) => Readable.from(mockR2Store.get(key)),
      getMetadata: async (key) => ({ exists: mockR2Store.has(key), sizeBytes: mockR2Store.get(key).length }),
    };

    const originalR2 = storageAdapter.r2Provider;
    storageAdapter.setR2Provider(mockR2);

    let tempFileUsed = null;
    await storageAdapter.withLocalFile('r2://pdfs/cloud/doc.pdf', async (filePath) => {
      tempFileUsed = filePath;
      assert.ok(fs.existsSync(filePath), 'Temp file exists during callback');
      assert.equal(fs.readFileSync(filePath, 'utf-8'), 'cloud object content from r2');
    });

    assert.equal(fs.existsSync(tempFileUsed), false, 'Temp file cleaned up after callback finishes');

    storageAdapter.setR2Provider(originalR2);
  });

  await t.test('6. User Asset Upload & Range Streaming (e.g. MP4 background video)', async () => {
    const videoPayload = '0123456789'.repeat(5); // 50 bytes mock video
    const tempVideo = path.join(testStorageDir, 'temp_video.mp4');
    fs.writeFileSync(tempVideo, videoPayload);

    // Upload asset
    const uploadRes = await storageAdapter.savePermanentFile(tempVideo, 'backgrounds', 'user-456', 'mp4', 'video/mp4');
    assert.ok(uploadRes.storagePath.includes('backgrounds/user-456'));

    // Range request on video
    function createMockRes() {
      return {
        statusCode: null,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        setHeader(name, val) { this.headers[name.toLowerCase()] = String(val); },
        pipe() {},
      };
    }

    const req = { headers: { range: 'bytes=0-19' } };
    const res = createMockRes();

    await storageAdapter.streamRangeResponse(req, res, () => {}, {
      storagePath: uploadRes.storagePath,
      filename: 'bg.mp4',
      mimeType: 'video/mp4',
    });

    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], 'bytes 0-19/50');
    assert.equal(res.headers['content-type'], 'video/mp4');
  });
});
