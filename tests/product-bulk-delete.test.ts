import {test} from 'node:test';
import assert from 'node:assert/strict';
import {removeSelectedProducts,planProductChanges} from '../server/product-workbench-service.ts';
import {planSupplierCatalogImport} from '../utils/supplierCatalogImport.ts';
import {sortedSupplierProducts} from '../shared/supplier-file.ts';
import {productFingerprint} from '../shared/product-workbench.ts';
import type {Product} from '../types.ts';
const owner={id:'owner',role:'CREATOR',active:true,displayName:'Sample owner'};
const sample:Product={id:'p1',supplierId:'s1',name:'Sample rice',categoryId:'c1',displayOrder:1,itemCode:'R1',active:true,allowedBranchIds:[],casePrice:10};
function fixture(products=[sample],user:any=owner){
 const records=new Map<string,any>([['users/owner',user],['settings/role_permissions',{map:{STAFF:[]}}],['orders/history',{items:[{productId:'p1',productNameSnapshot:'Old rice',casePriceSnapshot:8}]}],...products.map(p=>['products/'+p.id,structuredClone(p)] as [string,any])]);
 const reads:string[]=[],writes:any[]=[];let fail=false;
 const db={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id,id})}),runTransaction:async(fn:any,options:any)=>{
  assert.equal(options.maxAttempts,1);const staged:any[]=[];
  const result=await fn({get:async(ref:any)=>{reads.push(ref.path);return{id:ref.id,exists:records.has(ref.path),data:()=>structuredClone(records.get(ref.path))};},update:(ref:any,value:any)=>staged.push({kind:'update',path:ref.path,value}),create:(ref:any,value:any)=>staged.push({kind:'create',path:ref.path,value})});
  if(fail)throw new Error('Synthetic transaction failure');
  for(const write of staged){records.set(write.path,write.kind==='update'?{...records.get(write.path),...write.value}:write.value);writes.push(write);}return result;
 }};
 return{db,records,reads,writes,setFail:(value:boolean)=>{fail=value;}};
}
const body=(products=[sample])=>({supplierId:'s1',requestId:'request1',rows:products.map(p=>({id:p.id,expected:productFingerprint(p)}))});
test('inactive-only selection is deletable and cannot silently return through stale edits or CSV',async()=>{
 const inactive={...sample,active:false},f=fixture([inactive]);
 const result=await removeSelectedProducts(f.db,'owner',body([inactive]));
 assert.equal(result.removed,1);const removed=f.records.get('products/p1');
 assert.ok(removed.removedAt);assert.notEqual(productFingerprint(removed),productFingerprint(inactive));
 assert.deepEqual(sortedSupplierProducts([removed],'s1'),[]);
 assert.throws(()=>planProductChanges(owner,{}, {...body(),rows:[{id:removed.id,expected:productFingerprint(removed),values:{active:true}}]},[removed],[],[]),/deleted/);
 assert.throws(()=>planSupplierCatalogImport({rows:[{SystemID:'p1',Name:'Rice',Active:'TRUE'}],supplierId:'s1',products:[removed],categories:[],branches:[],newId:()=> 'new'}),/deleted/);
 assert.equal((await removeSelectedProducts(f.db,'owner',{...body([removed]),requestId:'second'})).removed,0);
});
test('selected removal retires active and inactive items, keeps orders/prices/IDs and reads only selected products',async()=>{
 const other={...sample,id:'p2',supplierId:'s2'},inactive={...sample,id:'p3',active:false},f=fixture([sample,other,inactive]);const before=structuredClone(f.records.get('orders/history'));
 const result=await removeSelectedProducts(f.db,'owner',body([sample,inactive]));
 assert.deepEqual(result,{success:true,removed:2,removedAt:result.removedAt,productIds:['p1','p3']});
 assert.deepEqual(f.writes.filter(w=>w.kind==='update'),['p1','p3'].map(id=>({kind:'update',path:'products/'+id,value:{active:false,removedAt:result.removedAt}})));
 assert.deepEqual(f.records.get('products/p1'),{...sample,active:false,removedAt:result.removedAt});assert.deepEqual(f.records.get('products/p2'),other);assert.deepEqual(f.records.get('orders/history'),before);
 assert.deepEqual(f.reads,['users/owner','settings/role_permissions','_product_operations/remove_request1','products/p1','products/p3']);assert.equal(f.writes.length,4);
});
test('same receipt replays once; changed payload or another user cannot reuse it',async()=>{
 const f=fixture();const first=await removeSelectedProducts(f.db,'owner',body());f.reads.length=0;
 assert.deepEqual(await removeSelectedProducts(f.db,'owner',body()),first);assert.equal(f.writes.length,3);assert.equal(f.reads.length,3);
 await assert.rejects(()=>removeSelectedProducts(f.db,'owner',{...body(),rows:[{id:'p1',expected:'changed'}]}),/different selection/);
 f.records.set('users/other',{...owner,id:'other'});await assert.rejects(()=>removeSelectedProducts(f.db,'other',body()),/different selection/);assert.equal(f.writes.length,3);
});
test('inactive users, missing permission and supplier scope are rejected before product reads',async()=>{
 for(const user of [{...owner,active:false},{...owner,role:'STAFF'},{...owner,role:'MANAGER',permissionMode:'CUSTOM',customPermissions:['manage_products'],supplierIds:['s2'],allSuppliers:false}]){
  const f=fixture([sample],user);await assert.rejects(()=>removeSelectedProducts(f.db,'owner',body()),/cannot delete/);assert.equal(f.writes.length,0);assert.equal(f.reads.length,2);
 }
 const f=fixture([sample],{...owner,role:'MANAGER',permissionMode:'CUSTOM',customPermissions:['manage_products'],supplierIds:['s1']});assert.equal((await removeSelectedProducts(f.db,'owner',body())).removed,1);
});
test('one changed, missing or wrong-supplier item rejects the entire selection',async()=>{
 const second={...sample,id:'p2'};
 for(const replacement of [undefined,{...second,name:'Changed'},{...second,supplierId:'s2'}]){
  const f=fixture(replacement?[sample,replacement]:[sample]);await assert.rejects(()=>removeSelectedProducts(f.db,'owner',body([sample,second])),/changed|missing|another supplier/);assert.equal(f.writes.length,0);assert.equal(f.records.get('products/p1').active,true);
 }
});
test('invalid, duplicate and oversized selections fail without database access',async()=>{
 for(const request of [{...body(),rows:[]},{...body(),rows:[...body().rows,...body().rows]},{...body(),rows:[null]},{...body(),rows:[{id:'../p1',expected:''}]},{...body(),supplierId:'../s1'},{...body(),requestId:''},{...body(),rows:Array.from({length:451},(_,i)=>({id:'p'+i,expected:''}))}]){
  const f=fixture();await assert.rejects(()=>removeSelectedProducts(f.db,'owner',request));assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);
 }
});
test('450 selected products fit one atomic transaction; a failed commit leaves everything unchanged',async()=>{
 const products=Array.from({length:450},(_,i)=>({...sample,id:'p'+i}));const f=fixture(products);f.setFail(true);await assert.rejects(()=>removeSelectedProducts(f.db,'owner',body(products)),/transaction failure/);assert.equal(f.writes.length,0);assert.equal(f.records.get('products/p1').active,true);
 f.setFail(false);assert.equal((await removeSelectedProducts(f.db,'owner',body(products))).removed,450);assert.equal(f.writes.length,452);
});
