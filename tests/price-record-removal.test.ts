import test from 'node:test';
import assert from 'node:assert/strict';
import {removePriceRecords} from '../server/price-record-removal-service.ts';
import {priceRecordFingerprint} from '../shared/price-record-removal.ts';
import {serviceReadiness} from '../server/service-readiness.ts';

const notice={id:'n',productId:'p',supplierId:'s',productName:'Rice',status:'PENDING',oldCasePrice:2,newCasePrice:3,oldPackPrice:1,newPackPrice:1,invoiceNumber:'INV',effectiveDate:'2026-10-30'};
const history={id:'h',productId:'p',supplierId:'s',newCasePrice:3,newPackPrice:1,invoiceRef:'INV',effectiveDate:'2026-10-30',source:'PRICE_NOTICE'};
function fixture(role='CREATOR',active=true) {
 const data=new Map<string,any>([['users/u',{role,active}],['price_change_notices/n',{...notice}],['price_history/h',{...history}],['products/p',{casePrice:3}],['orders/o',{status:'PLACED'}]]);
 const reads:string[]=[],writes:string[]=[];
 const ref=(path:string):any=>({path,id:path.split('/').at(-1)});
 const snap=(r:any)=>({exists:data.has(r.path),id:r.id,ref:r,data:()=>structuredClone(data.get(r.path))});
 const db:any={collection:(name:string)=>({doc:(id:string)=>ref(name+'/'+id),where:(field:string,_op:string,value:any)=>({query:name,field,value})}),runTransaction:async(fn:any)=>{
  const pending:any[]=[];
  const result=await fn({get:async(r:any)=>{reads.push(r.path||r.query);if(r.query)return {docs:[...data].filter(([k,v])=>k.startsWith(r.query+'/')&&v[r.field]===r.value).map(([k])=>snap(ref(k)))};return snap(r);},delete:(r:any)=>pending.push(['delete',r.path]),create:(r:any,v:any)=>pending.push(['create',r.path,v]),update:(r:any,v:any)=>pending.push(['update',r.path,v])});
  for(const [op,key,value] of pending){writes.push(key);if(op==='delete')data.delete(key);else data.set(key,op==='update'?{...data.get(key),...value}:value);}return result;
 }};
 const body=(kind='notices')=>({action:'price-record-delete',kind,requestId:'test-id',confirmation:'DELETE',rows:[{id:kind==='history'?'h':'n',expected:priceRecordFingerprint(kind==='history'?history:notice)}]});
 return {db,data,reads,writes,body};
}
test('owner permanently deletes a request without reading/writing products or orders',async()=>{const f=fixture();await removePriceRecords(f.db,'u',f.body());assert.equal(f.data.has('price_change_notices/n'),false);assert.deepEqual(f.data.get('products/p'),{casePrice:3});assert.deepEqual(f.data.get('orders/o'),{status:'PLACED'});assert.ok(!f.reads.some(p=>p.startsWith('products')||p.startsWith('orders')));});
for(const role of ['GM','MANAGER','STAFF',''])test(`${role||'missing role'} cannot delete`,async()=>{const f=fixture(role);await assert.rejects(removePriceRecords(f.db,'u',f.body()),/workspace owner/);assert.deepEqual(f.writes,[]);assert.deepEqual(f.reads,['users/u']);});
test('inactive owner cannot delete',async()=>{const f=fixture('CREATOR',false);await assert.rejects(removePriceRecords(f.db,'u',f.body()));assert.deepEqual(f.writes,[]);});
test('stale selection rejects atomically',async()=>{const f=fixture();f.data.get('price_change_notices/n').newCasePrice=5;await assert.rejects(removePriceRecords(f.db,'u',f.body()),/changed/);assert.deepEqual(f.writes,[]);});
test('missing selected record rejects without writes',async()=>{const f=fixture();f.data.delete('price_change_notices/n');await assert.rejects(removePriceRecords(f.db,'u',f.body()),/deleted/);assert.deepEqual(f.writes,[]);});
test('retry returns original result without repeating deletion',async()=>{const f=fixture(),body=f.body();const first=await removePriceRecords(f.db,'u',body),count=f.writes.length;assert.deepEqual(await removePriceRecords(f.db,'u',body),first);assert.equal(f.writes.length,count);});
test('request reference cannot be reused for different selection',async()=>{const f=fixture();await removePriceRecords(f.db,'u',f.body());await assert.rejects(removePriceRecords(f.db,'u',f.body('history')),/different selection/);});
test('history deletion preserves legacy activation evidence, not a hidden history copy',async()=>{const f=fixture();f.data.set('price_change_notices/n',{...notice,status:'APPROVED'});await removePriceRecords(f.db,'u',f.body('history'));assert.equal(f.data.has('price_history/h'),false);assert.ok(f.data.get('price_change_notices/n').activatedAt);assert.deepEqual(f.data.get('products/p'),{casePrice:3});assert.ok(!JSON.stringify(f.data.get('_price_record_operations/test-id')).includes('Rice'));});
test('unrelated or future scheduled notice is not marked applied',async()=>{const f=fixture();f.data.set('price_change_notices/n',{...notice,status:'APPROVED',effectiveDate:'2026-12-01'});await removePriceRecords(f.db,'u',f.body('history'));assert.equal(f.data.get('price_change_notices/n').activatedAt,undefined);});
test('deletes approved and rejected requests as well as pending',async()=>{for(const status of ['APPROVED','REJECTED']){const f=fixture();f.data.get('price_change_notices/n').status=status;const b=f.body();b.rows[0].expected=priceRecordFingerprint(f.data.get('price_change_notices/n'));await removePriceRecords(f.db,'u',b);assert.equal(f.data.has('price_change_notices/n'),false);}});
test('strict request limits and collection allowlist',async()=>{for(const change of [{kind:'orders'},{confirmation:''},{requestId:'../x'},{rows:[]},{rows:Array(201).fill({id:'n',expected:'x'})},{rows:[{id:'a/b',expected:'x'}]},{collection:'products'}]){const f=fixture();await assert.rejects(removePriceRecords(f.db,'u',{...f.body(),...change}));assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);}});
test('fingerprint ignores key ordering and undefined properties',()=>assert.equal(priceRecordFingerprint({a:1,b:2,missing:undefined}),priceRecordFingerprint({b:2,a:1})));
const cloud={HTOS_MODE:'cloud',FIREBASE_PROJECT_ID:'test-project',HTOS_CLOUD_PROJECT_ID:'test-project'};
test('status distinguishes switched off, key missing and configured; never exposes key',()=>{assert.equal(serviceReadiness(cloud).ocrStatus,'Switched off');assert.equal(serviceReadiness({...cloud,HTOS_ENABLE_OCR:'true'}).ocrStatus,'Key needed');const ready=serviceReadiness({...cloud,HTOS_ENABLE_OCR:'true',GEMINI_API_KEY:'sample-secret'});assert.equal(ready.ocr,true);assert.equal(ready.ocrStatus,'Configured');assert.ok(!JSON.stringify(ready).includes('sample-secret'));assert.match(ready.ocrDetail,/not been tested/);});
