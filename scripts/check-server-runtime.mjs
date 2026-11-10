import assert from 'node:assert/strict';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';

// Run with plain Node, not tsx: production does not resolve extensionless TS imports.
// This check must never open a network connection or initialise Firebase.
const forbidNetwork=()=>{throw new Error('Network is forbidden in the server runtime check');};
globalThis.fetch=forbidNetwork;
net.Socket.prototype.connect=forbidNetwork;
syncBuiltinESMExports();

const {default:handler}=await import('../api/admin/workspace.ts');
const {getApps}=await import('firebase-admin/app');
assert.equal(getApps().length,0,'Loading the workspace must not initialise Firebase');
for(const [method,expected] of [['GET',405],['POST',401]]){
 let status,body;
 const res={setHeader(){},status(value){status=value;return this;},json(value){body=value;return this;}};
 await handler({method,headers:{},body:{action:'catalog-preview'}},res);
 assert.equal(status,expected);
 assert.ok(body.error);
}
assert.equal(getApps().length,0,'Rejected requests must not initialise Firebase');
console.log('Native server startup passed; no Firebase initialisation or network access.');
