import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBusinessExport, importBatches, sameImportRecord, isImportOwner } from '../shared/business-import.ts';
import { runBusinessImport } from '../server/business-import-service.ts';

const order={id:'old-order',branchId:'old-branch',supplierId:'old-supplier',branchNameSnapshot:'Old branch',supplierNameSnapshot:'Old supplier',orderedByUserId:'original-author',orderedByNameSnapshot:'Original staff',createdAt:'2024-01-02T12:00:00Z',status:'PLACED',emailStatus:'SENT',emailTo:'supplier@example.invalid',items:[{productId:'p',productNameSnapshot:'Rice',caseQty:2,packQty:0,casePriceSnapshot:12,packPriceSnapshot:1.2,vatRate:.2,sentCaseQty:1}],invoiceVerification:{invoiceNumber:'INV-OLD',reviewStatus:'VERIFIED'},manualItems:[]};
function harness(profile:any={role:'CREATOR',active:true}) {
  const saved=new Map<string,any>();const writes:string[]=[];
  return {saved,writes,deps:{transaction:async(work:any)=>{
    const pending:any[]=[];
    const result=await work({profile:async()=>profile,get:async(c:string,id:string)=>saved.get(c+'/'+id),create:(c:string,r:any)=>pending.push([c,r])});
    for(const [c,r] of pending){saved.set(c+'/'+r.id,structuredClone(r));writes.push(c+'/'+r.id);}return result;
  }}};
}
test('configuration exports are accepted without inventing history or importing accounts',()=>{
  const data=parseBusinessExport({type:'configuration',data:{branches:[{id:'b',name:'Branch'}],users:[{id:'u',password:'secret'}],roles:[{id:'CREATOR'}],emailConfig:{smtpPass:'secret'}}});
  assert.equal(data.orders,undefined);assert.deepEqual(Object.keys(data),['branches']);
});
test('history preserves dates, actor, statuses, prices, delivery quantities and invoice facts',()=>{
  assert.deepEqual(parseBusinessExport({data:{orders:[order]}}).orders![0],order);
});

test('legacy uncategorised products survive parsing, preview, commit and retry unchanged',async()=>{
  for(const category of [{categoryId:''},{categoryId:null},{}]) {
    const product={id:'legacy-oil',name:'Legacy oil',supplierId:'supplier',active:true,casePrice:24.95,...category};
    const records=parseBusinessExport({data:{products:[product]}}).products!;
    assert.deepEqual(records,[product]);
    const h=harness();
    const input={collection:'products',records,action:'preview'};
    assert.equal((await runBusinessImport(input,'owner',h.deps)).newCount,1);
    assert.equal(h.writes.length,0);
    assert.equal((await runBusinessImport({...input,action:'commit'},'owner',h.deps)).created,1);
    assert.deepEqual(h.saved.get('products/legacy-oil'),product);
    assert.equal((await runBusinessImport({...input,action:'commit'},'owner',h.deps)).unchanged,1);
  }
});

test('legacy category compatibility still rejects invalid links and missing suppliers',()=>{
  const product={id:'p',name:'Oil',supplierId:'s',categoryId:''};
  for(const supplierId of ['',null,42,{}])assert.throws(()=>parseBusinessExport({products:[{...product,supplierId}]}),/supplier ID/);
  for(const categoryId of [42,{},[]])assert.throws(()=>parseBusinessExport({products:[{...product,categoryId}]}),/category ID/);
});
test('duplicate, traversal and malformed order data are rejected before import',()=>{
  assert.throws(()=>parseBusinessExport({branches:[{id:'b',name:'B'},{id:'b',name:'B'}]}),/Duplicate/);
  assert.throws(()=>parseBusinessExport({branches:[{id:'users/admin',name:'B'}]}),/invalid ID/);
  assert.throws(()=>parseBusinessExport({orders:[{...order,items:[{caseQty:-1,packQty:0}]}]}),/quantities/);
  assert.throws(()=>parseBusinessExport({orders:[{...order,status:'BROKEN'}]}),/status/);
  assert.throws(()=>parseBusinessExport(JSON.parse('{"branches":[{"id":"b","name":"B","__proto__":{"admin":true}}]}')),/Invalid record field/);
});
test('credential fields are excluded recursively without changing business facts',()=>{
  const data=parseBusinessExport({branches:[{id:'b',name:'B',password:'secret',contact:{smtpPass:'secret',name:'Manager'}}]});
  assert.deepEqual(data.branches![0],{id:'b',name:'B',contact:{name:'Manager'}});
});
test('batches are bounded and dependencies precede order history',()=>{
  const batches=importBatches({orders:[order],branches:Array.from({length:160},(_,i)=>({id:String(i),name:'Branch'}))});
  assert.deepEqual(batches.map(b=>[b.collection,b.records.length]),[['branches',75],['branches',75],['branches',10],['orders',1]]);
});
test('only an active workspace owner is eligible',()=>{
  assert.equal(isImportOwner({active:true,role:'CREATOR'}),true);
  for(const profile of [null,{active:false,role:'CREATOR'},{active:true,role:'GM'},{active:true,role:'STAFF'}])assert.equal(isImportOwner(profile),false);
});
test('preview never writes; commit and retry preserve immutable historic facts',async()=>{
  const h=harness();const input={collection:'orders',records:[order],action:'preview'};
  assert.equal((await runBusinessImport(input,'owner',h.deps)).newCount,1);assert.equal(h.writes.length,0);
  assert.equal((await runBusinessImport({...input,action:'commit'},'owner',h.deps)).created,1);
  assert.deepEqual(h.saved.get('orders/old-order'),order);
  assert.equal((await runBusinessImport({...input,action:'commit'},'owner',h.deps)).unchanged,1);assert.equal(h.writes.length,1);
});
test('one conflicting existing ID blocks every write in that batch',async()=>{
  const h=harness();h.saved.set('orders/old-order',{...order,comments:'New HTOS information'});
  const input={collection:'orders',records:[order,{...order,id:'another'}],action:'preview'};
  const plan=await runBusinessImport(input,'owner',h.deps);assert.deepEqual(plan.conflicts,['old-order']);assert.equal(h.writes.length,0);
  await assert.rejects(()=>runBusinessImport({...input,action:'commit'},'owner',h.deps),/Nothing in this batch/);
  assert.equal(h.writes.length,0);assert.equal(h.saved.get('orders/old-order').comments,'New HTOS information');
});
test('commit rechecks current owner status and rejects unapproved collections',async()=>{
  const h=harness({active:false,role:'CREATOR'});
  await assert.rejects(()=>runBusinessImport({action:'commit',collection:'orders',records:[order]},'owner',h.deps),/active HTOS workspace owner/);
  await assert.rejects(()=>runBusinessImport({action:'commit',collection:'users',records:[{id:'attacker'}]},'owner',h.deps),/Invalid import batch/);
  assert.equal(h.writes.length,0);
});
test('stable equality ignores key order but detects changed saved prices',()=>{
  assert.equal(sameImportRecord({id:'x',name:'A'},{name:'A',id:'x'}),true);
  assert.equal(sameImportRecord(order,{...order,items:[{...order.items[0],casePriceSnapshot:99}]}),false);
});
test('source connection uses server reads only and does not reuse operational Firebase configuration',()=>{
  const source=readFileSync(new URL('../app/htos/readOriginal.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(setDoc|updateDoc|deleteDoc|writeBatch|addDoc|runTransaction|setCustomUserClaims|createUserWithEmailAndPassword)\b/);
  assert.match(source,/getDocsFromServer/);assert.match(source,/inMemoryPersistence/);assert.match(source,/signOut\(sourceAuth\)/);assert.match(source,/deleteApp\(app\)/);
});
