import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getAdmin} from '../api/firebase-admin.ts';
import handler from '../api/admin/workspace.ts';
import prices from '../api/admin/price-change.ts';
import {productFingerprint} from '../shared/product-workbench.ts';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9095');assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.HTOS_MODE='emulator';process.env.FIREBASE_PROJECT_ID='demo-htos';
const {auth,db}=getAdmin(),id='workflow-'+randomUUID(),email=id+'@example.invalid',password=randomUUID();let token='';
async function request(body:any,price=false){let status=200,value:any;const res:any={setHeader(){},status(n:number){status=n;return this;},json(v:any){value=v;return this;}};await (price?prices:handler)({method:'POST',headers:{authorization:'Bearer '+token},body} as any,res);return {status,value};}
const product={id,name:'Test rice',supplierId:id,categoryId:id,displayOrder:1,allowedBranchIds:[],active:true,casePrice:10,packPrice:2};
const order={id,status:'PLACED',branchId:id,supplierId:id,createdAt:'2026-10-11',orderedByUserId:id,items:[{productId:id,productNameSnapshot:'Test rice',caseQty:10,packQty:0,casePriceSnapshot:10,packPriceSnapshot:2}],manualItems:[],receivedStatus:'NEW'};
try{
 await auth.createUser({uid:id,email,password});await db.collection('users').doc(id).set({id,displayName:'QA',role:'CREATOR',active:true,branchIds:[id]});
 await db.collection('suppliers').doc(id).set({id,name:'QA supplier',active:true,linkedBranchId:id});await db.collection('categories').doc(id).set({id,name:'QA category',supplierId:id,active:true});await db.collection('branches').doc(id).set({id,name:'QA branch',active:true,actsAsSupplier:true});await db.collection('products').doc(id).set(product);await db.collection('orders').doc(id).set(order);
 const login=await fetch('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-htos-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});token=(await login.json()).idToken;assert.ok(token);
 const bulk={action:'product-bulk',requestId:id,supplierId:id,rows:[{id,expected:productFingerprint(product),values:{name:'Renamed rice',casePrice:12}}],sequence:[id]};
 assert.equal((await request(bulk)).status,200);assert.equal((await request(bulk)).status,200);assert.equal((await request({...bulk,rows:[{...bulk.rows[0],values:{name:'Different payload'}}]})).status,400);
 let p=(await db.collection('products').doc(id).get()).data()!;assert.equal(p.name,'Renamed rice');assert.equal(p.casePrice,12);assert.equal(p.cataloguePosition,1);
 assert.equal((await db.collection('price_change_notices').where('supplierId','==',id).get()).size,0);
 assert.equal((await db.collection('price_history').where('supplierId','==',id).get()).size,1);
 // Owners apply prices once. A GM still proposes a change for owner review.
 await db.collection('users').doc(id).update({role:'GM'});
 const gmBulk={...bulk,requestId:id+'-gm',rows:[{id,expected:productFingerprint({...product,...p}),values:{casePrice:14}}]};
 assert.equal((await request(gmBulk)).status,200);
 assert.equal((await db.collection('products').doc(id).get()).data()?.casePrice,12);
 await db.collection('users').doc(id).update({role:'CREATOR'});
 const notices=await db.collection('price_change_notices').where('supplierId','==',id).get();assert.equal(notices.size,1);
 const approval={action:'APPROVE_NOTICE',supplierId:id,noticeId:notices.docs[0].id};
 let approved=await request(approval,true);assert.equal(approved.status,200,JSON.stringify(approved.value));assert.equal((await request(approval,true)).status,200);
 assert.equal((await db.collection('products').doc(id).get()).data()?.casePrice,14);assert.equal((await db.collection('price_history').where('supplierId','==',id).get()).size,2);
 const direct=await fetch('http://127.0.0.1:8085/v1/projects/demo-htos/databases/(default)/documents/products/'+id+'?updateMask.fieldPaths=casePrice',{method:'PATCH',headers:{'Content-Type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({fields:{casePrice:{doubleValue:99}}})});assert.equal(direct.status,403);
 assert.equal((await request({action:'APPLY_PRICE_UPDATE',supplierId:id,items:[{productId:id,newCasePrice:99}]},true)).status,400);
 const review={action:'invoice-review',orderId:id,expectedVersion:0,invoiceNumber:'QA-'+id,invoiceDate:'2026-10-11',lines:[{lineId:id,deliveredCaseQty:8,deliveredPackQty:0,invoicedCaseQty:10,invoicedPackQty:0,invoicedCasePrice:10,invoicedPackPrice:2,receiptConfirmed:true,isReviewed:true}]};
 const reviewed=await request(review);assert.equal(reviewed.status,200,JSON.stringify(reviewed.value));const saved=(await db.collection('orders').doc(id).get()).data()!;assert.deepEqual(saved.items,order.items);assert.equal(saved.receivedStatus,'NEW');assert.equal(saved.invoiceVerification.discrepancyTotal,20);assert.equal(saved.invoiceVerification.lines[0].expectedCasePrice,10);
 assert.equal((await request(review)).status,400);
 const corrected=await request({...review,expectedVersion:1,lines:[{...review.lines[0],deliveredCaseQty:10}]});assert.equal(corrected.status,200,JSON.stringify(corrected));assert.equal((await db.collection('orders').doc(id).get()).data()?.creditNoteClaim,null);
 const fulfillment={action:'fulfillment',orderId:id,updates:{items:[{...order.items[0],sentCaseQty:8,sentPackQty:0}],manualItems:[]}};
 const dispatched=await request(fulfillment);assert.equal(dispatched.status,200,JSON.stringify(dispatched));assert.equal((await db.collection('orders').doc(id).get()).data()?.fulfillmentStatus,'PARTIAL');
 assert.equal((await request(fulfillment)).status,400);
 const enc=(v:any):any=>Array.isArray(v)?{arrayValue:{values:v.map(enc)}}:v&&typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,enc(x)]))}}:typeof v==='number'?{doubleValue:v}:typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)};
 const patch=async(collection:string,doc:string,values:any)=>fetch('http://127.0.0.1:8085/v1/projects/demo-htos/databases/(default)/documents/'+collection+'/'+doc+'?'+Object.keys(values).map(k=>'updateMask.fieldPaths='+k).join('&'),{method:'PATCH',headers:{'Content-Type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({fields:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,enc(v)]))})});
 assert.equal((await patch('orders',id,{items:[{...order.items[0],casePriceSnapshot:1}]})).status,403);
 assert.equal((await patch('orders',id,{receivedStatus:'NEW'})).status,403);
 assert.equal((await patch('orders',id,{emailStatus:'FAILED',emailError:'Synthetic test'})).status,200);
 const proposal=await request({action:'PROPOSE_NOTICE',supplierId:id,noticeId:id+'-new',items:[{productId:id,newCasePrice:16,newPackPrice:2}]},true);assert.equal(proposal.status,200,JSON.stringify(proposal));
 assert.equal((await patch('price_change_notices',id+'-new',{status:'APPROVED',reviewedByUserId:id})).status,403);
 assert.equal((await patch('price_change_notices',id+'-new',{status:'REJECTED',reviewedByUserId:id,rejectionReason:'Test rejection'})).status,200);

 await db.collection('orders').doc(id+'-duplicate').set({...order,id:id+'-duplicate'});assert.equal((await request({...review,orderId:id+'-duplicate'})).status,400);
 await db.collection('users').doc(id).update({role:'MANAGER',branchId:'other'});assert.equal((await request({...review,expectedVersion:1})).status,400);
 await db.collection('users').doc(id).update({role:'MANAGER',branchId:id,permissionMode:'CUSTOM',customPermissions:[]});assert.equal((await request({...bulk,requestId:id+'2'})).status,400);assert.equal((await request(approval,true)).status,403);assert.equal((await patch('products',id,{name:'Unauthorized edit'})).status,403);assert.equal((await patch('orders',id,{emailStatus:'SENT'})).status,403);
 console.log('PASS: owner immediate prices, GM pending prices, idempotent approval/history, historical order pricing retained, separate invoice receipt, duplicate invoice and stale edit refusal, branch and custom permission checks.');
}finally{
 for(const collection of ['users','suppliers','categories','branches','products','orders','_product_operations','_audit_logs'])await db.collection(collection).doc(id).delete();await db.collection('orders').doc(id+'-duplicate').delete();
 await db.collection('_product_operations').doc(id+'-gm').delete();
 for(const collection of ['price_change_notices','price_history','_invoice_references']){const rows=await db.collection(collection).where('supplierId','==',id).get();for(const d of rows.docs)await d.ref.delete();}
 const events=await db.collection('_audit_logs').where('entityId','==',id).get();for(const d of events.docs)await d.ref.delete();await auth.deleteUser(id);await db.terminate();
}
