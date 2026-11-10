import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';

// Exercise the real server handlers without any cloud credentials or network.
const forbid=()=>{throw new Error('Network forbidden in domain compatibility tests');};
globalThis.fetch=forbid;
net.Socket.prototype.connect=forbid;
syncBuiltinESMExports();
Object.assign(process.env,{NODE_ENV:'production',HTOS_MODE:'cloud',FIREBASE_PROJECT_ID:'isolated-domain-check',HTOS_CLOUD_PROJECT_ID:'isolated-domain-check',HTOS_ENABLE_EMAIL:'true',HTOS_ENABLE_OCR:'true'});
delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
const handlers=await Promise.all(['admin/workspace','auth-sync','admin/users','scan-invoice','admin/branch-email','send-email'].map(async name=>({name,handler:(await import('../api/'+name+'.ts')).default})));
const {getApps}=await import('firebase-admin/app');
function response(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){return this;}};}
for(const host of ['htosuk.vercel.app','htos-ten.vercel.app']){
 for(const {name,handler} of handlers)test(`${host}: ${name} refuses unauthenticated actions before Firebase`,async()=>{
  const res=response();
  await handler({method:name==='admin/branch-email'?'GET':'POST',headers:{origin:'https://'+host,host},body:{},query:{}},res);
  assert.equal(res.statusCode,401);assert.equal(getApps().length,0);
  if(res.headers['access-control-allow-origin'])assert.equal(res.headers['access-control-allow-origin'],'https://'+host);
 });
 for(const {name,handler} of handlers.filter(h=>['admin/branch-email','send-email'].includes(h.name)))test(`${host}: ${name} accepts same-origin preflight without Firebase`,async()=>{
  const res=response();await handler({method:'OPTIONS',headers:{origin:'https://'+host,host},body:{},query:{}},res);
  assert.equal(res.statusCode,204);assert.equal(res.headers['access-control-allow-origin'],'https://'+host);assert.equal(getApps().length,0);
 });
}
