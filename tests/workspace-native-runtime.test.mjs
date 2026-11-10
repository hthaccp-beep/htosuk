import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('workspace starts in native Node TypeScript mode and rejects unauthenticated requests before Firebase initialisation',()=>{
 const result=spawnSync(process.execPath,['scripts/check-server-runtime.mjs'],{
  cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:''},
 });
 assert.equal(result.status,0,result.stderr||result.error?.message);
 assert.match(result.stdout,/Native server startup passed/);
});
