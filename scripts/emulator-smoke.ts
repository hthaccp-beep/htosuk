import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, deleteField, terminate } from 'firebase/firestore';
import { getAdmin } from '../api/firebase-admin.ts';

// This executable refuses all cloud projects before creating synthetic data.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9095');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.HTOS_MODE = 'emulator';
process.env.FIREBASE_PROJECT_ID = 'demo-htos';
const { db, auth } = getAdmin();
const id = 'htos-smoke-' + randomUUID();
const email = id + '@example.invalid';
const password = randomUUID();
const app = initializeApp({ projectId: 'demo-htos', apiKey: 'demo-htos-key' }, id);
const clientAuth = getAuth(app);
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9095', { disableWarnings: true });
const clientDb = getFirestore(app);
connectFirestoreEmulator(clientDb, '127.0.0.1', 8085);
try {
  await auth.createUser({ uid: id, email, password });
  await db.collection('users').doc(id).set({ active: true, role: 'STAFF', branchId: 'synthetic-branch' });
  await db.collection('products').doc(id).set({ name: 'Synthetic emulator item', supplierId: 'synthetic-supplier', casePrice: 12.5 });
  await signInWithEmailAndPassword(clientAuth, email, password);
  const result = await getDoc(doc(clientDb, 'products', id));
  assert.equal(result.data()?.casePrice, 12.5);
  await assert.rejects(updateDoc(doc(clientDb, 'products', id), { casePrice: 1 }), error => (error as any).code === 'permission-denied');
  assert.equal((await db.collection('products').doc(id).get()).data()?.casePrice, 12.5);
  console.log('PASS: isolated HTOS Auth sign-in, Firestore read, denied staff price write, unchanged price.');
  // Mirror the first administrator's optional-branch profile, using synthetic data only.
  await db.collection('users').doc(id).set({ id, username: email, displayName: 'Synthetic Admin', role: 'CREATOR', active: true });
  const profile = doc(clientDb, 'users', id);
  assert.equal((await getDoc(profile)).data()?.role, 'CREATOR');
  await updateDoc(profile, { displayName: 'Renamed Synthetic Admin' });
  assert.equal((await getDoc(profile)).data()?.displayName, 'Renamed Synthetic Admin');
  for (const patch of [
    { role: 'GM' }, { active: false }, { branchId: 'other-branch' },
    { branchIds: ['other-branch'] }, { supplierIds: ['other-supplier'] },
    { allBranches: true }, { username: 'changed@example.invalid' },
    { role: deleteField() }, { displayName: '' },
  ]) {
    await assert.rejects(updateDoc(profile, patch), error => (error as any).code === 'permission-denied');
  }
  await db.collection('users').doc(id).update({ active: false });
  await assert.rejects(updateDoc(profile, { displayName: 'Inactive Change' }), error => (error as any).code === 'permission-denied');
  console.log('PASS: branchless administrator profile read/name update; role, status, scope and identity changes denied; inactive profile writes denied.');
} finally {
  await Promise.all([db.collection('users').doc(id).delete(), db.collection('products').doc(id).delete(), auth.deleteUser(id).catch(() => {})]);
  await terminate(clientDb);
  await deleteApp(app);
  await db.terminate();
}
