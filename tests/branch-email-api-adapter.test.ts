import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  createBranchEmailSettingsHandler, 
  defaultBranchEmailHandler
} from '../api/admin/branch-email.ts';
import type {
  BranchEmailRequest,
  BranchEmailResponse
} from '../api/admin/branch-email.ts';
import { migrateBranchEmailEncryptionKey } from '../server/email-settings-migration.ts';
import { encryptBranchEmailPassword, decryptBranchEmailPassword } from '../server/branch-email-settings.ts';

const VALID_KEY = Buffer.alloc(32, 42).toString('base64');
const NEW_KEY = Buffer.alloc(32, 99).toString('base64');

function mockResponse() {
  const state = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
  };
  const res: BranchEmailResponse = {
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return this;
    },
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(data: unknown) {
      state.body = data;
      return this;
    },
    end() {
      return this;
    },
  };
  return { res, state };
}

test('Adapter: Missing or malformed authorization header fails closed with 401', async () => {
  const reqs: BranchEmailRequest[] = [
    { method: 'GET', headers: {}, query: { branchId: 'putney' } },
    { method: 'GET', headers: { authorization: '' }, query: { branchId: 'putney' } },
    { method: 'GET', headers: { authorization: 'Basic user:pass' }, query: { branchId: 'putney' } },
    { method: 'GET', headers: { authorization: 'Bearer' }, query: { branchId: 'putney' } },
    { method: 'GET', headers: { authorization: 'Bearer   ' }, query: { branchId: 'putney' } },
  ];

  for (const req of reqs) {
    const { res, state } = mockResponse();
    await defaultBranchEmailHandler(req, res);
    assert.equal(state.statusCode, 401, 'Must reject missing or malformed auth with 401');
    assert.equal(state.headers['Cache-Control'], 'no-store');
  }
});

test('Adapter: Unsigned JWT token fails closed without decoding or escalation', async () => {
  // Construct an unsigned JWT with admin payload:
  // header: {"alg":"none","typ":"JWT"}
  // payload: {"sub":"attacker1","email":"admin@attacker-com.example","name":"Allan Fake","role":"CREATOR","exp":9999999999}
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify({
    sub: 'attacker1',
    email: 'sample_admin@malicious-co-uk.example',
    name: 'Allan Admin',
    role: 'CREATOR',
    exp: 9999999999,
  })).toString('base64url');
  const unsignedJwt = `${headerB64}.${payloadB64}.`;

  const { res, state } = mockResponse();
  const req: BranchEmailRequest = {
    method: 'GET',
    headers: { authorization: `Bearer ${unsignedJwt}` },
    query: { branchId: 'putney' },
  };

  await defaultBranchEmailHandler(req, res);
  // Must fail closed (401 or 503) — NEVER 200!
  assert.notEqual(state.statusCode, 200, 'Unsigned JWT must never succeed');
  assert.ok([401, 503].includes(state.statusCode), 'Must fail closed');
});

test('Adapter: Expired token is rejected with 401', async () => {
  const handler = createBranchEmailSettingsHandler({
    verifyToken: async () => {
      const err: any = new Error('The token has expired');
      err.code = 'auth/id-token-expired';
      throw err;
    },
    getUser: async () => ({ role: 'CREATOR', active: true }),
    getBranch: async () => ({ email: 'putney@hareandtortoise-co-uk.example', active: true }),
    getSettings: async () => undefined,
    saveSettings: async () => {},
    env: { EMAIL_SETTINGS_ENCRYPTION_KEY: VALID_KEY },
  });

  const { res, state } = mockResponse();
  await handler({
    method: 'GET',
    headers: { authorization: 'Bearer expired-token' },
    query: { branchId: 'putney' },
  }, res);

  assert.equal(state.statusCode, 401);
  assert.match(state.body.error, /Sign in/i);
});

test('Adapter: Revoked token is rejected with 401', async () => {
  const handler = createBranchEmailSettingsHandler({
    verifyToken: async () => {
      const err: any = new Error('The token was revoked');
      err.code = 'auth/id-token-revoked';
      throw err;
    },
    getUser: async () => ({ role: 'CREATOR', active: true }),
    getBranch: async () => ({ email: 'putney@hareandtortoise-co-uk.example', active: true }),
    getSettings: async () => undefined,
    saveSettings: async () => {},
    env: { EMAIL_SETTINGS_ENCRYPTION_KEY: VALID_KEY },
  });

  const { res, state } = mockResponse();
  await handler({
    method: 'GET',
    headers: { authorization: 'Bearer revoked-token' },
    query: { branchId: 'putney' },
  }, res);

  assert.equal(state.statusCode, 401);
});

test('Adapter: Inactive or non-admin users cannot access or escalate (403)', async () => {
  const unauthorizedProfiles = [
    { role: 'STAFF', active: true, email: 'staff@example.com' },
    { role: 'MANAGER', active: true, email: 'manager@example.com' },
    { role: 'CREATOR', active: false, email: 'creator@example.com' },
    // Privilege escalation attempts by email/name matching
    { role: 'STAFF', active: true, email: 'admin@hareandtortoise-co-uk.example' },
    { role: 'STAFF', active: true, email: 'sample@hareandtortoise-co-uk.example' },
    { role: 'STAFF', active: true, email: 'owner@gmail-com.example' },
  ];

  for (const profile of unauthorizedProfiles) {
    const handler = createBranchEmailSettingsHandler({
      verifyToken: async () => ({ uid: 'user_test', email: profile.email }),
      getUser: async () => profile,
      getBranch: async () => ({ email: 'putney@hareandtortoise-co-uk.example', active: true }),
      getSettings: async () => undefined,
      saveSettings: async () => {},
      env: { EMAIL_SETTINGS_ENCRYPTION_KEY: VALID_KEY },
    });

    const { res, state } = mockResponse();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer valid-token' },
      query: { branchId: 'putney' },
    }, res);

    assert.equal(state.statusCode, 403, `User with role ${profile.role} and email ${profile.email} must receive 403`);
  }
});

test('Adapter: Valid active authorized users (CREATOR, GM, ADMIN) succeed with 200', async () => {
  const authorizedProfiles = [
    { role: 'CREATOR', active: true },
    { role: 'GM', active: true },
    { role: 'ADMIN', active: true },
  ];

  for (const profile of authorizedProfiles) {
    const handler = createBranchEmailSettingsHandler({
      verifyToken: async () => ({ uid: 'admin_test' }),
      getUser: async () => profile,
      getBranch: async () => ({ email: 'putney@hareandtortoise-co-uk.example', active: true }),
      getSettings: async () => undefined,
      saveSettings: async () => {},
      env: { EMAIL_SETTINGS_ENCRYPTION_KEY: VALID_KEY },
    });

    const { res, state } = mockResponse();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer valid-token' },
      query: { branchId: 'putney' },
    }, res);

    assert.equal(state.statusCode, 200);
    assert.equal(state.body.senderEmail, 'putney@hareandtortoise-co-uk.example');
  }
});

test('Controlled Migration: Re-encrypts branch settings securely without leaking secrets', async () => {
  const secretPassword = 'branch-real-password-123!';
  const branchId = 'putney';
  const originalEncrypted = encryptBranchEmailPassword(secretPassword, branchId, VALID_KEY);

  let savedData: any = null;

  const result = await migrateBranchEmailEncryptionKey({
    oldKey: VALID_KEY,
    newKey: NEW_KEY,
    getSettingsList: async () => [
      {
        branchId,
        data: {
          host: 'smtp.livemail.co.uk',
          port: 465,
          secure: true,
          user: 'putney@hareandtortoise-co-uk.example',
          cc: [],
          passwordEncrypted: originalEncrypted,
          updatedBy: 'migrator',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ],
    saveSetting: async (_id, data) => {
      savedData = data;
    },
  });

  assert.equal(result.migratedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.ok(savedData);
  assert.notDeepEqual(savedData.passwordEncrypted, originalEncrypted);
  
  // Verify that the new cipher decrypts cleanly with the new key and matches the secret
  const decryptedWithNewKey = decryptBranchEmailPassword(savedData.passwordEncrypted, branchId, NEW_KEY);
  assert.equal(decryptedWithNewKey, secretPassword);
  
  // Verify old key no longer decrypts new cipher
  assert.throws(() => decryptBranchEmailPassword(savedData.passwordEncrypted, branchId, VALID_KEY));
});
