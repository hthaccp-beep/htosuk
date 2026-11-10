import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { readHtosConfig } from './shared/htos-config.ts';

const env = import.meta.env || {};
let db: any = null;
let auth: any = null;
let configurationError: string | null = null;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
};

try {
  const config = readHtosConfig(env, true);
  if (config.mode === 'cloud' && (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.appId)) {
    throw new Error('HTOS web app configuration is incomplete.');
  }
  const app = initializeApp(config.mode === 'emulator'
    ? { projectId: 'demo-htos', apiKey: 'demo-htos-key', authDomain: 'localhost', appId: 'demo-htos' }
    : firebaseConfig, 'htos-' + config.mode + '-' + config.projectId);
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  auth = getAuth(app);
  if (config.mode === 'emulator') {
    connectFirestoreEmulator(db, '127.0.0.1', 8085);
    connectAuthEmulator(auth, 'http://127.0.0.1:9095', { disableWarnings: true });
  }
} catch (error) {
  configurationError = error instanceof Error ? error.message : 'HTOS database setup is incomplete.';
}
export { db, auth, configurationError };
