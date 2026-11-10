import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

test('frozen and cached pages release listeners and restore once, disposed consumers stay stopped',()=>{
 const handlers:Record<string,()=>void>={},keys:string[]=[];let stops=0;
 const surface={addEventListener:(name:string,fn:()=>void)=>handlers[name]=fn};
 const modules:any={'../firebase-config':{firebaseConfig:{projectId:'test-project'}},'../shared/shared-listener.ts':{createSharedListeners:()=>((key:string)=>{keys.push(key);return()=>stops++;})}};
 const output:any={};const source=ts.transpileModule(readFileSync(new URL('../hooks/sharedFirestore.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(source,{exports:output,require:(key:string)=>modules[key],window:surface,document:surface,Set,JSON});
 const a=output.shareFirestore('user-a','products',()=>{},()=>{},()=>{});
 assert.deepEqual(JSON.parse(keys[0]),['test-project','user-a','products']);
 handlers.pagehide();handlers.freeze();assert.equal(stops,1);
 const b=output.shareFirestore('user-b','orders',()=>{},()=>{},()=>{});assert.equal(keys.length,1);
 handlers.pageshow();handlers.resume();assert.equal(keys.length,3);
 handlers.freeze();assert.equal(stops,3);a();
 handlers.resume();assert.equal(keys.length,4);assert.ok(keys.at(-1)?.includes('user-b'));b();assert.equal(stops,4);
 handlers.pagehide();handlers.pageshow();assert.equal(keys.length,4);
});
