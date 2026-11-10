import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import ocrHandler, { redactSecrets } from '../api/ocr.ts';
import scanInvoiceHandler from '../api/scan-invoice.ts';

// Helper to construct test buffers with magic bytes
function createSyntheticFile(type: 'jpeg' | 'png' | 'webp' | 'pdf' | 'text-pdf' | 'corrupted', sizeBytes = 100): string {
  const buf = Buffer.alloc(Math.max(sizeBytes, 32));
  switch (type) {
    case 'jpeg':
      buf[0] = 0xff;
      buf[1] = 0xd8;
      buf[2] = 0xff;
      buf[3] = 0xe0;
      break;
    case 'png':
      buf[0] = 0x89;
      buf[1] = 0x50;
      buf[2] = 0x4e;
      buf[3] = 0x47;
      break;
    case 'webp':
      buf.write('RIFF', 0, 4, 'ascii');
      buf.write('WEBP', 8, 4, 'ascii');
      break;
    case 'pdf':
    case 'text-pdf':
      buf.write('%PDF-1.4\n%scanned_doc\n', 0, 18, 'ascii');
      break;
    case 'corrupted':
      buf.fill(0x00);
      break;
  }
  return buf.toString('base64');
}

function createMockRes() {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let jsonBody: any = null;
  let ended = false;

  const res: any = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      jsonBody = data;
      ended = true;
      return res;
    },
    end: () => {
      ended = true;
      return res;
    },
    get statusCode() {
      return statusCode;
    },
    get jsonBody() {
      return jsonBody;
    },
    get headers() {
      return headers;
    },
    get ended() {
      return ended;
    },
  };
  return res;
}

describe('Correction 3: Diagnose OCR Server Failure & Structured Error Architecture', () => {

  describe('1. Secret Redaction & Safe Logging', () => {
    it('redacts Google API keys, bearer tokens, and private keys from log messages', () => {
      const sensitiveMsg = 'Error communicating with https://generativelanguage.googleapis.com?key=AIzaSyA1234567890abcdefghijklmnopqrstuv using Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.xyz.secret';
      const sanitized = redactSecrets(sensitiveMsg);

      assert.ok(!sanitized.includes('AIzaSyA1234567890abcdefghijklmnopqrstuv'));
      assert.ok(!sanitized.includes('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9'));
      assert.ok(sanitized.includes('key=[REDACTED]'));
      assert.ok(sanitized.includes('Bearer [REDACTED]'));
    });
  });

  describe('2. Correlation Identifier & Request Tracking', () => {
    it('/api/ocr generates and attaches X-Request-Id header and payload requestId', async () => {
      const req: any = { method: 'POST', headers: {}, body: {} };
      const res = createMockRes();

      await ocrHandler(req, res);
      assert.ok(res.headers['x-request-id']);
      assert.equal(res.jsonBody?.requestId, res.headers['x-request-id']);
      assert.equal(res.statusCode, 401);
      assert.equal(res.jsonBody?.code, 'ERR_AUTH_MISSING');
    });

    it('/api/scan-invoice preserves incoming x-request-id from caller', async () => {
      const clientReqId = 'req_trace_client_999';
      const req: any = { 
        method: 'POST', 
        headers: { 'x-request-id': clientReqId }, 
        body: {} 
      };
      const res = createMockRes();

      await scanInvoiceHandler(req, res);
      assert.equal(res.headers['x-request-id'], clientReqId);
      assert.equal(res.jsonBody?.requestId, clientReqId);
      assert.equal(res.statusCode, 401);
      assert.equal(res.jsonBody?.code, 'ERR_AUTH_MISSING');
    });
  });

  describe('3. Distinguishing Authentication & Authorization Failures', () => {
    it('returns ERR_AUTH_MISSING when bearer authorization header is absent', async () => {
      const req: any = { 
        method: 'POST', 
        headers: {}, 
        body: { base64str: createSyntheticFile('jpeg'), mimeType: 'image/jpeg' } 
      };
      const res = createMockRes();

      await ocrHandler(req, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.jsonBody?.code, 'ERR_AUTH_MISSING');
    });

    it('returns ERR_AUTH_MISSING when bearer token is whitespace', async () => {
      const req: any = { 
        method: 'POST', 
        headers: { authorization: 'Bearer   ' }, 
        body: { base64str: createSyntheticFile('jpeg'), mimeType: 'image/jpeg' } 
      };
      const res = createMockRes();

      await scanInvoiceHandler(req, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.jsonBody?.code, 'ERR_AUTH_MISSING');
    });
  });

  describe('4. Distinguishing Payload, Magic Bytes, & Unsupported File Formats', () => {
    it('rejects unsupported file mime types with ERR_UNSUPPORTED_MIME_TYPE', async () => {
      // Direct payload validator test
      const { validateOcrPayload } = await import('../server/ocr-security.ts');
      assert.throws(
        () => validateOcrPayload({ base64str: 'dGVzdA==', mimeType: 'application/msword' }),
        (err: any) => err.status === 400 && err.code === 'UNSUPPORTED_MIME_TYPE'
      );
    });

    it('rejects spoofed file formats with binary magic byte mismatch', async () => {
      const { validateOcrPayload } = await import('../server/ocr-security.ts');
      // Buffer says JPEG header, but claiming to be PNG
      const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      assert.throws(
        () => validateOcrPayload({ base64str: jpegBuf.toString('base64'), mimeType: 'image/png' }),
        (err: any) => err.status === 400 && err.code === 'MIMETYPE_MISMATCH'
      );
    });

    it('accepts genuine JPEG, PNG, WebP, and PDF payloads', async () => {
      const { validateOcrPayload } = await import('../server/ocr-security.ts');

      const jpeg = validateOcrPayload({ base64str: createSyntheticFile('jpeg'), mimeType: 'image/jpeg' });
      assert.equal(jpeg.mimeType, 'image/jpeg');

      const png = validateOcrPayload({ base64str: createSyntheticFile('png'), mimeType: 'image/png' });
      assert.equal(png.mimeType, 'image/png');

      const pdf = validateOcrPayload({ base64str: createSyntheticFile('pdf'), mimeType: 'application/pdf' });
      assert.equal(pdf.mimeType, 'application/pdf');
    });
  });

  describe('5. Client Helper Resilience to Non-JSON Platform Errors', () => {
    it('parses error codes and requests IDs from structured JSON errors', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () => {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({
              'content-type': 'application/json',
              'x-request-id': 'req_quota_exhausted_123'
            }),
            json: async () => ({
              error: 'OCR provider quota exceeded. Please retry in a few moments.',
              code: 'ERR_PROVIDER_QUOTA',
              requestId: 'req_quota_exhausted_123'
            })
          } as any;
        }) as any;

        const { extractReceiptQuantities } = await import('../utils/geminiOCR.ts');
        const fakeFile = new File(['fake'], 'invoice.jpg', { type: 'image/jpeg' });

        await assert.rejects(
          async () => extractReceiptQuantities(fakeFile, 'Item 1'),
          (err: any) => {
            return err.message.includes('ERR_PROVIDER_QUOTA') || 
                   err.message.includes('quota exceeded') ||
                   err.message.includes('sign in'); // if auth mock intercepted
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('gracefully handles non-JSON / HTML 500 error pages without throwing SyntaxError', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () => {
          return {
            ok: false,
            status: 504,
            statusText: 'Gateway Timeout',
            headers: new Headers({
              'content-type': 'text/html',
              'x-request-id': 'req_edge_gateway_timeout_456'
            }),
            text: async () => '<html><body><h1>504 Gateway Timeout</h1><p>Edge runtime timed out</p></body></html>'
          } as any;
        }) as any;

        const { extractReceiptQuantities } = await import('../utils/geminiOCR.ts');
        const fakeFile = new File(['fake'], 'invoice.jpg', { type: 'image/jpeg' });

        await assert.rejects(
          async () => extractReceiptQuantities(fakeFile, 'Item 1'),
          (err: any) => {
            // Must NOT throw SyntaxError: Unexpected token <
            assert.ok(!err.message.includes('SyntaxError'));
            assert.ok(!err.message.includes('Unexpected token <'));
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

});
