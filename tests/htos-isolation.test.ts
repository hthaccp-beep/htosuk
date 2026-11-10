import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHtosConfig } from '../shared/htos-config.ts';
import { readServerConfig, externalServiceEnabled, parseServiceAccount, validateCloudSetup } from '../server/htos-runtime.ts';
import { readExistingProfile } from '../server/profile-access.ts';

const emulator = {
  HTOS_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-htos',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9095',
};
test('missing configuration refuses to choose a database', () => {
  assert.throws(() => readHtosConfig({}), /own database/);
});
test('old database is forbidden in both modes on browser and server', () => {
  for (const mode of ['emulator','cloud']) {
    assert.throws(() => readHtosConfig({ HTOS_MODE: mode, FIREBASE_PROJECT_ID: 'ordersystemv3', HTOS_CLOUD_PROJECT_ID: 'ordersystemv3' }), /separate/);
    assert.throws(() => readHtosConfig({ VITE_HTOS_MODE: mode, VITE_FIREBASE_PROJECT_ID: 'ordersystemv3', VITE_HTOS_CLOUD_PROJECT_ID: 'ordersystemv3' }, true), /separate/);
  }
});
test('local mode requires both loopback emulators and no cloud credentials', () => {
  assert.equal(readServerConfig(emulator).projectId, 'demo-htos');
  for (const patch of [
    { FIREBASE_PROJECT_ID: 'another-project' }, { FIRESTORE_EMULATOR_HOST: undefined },
    { FIREBASE_AUTH_EMULATOR_HOST: 'remote.example:9095' }, { FIREBASE_SERVICE_ACCOUNT_KEY: '{}' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'some-key.json' },
  ]) assert.throws(() => readServerConfig({ ...emulator, ...patch }));
});
test('cloud mode requires explicit matching project and cannot use emulator overrides', () => {
  const cloud = { HTOS_MODE: 'cloud', FIREBASE_PROJECT_ID: 'htos-test', HTOS_CLOUD_PROJECT_ID: 'htos-test' };
  assert.equal(readServerConfig(cloud).projectId, 'htos-test');
  assert.throws(() => readServerConfig({ ...cloud, HTOS_CLOUD_PROJECT_ID: undefined }));
  assert.throws(() => readServerConfig({ ...cloud, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9095' }));
});
test('credentials must belong to HTOS and errors do not echo secret contents', () => {
  assert.throws(() => parseServiceAccount(undefined, 'htos-test'));
  const raw = JSON.stringify({ project_id: 'other-project', private_key: 'private-test-marker', client_email: 'example@example.invalid' });
  assert.throws(() => parseServiceAccount(raw, 'htos-test'), error => error instanceof Error && !error.message.includes('private-test-marker'));
  assert.equal(parseServiceAccount(raw, 'other-project').project_id, 'other-project');
});

test('cloud preview refuses missing credentials and mismatched browser/server projects', () => {
  const env = { HTOS_MODE: 'cloud', FIREBASE_PROJECT_ID: 'htos-test', HTOS_CLOUD_PROJECT_ID: 'htos-test',
    VITE_HTOS_MODE: 'cloud', VITE_FIREBASE_PROJECT_ID: 'htos-test', VITE_HTOS_CLOUD_PROJECT_ID: 'htos-test' };
  assert.throws(() => validateCloudSetup(env), /credentials/);
  const configured = { ...env, FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'htos-test', private_key: 'synthetic-only', client_email: 'test@example.invalid' }) };
  assert.equal(validateCloudSetup(configured).projectId, 'htos-test');
  assert.throws(() => validateCloudSetup({ ...configured, VITE_FIREBASE_PROJECT_ID: 'other', VITE_HTOS_CLOUD_PROJECT_ID: 'other' }), /same separate/);
  assert.throws(() => validateCloudSetup({ ...configured, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }), /emulator/);
});
test('local tests never enable real mail or OCR even if flags are true', () => {
  for (const service of ['EMAIL','OCR'] as const) {
    assert.equal(externalServiceEnabled(service, {}), false);
    assert.equal(externalServiceEnabled(service, { ...emulator, ['HTOS_ENABLE_' + service]: 'true' }), false);
  }
});
test('disabled API routes return safe failures without external requests', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected external request'); };
  try {
    for (const file of ['../api/send-email.ts','../api/ocr.ts','../api/scan-invoice.ts']) {
      const { default: handler } = await import(file);
      const res: any = { statusCode: 0, body: null, setHeader() {}, status(code: number) { this.statusCode=code; return this; }, json(body: unknown) { this.body=body; return this; } };
      await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-test-token' }, body: {} }, res);
      assert.equal(res.statusCode, 503);
      assert.match(res.body.error, /disabled/);
    }
  } finally { globalThis.fetch = savedFetch; }
});
test('profile sync cannot invent an admin account or reactivate a disabled account', async () => {
  assert.equal(await readExistingProfile('admin-allan', async () => undefined), null);
  assert.equal(await readExistingProfile('admin-allan', async () => ({ active: false, role: 'CREATOR' })), null);
  const user = await readExistingProfile('test-user', async () => ({ active: true, role: 'STAFF', branchIds: ['test-a', 'test-b'], supplierIds: ['test-supplier'], password: 'synthetic' }));
  assert.deepEqual(user, { id: 'test-user', active: true, role: 'STAFF', branchIds: ['test-a', 'test-b'], supplierIds: ['test-supplier'] });
});
