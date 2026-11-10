import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {historyOrderPartitions, outgoingOrderPartitions, linkedSupplierIds} from '../shared/order-scope.ts';
import {coalescePending} from '../shared/pending-request.ts';

const user = {id:'staff',active:true,role:'STAFF',branchId:'b',supplierIds:['s','other']};
const suppliers = [{id:'s',linkedBranchId:'b'}];
const matches=(p:any,b:string,s:string)=>(!p.branchId||p.branchId===b)&&(!p.supplierId||p.supplierId===s);
test('history removes covered queries without changing the authorized result union',()=>{
  for(const profile of [user,{...user,allBranches:true},{...user,allSuppliers:true},{...user,role:'CREATOR'},{...user,active:false},{...user,supplierIds:[]}]){
    const old=[...outgoingOrderPartitions(profile),...linkedSupplierIds(profile,suppliers).map(supplierId=>({supplierId}))];
    const next=historyOrderPartitions(profile,suppliers);
    for(const b of ['b','outside'])for(const s of ['s','other','unassigned'])assert.equal(next.some(p=>matches(p,b,s)),old.some(p=>matches(p,b,s)));
  }
  assert.equal(historyOrderPartitions(user,suppliers).length,2); // previously 3
  assert.equal(historyOrderPartitions({...user,allBranches:true},suppliers).length,2); // previously 3
  assert.equal(historyOrderPartitions({...user,role:'CREATOR'},suppliers).length,1);
});

test('concurrent identical reads share a request, but later refreshes do not use stale cache',async()=>{
  let calls=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const load=async()=>{calls++;await gate;return {version:calls};};
  const a=coalescePending('same-user-scope-range',load),b=coalescePending('same-user-scope-range',load);
  assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);release();assert.deepEqual(await a,{version:1});await b;
  assert.deepEqual(await coalescePending('same-user-scope-range',load),{version:2});
});
test('different scopes never share a pending read and rejected reads can be retried',async()=>{
  let calls=0;const load=async()=>{calls++;throw new Error('offline');};
  await Promise.all([assert.rejects(coalescePending('user-a',load)),assert.rejects(coalescePending('user-b',load))]);
  assert.equal(calls,2);await assert.rejects(coalescePending('user-a',load));assert.equal(calls,3);
});

test('repeated exact-order snapshots retain one latest archived record and live data takes precedence',async()=>{
  const {useAppStore}=await import('../store.ts');
  useAppStore.setState({_archivedOrders:[],_liveOrders:[],_incomingOrders:[],orders:[]});
  for(let i=0;i<1000;i++)useAppStore.getState().appendArchivedOrders([{id:'same',createdAt:'2026-10-12',notes:String(i)}] as any);
  assert.equal(useAppStore.getState()._archivedOrders.length,1);
  assert.equal((useAppStore.getState()._archivedOrders[0] as any).notes,'999');
  useAppStore.getState().syncLiveOrders([{id:'same',createdAt:'2026-10-12',notes:'live'}] as any);
  assert.equal((useAppStore.getState().orders[0] as any).notes,'live');
  useAppStore.setState({_archivedOrders:[],_liveOrders:[],_incomingOrders:[],orders:[]});
});

function endpoint(source:string, failure?:Error, invalidToken=false){
  let reads=0,services=0;const exports:any={};
  const service=async()=>{services++;if(failure)throw failure;return {ok:true};};
  const db={collection:()=>({doc:()=>({get:async()=>{reads++;return {data:()=>({active:true,role:'CREATOR',map:{}})};}})})};
  const modules:any={'../firebase-admin.ts':{getAdmin:()=>({db,auth:{verifyIdToken:async()=>{if(invalidToken)throw Error('invalid');return {uid:'u'};}}})},'../../shared/database-errors.ts':{isDatabaseQuotaError:(e:any)=>e.code==='resource-exhausted',databaseErrorMessage:(_:any,fallback:string)=>fallback}};
  for(const [file,name]of [['order-entry','saveOrderEntry'],['fulfillment-workflow','saveFulfillment'],['invoice-workflow','saveInvoiceReview'],['product-workbench','saveProductWorkbench']])modules['../../server/'+file+'-service.ts']={[name]:service};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(key:string)=>modules[key]||{},process:{env:{}}});
  return {async run(action:string){const res:any={code:0,body:null,setHeader(){},status(code:number){res.code=code;return res;},json(body:any){res.body=body;return res;}};await exports.default({method:'POST',headers:{authorization:'Bearer token'},body:{action}},res);return {reads,services,code:res.code,body:res.body};}};
}
const source=readFileSync(new URL('../api/admin/workspace.ts',import.meta.url),'utf8');
for(const action of ['order-save','fulfillment','invoice-review','product-bulk']){
  test(action+' performs no redundant outer authorization reads and delegates to its transactional checks',async()=>{
    const result=await endpoint(source).run(action);assert.equal(result.reads,0);assert.equal(result.services,1);assert.equal(result.code,200);
    const denied=await endpoint(source,new Error('Permission revoked')).run(action);assert.equal(denied.code,400);assert.equal(denied.body.error,'Permission revoked');
    const quota=await endpoint(source,Object.assign(new Error('quota'),{code:'resource-exhausted'})).run(action);assert.equal(quota.code,503);
    const anonymous=await endpoint(source,undefined,true).run(action);assert.equal(anonymous.code,401);assert.equal(anonymous.services,0);assert.equal(anonymous.reads,0);
  });
}
