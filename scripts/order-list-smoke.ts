import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getAdmin} from '../api/firebase-admin.ts';
import handler from '../api/admin/order-action.ts';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9095');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.HTOS_MODE='emulator';process.env.FIREBASE_PROJECT_ID='demo-htos';
const {auth,db}=getAdmin(),id='archive-qa-'+randomUUID(),email=id+'@example.invalid',password=randomUUID();
let token='';
async function request(action:string,bearer=token){let status=200,value:any;const res:any={setHeader(){},status(n:number){status=n;return this;},json(data:any){value=data;return this;}};await handler({method:'POST',headers:bearer?{authorization:'Bearer '+bearer}:{},body:{action,orderId:id}} as any,res);return {status,value};}
const order={id,status:'CANCELLED',branchId:'qa-b',supplierId:'qa-s',orderedByUserId:id,createdAt:'2026-10-10',items:[{productId:'qa-p',caseQty:2,packQty:0,casePriceSnapshot:12}],manualItems:[],emailStatus:'SENT'};
try{
 await auth.createUser({uid:id,email,password});await db.collection('users').doc(id).set({id,username:email,displayName:'QA owner',role:'CREATOR',active:true});
 await db.collection('orders').doc(id).set(order);
 const login=await fetch('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-htos-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});token=(await login.json()).idToken;assert.ok(token);
 assert.equal((await request('archive','')).status,401);
 assert.equal((await request('archive')).status,200);
 const archived=(await db.collection('orders').doc(id).get()).data()!;
 assert.equal(archived.archived,true);assert.deepEqual(archived.items,order.items);assert.equal(archived.emailStatus,'SENT');assert.equal(archived.status,'CANCELLED');
 assert.equal((await request('archive')).status,200);
 assert.equal((await db.collection('_audit_logs').where('entityId','==',id).get()).size,1);
 assert.equal((await request('restore')).status,200);assert.equal((await db.collection('orders').doc(id).get()).data()?.archived,false);
 await db.collection('orders').doc(id).update({status:'PLACED'});assert.equal((await request('archive')).status,409);
 await db.collection('orders').doc(id).update({status:'DRAFT'});assert.equal((await request('archive')).status,409);
 await db.collection('orders').doc(id).update({status:'CANCELLED'});
 await db.collection('users').doc(id).update({role:'STAFF',branchId:'qa-b'});assert.equal((await request('archive')).status,403);
 await db.collection('users').doc(id).update({role:'MANAGER',branchId:'other'});assert.equal((await request('archive')).status,403);
 await db.collection('users').doc(id).update({branchId:'qa-b',allSuppliers:false,supplierIds:[]});assert.equal((await request('archive')).status,403);
 await db.collection('users').doc(id).update({allSuppliers:true,permissionMode:'CUSTOM',customPermissions:[]});assert.equal((await request('archive')).status,403);
 await db.collection('users').doc(id).update({customPermissions:['cancel_orders']});assert.equal((await request('archive')).status,200);
 await db.collection('users').doc(id).update({active:false});assert.equal((await request('restore')).status,403);
 console.log('PASS: reversible removal, original quantities/email retained, idempotent audit, placed/draft refusal, anonymous/staff/out-of-scope/restricted/inactive denial.');
}finally{
 for(const collection of ['users','orders'])await db.collection(collection).doc(id).delete();
 const events=await db.collection('_audit_logs').where('entityId','==',id).get();for(const event of events.docs)await event.ref.delete();
 await auth.deleteUser(id).catch(()=>{});await db.terminate();
}
