import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

test('after quota detection, catalogue actions stop locally without token or API requests',async()=>{
 let tokens=0,requests=0;const state={quotaMessage:'Database quota reached'};
 const modules:any={
  '../../shared/order-reference.ts':{},'../../shared/database-errors':{},'../../shared/api-response':{readApiResponse:async()=>({ok:true})},
  '../../hooks/databaseStatus':{useDatabaseStatus:{getState:()=>state},reportDatabaseError:()=>{}},
  '../../shared/pending-work':{beginPendingWork:()=>()=>{}},
  react:{},'lucide-react':{},'../../firebase-config':{auth:{currentUser:{getIdToken:async()=>{tokens++;return 'test';}}}},'../../utils/orderPricing':{}
 };
 const output:any={};runInNewContext(ts.transpileModule(readFileSync(new URL('../app/htos/ui.tsx',import.meta.url),'utf8'),{fileName:'ui.tsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:output,require:(key:string)=>{assert.ok(modules[key],key);return modules[key];},fetch:async()=>{requests++;return {};},Intl,JSON,Error,Object});
 for(const action of ['catalog-preview','catalog-commit','product-bulk'])await assert.rejects(output.api('/api/admin/workspace',{action}),(e:any)=>e.code==='DATABASE_QUOTA_EXCEEDED');
 assert.equal(tokens,0);assert.equal(requests,0);
 state.quotaMessage='';assert.deepEqual(JSON.parse(JSON.stringify(await output.api('/api/admin/workspace',{action:'catalog-preview'}))),{ok:true});assert.equal(requests,1);
});
