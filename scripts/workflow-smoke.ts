import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDocFromServer, deleteDoc, terminate } from 'firebase/firestore';
import { getAdmin } from '../api/firebase-admin.ts';
import { calculateOrderTotals } from '../utils/orderPricing.ts';
import {saveOrderEntry} from '../server/order-entry-service.ts';
import {saveFulfillment} from '../server/fulfillment-workflow-service.ts';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9095');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.HTOS_MODE = 'emulator';
process.env.FIREBASE_PROJECT_ID = 'demo-htos';
const admin = getAdmin();
const id = 'workflow-' + randomUUID(), email = id + '@example.invalid', password = randomUUID();
const app = initializeApp({ projectId: 'demo-htos', apiKey: 'demo-htos-key' }, id);
const auth = getAuth(app), db = getFirestore(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9095', { disableWarnings: true });
connectFirestoreEmulator(db, '127.0.0.1', 8085);
const collections = ['users', 'branches', 'suppliers', 'categories', 'products', 'orders'];
try {
  await admin.auth.createUser({ uid: id, email, password });
  await admin.db.collection('users').doc(id).set({ id, username: email, displayName: 'Synthetic Admin', active: true, role: 'CREATOR', branchIds:[id] });
  await signInWithEmailAndPassword(auth, email, password);
  for (const [collection, data] of Object.entries({
    branches: { id, name: 'Synthetic Branch', code: id, active: true, actsAsSupplier:true },
    suppliers: { id, name: 'Synthetic Supplier', active: true, allBranches:true, linkedBranchId:id, deliveryRules:{default:[0,1,2,3,4,5,6]} },
    categories: { id, name: 'Synthetic Category', supplierId: id },
    products: { id, name: 'Synthetic Item', supplierId: id, categoryId: id, casePrice: 12.5, packPrice: 2.5, active: true },
  })) await setDoc(doc(db, collection, id), data);
  const items = [{ productId: id, productNameSnapshot:'Synthetic Item', caseQty: 2, packQty: 1, casePriceSnapshot: 12.5, packPriceSnapshot: 2.5, vatRate: 0 }];
  const order = doc(db, 'orders', id);
  const now=new Date('2026-10-12T12:00:00Z');
  const saved=await saveOrderEntry(admin.db,id,{mode:'create',order:{ id, branchId: id, supplierId: id, orderedByUserId: id, status: 'DRAFT', createdAt: now.toISOString(),deliveryDate:'2026-10-14',comments:'',manualItems:[],
    branchNameSnapshot: 'Synthetic Branch', supplierNameSnapshot: 'Synthetic Supplier', orderedByNameSnapshot: 'Synthetic Admin', items }},now);
  const placed=await saveOrderEntry(admin.db,id,{mode:'edit',expectedRevision:1,order:{...saved.order,status:'PLACED'}},now);
  await assert.rejects(updateDoc(doc(db, 'products', id), { casePrice: 99 }), (error:any)=>error.code==='permission-denied');
  // Simulate a later approved price; product-invoice-smoke tests approval itself.
  await admin.db.collection('products').doc(id).update({casePrice:99});
  await saveFulfillment(admin.db,id,{orderId:id,updates:{items:placed.order.items.map((item:any)=>({...item,sentCaseQty:item.caseQty,sentPackQty:item.packQty})),manualItems:[]}});
  const persisted = (await getDocFromServer(order)).data()!;
  assert.equal(persisted.status, 'PLACED');
  assert.equal(persisted.receivedStatus, 'PROCESSED');
  assert.equal(calculateOrderTotals(persisted.items).grandTotal, 27.5);
  assert.equal((await getDocFromServer(doc(db, 'products', id))).data()?.casePrice, 99);
  await assert.rejects(deleteDoc(order), (error: any) => error.code === 'permission-denied');
  console.log('PASS: authenticated catalogue setup, draft, placement, receipt, immutable order-time prices and report totals; placed-order deletion refused.');
} finally {
  await Promise.all(collections.map(collection => admin.db.collection(collection).doc(id).delete()));
  await admin.auth.deleteUser(id).catch(() => {});
  await terminate(db);
  await deleteApp(app);
  await admin.db.terminate();
}
