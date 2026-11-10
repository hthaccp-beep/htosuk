import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getAdmin } from '../api/firebase-admin.ts';
import handler from '../api/admin/import-data.ts';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9095');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.HTOS_MODE='emulator';process.env.FIREBASE_PROJECT_ID='demo-htos';
const admin=getAdmin(),id='import-check-'+randomUUID(),email=id+'@example.invalid',password=randomUUID();
const app=initializeApp({projectId:'demo-htos',apiKey:'demo-htos-key'},id),auth=getAuth(app);
connectAuthEmulator(auth,'http://127.0.0.1:9095',{disableWarnings:true});
let token='';
async function call(body:any,authenticated=true){let status=0,payload:any;const response={setHeader(){},status(code:number){status=code;return this;},json(value:any){payload=value;return this;}};await handler({method:'POST',headers:authenticated?{authorization:'Bearer '+token}:{},body} as any,response as any);return {status,payload};}
const order={id,branchId:'old-b',supplierId:'old-s',branchNameSnapshot:'Original branch',supplierNameSnapshot:'Original supplier',orderedByUserId:'old-uid',orderedByNameSnapshot:'Original person',createdAt:'2023-04-01T12:00:00Z',status:'PLACED',items:[{productId:'old-p',caseQty:2,packQty:0,casePriceSnapshot:14}],manualItems:[]};
try{
  await admin.auth.createUser({uid:id,email,password});
  await admin.db.collection('users').doc(id).set({id,active:true,role:'STAFF'});
  const signed=await signInWithEmailAndPassword(auth,email,password);token=await signed.user.getIdToken();
  const input={action:'preview',collection:'orders',records:[order]};
  assert.equal((await call(input,false)).status,401);
  assert.equal((await call(input)).status,403);
  await admin.db.collection('users').doc(id).update({role:'CREATOR'});
  assert.equal((await call(input)).payload.newCount,1);
  assert.equal((await admin.db.collection('orders').doc(id).get()).exists,false);
  assert.equal((await call({...input,action:'commit'})).payload.created,1);
  assert.deepEqual((await admin.db.collection('orders').doc(id).get()).data(),order);
  assert.equal((await call({...input,action:'commit'})).payload.unchanged,1);
  const conflict=await call({...input,action:'commit',records:[{...order,id:id+'-new'},{...order,comments:'Overwrite attempt'}]});
  assert.equal(conflict.status,409);assert.equal((await admin.db.collection('orders').doc(id+'-new').get()).exists,false);
  assert.deepEqual((await admin.db.collection('orders').doc(id).get()).data(),order);
  await admin.db.collection('users').doc(id).update({active:false});
  assert.equal((await call({...input,action:'commit'})).status,403);
  console.log('PASS: import API authentication, owner gate, preview without writes, historic author/prices, idempotent retry, atomic conflict refusal and deactivation enforcement.');
}finally{
  await admin.db.collection('orders').doc(id).delete();await admin.db.collection('orders').doc(id+'-new').delete();
  await admin.db.collection('users').doc(id).delete();await admin.auth.deleteUser(id).catch(()=>{});
  await deleteApp(app);await admin.db.terminate();
}
