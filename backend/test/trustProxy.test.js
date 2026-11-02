import { describe, it } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { env } from '../src/config/env.js';

describe('ISSUE-BACK-01: Reverse Proxy Configuration', () => {
  it('exposes TRUST_PROXY in env configuration', () => {
    assert.notStrictEqual(env.TRUST_PROXY, undefined);
  });

  it('respects trust proxy setting for req.ip and req.protocol when enabled', async () => {
    const testApp = express();
    testApp.set('trust proxy', 1);

    testApp.get('/test-proxy', (req, res) => {
      res.json({
        ip: req.ip,
        protocol: req.protocol,
        ips: req.ips,
      });
    });

    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/test-proxy`, {
        headers: {
          'X-Forwarded-For': '203.0.113.195',
          'X-Forwarded-Proto': 'https',
        },
      });

      const data = await response.json();
      assert.strictEqual(data.protocol, 'https');
      assert.strictEqual(data.ip, '203.0.113.195');
    } finally {
      server.close();
    }
  });

  it('does not trust X-Forwarded headers when trust proxy is false', async () => {
    const testApp = express();
    testApp.set('trust proxy', false);

    testApp.get('/test-no-proxy', (req, res) => {
      res.json({
        ip: req.ip,
        protocol: req.protocol,
      });
    });

    const server = testApp.listen(0);
    const port = server.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/test-no-proxy`, {
        headers: {
          'X-Forwarded-For': '203.0.113.195',
          'X-Forwarded-Proto': 'https',
        },
      });

      const data = await response.json();
      assert.strictEqual(data.protocol, 'http');
      assert.notStrictEqual(data.ip, '203.0.113.195');
    } finally {
      server.close();
    }
  });
});
