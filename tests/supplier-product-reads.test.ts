import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {checkUserActionPermission} from '../server/order-authorization.ts';
import {orderScopeKey} from '../shared/order-scope.ts';
import {mergeProductSnapshot} from '../shared/product-snapshot.ts';

function harness(){
 const state:any={currentUser:{id:'owner',role:'CREATOR',active:true},products:[]},quota={quotaMessage:''};
 state.setProducts=(products:any)=>state.products=products;
 const useAppStore:any=(fn:any)=>fn(state);useAppStore.getState=()=>state;
 const slots:any[]=[],records:any[]=[];let index=0,updated=false,pending:any[]=[];
 const react={createContext:(value:any)=>value,useContext:(value:any)=>value,
  useState:(initial:any)=>{const i=index++;if(!slots[i])slots[i]={value:initial};return [slots[i].value,(value:any)=>{slots[i].value=value;updated=true;}];},
  useEffect:(fn:any,deps:any[])=>{const i=index++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))pending.push(()=>{old?.stop?.();slots[i]={deps,stop:fn()};});}};
 const modules:any={'../utils/secureRead':{subscribeProtectedRecords:(request:any,next:any,error:any)=>{const record={request,next,error,stopped:false};records.push(record);return()=>record.stopped=true;}},react,'../firebase-config':{db:{}},'../store':{useAppStore,can:(user:any,permission:string)=>checkUserActionPermission(user,permission,{})},
  './sharedFirestore':{shareFirestore:(scope:any,key:any,start:any,next:any,error:any)=>start(next,error)},
  './databaseStatus':{useDatabaseStatus:(fn:any)=>fn(quota),reportDatabaseError:(e:any)=>{if(e.code==='resource-exhausted')quota.quotaMessage='Quota reached';}},
  '../shared/order-scope':{orderScopeKey},'../shared/product-snapshot':{mergeProductSnapshot},'../shared/database-errors':{databaseErrorMessage:(_:any,fallback:string)=>fallback},
  'firebase/firestore':{collection:(_:any,name:string)=>({name}),where:(field:string,op:string,value:string)=>({field,op,value}),query:(ref:any,...constraints:any[])=>({...ref,constraints}),onSnapshot:(ref:any,options:any,next:any,error:any)=>{const record={ref,options,next,error,stopped:false};records.push(record);return()=>record.stopped=true;}}};
 const output:any={};runInNewContext(ts.transpileModule(readFileSync(new URL('../hooks/useSupplierProducts.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:output,require:(id:string)=>{assert.ok(modules[id],id);return modules[id];},JSON});
 return {state,quota,records,render(id:string,fullIntegrity=false){let result:any;for(let n=0;n<10;n++){index=0;pending=[];updated=false;result=output.useSupplierProducts(id,fullIntegrity);pending.forEach(fn=>fn());if(!updated)return result;}throw Error('Render loop');},snapshot(record:any,products:any[],fromCache=false){record.next({metadata:{fromCache},docs:products.map(p=>({id:p.id,data:()=>p}))});}};
}

test('blank supplier costs zero product reads; a selected supplier uses exactly one scoped query',()=>{
 const h=harness();assert.equal(h.render('').ready,false);assert.equal(h.records.length,0);
 assert.equal(h.render('jfc').ready,false);assert.equal(h.records.length,1);
 assert.equal(h.records[0].ref.name,'products');assert.deepEqual(JSON.parse(JSON.stringify(h.records[0].ref.constraints)),[{field:'supplierId',op:'==',value:'jfc'}]);
 for(let i=0;i<20;i++)h.render('jfc');assert.equal(h.records.length,1);
});

test('cached or incomplete data cannot enable export/import; a confirmed empty supplier can',()=>{
 const h=harness();h.render('jfc');const r=h.records[0];
 h.snapshot(r,[],true);assert.equal(h.render('jfc').ready,false);
 h.snapshot(r,[]);assert.equal(h.render('jfc').ready,true);
 h.snapshot(r,[],true);assert.equal(h.render('jfc').ready,false);
});

test('switching, finishing and leaving release reads; a late previous-supplier response is ignored',()=>{
 const h=harness();h.state.products=[{id:'other',supplierId:'other'}];h.render('jfc');const first=h.records[0];
 h.snapshot(first,[{id:'a',supplierId:'jfc'}]);assert.equal(h.render('jfc').ready,true);
 assert.equal(h.render('next').ready,false);assert.equal(first.stopped,true);
 h.snapshot(first,[{id:'late',supplierId:'jfc'}]);assert.equal(h.state.products.some((p:any)=>p.id==='late'),false);
 h.snapshot(h.records[1],[{id:'b',supplierId:'next'}]);assert.equal(h.render('next').ready,true);assert.equal(h.state.products.length,3);
 h.render('');assert.ok(h.records.every(r=>r.stopped));assert.equal(h.records.length,2);
});

test('scope revocation and quota failures disable editing and do not automatically retry',()=>{
 const h=harness();h.render('jfc');h.records[0].error({code:'resource-exhausted'});
 assert.equal(h.render('jfc').ready,false);assert.equal(h.records[0].stopped,true);
 h.render('other');h.render('');h.render('jfc');assert.equal(h.records.length,1);
 h.quota.quotaMessage='';h.state.currentUser=null;h.render('jfc');assert.equal(h.records.length,1);
});

test('supplier changes replace only their own records, including deleted items',()=>{
 const h=harness();h.render('jfc');const r=h.records[0];h.state.products=[{id:'other',supplierId:'other'}];
 h.snapshot(r,[{id:'a',supplierId:'jfc'},{id:'b',supplierId:'jfc'}]);h.snapshot(r,[{id:'b',supplierId:'jfc',casePrice:25}]);
 assert.deepEqual(h.state.products.map((p:any)=>p.id),['other','b']);assert.equal(h.state.products[1].casePrice,25);
});

test('supplier removal loads the full integrity reference set only while requested',()=>{
 const h=harness();h.render('',true);assert.equal(h.records.length,0);
 h.render('jfc',true);assert.equal(h.records[0].ref.name,'products');assert.equal(h.records[0].ref.constraints,undefined);
 h.snapshot(h.records[0],[{id:'source',supplierId:'jfc',categoryId:'c'},{id:'foreign',supplierId:'other',categoryId:'c'}]);assert.equal(h.render('jfc',true).ready,true);assert.equal(h.state.products.length,2);h.render('',true);assert.equal(h.records[0].stopped,true);
});


test('restricted supplier loads the safe server projection instead of a direct product listener',()=>{
 const h=harness();h.state.currentUser={id:'staff',role:'STAFF',active:true,permissionMode:'CUSTOM',customPermissions:[]};
 h.render('jfc');assert.equal(h.records.length,1);assert.equal(h.records[0].ref,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(h.records[0].request)),{resource:'products',supplierId:'jfc'});
 h.records[0].next([{id:'safe',name:'Rice',supplierId:'jfc'}]);assert.equal(h.render('jfc').ready,true);
 assert.equal(h.state.products[0].casePrice,undefined);h.render('');assert.equal(h.records[0].stopped,true);
});
