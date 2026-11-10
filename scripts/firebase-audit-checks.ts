import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9095');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const suite=['emulator-smoke','order-scope-smoke','workflow-smoke','admin-workflow-smoke','import-emulator-check','order-list-smoke','product-invoice-smoke','order-entry-smoke'];
const selected=process.argv.slice(2);
assert.ok(selected.every(name=>suite.includes(name)));
for(const name of selected.length?selected:suite){
  const result=spawnSync(process.execPath,['--import','tsx',`scripts/${name}.ts`],{stdio:'inherit',env:process.env});
  if(result.error||result.status!==0)process.exit(result.status||1);
}
