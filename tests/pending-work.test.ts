import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginPendingWork,pendingWorkCount,subscribePendingWork} from '../shared/pending-work.ts';

test('concurrent work remains pending until every task ends; completion is idempotent',()=>{
  const changes:number[]=[];
  const unsubscribe=subscribePendingWork(()=>changes.push(pendingWorkCount()));
  const first=beginPendingWork(),second=beginPendingWork();
  assert.equal(pendingWorkCount(),2);
  first();first();assert.equal(pendingWorkCount(),1);
  second();assert.equal(pendingWorkCount(),0);
  assert.deepEqual(changes,[1,2,1,0]);
  unsubscribe();const last=beginPendingWork();last();assert.deepEqual(changes,[1,2,1,0]);
});
