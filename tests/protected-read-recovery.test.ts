import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {coalescePending} from '../shared/pending-request.ts';
import {readApiResponse} from '../shared/api-response.ts';
import {isDatabaseQuotaError} from '../shared/database-errors.ts';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function fixture() {
 const handlers=new Map<string,Set<()=>void>>(),calls:any[]=[],values:any[]=[],errors:any[]=[];
 const account={uid:crypto.randomUUID(),getIdToken:async()=>'synthetic-token'};
 const auth:{currentUser:typeof account|null}={currentUser:account};
 const document={visibilityState:'visible'};
 const window={addEventListener:(name:string,fn:()=>void)=>{if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name)!.add(fn);},removeEventListener:(name:string,fn:()=>void)=>handlers.get(name)?.delete(fn)};
 const modules:any={'../firebase-config':{auth},'../shared/pending-request':{coalescePending},'../shared/api-response':{readApiResponse},'../shared/database-errors':{isDatabaseQuotaError}};
 const exports:any={};
 const source=readFileSync(new URL('../utils/secureRead.ts',import.meta.url),'utf8');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(key:string)=>{if(!(key in modules))throw Error('Unexpected module: '+key);return modules[key];},window,document,fetch:(url:string,options:any)=>new Promise((resolve,reject)=>calls.push({url,body:JSON.parse(options.body),resolve,reject}))});
 return {calls,values,errors,auth,document,handlers,emit:(name:string)=>handlers.get(name)?.forEach(fn=>fn()),start:()=>exports.subscribeProtectedRecords({resource:'products',supplierId:'synthetic-supplier'},(value:any)=>values.push(value),(error:any)=>errors.push(error)),reply:(index:number,records:any[],cursor?:string)=>calls[index].resolve(Response.json({records,cursor}))};
}

test('save notification during a pending read gets one fresh read, even after a burst of notifications',async()=>{
 const f=fixture(),stop=f.start();await flush();assert.equal(f.calls.length,1);
 for(let i=0;i<20;i++)f.emit('htos-data-changed');
 f.reply(0,[{id:'old'}]);await flush();
 assert.equal(f.calls.length,2,'the update must not be lost while the old response is in flight');
 f.reply(1,[{id:'new'}]);await flush();assert.equal(f.values.at(-1)[0].id,'new');assert.equal(f.calls.length,2);stop();
});

test('reconnecting a visible failed view retries once without polling',async()=>{
 const f=fixture(),stop=f.start();await flush();f.calls[0].reject(new TypeError('Offline'));await flush();
 assert.equal(f.errors.length,1);assert.equal(f.calls.length,1);
 f.emit('online');await flush();assert.equal(f.calls.length,2);
 f.reply(1,[{id:'recovered'}]);await flush();assert.equal(f.values.at(-1)[0].id,'recovered');stop();
});

test('quota failure drops queued refreshes and stops automatic retries',async()=>{
 const f=fixture(),stop=f.start();await flush();f.emit('htos-data-changed');
 f.calls[0].resolve(Response.json({error:'Database quota exceeded'},{status:503}));await flush();
 for(const event of ['online','focus','htos-data-changed'])f.emit(event);await flush();
 assert.equal(f.calls.length,1);assert.equal(f.errors.length,1);stop();
});

test('disposing a pending view removes listeners, queued work and late callbacks',async()=>{
 const f=fixture(),stop=f.start();await flush();f.emit('htos-data-changed');stop();f.reply(0,[{id:'late'}]);await flush();
 for(const event of ['online','focus','htos-data-changed'])f.emit(event);await flush();
 assert.equal(f.calls.length,1);assert.equal(f.values.length,0);assert.equal(f.errors.length,0);
 assert.ok([...f.handlers.values()].every(list=>list.size===0));
});

test('concurrent consumers share pages, failed pagination publishes no partial list and explicit retry starts from page one',async()=>{
 const f=fixture(),a=f.start(),b=f.start();await flush();assert.equal(f.calls.length,1);
 f.reply(0,[{id:'page-one'}],'next');await flush();assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.cursor,'next');
 f.calls[1].reject(new TypeError('Connection interrupted'));await flush();assert.equal(f.values.length,0);assert.equal(f.errors.length,2);
 f.emit('focus');await flush();assert.equal(f.calls.length,3);assert.equal(f.calls[2].body.cursor,undefined);
 f.reply(2,[{id:'complete'}]);await flush();assert.equal(f.values.length,2);a();b();
});

test('focus bursts and hidden reconnects do not add reads; signed-out retry cannot fetch',async()=>{
 const f=fixture(),stop=f.start();await flush();for(let i=0;i<30;i++)f.emit('focus');assert.equal(f.calls.length,1);
 f.reply(0,[]);await flush();assert.equal(f.calls.length,1);
 f.document.visibilityState='hidden';f.emit('online');f.emit('focus');await flush();assert.equal(f.calls.length,1);
 f.document.visibilityState='visible';f.auth.currentUser=null;f.emit('focus');await flush();assert.equal(f.calls.length,1);assert.match(f.errors.at(-1).message,/sign in again/);stop();
});
