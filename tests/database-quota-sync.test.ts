import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as scope from '../shared/order-scope.ts';
import {checkUserActionPermission} from '../server/order-authorization.ts';
import {syncDemand} from '../shared/sync-demand.ts';
import {mergeProductSnapshot} from '../shared/product-snapshot.ts';
import {DATABASE_QUOTA_MESSAGE,isDatabaseQuotaError,databaseErrorMessage} from '../shared/database-errors.ts';
import {createBranchEmailSettingsHandler} from '../api/admin/branch-email.ts';

function syncHarness(){
 const records:any[]=[];const effects:any[]=[];let index=0,pending:any[]=[];
 const state:any=new Proxy({suppliers:[],branches:[],rolePermissions:{},products:[]},{get(target:any,key){return key in target?target[key]:(target[key]=()=>{});}});
 state.setProducts=(products:any[])=>state.products=products;
 const requests:any={requests:{}},status={quotaMessage:''};const useAppStore:any=(select:any)=>select(state);useAppStore.getState=()=>state;
 const react={useMemo:(fn:any)=>fn(),useEffect:(run:any,deps:any[])=>{const i=index++;const prev=effects[i];if(!prev||deps.some((v,j)=>v!==prev.deps[j]))pending.push(()=>{prev?.stop?.();effects[i]={deps,stop:run()};});}};
 const modules:any={'../utils/secureRead':{subscribeProtectedRecords:()=>{throw Error('Unexpected restricted read in priced fixture');}},react,'../firebase-config':{db:{}},'../store':{useAppStore,can:(user:any,permission:string)=>checkUserActionPermission(user,permission,state.rolePermissions)},'../shared/sync-demand':{syncDemand},'./databaseStatus':{reportDatabaseError:()=>{},useDatabaseStatus:(select:any)=>select(status)},'./syncRequests':{useSyncRequests:(select:any)=>select(requests)},'./sharedFirestore':{shareFirestore:(_:any,key:any,start:any,next:any,error:any)=>start(next,error)},'../shared/database-errors':{isDatabaseQuotaError},'../constants':{LIVE_SYNC_DAYS:45},'../utils/orderLifecycle':{shouldRetainInLiveSync:()=>true},'../logger':{addLog:()=>{}},'../shared/order-scope.ts':scope,
 'firebase/firestore':{collection:(_:any,name:string)=>({name}),doc:(_:any,...parts:string[])=>({name:parts.join('/')}),query:(ref:any,...constraints:any[])=>({...ref,constraints}),where:(field:string,op:string,value:any)=>({field,op,value}),limit:(count:number)=>({limit:count}),onSnapshot:(ref:any,next:any)=>{const record={ref:ref.name,constraints:ref.constraints||[],next,stopped:false};records.push(record);return()=>{record.stopped=true;};}},
 '../utils/orderQueries.ts':{subscribeOrderPartitions:(_:any,partitions:any[])=>{const group=partitions.map(p=>({ref:'partition',partition:p,stopped:false}));records.push(...group);return()=>group.forEach(r=>r.stopped=true);}}};
 modules['../shared/product-snapshot']={mergeProductSnapshot};
 const output:any={};const code=ts.transpileModule(readFileSync(new URL('../hooks/useFirestoreSync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports:output,require:(key:string)=>{assert.ok(modules[key],key);return modules[key];},Date,Map,Set,JSON,console});
 return {records,state,requests,status,active(){return records.filter(r=>!r.stopped);},render(user:any,path:string){state.currentUser=user;index=0;pending=[];output.useFirestoreSync(user,path);pending.forEach(fn=>fn());},stop(){effects.forEach(e=>e.stop?.());}};
}
const user={id:'u',active:true,role:'STAFF',branchId:'b',allSuppliers:true};
test('blank order form avoids products, order history and unrelated settings',()=>{
 const h=syncHarness();h.render(user,'/new-order');assert.deepEqual(h.active().map(r=>r.ref).sort(),['branches','categories','settings/role_permissions','suppliers']);h.stop();assert.ok(h.records.every(r=>r.stopped));
});
test('supplier selection loads only its products and changing supplier releases the old query',()=>{
 const h=syncHarness();h.render(user,'/new-order');h.requests.requests={composer:{supplierId:'s1',sourceOrderId:''}};h.render(user,'/new-order');
 const first=h.active().find(r=>r.ref==='products');assert.equal(first.constraints[0].value,'s1');assert.equal(first.constraints[0].field,'supplierId');
 h.requests.requests={composer:{supplierId:'s2',sourceOrderId:''}};h.render(user,'/new-order');assert.equal(first.stopped,true);assert.equal(h.active().find(r=>r.ref==='products').constraints[0].value,'s2');
 const common=h.records.filter(r=>r.ref==='suppliers');assert.equal(common.length,1);h.stop();
});
test('email settings starts only its required five subscriptions, not the catalogue',()=>{
 const h=syncHarness();h.render(user,'/settings?tab=email');assert.deepEqual(h.active().map(r=>r.ref).sort(),['branches','settings/email_config','settings/role_permissions','suppliers']);h.stop();
});
test('route changes preserve common subscriptions and release data no longer needed',()=>{
 const h=syncHarness();h.render(user,'/settings?tab=categories');assert.ok(h.active().some(r=>r.ref==='products'));h.render(user,'/settings?tab=email');assert.equal(h.active().some(r=>r.ref==='products'),false);assert.equal(h.records.filter(r=>r.ref==='branches').length,1);h.stop();
});
test('catalogue editing, integrity checks, approvals and people retain their required data',()=>{
 for(const tab of ['products','suppliers','system']){const d=syncDemand('/settings?tab='+tab);assert.equal(d.products,false);assert.equal(d.newItems,false);}
 assert.equal(syncDemand('/settings?tab=categories').products,true);
 assert.equal(syncDemand('/settings?tab=approvals').priceHistory,true);assert.equal(syncDemand('/settings?tab=email').priceHistory,false);
 const people=syncDemand('/settings?tab=users');assert.ok(people.users&&people.roles&&people.departments);assert.equal(people.products,false);
 for(const route of ['/orders','/checks','/deliveries']){const d=syncDemand(route);assert.ok(d.orders&&d.products);assert.equal(d.users,false);}
});
test('repeat/draft watches its exact source without loading every order',()=>{
 const h=syncHarness();h.requests.requests={composer:{supplierId:'s',sourceOrderId:'draft-1'}};h.render(user,'/new-order');assert.ok(h.active().some(r=>r.ref==='orders/draft-1'));assert.equal(h.active().some(r=>r.ref==='partition'),false);h.stop();
});
test('incoming assignments reconnect only their queries, not common data',()=>{
 const h=syncHarness();h.state.branches=[{id:'b',active:true,actsAsSupplier:true}];h.render(user,'/deliveries');const first=h.records.filter(r=>r.ref==='products');h.state.suppliers=[{id:'s',linkedBranchId:'b'}];h.render(user,'/deliveries');assert.equal(h.records.filter(r=>r.ref==='products').length,1);assert.equal(first[0].stopped,false);assert.ok(h.active().some(r=>r.partition?.supplierId==='s'));assert.ok(h.active().filter(r=>r.ref==='partition').every(r=>!r.partition.branchId));h.stop();
});

test('unassigned users and denied roles load no incoming orders or catalogue via a direct link',()=>{
 for(const profile of [user,{...user,branchId:'cpu',permissionMode:'CUSTOM',customPermissions:[]},{...user,branchId:'other',allBranches:true}]){
  const h=syncHarness();h.state.branches=[{id:'cpu',active:true,actsAsSupplier:true}];h.state.suppliers=[{id:'cpu-supplier',linkedBranchId:'cpu'}];h.render(profile,'/deliveries');
  assert.deepEqual(h.active().map(r=>r.ref).sort(),['branches','settings/role_permissions','suppliers']);h.stop();
 }
});

test('incoming role revocation stops incoming listeners immediately',()=>{
 const h=syncHarness();h.state.branches=[{id:'b',active:true,actsAsSupplier:true}];h.state.suppliers=[{id:'s',linkedBranchId:'b'}];h.render(user,'/deliveries');
 const incoming=h.active().filter(r=>r.ref==='partition');assert.ok(incoming.length);
 h.state.rolePermissions={STAFF:[]};h.render(user,'/deliveries');assert.ok(incoming.every(r=>r.stopped));assert.equal(h.active().some(r=>r.ref==='partition'||r.ref==='products'),false);h.stop();
});
test('already-covered supplier orders are not queried twice',()=>{
 const h=syncHarness();h.state.suppliers=[{id:'s',linkedBranchId:'b'}];h.render({...user,allBranches:true,allSuppliers:false,supplierIds:['s']},'/orders');assert.equal(h.active().filter(r=>r.ref==='partition').length,1);h.stop();
});
test('quota stop does not reconnect on navigation, scope change and logout dispose data',()=>{
 const h=syncHarness();h.render(user,'/orders');const first=[...h.records];h.render({...user,branchId:'other'},'/orders');assert.ok(first.every(r=>r.stopped));
 h.status.quotaMessage='Quota exceeded';h.render(user,'/orders');const count=h.records.length;assert.equal(h.active().length,0);h.render(user,'/settings?tab=products');assert.equal(h.records.length,count);h.render(null,'/new-order');assert.equal(h.active().length,0);
});
test('dashboard checks catalogue existence with one document, not all products',()=>{
 const h=syncHarness();h.render({...user,role:'CREATOR'},'/');assert.equal(h.active().find(r=>r.ref==='products').constraints[0].limit,1);h.stop();
});

test('partial product reads and quota navigation preserve products loaded from other suppliers',()=>{
 const h=syncHarness(),products=[{id:'a',supplierId:'one'},{id:'b',supplierId:'two'}];
 const snapshot=(items:any[])=>({docs:items.map(product=>({id:product.id,data:()=>product}))});
 h.render(user,'/settings?tab=categories');h.active().find(r=>r.ref==='products').next(snapshot(products));
 h.render(user,'/');h.active().find(r=>r.ref==='products').next(snapshot([products[0]]));assert.equal(h.state.products.length,2);
 h.requests.requests={composer:{supplierId:'one',sourceOrderId:''}};h.render(user,'/new-order');
 h.active().find(r=>r.ref==='products').next(snapshot([{...products[0],name:'Updated'}]));assert.equal(h.state.products.length,2);
 h.status.quotaMessage='Quota exceeded';h.render(user,'/settings?tab=products');assert.equal(h.state.products.length,2);assert.equal(h.active().length,0);
 h.status.quotaMessage='';h.render(user,'/settings?tab=categories');h.active().find(r=>r.ref==='products').next(snapshot([]));assert.deepEqual(h.state.products,[]);h.stop();
});
test('quota detection does not disguise unrelated errors',()=>{
 for(const error of [{code:8},{code:'resource-exhausted'},{code:'firestore/resource-exhausted'},{code:'DATABASE_QUOTA_EXCEEDED'},new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.')])assert.equal(databaseErrorMessage(error,'other'),DATABASE_QUOTA_MESSAGE);
 assert.equal(isDatabaseQuotaError({code:'permission-denied'}),false);
});
test('mailbox actions return a safe quota response',async()=>{
 for(const stage of ['getUser','getBranch','getSettings','saveSettings']){
  const deps:any={verifyToken:async()=>({uid:'u'}),getUser:async()=>({active:true,role:'CREATOR'}),getBranch:async()=>({email:'branch@example.com'}),getSettings:async()=>undefined,saveSettings:async()=>{},env:{EMAIL_SETTINGS_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64')}};
  deps[stage]=async()=>{throw Object.assign(new Error('Quota exceeded: private diagnostic'),{code:8});};
  let status=0,body:any;const res:any={setHeader(){return this;},status(s:number){status=s;return this;},json(b:any){body=b;},end(){}};
  await createBranchEmailSettingsHandler(deps)({method:stage==='saveSettings'?'PUT':'GET',headers:{authorization:'Bearer verified'},query:{branchId:'b'},body:{branchId:'b',host:'smtp.example.com',port:465,secure:true,user:'branch@example.com',password:'fake-test-secret',cc:''}},res);
  assert.equal(status,503);assert.equal(body.code,'DATABASE_QUOTA_EXCEEDED');assert.ok(!JSON.stringify(body).includes('private diagnostic'));
 }
});

test('opening product editing, suppliers and backup never subscribes to every product or item-notice history',()=>{
 for(const path of ['/settings?tab=products','/settings?tab=products&view=bulk','/settings?tab=suppliers','/settings?tab=system']){const h=syncHarness();h.render({...user,role:'CREATOR'},path);assert.equal(h.active().some(r=>['products','new_item_notices','price_history'].includes(r.ref)),false,path);h.stop();}
});

test('standalone checklists request categories without broad product or order reads',()=>{
 const demand=syncDemand('/checklists');
 assert.equal(demand.categories,true);
 for(const field of ['products','productExists','orders','users','priceHistory','priceNotices'] as const)assert.equal(demand[field],false,field);
});
