import { readHtosConfig, assertLocalEmulatorHost, type Environment } from '../shared/htos-config.ts';

export function readServerConfig(env: Environment) {
  const config = readHtosConfig(env);
  if (config.mode === 'emulator') {
    assertLocalEmulatorHost(env.FIRESTORE_EMULATOR_HOST, 8085);
    assertLocalEmulatorHost(env.FIREBASE_AUTH_EMULATOR_HOST, 9095);
    if (env.FIREBASE_SERVICE_ACCOUNT_KEY || env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('Remove cloud credentials before running local HTOS emulators.');
    }
  } else if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Cloud mode cannot use emulator overrides.');
  }
  return config;
}

export function externalServiceEnabled(service: 'EMAIL' | 'OCR', env: Environment = process.env) {
  try {
    return readServerConfig(env).mode === 'cloud' && env['HTOS_ENABLE_' + service] === 'true';
  } catch { return false; }
}

export function parseServiceAccount(raw: string | undefined, projectId: string) {
  if (!raw) throw new Error('HTOS server credentials are not configured.');
  try {
    let text = raw.trim();
    if (!text.startsWith('{')) text = Buffer.from(text, 'base64').toString('utf8');
    const account = JSON.parse(text);
    if (account.project_id !== projectId || !account.private_key || !account.client_email) throw new Error();
    account.private_key = account.private_key.replace(/\\n/g, '\n');
    return account;
  } catch { throw new Error('HTOS server credentials must belong to its separate project.'); }
}

export function validateCloudSetup(env: Environment) {
  const server = readServerConfig(env);
  const client = readHtosConfig(env, true);
  if (server.mode !== 'cloud' || client.mode !== 'cloud' || server.projectId !== client.projectId) {
    throw new Error('HTOS browser and server must use the same separate cloud project.');
  }
  parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_KEY, server.projectId);
  return server;
}
