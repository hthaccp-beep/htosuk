import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BranchEmailSettingsError,
  createBranchEmailSettingsHandler,
  decryptBranchEmailPassword,
  encryptBranchEmailPassword,
  MANDATORY_EMAIL_CC,
  readBranchEmailAccount,
} from '../server/branch-email-settings.ts';
import type { BranchEmailRequest, BranchEmailSettingsDependencies, StoredBranchEmailSettings } from '../server/branch-email-settings.ts';

// Synthetic values only. Dependencies below cannot call Firebase or an SMTP server.
const KEY = Buffer.alloc(32, 7).toString('base64');
const PASSWORD = 'synthetic-test-password';
const FIELDS = { host: 'smtp.example.com', port: 465, secure: true, user: 'branch@example.com' };
const payload = (changes: Record<string, unknown> = {}) => ({ branchId: 'b1', ...FIELDS, password: PASSWORD, ...changes });
const initialSettings = (changes: Partial<StoredBranchEmailSettings> = {}): StoredBranchEmailSettings => ({
  ...FIELDS, cc: [], passwordEncrypted: encryptBranchEmailPassword(PASSWORD, 'b1', KEY),
  updatedBy: 'admin-id', updatedAt: '2026-01-01T00:00:00.000Z', ...changes,
});

function fixture(overrides: Partial<BranchEmailSettingsDependencies> = {}, initial?: unknown) {
  let stored: unknown = initial;
  const writes: StoredBranchEmailSettings[] = [];
  const reads: string[] = [];
  const deps: BranchEmailSettingsDependencies = {
    verifyToken: async token => { reads.push('verify'); assert.equal(token, 'synthetic-token'); return { uid: 'admin-id' }; },
    getUser: async () => { reads.push('user'); return { role: 'CREATOR', active: true }; },
    getBranch: async () => { reads.push('branch'); return { email: 'branch@example.com', active: true }; },
    getSettings: async () => { reads.push('settings'); return stored; },
    saveSettings: async (_branchId, settings) => { writes.push(settings); stored = settings; },
    env: { NODE_ENV: 'production', EMAIL_SETTINGS_ENCRYPTION_KEY: KEY },
    now: () => new Date('2026-09-28T12:00:00.000Z'),
    ...overrides,
  };
  const handler = createBranchEmailSettingsHandler(deps);
  const run = async (method = 'GET', body?: unknown, changes: Partial<BranchEmailRequest> = {}) => {
    const state = { status: 200, data: undefined as any, headers: {} as Record<string, string> };
    const response = {
      setHeader(name: string, value: string) { state.headers[name] = value; },
      status(code: number) { state.status = code; return this; },
      json(data: unknown) { state.data = data; },
      end() {},
    };
    await handler({ method, body, query: { branchId: 'b1' }, headers: { authorization: 'Bearer synthetic-token' }, ...changes }, response);
    return state;
  };
  return { run, writes, reads, deps };
}

test('AES-GCM round trip has random IV and is bound to the branch', () => {
  const first = encryptBranchEmailPassword(PASSWORD, 'b1', KEY);
  const second = encryptBranchEmailPassword(PASSWORD, 'b1', KEY);
  assert.notDeepEqual(first, second);
  assert.equal(decryptBranchEmailPassword(first, 'b1', KEY), PASSWORD);
  assert.equal(JSON.stringify(first).includes(PASSWORD), false);
  assert.throws(() => decryptBranchEmailPassword(first, 'b2', KEY), BranchEmailSettingsError);
});

test('tampered ciphertext, IV, tag and wrong keys fail with generic errors', () => {
  const encrypted = encryptBranchEmailPassword(PASSWORD, 'b1', KEY);
  for (const field of ['ciphertext', 'iv', 'tag'] as const) {
    const bytes = Buffer.from(encrypted[field], 'base64'); bytes[0] ^= 1;
    assert.throws(() => decryptBranchEmailPassword({ ...encrypted, [field]: bytes.toString('base64') }, 'b1', KEY),
      (error: unknown) => error instanceof BranchEmailSettingsError && error.status === 503 && !error.message.includes(PASSWORD));
  }
  assert.throws(() => decryptBranchEmailPassword(encrypted, 'b1', Buffer.alloc(32, 8).toString('base64')), BranchEmailSettingsError);
});

for (const key of [undefined, '', 'not-base64', Buffer.alloc(16).toString('base64'), Buffer.alloc(33).toString('base64')]) {
  test(`missing/malformed encryption key fails closed (${String(key).length} chars)`, async () => {
    const { run, writes } = fixture({ env: { EMAIL_SETTINGS_ENCRYPTION_KEY: key } });
    assert.equal((await run()).status, 503);
    assert.equal((await run('PUT', payload())).status, 503);
    assert.equal(writes.length, 0);
    assert.throws(() => readBranchEmailAccount(undefined, 'b1', key), BranchEmailSettingsError);
  });
}

test('anonymous/malformed tokens fail before any database read', async () => {
  for (const authorization of [undefined, 'Basic abc', 'Bearer ', ['Bearer a', 'Bearer b'], 'Bearer token extra']) {
    const { run, reads, writes } = fixture();
    assert.equal((await run('GET', undefined, { headers: { authorization } })).status, 401);
    assert.deepEqual(reads, []); assert.deepEqual(writes, []);
  }
});

test('revoked identity is rejected; verification outage is retryable and does not leak errors', async () => {
  for (const [code, status] of [['auth/id-token-revoked', 401], ['service/unavailable', 503]] as const) {
    const { run, writes } = fixture({ verifyToken: async () => { throw Object.assign(new Error(PASSWORD), { code }); } });
    const result = await run();
    assert.equal(result.status, status); assert.equal(JSON.stringify(result.data).includes(PASSWORD), false);
    assert.equal(writes.length, 0);
  }
});

test('STAFF, MANAGER, inactive and missing profiles cannot inspect or save settings', async () => {
  for (const user of [undefined, { role: 'STAFF', active: true }, { role: 'MANAGER', active: true }, { role: 'CREATOR', active: false }, { role: 'GM' }]) {
    const { run, reads, writes } = fixture({ getUser: async () => user });
    assert.equal((await run()).status, 403);
    assert.equal((await run('PUT', payload())).status, 403);
    assert.equal(reads.includes('settings'), false); assert.equal(writes.length, 0);
  }
});

test('active GM can configure even an inactive branch', async () => {
  const { run, writes } = fixture({ getUser: async () => ({ role: 'GM', active: true }), getBranch: async () => ({ email: FIELDS.user, active: false }) });
  assert.equal((await run('PUT', payload())).status, 200);
  assert.equal(writes.length, 1);
});

test('active ADMIN can configure branch email settings', async () => {
  const { run, writes } = fixture({ getUser: async () => ({ role: 'ADMIN', active: true }), getBranch: async () => ({ email: FIELDS.user, active: true }) });
  assert.equal((await run('PUT', payload())).status, 200);
  assert.equal(writes.length, 1);
});

test('GET unconfigured branch returns null and mandatory sender/CC without secrets', async () => {
  const { run } = fixture();
  const response = await run();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { settings: null, senderEmail: FIELDS.user, cc: MANDATORY_EMAIL_CC });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('PUT encrypts the password and GET returns only metadata', async () => {
  const { run, writes } = fixture();
  const put = await run('PUT', payload());
  assert.equal(put.status, 200);
  assert.equal(put.data.success, true);
  assert.equal(writes[0].updatedBy, 'admin-id');
  assert.equal(writes[0].updatedAt, '2026-09-28T12:00:00.000Z');
  assert.equal('password' in writes[0], false);
  assert.equal(JSON.stringify(writes[0]).includes(PASSWORD), false);
  assert.equal(decryptBranchEmailPassword(writes[0].passwordEncrypted, 'b1', KEY), PASSWORD);
  const get = await run();
  assert.deepEqual(get.data.settings, { ...FIELDS, cc: [], hasPassword: true });
  for (const response of [put, get]) {
    const serialized = JSON.stringify(response.data);
    for (const forbidden of [PASSWORD, writes[0].passwordEncrypted.ciphertext, 'passwordEncrypted', 'ciphertext', 'updatedBy']) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
});

test('omitted/blank passwords retain existing encrypted value on safe changes', async () => {
  for (const password of [undefined, '', '   ']) {
    const initial = initialSettings(); const { run, writes } = fixture({}, initial);
    assert.equal((await run('PUT', payload({ password, port: 587, secure: false }))).status, 200);
    assert.deepEqual(writes[0].passwordEncrypted, initial.passwordEncrypted);
  }
});

test('first save and changes of host or username require a new password', async () => {
  assert.equal((await fixture().run('PUT', payload({ password: '' }))).status, 400);
  const hostChange = fixture({}, initialSettings());
  assert.equal((await hostChange.run('PUT', payload({ host: 'new.example.com', password: '' }))).status, 400);
  assert.equal(hostChange.writes.length, 0);
  const userChange = fixture({ getBranch: async () => ({ email: 'new@example.com' }) }, initialSettings());
  assert.equal((await userChange.run('PUT', payload({ user: 'new@example.com', password: '' }))).status, 400);
  assert.equal((await userChange.run('PUT', payload({ user: 'new@example.com', password: 'new-synthetic-password' }))).status, 200);
});

test('username must match the saved branch email and missing/invalid branch email fails', async () => {
  assert.equal((await fixture().run('PUT', payload({ user: 'other@example.com' }))).status, 400);
  for (const email of [undefined, '', 'a@example.com,b@example.com', 'branch@example.com\r\nBcc:x@example.com']) {
    const { run } = fixture({ getBranch: async () => ({ email }) });
    assert.equal((await run()).status, 400); assert.equal((await run('PUT', payload())).status, 400);
  }
  assert.equal((await fixture({ getBranch: async () => undefined }).run()).status, 404);
});

test('rejects unknown fields, unsafe hosts, invalid TLS/ports and overlong passwords', async () => {
  const invalid = [
    { pass: PASSWORD }, { passwordEncrypted: {} }, { cc: ['a@example.com'] }, { password: 123 },
    { host: 'https://smtp.example.com' }, { host: 'localhost' }, { host: 'a.localhost' },
    { host: '127.0.0.1' }, { host: '::1' }, { host: 'smtp.example.com:465' },
    { host: 'bad\r\n.example.com' }, { host: '-smtp.example.com' }, { host: 'a..example.com' },
    { port: 25 }, { port: '465' }, { port: 587, secure: true }, { port: 465, secure: false }, { secure: 'true' },
    { password: 'x'.repeat(4097) }, { branchId: '../users' },
  ];
  for (const changes of invalid) {
    const { run, writes } = fixture();
    assert.equal((await run('PUT', payload(changes))).status, 400, JSON.stringify(Object.keys(changes)));
    assert.equal(writes.length, 0);
  }
  assert.equal((await fixture().run('GET', undefined, { query: { branchId: ['b1', 'b2'] } })).status, 400);
  assert.equal((await fixture().run('GET', undefined, { query: { branchId: 'b1', password: '1' } })).status, 400);
});

test('CC accepts arbitrary admin-chosen external addresses, deduplicates and keeps mandatory CC automatic', async () => {
  const { run, writes } = fixture();
  const response = await run('PUT', payload({ cc: ` External@Elsewhere.test, external@elsewhere.test, ${MANDATORY_EMAIL_CC.toUpperCase()}, another@outside.example ` }));
  assert.equal(response.status, 200);
  assert.deepEqual(writes[0].cc, ['external@elsewhere.test', 'another@outside.example']);
  assert.deepEqual(response.data.settings.cc, writes[0].cc);
  assert.equal(response.data.cc, MANDATORY_EMAIL_CC);
  assert.deepEqual(readBranchEmailAccount(writes[0], 'b1', KEY)?.cc, writes[0].cc);
});

test('CC-only updates preserve password; omitted CC preserves, empty CC clears extra addresses only', async () => {
  const initial = initialSettings({ cc: ['previous@external.example'] });
  const { run, writes } = fixture({}, initial);
  assert.equal((await run('PUT', payload({ password: '', cc: undefined }))).status, 200);
  assert.deepEqual(writes[0].cc, initial.cc);
  const cleared = await run('PUT', payload({ password: '', cc: '' }));
  assert.equal(cleared.status, 200); assert.deepEqual(writes[1].cc, []);
  assert.deepEqual(writes[1].passwordEncrypted, initial.passwordEncrypted);
  assert.equal(cleared.data.cc, MANDATORY_EMAIL_CC);
});

test('CC rejects injection, invalid names, empty list entries, oversized and too many addresses', async () => {
  for (const cc of ['a@example.com\r\nBcc:b@example.com', 'Name <a@example.com>', 'not-email', 'a@example.com,', 'x'.repeat(255) + '@example.com', Array.from({ length: 19 }, (_, i) => `person${i}@example.com`).join(',')]) {
    const { run, writes } = fixture();
    assert.equal((await run('PUT', payload({ cc }))).status, 400); assert.equal(writes.length, 0);
  }
});

test('records created before additional CC support default to no extras', () => {
  const stored: Record<string, unknown> = initialSettings(); delete stored.cc;
  assert.deepEqual(readBranchEmailAccount(stored, 'b1', KEY)?.cc, []);
});

test('wrong-branch ciphertext stays unreadable but an authorized new password can replace it', async () => {
  const stored = initialSettings({ passwordEncrypted: encryptBranchEmailPassword(PASSWORD, 'b2', KEY) });
  const { run, writes } = fixture({}, stored);
  const response = await run();
  assert.equal(response.status, 200); assert.equal(response.data.settings.hasPassword, false);
  assert.equal(JSON.stringify(response.data).includes(PASSWORD), false);
  assert.equal((await run('PUT', payload({ password: '' }))).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await run('PUT', payload({ password: 'replacement-synthetic-password' }))).status, 200);
  assert.equal(decryptBranchEmailPassword(writes[0].passwordEncrypted, 'b1', KEY), 'replacement-synthetic-password');
});

test('key rotation requires re-entering a password and preserves nonsecret metadata', async () => {
  const initial = initialSettings({ cc: ['external@example.com'] });
  const rotatedKey = Buffer.alloc(32, 9).toString('base64');
  const { run, writes } = fixture({ env: { EMAIL_SETTINGS_ENCRYPTION_KEY: rotatedKey } }, initial);
  assert.throws(() => readBranchEmailAccount(initial, 'b1', rotatedKey), BranchEmailSettingsError);
  const get = await run();
  assert.deepEqual(get.data.settings, { ...FIELDS, cc: initial.cc, hasPassword: false });
  assert.equal((await run('PUT', payload({ password: undefined }))).status, 400);
  assert.equal((await run('PUT', payload())).status, 200);
  assert.deepEqual(writes[0].cc, initial.cc);
  assert.equal(readBranchEmailAccount(writes[0], 'b1', rotatedKey)?.pass, PASSWORD);
});

test('invalid stored metadata returns a fresh form and can be replaced with valid settings', async () => {
  const { run, writes } = fixture({}, { host: 'invalid', passwordEncrypted: {} });
  assert.equal((await run()).data.settings, null);
  assert.equal((await run('PUT', payload({ password: '' }))).status, 400);
  assert.equal((await run('PUT', payload())).status, 200);
  assert.equal(writes.length, 1);
});

test('configured origins work, unlisted origin and unsupported methods do no downstream work', async () => {
  const env = { EMAIL_SETTINGS_ENCRYPTION_KEY: KEY, NODE_ENV: 'production', APP_ORIGIN: 'https://custom.example', VERCEL_URL: 'preview.example' };
  for (const origin of ['https://ordersystem2027.vercel.app', 'https://custom.example', 'https://preview.example']) {
    const { run, reads } = fixture({ env });
    const preflight = await run('OPTIONS', undefined, { headers: { origin } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers['Access-Control-Allow-Origin'], origin); assert.deepEqual(reads, []);
  }
  const blocked = fixture({ env });
  assert.equal((await blocked.run('PUT', payload(), { headers: { origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await blocked.run('GET', undefined, { headers: { origin: 'http://localhost:3000' } })).status, 403);
  assert.equal((await blocked.run('POST', payload())).status, 405);
  assert.deepEqual(blocked.reads, []); assert.deepEqual(blocked.writes, []);
});

test('preview deployments exclude localhost and configured origins with paths are rejected', async () => {
  const { run } = fixture({ env: { EMAIL_SETTINGS_ENCRYPTION_KEY: KEY, VERCEL_ENV: 'preview', APP_ORIGIN: 'https://custom.example/path' } });
  for (const origin of ['http://localhost:3000', 'https://custom.example']) {
    assert.equal((await run('OPTIONS', undefined, { headers: { origin } })).status, 403);
  }
});

test('cloud run origins (.run.app) and admin accounts are allowed', async () => {
  const env = { EMAIL_SETTINGS_ENCRYPTION_KEY: KEY, NODE_ENV: 'production' };
  const { run } = fixture({
    env,
    verifyToken: async () => ({ uid: 'firebase_uid_123', email: 'owner@gmail-com.example' }),
    getUser: async (_uid, identity) => ({ id: 'firebase_uid_123', email: identity?.email, role: 'ADMIN', active: true }),
  });
  const res = await run('GET', undefined, {
    headers: {
      authorization: 'Bearer synthetic-token',
      origin: 'https://ais-dev-12345.europe-west3.run.app',
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://ais-dev-12345.europe-west3.run.app');
});

test('database failures return generic errors without submitted passwords', async () => {
  const { run } = fixture({ saveSettings: async () => { throw new Error(`Simulated storage error ${PASSWORD}`); } });
  const response = await run('PUT', payload());
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(response.data).includes(PASSWORD), false);
});
