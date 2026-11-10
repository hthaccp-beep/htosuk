import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getAdmin} from '../api/firebase-admin.ts';
import {secureRead} from '../server/secure-read-service.ts';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
assert.equal(process.env.FIREBASE_PROJECT_ID,'demo-htos');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const {db}=getAdmin(),uid='page-'+randomUUID(),supplier=uid+'-s',branch=uid+'-b',refs:any[]=[];
const put=(batch:any,collection:string,id:string,data:any)=>{const ref=db.collection(collection).doc(id);refs.push(ref);batch.set(ref,data);};
try {
 let batch=db.batch();
 put(batch,'users',uid,{active:true,role:'STAFF',branchIds:[branch],supplierIds:[supplier],permissionMode:'CUSTOM',customPermissions:['view_order_history']});
 await batch.commit();
 for(const collection of ['products','orders']){
  for(let start=0;start<501;start+=250){
   batch=db.batch();
   for(let i=start;i<Math.min(start+250,501);i++)put(batch,collection,`${uid}-${String(i).padStart(3,'0')}`,{supplierId:supplier,branchId:branch,name:'Synthetic item',createdAt:'2026-10-19T12:00:00.000Z',casePrice:10,items:[{productId:'p',caseQty:1,casePriceSnapshot:10}]});
   await batch.commit();
  }
  const request={resource:collection,supplierId:supplier,...(collection==='orders'?{branchId:branch,start:'2026-10-01T00:00:00.000Z',end:'2026-10-31T23:59:59.999Z'}:{})};
  const first=await secureRead(db,uid,request),second=await secureRead(db,uid,{...request,cursor:first.cursor});
  assert.equal(first.records.length,500);assert.equal(second.records.length,1);assert.equal(second.cursor,null);
  assert.equal(new Set([...first.records,...second.records].map((r:any)=>r.id)).size,501);
  for(const row of [...first.records,...second.records]){assert.equal(row.casePrice,undefined);if(collection==='orders')assert.equal(row.items[0].casePriceSnapshot,undefined);}
  await assert.rejects(secureRead(db,uid,{...request,cursor:'invalid'}),/Invalid page reference/);
  console.log(`PASS: ${collection}: 501 records across pages without duplication, truncation or prices; invalid cursor rejected`);
 }
}finally{
 for(let start=0;start<refs.length;start+=250){const batch=db.batch();for(const ref of refs.slice(start,start+250))batch.delete(ref);await batch.commit();}
}
