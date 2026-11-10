import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOcrAuthorization,
  validateOcrPayload,
  checkOcrRateLimit,
  resetOcrRateLimits,
  OcrSecurityError,
  MAX_OCR_FILE_SIZE_BYTES,
  type AuthenticatedUser,
} from '../server/ocr-security.ts';
import ocrHandler from '../api/ocr.ts';
import scanInvoiceHandler from '../api/scan-invoice.ts';

// Helper to create synthetic magic-byte buffers
function createSyntheticFile(type: 'jpeg' | 'png' | 'webp' | 'pdf' | 'corrupted' | 'html', sizeBytes = 100): string {
  const buf = Buffer.alloc(Math.max(sizeBytes, 16));
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
      buf.write('%PDF-1.4', 0, 8, 'ascii');
      break;
    case 'html':
      buf.write('<html><body>Evil</body></html>', 0, 30, 'ascii');
      break;
    case 'corrupted':
      buf.fill(0x00);
      break;
  }
  return buf.toString('base64');
}

describe('Secure OCR and Deployed Routes (Issue 7)', () => {
  beforeEach(() => {
    resetOcrRateLimits();
  });

  const creatorUser: AuthenticatedUser = {
    id: 'usr_creator',
    role: 'CREATOR',
    active: true,
    displayName: 'Creator',
  };

  const gmUser: AuthenticatedUser = {
    id: 'usr_gm',
    role: 'GM',
    active: true,
    displayName: 'General Manager',
  };

  const managerEaling: AuthenticatedUser = {
    id: 'usr_mgr_ealing',
    role: 'MANAGER',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Ealing Manager',
  };

  const staffEaling: AuthenticatedUser = {
    id: 'usr_staff_ealing',
    role: 'STAFF',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Alice Staff',
  };

  const inactiveStaff: AuthenticatedUser = {
    id: 'usr_inactive',
    role: 'STAFF',
    branchId: 'branch_ealing',
    active: false,
    displayName: 'Inactive Staff',
  };

  // =========================================================================
  // 1. AUTHENTICATION & BRANCH CONTEXT AUTHORIZATION
  // =========================================================================
  describe('Caller Authentication & Branch Context', () => {
    it('allows active Staff to scan documents for their assigned branch', () => {
      assert.doesNotThrow(() =>
        validateOcrAuthorization(staffEaling, { branchId: 'branch_ealing' })
      );
    });

    it('denies Staff scanning documents for a different branch (403)', () => {
      assert.throws(
        () => validateOcrAuthorization(staffEaling, { branchId: 'branch_soho' }),
        (err: any) => err instanceof OcrSecurityError && err.status === 403 && err.code === 'BRANCH_MISMATCH'
      );
    });

    it('denies Manager scanning documents for a different branch (403)', () => {
      assert.throws(
        () => validateOcrAuthorization(managerEaling, { branchId: 'branch_soho' }),
        (err: any) => err instanceof OcrSecurityError && err.status === 403 && err.code === 'BRANCH_MISMATCH'
      );
    });

    it('allows GM, Creator, and ADMIN to scan documents across any branch', () => {
      assert.doesNotThrow(() => validateOcrAuthorization(gmUser, { branchId: 'branch_ealing' }));
      assert.doesNotThrow(() => validateOcrAuthorization(creatorUser, { branchId: 'branch_soho' }));
      const adminUser: AuthenticatedUser = {
        id: 'usr_admin',
        role: 'ADMIN',
        active: true,
        displayName: 'Admin User',
      };
      assert.doesNotThrow(() => validateOcrAuthorization(adminUser, { branchId: 'branch_soho' }));
      const lowerAdminUser: AuthenticatedUser = {
        id: 'usr_admin_lower',
        role: 'admin',
        active: true,
        displayName: 'Lowercase Admin User',
      };
      assert.doesNotThrow(() => validateOcrAuthorization(lowerAdminUser, { branchId: 'branch_soho' }));
    });

    it('allows standalone scanning without an existing orderId', () => {
      // Standalone new invoice scanning provides no orderId
      assert.doesNotThrow(() => validateOcrAuthorization(staffEaling));
      assert.doesNotThrow(() => validateOcrAuthorization(managerEaling));
    });

    it('strictly denies inactive users (403)', () => {
      assert.throws(
        () => validateOcrAuthorization(inactiveStaff),
        (err: any) => err instanceof OcrSecurityError && err.status === 403 && err.code === 'INACTIVE_USER'
      );
    });

    it('denies unauthorized roles (e.g. guest or supplier) (403)', () => {
      const supplierUser: AuthenticatedUser = {
        id: 'usr_sup',
        role: 'SUPPLIER_GUEST',
        active: true,
      };
      assert.throws(
        () => validateOcrAuthorization(supplierUser),
        (err: any) => err.status === 403 && err.code === 'UNAUTHORIZED_ROLE'
      );
    });
  });

  // =========================================================================
  // 2. PAYLOAD & MIME TYPE VALIDATION
  // =========================================================================
  describe('Payload and MIME Type Constraints', () => {
    it('accepts valid JPEG, PNG, WebP, and PDF payloads', () => {
      const validJpeg = validateOcrPayload({
        base64str: createSyntheticFile('jpeg'),
        mimeType: 'image/jpeg',
      });
      assert.equal(validJpeg.mimeType, 'image/jpeg');

      const validPng = validateOcrPayload({
        base64str: createSyntheticFile('png'),
        mimeType: 'image/png',
      });
      assert.equal(validPng.mimeType, 'image/png');

      const validWebp = validateOcrPayload({
        base64str: createSyntheticFile('webp'),
        mimeType: 'image/webp',
      });
      assert.equal(validWebp.mimeType, 'image/webp');

      const validPdf = validateOcrPayload({
        base64str: createSyntheticFile('pdf'),
        mimeType: 'application/pdf',
      });
      assert.equal(validPdf.mimeType, 'application/pdf');
    });

    it('rejects unsupported MIME types (400)', () => {
      const unsupported = ['text/html', 'application/javascript', 'image/svg+xml', 'application/zip', 'text/plain'];
      for (const mime of unsupported) {
        assert.throws(
          () => validateOcrPayload({ base64str: createSyntheticFile('jpeg'), mimeType: mime }),
          (err: any) => err.status === 400 && err.code === 'UNSUPPORTED_MIME_TYPE'
        );
      }
    });

    it('rejects empty or missing base64 payload (400)', () => {
      // Missing base64str
      assert.throws(
        () => validateOcrPayload({ mimeType: 'image/jpeg' }),
        (err: any) => err.status === 400 && err.code === 'MISSING_PAYLOAD'
      );
      // Empty string
      assert.throws(
        () => validateOcrPayload({ base64str: '', mimeType: 'image/jpeg' }),
        (err: any) => err.status === 400 && err.code === 'MISSING_PAYLOAD'
      );
      // Whitespace string
      assert.throws(
        () => validateOcrPayload({ base64str: '   ', mimeType: 'image/jpeg' }),
        (err: any) => err.status === 400 && (err.code === 'EMPTY_FILE' || err.code === 'MISSING_PAYLOAD')
      );
    });

    it('rejects payload exceeding the 10MB limit (413)', () => {
      // Create synthetic buffer of 10.5 MB
      const bigBuf = Buffer.alloc(MAX_OCR_FILE_SIZE_BYTES + 500 * 1024);
      bigBuf[0] = 0xff;
      bigBuf[1] = 0xd8;
      bigBuf[2] = 0xff;
      bigBuf[3] = 0xe0;

      assert.throws(
        () => validateOcrPayload({ base64str: bigBuf.toString('base64'), mimeType: 'image/jpeg' }),
        (err: any) => err.status === 413 && err.code === 'FILE_TOO_LARGE'
      );
    });
  });

  // =========================================================================
  // 3. BINARY MAGIC BYTE VALIDATION (ANTI-SPOOFING)
  // =========================================================================
  describe('Binary Magic Byte Anti-Spoofing', () => {
    it('detects and rejects mislabeled HTML file disguised as JPEG (400)', () => {
      const spoofedJpeg = createSyntheticFile('html');
      assert.throws(
        () => validateOcrPayload({ base64str: spoofedJpeg, mimeType: 'image/jpeg' }),
        (err: any) => err.status === 400 && err.code === 'MIMETYPE_MISMATCH'
      );
    });

    it('detects and rejects PNG file disguised as PDF (400)', () => {
      const spoofedPdf = createSyntheticFile('png');
      assert.throws(
        () => validateOcrPayload({ base64str: spoofedPdf, mimeType: 'application/pdf' }),
        (err: any) => err.status === 400 && err.code === 'MIMETYPE_MISMATCH'
      );
    });

    it('detects and rejects random corrupted binary disguised as PNG (400)', () => {
      const corrupted = createSyntheticFile('corrupted');
      assert.throws(
        () => validateOcrPayload({ base64str: corrupted, mimeType: 'image/png' }),
        (err: any) => err.status === 400 && err.code === 'MIMETYPE_MISMATCH'
      );
    });
  });

  // =========================================================================
  // 4. RATE LIMITING & CONCURRENCY
  // =========================================================================
  describe('Sliding-Window Rate Limiting', () => {
    it('allows requests within the allowed rate limit', () => {
      for (let i = 0; i < 15; i++) {
        assert.doesNotThrow(() => checkOcrRateLimit('usr_regular', 15));
      }
    });

    it('rejects requests exceeding the threshold with 429 Too Many Requests', () => {
      for (let i = 0; i < 15; i++) {
        checkOcrRateLimit('usr_rapid', 15);
      }
      assert.throws(
        () => checkOcrRateLimit('usr_rapid', 15),
        (err: any) => err.status === 429 && err.code === 'RATE_LIMIT_EXCEEDED'
      );
    });
  });

  // =========================================================================
  // 5. ENDPOINT CONTRACT (HTTP METHODS & PREFLIGHT)
  // =========================================================================
  describe('Deployed Endpoint Route Contracts', () => {
    function createMockRes() {
      let statusCode = 200;
      const headers: Record<string, string> = {};
      let jsonBody: any = null;
      let ended = false;

      const res: any = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
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

    it('/api/ocr rejects GET requests with 405 Method Not Allowed', async () => {
      const req: any = { method: 'GET', headers: {} };
      const res = createMockRes();

      await ocrHandler(req, res);
      assert.equal(res.statusCode, 405);
      assert.equal(res.jsonBody?.error, 'Method not allowed');
    });

    it('/api/scan-invoice rejects GET requests with 405 Method Not Allowed', async () => {
      const req: any = { method: 'GET', headers: {} };
      const res = createMockRes();

      await scanInvoiceHandler(req, res);
      assert.equal(res.statusCode, 405);
      assert.equal(res.jsonBody?.error, 'Method not allowed');
    });

    it('/api/ocr handles OPTIONS preflight request with 200 and CORS headers', async () => {
      const req: any = { method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } };
      const res = createMockRes();

      await ocrHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:3000');
    });

    it('/api/ocr rejects unauthenticated POST request with 401', async () => {
      const req: any = {
        method: 'POST',
        headers: {},
        body: { base64str: createSyntheticFile('jpeg'), mimeType: 'image/jpeg' },
      };
      const res = createMockRes();

      await ocrHandler(req, res);
      assert.equal(res.statusCode, 401);
      assert.ok(res.jsonBody?.error?.includes('Unauthorized'));
    });

    it('/api/scan-invoice rejects unauthenticated POST request with 401', async () => {
      const req: any = {
        method: 'POST',
        headers: {},
        body: { base64str: createSyntheticFile('jpeg'), mimeType: 'image/jpeg' },
      };
      const res = createMockRes();

      await scanInvoiceHandler(req, res);
      assert.equal(res.statusCode, 401);
      assert.ok(res.jsonBody?.error?.includes('Unauthorized'));
    });
  });
});
