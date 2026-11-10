import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { readServerConfig, parseServiceAccount } from '../server/htos-runtime.ts';

// No SDK initialization, credentials discovery, or network access at import time.
export function getAdmin() {
  const config = readServerConfig(process.env);
  const name = 'htos-' + config.mode + '-' + config.projectId;
  let app = getApps().find(candidate => candidate.name === name);
  if (!app) {
    const options = config.mode === 'emulator'
      ? { projectId: config.projectId }
      : { projectId: config.projectId, credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, config.projectId)) };
    app = initializeApp(options, name);
  }
  return { db: getFirestore(app), auth: getAuth(app), hasAdminCredentials: true };
}

function lazyService<T extends object>(key: 'db' | 'auth'): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const service = getAdmin()[key] as any;
      const value = service[property];
      return typeof value === 'function' ? value.bind(service) : value;
    },
  });
}
export const db = lazyService<Firestore>('db');
export const auth = lazyService<Auth>('auth');
export const adminDb = db;
export const adminAuth = auth;
export const hasAdminCredentials = false;
