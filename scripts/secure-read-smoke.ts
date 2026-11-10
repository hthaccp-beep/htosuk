import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getAdmin} from '../api/firebase-admin.ts';
import {secureRead} from '../server/secure-read-service.ts';
import {saveOrderEntry} from '../server/order-entry-service.ts';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
assert.equal(process.env.FIREBASE_PROJECT_ID,'demo-htos');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const {db}=getAdmin(),uid='secure-'+randomUUID(),supplier=uid+'-s',branch=uid+'-b',product=uid+'-p',orderId=uid+'-o',records:[string,string][]=[];
const seed=async(c:string,id:string,data:any)=>{records.push([c,id]);await db.collection(c).doc(id).set(data);};
const token=[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({iss:'https://securetoken.google.com/demo-htos',aud:'demo-htos',sub:uid,user_id:uid,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,firebase:{sign_in_provider:'custom'}})).toString('base64url'),''].join('.');
const read=async(c:string,id:string)=>fetch(`http://127.0.0.1:8085/v1/projects/demo-htos/databases/(default)/documents/${c}/${id}`,{headers:{authorization:'Bearer '+token}});
let passed=0;const check=(message:string)=>{passed++;console.log('PASS: '+message);};
try {
 await seed('users',uid,{id:uid,displayName:'Synthetic restricted staff',active:true,role:'STAFF',branchIds:[branch],supplierIds:[supplier],permissionMode:'CUSTOM',customPermissions:['create_orders','edit_drafts','submit_orders','view_order_history']});
 await seed('branches',branch,{name:'Synthetic branch',active:true,actsAsSupplier:true});
 await seed('suppliers',supplier,{name:'Synthetic supplier',active:true,allBranches:true,linkedBranchId:branch,deliveryRules:{default:[0,1,2,3,4,5,6]}});
 await seed('products',product,{id:product,name:'Synthetic rice',active:true,supplierId:supplier,casePrice:12,packPrice:2});
 await seed('price_history',product,{supplierId:supplier,oldPrice:10,newPrice:12});
 await seed('price_change_notices',product,{supplierId:supplier,oldCasePrice:10,newCasePrice:12});
 await seed('new_item_notices',product,{supplierId:supplier,casePrice:12});
 const now=new Date('2026-10-19T12:00:00Z');
 records.push(['orders',orderId]);
 const saved=await saveOrderEntry(db,uid,{mode:'create',order:{id:orderId,branchId:branch,supplierId:supplier,orderedByUserId:uid,createdAt:now.toISOString(),deliveryDate:'2026-10-21',status:'DRAFT',items:[{productId:product,productNameSnapshot:'Rice',caseQty:2,packQty:0,casePriceSnapshot:999}],manualItems:[],comments:''}},now);
 assert.equal(saved.order.items[0].casePriceSnapshot,undefined);assert.equal((await db.collection('orders').doc(orderId).get()).data()!.items[0].casePriceSnapshot,12);check('Restricted save captures real catalogue price on server; response omits it');
 const historical=JSON.stringify((await db.collection('orders').doc(orderId).get()).data());
 for(const collection of ['products','orders','price_history','price_change_notices','new_item_notices']){
  assert.equal((await read(collection,collection==='orders'?orderId:product)).status,403);check('Direct restricted read denied: '+collection);
 }
 const catalogue=await secureRead(db,uid,{resource:'products',supplierId:supplier});assert.equal(catalogue.records[0].name,'Synthetic rice');assert.equal(catalogue.records[0].casePrice,undefined);check('Ordering catalogue usable without price disclosure');
 const history=await secureRead(db,uid,{resource:'orders',branchId:branch,supplierId:supplier,start:'2026-10-01T00:00:00Z',end:'2026-10-31T23:59:59Z'});assert.equal(history.records.length,1);assert.equal(history.records[0].items[0].casePriceSnapshot,undefined);check('Date-filtered history redacted');
 assert.equal((await secureRead(db,uid,{resource:'orders',id:orderId})).records[0].items[0].caseQty,2);check('Individual order redacted');
 await assert.rejects(secureRead(db,uid,{resource:'products',supplierId:'unassigned'}),/outside/);
 await assert.rejects(secureRead(db,uid,{resource:'products'}),/outside/);
 await assert.rejects(secureRead(db,uid,{resource:'orders'}),/outside/);check('Unassigned and unscoped queries denied');
 await db.collection('users').doc(uid).update({customPermissions:['view_prices']});
 assert.equal((await read('products',product)).status,200);assert.equal((await secureRead(db,uid,{resource:'products',supplierId:supplier})).records[0].casePrice,12);check('Authorised prices retained');
 await db.collection('users').doc(uid).update({supplierIds:[]});assert.equal((await read('products',product)).status,403);await assert.rejects(secureRead(db,uid,{resource:'products',supplierId:supplier}),/outside/);check('Assignment revocation enforced');
 await db.collection('users').doc(uid).update({customPermissions:['view_received_orders']});
 assert.equal((await secureRead(db,uid,{resource:'orders',supplierId:supplier,incomingOnly:true})).records.length,1);
 await db.collection('users').doc(uid).update({branchIds:[]});await assert.rejects(secureRead(db,uid,{resource:'orders',supplierId:supplier,incomingOnly:true}),/outside/);check('Incoming supplying-branch assignment enforced');
 assert.equal(JSON.stringify((await db.collection('orders').doc(orderId).get()).data()),historical);check('Saved order unchanged throughout read checks');
 await db.collection('users').doc(uid).update({active:false});await assert.rejects(secureRead(db,uid,{resource:'products',supplierId:supplier}),/outside/);check('Inactive profile denied');
 console.log(`${passed} secure-read checks passed; production reads 0.`);
}finally {for(const [c,id]of records)await db.collection(c).doc(id).delete();}
