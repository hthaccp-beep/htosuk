import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, updateDoc, setDoc, deleteDoc, collection, where, terminate } from 'firebase/firestore';
import { getAdmin } from '../api/firebase-admin.ts';
import { outgoingOrderPartitions, linkedSupplierIds, type OrderScopeUser } from '../shared/order-scope.ts';
import { scopedOrderQuery } from '../utils/orderQueries.ts';

// Never create test accounts or business records in a cloud project.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9095');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.HTOS_MODE = 'emulator';
process.env.FIREBASE_PROJECT_ID = 'demo-htos';
const { db, auth } = getAdmin();
const prefix = 'scope-' + randomUUID();
const uid = prefix + '-user';
const email = uid + '@example.invalid';
const password = randomUUID();
const a = prefix + '-a', b = prefix + '-b', c = prefix + '-c';
const s1 = prefix + '-s1', s2 = prefix + '-s2', internal = prefix + '-internal';
const app = initializeApp({ projectId: 'demo-htos', apiKey: 'demo-htos-key' }, prefix);
const clientAuth = getAuth(app);
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9095', { disableWarnings: true });
const clientDb = getFirestore(app);
connectFirestoreEmulator(clientDb, '127.0.0.1', 8085);
const written: Array<{ collection: string; id: string }> = [];
const denied = (operation: Promise<unknown>) => assert.rejects(operation, error => (error as any).code === 'permission-denied');
const order = (id: string, branchId: string, supplierId: string) => ({ id, branchId, supplierId, orderedByUserId: uid,
  status: 'DRAFT', createdAt: '2026-10-01T12:00:00.000Z', items: [{ productId: 'synthetic', casePriceSnapshot: 12.5, caseQty: 1 }] });
async function seed(coll: string, id: string, data: object) {
  written.push({ collection: coll, id });
  await db.collection(coll).doc(id).set(data);
}
async function profile(patch: Partial<OrderScopeUser>) {
  const user = { id: uid, username: email, displayName: 'Synthetic Scope User', active: true, role: 'STAFF', ...patch };
  await db.collection('users').doc(uid).set(user);
  return user;
}
async function readPartitions(user: OrderScopeUser, history = false) {
  const snaps = await Promise.all(outgoingOrderPartitions(user).map(p => getDocsFromServer(scopedOrderQuery(clientDb, p,
    ...(history ? [where('createdAt', '>=', '2026-10-01'), where('createdAt', '<=', '2026-10-31')] : [])))));
  return [...new Set(snaps.flatMap(s => s.docs.map(d => d.id)))].sort();
}
try {
  await auth.createUser({ uid, email, password });
  written.push({ collection: 'users', id: uid });
  await seed('suppliers', s1, { id: s1 });
  await seed('suppliers', s2, { id: s2 });
  await seed('suppliers', internal, { id: internal, linkedBranchId: b });
  await seed('branches', b, { id: b, active: true, actsAsSupplier: true });
  const ids = ['a1', 'b1', 'c1', 'a2', 'incoming'].map(s => prefix + '-' + s);
  await seed('orders', ids[0], order(ids[0], a, s1));
  await seed('orders', ids[1], order(ids[1], b, s1));
  await seed('orders', ids[2], order(ids[2], c, s1));
  await seed('orders', ids[3], order(ids[3], a, s2));
  await seed('orders', ids[4], { ...order(ids[4], c, internal), status: 'PLACED' });
  await denied(getDocFromServer(doc(clientDb, 'orders', ids[0])));
  await signInWithEmailAndPassword(clientAuth, email, password);
  let user = await profile({ branchId: a, branchIds: [b], allSuppliers: false, supplierIds: [s1] });
  const expected = [ids[0], ids[1]].sort();
  assert.deepEqual(await readPartitions(user), expected);
  assert.deepEqual(await readPartitions(user, true), expected);
  await denied(getDocsFromServer(collection(clientDb, 'orders')));
  // Being the author does not bypass branch or supplier restrictions.
  for (const id of [ids[2], ids[3]]) {
    await denied(getDocFromServer(doc(clientDb, 'orders', id)));
    await denied(updateDoc(doc(clientDb, 'orders', id), { items: [] }));
    await denied(deleteDoc(doc(clientDb, 'orders', id)));
  }
  const created = prefix + '-created';
  written.push({ collection: 'orders', id: created });
  await denied(setDoc(doc(clientDb, 'orders', created), order(created, c, s1)));
  await denied(setDoc(doc(clientDb, 'orders', created), order(created, b, s2)));
  await denied(setDoc(doc(clientDb, 'orders', created), order(created, b, s1)));
  // Current order creation/editing is server-only; order-entry-smoke covers that workflow.
  await db.collection('orders').doc(created).set(order(created, b, s1));
  await denied(updateDoc(doc(clientDb, 'orders', created), { note: 'Client draft edit' }));
  await deleteDoc(doc(clientDb, 'orders', created));
  // Incoming fulfilment from an assigned secondary supplier branch.
  assert.deepEqual(linkedSupplierIds(user, [{ id: internal, linkedBranchId: b }]), [internal]);
  assert.deepEqual((await getDocsFromServer(scopedOrderQuery(clientDb, { supplierId: internal }))).docs.map(d => d.id), [ids[4]]);
  await denied(updateDoc(doc(clientDb, 'orders', ids[4]), { fulfillmentStatus: 'PARTIAL' })); // Dispatch must use the validated server workflow.
  user = await profile({ branchId: a, branchIds: [], supplierIds: [s1] });
  await denied(getDocFromServer(doc(clientDb, 'orders', ids[1])));
  await denied(getDocFromServer(doc(clientDb, 'orders', ids[4])));
  await denied(updateDoc(doc(clientDb, 'orders', ids[1]), { note: 'Revoked' }));
  // Explicit empty supplier selection never falls back to all suppliers.
  for (const scope of [{ allSuppliers: false }, { supplierIds: [] }]) {
    user = await profile({ branchId: a, ...scope });
    assert.deepEqual(outgoingOrderPartitions(user), []);
    await denied(getDocFromServer(doc(clientDb, 'orders', ids[0])));
    await denied(setDoc(doc(clientDb, 'orders', created), order(created, a, s1)));
  }
  user = await profile({ branchId: a });
  assert.deepEqual(await readPartitions(user), [ids[0], ids[3]].sort());
  user = await profile({ allBranches: true, supplierIds: [s1] });
  assert.deepEqual(await readPartitions(user), [ids[0], ids[1], ids[2]].sort());
  user = await profile({ branchIds: [a, b], allSuppliers: true });
  assert.deepEqual(await readPartitions(user), [ids[0], ids[1], ids[3]].sort());
  user = await profile({ active: false, role: 'CREATOR' });
  await denied(getDocsFromServer(collection(clientDb, 'orders')));
  user = await profile({ role: 'CREATOR' });
  assert.deepEqual(await readPartitions(user), ids.sort());
  assert.equal((await db.collection('orders').doc(ids.find(id => id.endsWith('-a2'))!).get()).data()?.items[0].casePriceSnapshot, 12.5);
  console.log('PASS: multi-branch live/history queries, selected/empty suppliers, legacy and global scopes, secondary-branch incoming orders, revocation, inactive/anonymous denial, client create/edit denial, scoped draft deletion and unchanged historical price.');
} finally {
  await Promise.all(written.map(ref => db.collection(ref.collection).doc(ref.id).delete()));
  await auth.deleteUser(uid).catch(() => {});
  await terminate(clientDb);
  await deleteApp(app);
  await db.terminate();
}
