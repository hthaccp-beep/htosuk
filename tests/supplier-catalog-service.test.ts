import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierCatalogImport} from '../server/supplier-catalog-service.ts';
import {saveProductWorkbench} from '../server/product-workbench-service.ts';
import {productFingerprint} from '../shared/product-workbench.ts';
import {generateProductCSV} from '../utils/csvHelpers.ts';
import {CatalogueValidationError} from '../shared/catalogue-errors.ts';

test('all independent file errors return together before any database reads or writes',async()=>{
 for(const action of ['catalog-preview','catalog-commit']){
  const f=fixture(),before=structuredClone(f.data);
  const csv='SystemID,ItemCode,Name,PriceBox,PriceUnit,Active,SupplierID,BranchScope,B\np,001,Rice,bad,-1,maybe,wrong,ALL,No\n,NEW,Noodles,bad,,TRUE,wrong,ALL,No';
  await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,action,mode:'catalogue',csv}),e=>e instanceof CatalogueValidationError&&e.issues.length===8&&e.stage==='file');
  assert.deepEqual(f.reads,[]);assert.deepEqual(f.data,before);
 }
});

test('every unmatched SystemID is reported and no valid row is partially saved',async()=>{
 for(const mode of ['catalogue','replace-catalogue'])for(const action of ['catalog-preview','catalog-commit']){
  const f=fixture(),before=structuredClone(f.data);
  const csv='SystemID,ItemCode,Name,Active,PriceBox\nunknown,NEW,Unknown,TRUE,12\nother,OTHER,Foreign,TRUE,12\np,001,Valid change,TRUE,12';
  await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,action,mode,removeMissing:mode==='replace-catalogue',csv}),e=>e instanceof CatalogueValidationError&&e.issues.length===2&&e.issues[0].row===2&&e.issues[1].row===3);
  assert.deepEqual(f.data,before);assert.equal(f.reads.some(r=>r.startsWith('orders')),false);
 }
});

test('two ambiguous code-only rows retain the existing explicit product-choice workflow',async()=>{
 const f=conflictingFixture(),body={...f.body,csv:'SystemID,ItemCode,Name,PriceBox\n,001,First,12\n,001,Second,13'};
 const conflicts:any=await supplierCatalogImport(f.db,'owner',body);
 assert.equal(conflicts.conflicts.length,2);
 const preview:any=await supplierCatalogImport(f.db,'owner',{...body,conflictExpected:conflicts.expected,conflictChoices:[{rowNumber:2,productId:'p'},{rowNumber:3,productId:'duplicate'}]});
 assert.equal(preview.updated,2);
});

test('add and update assigns IDs and supplier, preserves omissions and repeats coded rows without duplicates',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 const body={...f.body,mode:'catalogue',newProductDefaults:{branchScope:'ALL'},csv:'SystemID,ItemCode,Name,Category,Active,PriceBox,SupplierID\np,001,Updated rice,Food,TRUE,12,\n,NEW,New noodles,Food,TRUE,,'};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);
 assert.equal(preview.added,1);assert.equal(preview.updated,2);assert.equal(preview.removed,0); // Includes the retained product's normalised position.
 assert.deepEqual(f.data,before);
 const commit={...body,action:'catalog-commit',expected:preview.expected,reviewed:true};
 await supplierCatalogImport(f.db,'owner',commit);
 assert.equal(f.data.get('products/ci_test_1').supplierId,'s');
 assert.equal(f.data.get('products/ci_test_1').casePrice,undefined);
 assert.equal(f.data.get('products/missing').active,true);
 const saved=structuredClone(f.data);
 await supplierCatalogImport(f.db,'owner',commit);assert.deepEqual(f.data,saved);
 const repeated:any=await supplierCatalogImport(f.db,'owner',{...body,requestId:'repeat'});
 assert.equal(repeated.added,0);assert.equal(repeated.updated,0);assert.equal(repeated.unchanged,2);
 assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
 assert.deepEqual(f.data.get('products/other'),before.get('products/other'));
 assert.equal(f.reads.some(path=>path.startsWith('orders')),false);
});

test('uncoded new items get IDs with unknown-price warning; repeat requires their saved IDs',async()=>{
 const f=fixture(),body={...f.body,mode:'catalogue',newProductDefaults:{branchScope:'ALL'},csv:'SystemID,ItemCode,Name,Category,Active,SupplierID\n,,Special noodles,Food,TRUE,'};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);
 assert.equal(preview.added,1);assert.ok(preview.details.find((d:any)=>d.action==='Add').flags.some((s:string)=>s.includes('Prices not supplied')));
 const commit={...body,action:'catalog-commit',expected:preview.expected,reviewed:true};
 await supplierCatalogImport(f.db,'owner',commit);
 const saved=structuredClone(f.data);
 await supplierCatalogImport(f.db,'owner',commit);assert.deepEqual(f.data,saved);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,requestId:'repeat'}),/already exists.*SystemID/);
 assert.deepEqual(f.data,saved);
 const exported=generateProductCSV([...f.data].filter(([k,p])=>k.startsWith('products/')&&p.supplierId==='s').map(([k,p])=>({...p,id:k.split('/')[1]})),[{...f.data.get('categories/c'),id:'c'}],[{...f.data.get('branches/b'),id:'b'}]);
 const roundtrip:any=await supplierCatalogImport(f.db,'owner',{...body,requestId:'roundtrip',csv:exported});
 assert.equal(roundtrip.added,0);assert.equal(roundtrip.updated,0);assert.equal(roundtrip.unchanged,3);
});

test('code matching includes inactive products and only reactivates on explicit Active value',async()=>{
 const f=fixture();f.data.get('products/p').active=false;
 const body={...f.body,mode:'catalogue',csv:'SystemID,ItemCode,Name,SupplierID\n,001,Updated inactive rice,'};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);
 assert.equal(preview.added,0);assert.equal(preview.details[0].id,'p');assert.equal(preview.details[0].after.active,false);
 await supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected,reviewed:true});
 assert.equal(f.data.get('products/p').active,false);
 const activate={...body,requestId:'activate',csv:'SystemID,ItemCode,Active,SupplierID\n,001,TRUE,'};
 const next:any=await supplierCatalogImport(f.db,'owner',activate);
 assert.equal(next.details[0].before.active,false);assert.equal(next.details[0].after.active,true);
 await supplierCatalogImport(f.db,'owner',{...activate,action:'catalog-commit',expected:next.expected,reviewed:true});
 assert.equal(f.data.get('products/p').active,true);
});

test('complete active and inactive export reimports unchanged including unknown and zero prices',async()=>{
 const f=fixture();f.data.set('products/inactive',{...f.data.get('products/p'),name:'Inactive rice',itemCode:'INACTIVE',active:false,casePrice:0,packPrice:undefined});
 const products=[...f.data].filter(([k])=>k.startsWith('products/')&&f.data.get(k).supplierId==='s').map(([k,p])=>({...p,id:k.split('/')[1],displayOrder:p.displayOrder??0,allowedBranchIds:p.allowedBranchIds??[]}));
 for(const p of products)f.data.set('products/'+p.id,p);
 const csv=generateProductCSV(products,[{...f.data.get('categories/c'),id:'c'}],[{...f.data.get('branches/b'),id:'b'}]);
 const before=structuredClone(f.data),response:any=await supplierCatalogImport(f.db,'owner',{...f.body,mode:'catalogue',csv});
 assert.equal(response.unchanged,3);assert.equal(response.updated,0);assert.equal(response.added,0);assert.equal(response.removed,0);assert.deepEqual(f.data,before);
});

test('duplicate input identities, uncoded names and foreign IDs fail without changes',async()=>{
 for(const csv of ['SystemID,ItemCode,Name\np,001,Rice\n,001,Other pack','SystemID,ItemCode,Name\n,,New food\n,,New food','SystemID,ItemCode,Name\n,,Rice','SystemID,ItemCode,Name,SupplierID\nother,,Foreign,']){
  const f=fixture(),before=structuredClone(f.data);
  await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,mode:'catalogue',csv}));assert.deepEqual(f.data,before);
 }
});

test('wrong supplier CSV is rejected before any database reads',async()=>{
 const f=fixture();
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,csv:'SystemID,ItemCode,Name,SupplierID\n,new,New product,wrong'}),/SupplierID does not match/);
 assert.equal(f.reads.length,0);
});

test('legacy uncategorised preview makes no product/category changes or historical writes',async()=>{
 const f=fixture();delete f.data.get('products/p').categoryId;
 const before=structuredClone(f.data);
 const response:any=await supplierCatalogImport(f.db,'owner',{...f.body,csv:'SystemID,Category\np,Uncategorized'});
 assert.equal(response.updated,0);assert.equal(response.unchanged,1);assert.deepEqual(response.details,[]);
 assert.deepEqual(f.data,before);assert.equal(f.reads.some(path=>path.startsWith('orders')),false);
});

test('new category names are available in preview before any records are saved',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 const response:any=await supplierCatalogImport(f.db,'owner',{...f.body,csv:'SystemID,Category\np,Frozen food'});
 assert.deepEqual(response.details[0].categoryLabels,{before:'Food',after:'Frozen food'});
 assert.deepEqual(f.data,before);
 await supplierCatalogImport(f.db,'owner',{...f.body,csv:'SystemID,Category\np,Frozen food',action:'catalog-commit',expected:response.expected});
 assert.equal(f.data.get('categories/'+f.data.get('products/p').categoryId).name,'Frozen food');
 assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
});

test('single-screen supplier review includes a fresh product fingerprint and exact reviewed values',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 const response:any=await supplierCatalogImport(f.db,'owner',{...f.body,mode:'supplier-file',csv:'SystemID,Name,PriceBox\np,Rice renamed,12'});
 assert.equal(response.matchedItems[0].fingerprint,productFingerprint({...f.data.get('products/p'),id:'p'}));
 assert.equal(response.details[0].before.name,f.data.get('products/p').name);
 assert.equal(response.details[0].after.name,'Rice renamed');assert.equal(response.details[0].after.casePrice,12);
 assert.deepEqual(f.data,before);
});

function conflictingFixture(){
 const f=fixture();
 f.data.set('products/duplicate',{...f.data.get('products/p'),name:'Rice alternative',packSize:'10kg',casePrice:25,active:false});
 return {...f,body:{...f.body,mode:'catalogue',csv:'SystemID,ItemCode,Name,PackSize,PriceBox\np,001,Updated rice,20kg,12'}};
}
async function chooseConflict(f:ReturnType<typeof conflictingFixture>,productId='p'){
 const conflict:any=await supplierCatalogImport(f.db,'owner',f.body);
 assert.equal(conflict.status,'conflicts');
 const body={...f.body,conflictChoices:[{rowNumber:2,productId}],conflictExpected:conflict.expected};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);
 return {...body,action:'catalog-commit',expected:preview.expected,reviewed:true};
}

test('CSV conflicts show saved ID and code candidates without writes or other-supplier products',async()=>{
 const f=conflictingFixture(),before=structuredClone(f.data);
 const result:any=await supplierCatalogImport(f.db,'owner',f.body);
 assert.equal(result.status,'conflicts');assert.equal(result.conflicts.length,1);
 assert.deepEqual(result.conflicts[0].candidates.map((p:any)=>p.id),['p','duplicate']);
 assert.equal(result.conflicts[0].candidates[1].active,false);
 assert.equal(result.conflicts[0].candidates[1].casePrice,25);
 assert.deepEqual(f.data,before);
 assert.equal(f.reads.filter(r=>r==='products').length,1);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:result.expected}),/Choose the correct product/);
 assert.deepEqual(f.data,before);
});

test('choosing either duplicate updates only that product; full catalogue keeps conflicting records and past orders',async()=>{
 for(const selected of ['p','duplicate']){
  const f=conflictingFixture(),untouched=selected==='p'?'duplicate':'p';
  const otherBefore=structuredClone(f.data.get(`products/${untouched}`)),history=structuredClone(f.data.get('orders/history'));
  const body=await chooseConflict(f,selected);
  const result:any=await supplierCatalogImport(f.db,'owner',{...body,removeMissing:true});
  assert.equal(result.pricesApplied,1);assert.equal(result.removed,1);
  assert.equal(f.data.get(`products/${selected}`).casePrice,12);
  assert.equal(f.data.get(`products/${selected}`).name,'Updated rice');
  assert.equal(f.data.get(`products/${selected}`).packSize,'20kg');
  assert.equal(f.data.get(`products/${selected}`).itemCode,'001');
  assert.equal(f.data.get(`products/${selected}`).active,selected==='p');
  assert.deepEqual(f.data.get(`products/${untouched}`),otherBefore);
  assert.deepEqual(f.data.get('orders/history'),history);
  assert.equal(f.data.get('_audit_logs/ci_test').details.productChoices[0].productId,selected);
 }
});

test('ID/code disagreement keeps the chosen existing code instead of transferring it',async()=>{
 for(const selected of ['p','duplicate']){
  const f=conflictingFixture();f.data.get('products/p').itemCode='OLD';
  const body=await chooseConflict(f,selected);
  await supplierCatalogImport(f.db,'owner',body);
  assert.equal(f.data.get('products/p').itemCode,'OLD');assert.equal(f.data.get('products/duplicate').itemCode,'001');
  assert.equal(f.data.get(`products/${selected}`).casePrice,12);
 }
});

test('ambiguous code without SystemID can be resolved, but foreign or unknown IDs cannot',async()=>{
 const f=conflictingFixture();f.body.csv='ItemCode,Name,PriceBox\n001,Rice chosen,12';
 const body=await chooseConflict(f,'duplicate');await supplierCatalogImport(f.db,'owner',body);
 assert.equal(f.data.get('products/duplicate').name,'Rice chosen');
 for(const id of ['other','unknown']){
  const g=conflictingFixture(),before=structuredClone(g.data);
  await assert.rejects(supplierCatalogImport(g.db,'owner',{...g.body,csv:`SystemID,ItemCode,PriceBox\n${id},001,12`}),/SystemID does not belong/);
  assert.deepEqual(g.data,before);
 }
});

test('conflict choices cannot target arbitrary products or stale catalogue versions',async()=>{
 for(const productId of ['other','missing','unknown']){
  const f=conflictingFixture(),before=structuredClone(f.data),conflict:any=await supplierCatalogImport(f.db,'owner',f.body);
  await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,conflictExpected:conflict.expected,conflictChoices:[{rowNumber:2,productId}]}),/choose one of/);
  assert.deepEqual(f.data,before);
 }
 const f=conflictingFixture(),body=await chooseConflict(f);f.data.get('products/duplicate').packSize='Changed';
 const before=structuredClone(f.data);await assert.rejects(supplierCatalogImport(f.db,'owner',body),/changed after the product comparison/);assert.deepEqual(f.data,before);
});

test('malformed choices are rejected before reads; changing a saved choice cannot reuse its receipt',async()=>{
 for(const choices of [null,{},[{rowNumber:1,productId:'p'}],[{rowNumber:2,productId:'p'},{rowNumber:2,productId:'duplicate'}],[{rowNumber:2,productId:'p',allow:true}]]){
  const f=conflictingFixture();await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,conflictChoices:choices}));assert.deepEqual(f.reads,[]);
 }
 const f=conflictingFixture(),body=await chooseConflict(f),before=structuredClone(f.data);f.fail();
 await assert.rejects(supplierCatalogImport(f.db,'owner',body),/Connection failed/);assert.deepEqual(f.data,before);
 const result=await supplierCatalogImport(f.db,'owner',body),after=structuredClone(f.data);f.reads.length=0;
 assert.deepEqual(await supplierCatalogImport(f.db,'owner',body),result);assert.deepEqual(f.data,after);
 assert.deepEqual(f.reads,['users/owner','settings/role_permissions','_product_operations/ci_test']);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,conflictChoices:[{rowNumber:2,productId:'duplicate'}]}),/already been used/);
 assert.deepEqual(f.data,after);
});

test('choosing a product twice fails safely; choosing two existing duplicates separately is explicit',async()=>{
 const f=conflictingFixture();f.body.csv+='\nduplicate,001,Second row,10kg,26';
 const conflict:any=await supplierCatalogImport(f.db,'owner',f.body),before=structuredClone(f.data);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,conflictExpected:conflict.expected,conflictChoices:[{rowNumber:2,productId:'p'},{rowNumber:3,productId:'p'}]}),/appears more than once/);
 assert.deepEqual(f.data,before);
 const preview:any=await supplierCatalogImport(f.db,'owner',{...f.body,conflictExpected:conflict.expected,conflictChoices:[{rowNumber:2,productId:'p'},{rowNumber:3,productId:'duplicate'}]});
 assert.equal(preview.updated,2);assert.deepEqual(f.data,before);
});

test('CSV choices preserve approval permissions and cannot bypass the bulk code rule',async()=>{
 const f=conflictingFixture();f.data.set('users/owner',{role:'GM',active:true});const body=await chooseConflict(f);
 const result:any=await supplierCatalogImport(f.db,'owner',body);assert.equal(result.proposed,1);assert.equal(result.pricesApplied,0);assert.equal(f.data.get('products/p').casePrice,10);
 const g=conflictingFixture(),p={...g.data.get('products/p'),id:'p'};g.data.get('products/duplicate').active=true;
 await assert.rejects(saveProductWorkbench(g.db,'owner',{supplierId:'s',requestId:'strict',keepExistingDuplicateCodes:true,rows:[{id:'p',expected:productFingerprint(p),values:{name:'Changed'}}]}),/Duplicate supplier code/);
 g.data.set('users/owner',{role:'STAFF',active:true});g.reads.length=0;
 await assert.rejects(supplierCatalogImport(g.db,'owner',g.body),/cannot import/);
 assert.deepEqual(g.reads,['users/owner','settings/role_permissions']);
});

test('quota failure uses one read-only preview or one commit attempt, without reading the catalogue',async()=>{
 for(const action of ['catalog-preview','catalog-commit']){
  let attempts=0;const reads:string[]=[];const quota=Object.assign(new Error('Quota exceeded'),{code:8});
  const db={collection:(name:string)=>({doc:(id:string)=>({path:`${name}/${id}`})}),runTransaction:async(fn:any,options:any)=>{
   assert.deepEqual(options,action==='catalog-preview'?{readOnly:true}:{maxAttempts:1});
   attempts++;return fn({get:async(ref:any)=>{reads.push(ref.path);throw quota;}});
  }};
  await assert.rejects(supplierCatalogImport(db,'owner',{action,supplierId:'s',requestId:'quota-test',removeMissing:false,csv:'SystemID,PriceBox\np,10'}),e=>e===quota);
  assert.equal(attempts,1);assert.deepEqual(reads,['users/owner','settings/role_permissions']);
 }
});

function fixture(){
 const data=new Map<string,any>(Object.entries({
  'users/owner':{role:'CREATOR',active:true,displayName:'Owner'},
  'settings/role_permissions':{map:{}},'suppliers/s':{name:'Supplier',active:true},
  'categories/c':{name:'Food',supplierId:'s',active:true,displayOrder:1},
  'branches/b':{name:'Branch',code:'B',active:true},
  'products/p':{supplierId:'s',name:'Rice',itemCode:'001',categoryId:'c',active:true,casePrice:10,packPrice:2,displayOrder:1,allowedBranchIds:[]},
  'products/missing':{supplierId:'s',name:'Old item',itemCode:'002',categoryId:'c',active:true},
  'products/other':{supplierId:'other',name:'Other supplier item',itemCode:'001',active:true},
  'orders/history':{items:[{productId:'missing',productNameSnapshot:'Old item',casePriceSnapshot:5}]}
 }));
 const reads:string[]=[];
 const snapshot=(path:string)=>({id:path.split('/')[1],exists:data.has(path),data:()=>structuredClone(data.get(path))});
 let fail=false;
 const db={collection:(name:string)=>({doc:(id:string)=>({path:`${name}/${id}`}),where:(key:string,op:string,value:string)=>({name,key,value}),name}),runTransaction:async(fn:any)=>{
  const writes:any[]=[];
  const result=await fn({get:async(ref:any)=>{reads.push(ref.path||ref.name);if(ref.path)return snapshot(ref.path);return {docs:[...data.keys()].filter(p=>p.startsWith(ref.name+'/')&&(!ref.key||data.get(p)[ref.key]===ref.value)).map(snapshot)};},create:(ref:any,value:any)=>writes.push({kind:'create',path:ref.path,value}),update:(ref:any,value:any)=>writes.push({kind:'update',path:ref.path,value})});
  if(fail){fail=false;throw new Error('Connection failed');}
  for(const w of writes){if(w.kind==='create'&&data.has(w.path))throw new Error('Duplicate create');}
  for(const w of writes)data.set(w.path,w.kind==='update'?{...data.get(w.path),...structuredClone(w.value)}:structuredClone(w.value));
  return result;
 }};
 const body={action:'catalog-preview',supplierId:'s',requestId:'test',removeMissing:false,csv:'SystemID,ItemCode,Name,PackSize,PriceBox,DisplayOrder\np,001,Brown rice,20kg,12,7\n,003,New noodles,6x2kg,15,8'};
 return {data,reads,db,body,fail:()=>{fail=true;}};
}

function replacementBody(f:ReturnType<typeof fixture>){return {...f.body,mode:'replace-catalogue',newProductDefaults:{categoryId:'c',branchScope:'ALL'},removeMissing:true,csv:'SystemID,ItemCode,Name,Active,PriceBox,PackSize\np,001,New rice name,TRUE,12,20kg\n,003,New noodles,TRUE,15,6x2kg'};}

test('replacement uses explicit IDs, retires omitted duplicates and updates owner prices without changing orders',async()=>{
 const f=conflictingFixture();f.data.get('products/duplicate').active=true;
 const body=replacementBody(f),before=structuredClone(f.data);
 const preview:any=await supplierCatalogImport(f.db,'owner',body);
 assert.notEqual(preview.status,'conflicts');assert.equal(preview.added,1);assert.equal(preview.updated,1);assert.equal(preview.removed,2);
 assert.deepEqual(f.data,before);assert.equal(f.reads.filter(r=>r==='products').length,1);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected}),/price warnings/);
 const result=await supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected,reviewed:true});
 assert.equal(result.pricesApplied,1);assert.equal(f.data.get('products/p').casePrice,12);assert.equal(f.data.get('products/p').packSize,'20kg');assert.equal(f.data.get('products/p').name,'New rice name');
 assert.equal(f.data.get('products/duplicate').active,false);assert.equal(f.data.get('products/missing').active,false);
 assert.equal(f.data.get('products/ci_test_1').itemCode,'003');assert.equal(f.data.has('price_change_notices/pcn_ci_test_p'),false);
 assert.deepEqual(f.data.get('products/other'),before.get('products/other'));assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
});

test('replacement can create an entirely new list using old supplier codes; failure and retry are atomic and idempotent',async()=>{
 const f=conflictingFixture(),body={...replacementBody(f),csv:'SystemID,ItemCode,Name,Active,PriceBox\n,001,Replacement rice,TRUE,20'},before=structuredClone(f.data);
 const preview:any=await supplierCatalogImport(f.db,'owner',body);assert.equal(preview.added,1);assert.equal(preview.updated,0);
 const commit={...body,action:'catalog-commit',expected:preview.expected,reviewed:true};
 f.fail();await assert.rejects(supplierCatalogImport(f.db,'owner',commit),/Connection failed/);assert.deepEqual(f.data,before);
 const result=await supplierCatalogImport(f.db,'owner',commit),saved=structuredClone(f.data);
 assert.equal(f.data.get('products/p').active,false);assert.equal(f.data.get('products/ci_test_1').active,true);
 assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));f.reads.length=0;
 assert.deepEqual(await supplierCatalogImport(f.db,'owner',commit),result);assert.deepEqual(f.data,saved);
 assert.deepEqual(f.reads,['users/owner','settings/role_permissions','_product_operations/ci_test']);
});

test('replacement rejects partial, duplicate and invalid files before database reads',async()=>{
 for(const csv of ['SystemID,PriceBox\np,12','SystemID,ItemCode,Name,Active\np,001,Rice,','SystemID,ItemCode,Name,Active\np,001,Rice,TRUE\np,002,Duplicate,TRUE','SystemID,ItemCode,Name,Active\np,001,Rice,TRUE\n,001,Duplicate,FALSE','SystemID,ItemCode,Name,Active\n,,,TRUE']){
  const f=fixture(),before=structuredClone(f.data);await assert.rejects(supplierCatalogImport(f.db,'owner',{...replacementBody(f),csv}));assert.deepEqual(f.reads,[]);assert.deepEqual(f.data,before);
 }
});

test('replacement rejects unknown or foreign IDs and never redirects them by code',async()=>{
 for(const id of ['unknown','other']){const f=fixture(),before=structuredClone(f.data);await assert.rejects(supplierCatalogImport(f.db,'owner',{...replacementBody(f),csv:`SystemID,ItemCode,Name,Active\n${id},001,Rice,TRUE`}),/SystemID does not belong/);assert.deepEqual(f.data,before);}
});

test('2027 rows without codes create distinct IDs, preserve details and history, and retry once',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 const body={...replacementBody(f),csv:'SystemID,ItemCode,Name,Active,PriceBox,PriceUnit,PackSize,ChineseName,VATRate,UnitType,CataloguePosition\n,,Gyoza,TRUE,12,,6x1kg,餃子,0.2,CASE_ONLY,1\n,,Gyoza,TRUE,20,2,10x1kg,餃子,0.2,DUAL,2'};
 const review:any=await supplierCatalogImport(f.db,'owner',body);
 assert.equal(review.added,2);assert.equal(review.updated,0);
 assert.deepEqual(review.details.map((d:any)=>d.rowNumber),[2,3]);
 assert.ok(review.details.every((d:any)=>d.flags.some((flag:string)=>flag.includes('No supplier code'))));
 assert.deepEqual(f.data,before);
 const commit={...body,action:'catalog-commit',expected:review.expected,reviewed:true};
 await supplierCatalogImport(f.db,'owner',commit);
 const first=f.data.get('products/ci_test_1'),second=f.data.get('products/ci_test_2');
 assert.equal(first.itemCode,'');assert.equal(first.casePrice,12);assert.equal(first.packPrice,undefined);
 assert.equal(first.chineseName,'餃子');assert.equal(first.vatRate,.2);assert.equal(first.unitType,'CASE_ONLY');assert.equal(first.cataloguePosition,1);
 assert.equal(second.casePrice,20);assert.equal(second.packSize,'10x1kg');
 assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
 const saved=structuredClone(f.data);await supplierCatalogImport(f.db,'owner',commit);assert.deepEqual(f.data,saved);
});

test('replacement requires current owner access and rejects concurrent changes before writing',async()=>{
 const f=fixture(),body=replacementBody(f),preview:any=await supplierCatalogImport(f.db,'owner',body);
 f.data.set('users/owner',{role:'GM',active:true});f.reads.length=0;
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected,reviewed:true}),/Only the workspace owner/);
 assert.deepEqual(f.reads,['users/owner','settings/role_permissions']);
 f.data.set('users/owner',{role:'CREATOR',active:true});f.data.get('products/missing').name='Changed elsewhere';const before=structuredClone(f.data);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected,reviewed:true}),/changed after/);assert.deepEqual(f.data,before);
});

test('retired duplicate codes do not block normal bulk edits, but cannot be reactivated alongside an active duplicate',async()=>{
 const f=conflictingFixture(),p={...f.data.get('products/p'),id:'p'};
 await saveProductWorkbench(f.db,'owner',{supplierId:'s',requestId:'after-replace',rows:[{id:'p',expected:productFingerprint(p),values:{name:'Edited rice'}}]});
 assert.equal(f.data.get('products/p').name,'Edited rice');
 const retired={...f.data.get('products/duplicate'),id:'duplicate'};
 await assert.rejects(saveProductWorkbench(f.db,'owner',{supplierId:'s',requestId:'reactivate',rows:[{id:'duplicate',expected:productFingerprint(retired),values:{active:true}}]}),/Duplicate supplier code/);
 assert.equal(f.data.get('products/duplicate').active,false);
});

test('invalid CSV consumes no database reads',async()=>{
 for(const csv of ['','Bad,Headings\na,b','SystemID,PriceBox\np,1,unexpected', 'SystemID,PriceBox\n'+Array.from({length:241},(_,i)=>`p${i},10`).join('\n')]){
  const f=fixture();await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,csv}));assert.deepEqual(f.reads,[]);
 }
});

test('repeated bulk confirmation and unauthorised saves avoid catalogue reads',async()=>{
 const f=fixture(),p={...f.data.get('products/p'),id:'p'};
 const body={supplierId:'s',requestId:'budget-test',rows:[{id:'p',expected:productFingerprint(p),values:{casePrice:12}}]};
 await saveProductWorkbench(f.db,'owner',body);f.reads.length=0;
 await saveProductWorkbench(f.db,'owner',body);
 assert.deepEqual(f.reads,['users/owner','settings/role_permissions','_product_operations/budget-test']);
 f.data.set('users/owner',{role:'CREATOR',active:false});f.reads.length=0;
 await assert.rejects(saveProductWorkbench(f.db,'owner',body),/not available/);
 assert.deepEqual(f.reads,['users/owner','settings/role_permissions']);
});

test('bulk quota failure has one attempt and stops before catalogue queries',async()=>{
 const reads:string[]=[];
 const db={collection:(name:string)=>({doc:(id:string)=>({path:`${name}/${id}`})}),runTransaction:async(fn:any,options:any)=>{assert.deepEqual(options,{maxAttempts:1});return fn({get:async(ref:any)=>{reads.push(ref.path);throw Object.assign(new Error('Quota'),{code:8});}});}};
 await assert.rejects(saveProductWorkbench(db,'owner',{supplierId:'s',requestId:'once',rows:[]}),/Quota/);
 assert.deepEqual(reads,['users/owner','settings/role_permissions']);
});

test('bulk owner save writes prices and history atomically; failed retry and repeated save do not duplicate',async()=>{
 const f=fixture(),product={...f.data.get('products/p'),id:'p'};
 const body={supplierId:'s',requestId:'bulk1',rows:[{id:'p',expected:productFingerprint(product),values:{casePrice:20,packSize:'20kg'}}]};
 const before=structuredClone(f.data);f.fail();await assert.rejects(saveProductWorkbench(f.db,'owner',body),/Connection failed/);assert.deepEqual(f.data,before);
 const result=await saveProductWorkbench(f.db,'owner',body);assert.equal(result.pricesApplied,1);assert.equal(result.proposed,0);
 assert.equal(f.data.get('products/p').casePrice,20);assert.equal(f.data.get('products/p').packSize,'20kg');
 assert.equal(f.data.get('price_history/ph_pcn_bulk1_p').previousCasePrice,10);assert.equal(f.data.get('price_history/ph_pcn_bulk1_p').newCasePrice,20);
 assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
 const saved=structuredClone(f.data);assert.deepEqual(await saveProductWorkbench(f.db,'owner',body),result);assert.deepEqual(f.data,saved);
 await assert.rejects(saveProductWorkbench(f.db,'owner',{...body,rows:[{...body.rows[0],values:{casePrice:30}}]}),/already used/);
});

test('bulk GM save cannot bypass approval; concurrent edits cannot be overwritten',async()=>{
 const f=fixture(),product={...f.data.get('products/p'),id:'p'};f.data.set('users/owner',{role:'GM',active:true});
 const body={supplierId:'s',requestId:'bulk2',immediatePrices:true,role:'CREATOR',rows:[{id:'p',expected:productFingerprint(product),values:{casePrice:20}}]};
 const result=await saveProductWorkbench(f.db,'owner',body);assert.equal(result.proposed,1);assert.equal(result.pricesApplied,0);assert.equal(f.data.get('products/p').casePrice,10);
 f.data.set('products/p',{...f.data.get('products/p'),name:'Changed elsewhere'});const saved=structuredClone(f.data);
 await assert.rejects(saveProductWorkbench(f.db,'owner',{...body,requestId:'bulk3'}),/changed after/);assert.deepEqual(f.data,saved);
});
test('GM imports still require approval even if request claims owner privileges',async()=>{
 const f=fixture();f.data.set('users/owner',{role:'GM',active:true});
 const preview:any=await supplierCatalogImport(f.db,'owner',{...f.body,immediatePrices:true,role:'CREATOR'});
 assert.equal(preview.immediatePrices,false);assert.equal(preview.proposed,1);
 await supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected,immediatePrices:true});
 assert.equal(f.data.get('products/p').casePrice,10);assert.equal(f.data.get('price_change_notices/pcn_ci_test_p').status,'PENDING');assert.equal([...f.data.keys()].some(k=>k.startsWith('price_history/')),false);
});
test('owner price-only import accepts zero, preserves blank prices and is unchanged on reimport',async()=>{
 const f=fixture();f.body.csv='SystemID,PriceBox,PriceUnit\np,0,';
 const preview:any=await supplierCatalogImport(f.db,'owner',f.body);
 await supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected});
 assert.equal(f.data.get('products/p').casePrice,0);assert.equal(f.data.get('products/p').packPrice,2);
 const repeated:any=await supplierCatalogImport(f.db,'owner',{...f.body,requestId:'another'});
 assert.equal(repeated.pricesApplied,0);assert.equal(repeated.unchanged,1);
});
test('owner role changed to GM between preview and commit requires a fresh review',async()=>{
 const f=fixture();const preview:any=await supplierCatalogImport(f.db,'owner',f.body);f.data.set('users/owner',{role:'GM',active:true});
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected}),/changed after/);
 assert.equal(f.data.get('products/p').casePrice,10);
});
test('preview is read-only; owner commit updates details and prices, adds and removes only within supplier',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 const preview:any=await supplierCatalogImport(f.db,'owner',f.body);
 assert.deepEqual(f.data,before);assert.equal(preview.added,1);assert.equal(preview.updated,1);assert.equal(preview.proposed,0);assert.equal(preview.pricesApplied,1);assert.deepEqual(preview.missing,[{id:'missing',name:'Old item',itemCode:'002'}]);
 const result:any=await supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected,removeMissing:true});
 assert.equal(result.removed,1);assert.equal(f.data.get('products/missing').active,false);
 assert.equal(f.data.get('products/p').name,'Brown rice');assert.equal(f.data.get('products/p').packSize,'20kg');assert.equal(f.data.get('products/p').displayOrder,7);
 assert.equal(f.data.get('products/p').casePrice,12);assert.equal(f.data.get('products/p').packPrice,2);
 assert.equal(f.data.get('price_history/ph_pcn_ci_test_p').newCasePrice,12);assert.equal(f.data.get('price_history/ph_pcn_ci_test_p').previousCasePrice,10);
 assert.equal(f.data.get('price_history/ph_pcn_ci_test_p').approvedByUserId,'owner');assert.equal(f.data.has('price_change_notices/pcn_ci_test_p'),false);
 assert.equal(f.data.get('products/ci_test_1').itemCode,'003');
 assert.deepEqual(f.data.get('products/other'),before.get('products/other'));assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
});
test('default update-only import preserves missing items',async()=>{const f=fixture();const preview:any=await supplierCatalogImport(f.db,'owner',f.body);await supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected});assert.equal(f.data.get('products/missing').active,true);});
test('failed transaction is atomic; retry and repeated confirmation create no duplicates',async()=>{
 const f=fixture();const preview:any=await supplierCatalogImport(f.db,'owner',f.body);const body={...f.body,action:'catalog-commit',expected:preview.expected};const before=structuredClone(f.data);
 f.fail();await assert.rejects(supplierCatalogImport(f.db,'owner',body),/Connection failed/);assert.deepEqual(f.data,before);
 const result=await supplierCatalogImport(f.db,'owner',body),saved=structuredClone(f.data);assert.deepEqual(await supplierCatalogImport(f.db,'owner',body),result);assert.deepEqual(f.data,saved);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,removeMissing:true}),/already been used/);
});
test('concurrent catalogue changes reject commit including removals',async()=>{const f=fixture();const preview:any=await supplierCatalogImport(f.db,'owner',f.body);f.data.set('products/new',{supplierId:'s',name:'Just added',itemCode:'004',active:true});const before=structuredClone(f.data);await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected,removeMissing:true}),/changed after/);assert.deepEqual(f.data,before);});
test('inactive, unprivileged and out-of-scope users cannot read catalogue or write',async()=>{
 for(const profile of [{role:'CREATOR',active:false},{role:'STAFF',active:true},{role:'CUSTOM',active:true,customPermissions:['manage_products'],supplierIds:['other']}]){const f=fixture();f.data.set('users/owner',profile);await assert.rejects(supplierCatalogImport(f.db,'owner',f.body),/cannot import/);assert.deepEqual(f.reads,['users/owner','settings/role_permissions']);}
});
test('permission loss after preview stops commit',async()=>{const f=fixture();const preview:any=await supplierCatalogImport(f.db,'owner',f.body);f.data.set('users/owner',{role:'STAFF',active:true});await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected}),/cannot import/);});
test('bad final row, foreign ID, duplicate identity and empty file reject everything',async()=>{
 for(const csv of ['SystemID,Name\nother,Hijacked','ItemCode,Name\n003,New\n003,Duplicate','SystemID,PriceBox\np,-1','SystemID,Name\n']){const f=fixture();const before=structuredClone(f.data);await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,csv,removeMissing:true}));assert.deepEqual(f.data,before);}
});
test('new category requires category permission',async()=>{const f=fixture();f.data.set('users/owner',{active:true,role:'CUSTOM',customPermissions:['manage_products','view_prices'],supplierIds:['s']});await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,csv:'ItemCode,Name,Category\n003,Noodles,New category'}),/category management/);});
test('explicit inactive row and missing-only full catalogue import work',async()=>{const f=fixture();f.body.csv='SystemID,Active\np,False';const preview:any=await supplierCatalogImport(f.db,'owner',f.body);await supplierCatalogImport(f.db,'owner',{...f.body,action:'catalog-commit',expected:preview.expected});assert.equal(f.data.get('products/p').active,false);assert.equal(f.data.get('products/missing').active,true);});

test('unified price file requires review, records source, saves once, keeps other fields and historical orders',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 const body={...f.body,mode:'prices',csv:'SystemID,PriceBox,PriceUnit\np,15,',fileSource:{name:'Supplier.pdf',reference:'October',currency:'GBP'}};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);
 assert.equal(preview.prices[0].before.casePrice,10);assert.equal(preview.prices[0].after.casePrice,15);assert.match(preview.prices[0].flags[0],/50.0%/);
 const commit={...body,action:'catalog-commit',expected:preview.expected};
 await assert.rejects(supplierCatalogImport(f.db,'owner',commit),/Check the matched/);assert.deepEqual(f.data,before);
 f.fail();await assert.rejects(supplierCatalogImport(f.db,'owner',{...commit,reviewed:true}),/Connection failed/);assert.deepEqual(f.data,before);
 const result=await supplierCatalogImport(f.db,'owner',{...commit,reviewed:true});assert.equal(result.pricesApplied,1);
 assert.deepEqual(f.data.get('products/p'),{...before.get('products/p'),casePrice:15});
 assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));assert.deepEqual(f.data.get('products/missing'),before.get('products/missing'));
 assert.equal(f.data.get('price_history/ph_pcn_ci_test_p').fileSource.name,'Supplier.pdf');
 const saved=structuredClone(f.data);assert.deepEqual(await supplierCatalogImport(f.db,'owner',{...commit,reviewed:true}),result);assert.deepEqual(f.data,saved);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...commit,reviewed:true,fileSource:{name:'Another.pdf'}}),/already been used/);
});
test('price file cannot add, remove, rename, alter packs or update foreign products',async()=>{
 for(const overrides of [{removeMissing:true},{csv:'SystemID,Name,PriceBox\np,Renamed,15'},{csv:'SystemID,PackSize,PriceBox\np,12kg,15'},{csv:'SystemID,PriceBox\n,15'},{csv:'SystemID,PriceBox\nother,15'}]){
  const f=fixture(),before=structuredClone(f.data);await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,mode:'prices',csv:'SystemID,PriceBox\np,15',...overrides}));assert.deepEqual(f.data,before);
 }
});
test('catalogue price warnings require acknowledgement; GM price files retain approval',async()=>{
 const f=fixture(),body={...f.body,mode:'catalogue',newProductDefaults:{categoryId:'c',branchScope:'ALL'}};const preview:any=await supplierCatalogImport(f.db,'owner',body);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected}),/price warnings/);
 f.data.set('users/owner',{role:'GM',active:true});const priceBody={...f.body,mode:'prices',csv:'SystemID,PriceBox\np,15'};const gm:any=await supplierCatalogImport(f.db,'owner',priceBody);
 await supplierCatalogImport(f.db,'owner',{...priceBody,action:'catalog-commit',expected:gm.expected,reviewed:true});assert.equal(f.data.get('products/p').casePrice,10);assert.equal(f.data.get('price_change_notices/pcn_ci_test_p').status,'PENDING');
});


test('matched supplier file reviews and updates names with prices once, preserving IDs, other items and order snapshots',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 const body={...f.body,mode:'supplier-file',csv:'SystemID,Name,PriceBox,PriceUnit\np,Brown rice,15,'};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);
 assert.deepEqual(preview.matchedItems[0],{id:'p',fingerprint:productFingerprint({...f.data.get('products/p'),id:'p'}),itemCode:'001',before:{name:'Rice',casePrice:10,packPrice:2},after:{name:'Brown rice',casePrice:15,packPrice:2},flags:['Case price +50.0%']});
 assert.deepEqual(f.data,before);
 const commit={...body,action:'catalog-commit',expected:preview.expected};
 await assert.rejects(supplierCatalogImport(f.db,'owner',commit),/Check the matched/);
 f.fail();await assert.rejects(supplierCatalogImport(f.db,'owner',{...commit,reviewed:true}),/Connection failed/);assert.deepEqual(f.data,before);
 const result=await supplierCatalogImport(f.db,'owner',{...commit,reviewed:true});
 assert.equal(f.data.get('products/p').name,'Brown rice');assert.equal(f.data.get('products/p').casePrice,15);
 assert.equal(f.data.get('price_history/ph_pcn_ci_test_p').source,'OWNER_SUPPLIER_FILE');
 assert.deepEqual(f.data.get('products/missing'),before.get('products/missing'));assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
 const saved=structuredClone(f.data);assert.deepEqual(await supplierCatalogImport(f.db,'owner',{...commit,reviewed:true}),result);assert.deepEqual(f.data,saved);
});

test('matched supplier rename-only works and retains concurrent-edit protection',async()=>{
 const f=fixture(),body={...f.body,mode:'supplier-file',csv:'SystemID,Name\np,Brown rice'};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);assert.equal(preview.matchedItems.length,1);assert.equal(preview.pricesApplied,0);
 f.data.get('products/p').name='Changed elsewhere';
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected,reviewed:true}),/changed after/);
 const fresh:any=await supplierCatalogImport(f.db,'owner',body);
 await supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:fresh.expected,reviewed:true});assert.equal(f.data.get('products/p').name,'Brown rice');assert.equal(f.data.get('products/p').casePrice,10);
});

test('matched supplier imports cannot add, remove, alter packs, use foreign IDs or bypass GM approval',async()=>{
 for(const overrides of [{removeMissing:true},{csv:'SystemID,Name,PackSize\np,New,12kg'},{csv:'SystemID,Name\n,New'},{csv:'SystemID,Name\nother,New'}]){const f=fixture(),before=structuredClone(f.data);await assert.rejects(supplierCatalogImport(f.db,'owner',{...f.body,mode:'supplier-file',csv:'SystemID,Name\np,New',...overrides}));assert.deepEqual(f.data,before);}
 const f=fixture();f.data.set('users/owner',{role:'GM',active:true});const body={...f.body,mode:'supplier-file',csv:'SystemID,Name,PriceBox\np,Brown rice,15'};
 const preview:any=await supplierCatalogImport(f.db,'owner',body);await supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected,reviewed:true});assert.equal(f.data.get('products/p').name,'Brown rice');assert.equal(f.data.get('products/p').casePrice,10);assert.equal(f.data.get('price_change_notices/pcn_ci_test_p').status,'PENDING');
});


test('catalogue preview cannot disclose prices to a product editor without price access',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 f.data.set('users/owner',{active:true,role:'CUSTOM',permissionMode:'CUSTOM',customPermissions:['manage_products'],supplierIds:['s']});
 await assert.rejects(supplierCatalogImport(f.db,'owner',f.body),/Price access/);
 assert.deepEqual(f.reads,['users/owner','settings/role_permissions']);
 assert.deepEqual(f.data.get('products/p'),before.get('products/p'));
});


test('missing new-product choices require review; direct commit cannot save inferred defaults',async()=>{
 const f=fixture(),before=structuredClone(f.data),body={...f.body,mode:'catalogue',csv:'SystemID,Name\np,Renamed rice\n,New tea'};
 const needed:any=await supplierCatalogImport(f.db,'owner',body);
 assert.equal(needed.status,'details-required');assert.deepEqual(needed.needed,[{row:3,name:'New tea',category:true,branches:true}]);
 assert.deepEqual(f.data,before);
 await assert.rejects(supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:needed.expected}),/Complete the new-product/);
 assert.deepEqual(f.data,before);
 const chosen={...body,newProductDefaults:{categoryId:'c',branchScope:'SELECTED',branchIds:['b']}};
 const preview:any=await supplierCatalogImport(f.db,'owner',chosen);assert.equal(preview.added,1);
 await supplierCatalogImport(f.db,'owner',{...chosen,action:'catalog-commit',expected:preview.expected,reviewed:true});
 assert.deepEqual(f.data.get('products/ci_test_1').allowedBranchIds,['b']);assert.deepEqual(f.data.get('products/p').allowedBranchIds,[]);
 assert.deepEqual(f.data.get('orders/history'),before.get('orders/history'));
});

test('unchanged modern export commit performs no writes, receipts or audit entries',async()=>{
 const f=fixture();
 const products=[...f.data].filter(([k,p])=>k.startsWith('products/')&&p.supplierId==='s').map(([k,p])=>({...p,id:k.split('/')[1]}));
 const csv=generateProductCSV(products,[{...f.data.get('categories/c'),id:'c'}],[{...f.data.get('branches/b'),id:'b'}]);
 const body={...f.body,mode:'catalogue',csv},before=structuredClone(f.data);
 const preview:any=await supplierCatalogImport(f.db,'owner',body);assert.equal(preview.updated,0);assert.equal(preview.unchanged,2);
 await supplierCatalogImport(f.db,'owner',{...body,action:'catalog-commit',expected:preview.expected});assert.deepEqual(f.data,before);
 assert.equal(f.reads.some(p=>p.startsWith('orders')),false);
});
