import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyDayGroups} from '../app/htos/historyDayGroups.ts';

test('keeps every order exactly once in supplied newest-first order',()=>{
  const rows=Array.from({length:36},(_,i)=>({id:i,createdAt:`2026-11-02T${String(20-Math.floor(i/6)).padStart(2,'0')}:00:00Z`}));
  const old={id:36,createdAt:'2026-11-01T20:00:00Z'};
  const groups=historyDayGroups([...rows,old]);
  assert.deepEqual(groups.map(g=>g.orders.length),[36,1]);
  assert.deepEqual(groups.flatMap(g=>g.orders),[...rows,old]);
  assert.equal(groups[0].label,'Mon, 2 Nov 2026');
});
test('groups summer midnight by London date, not UTC date',()=>{
  const groups=historyDayGroups([{createdAt:'2026-07-01T23:30:00Z'},{createdAt:'2026-07-01T22:30:00Z'}]);
  assert.deepEqual(groups.map(g=>g.key),['2026-07-02','2026-07-01']);
});
test('retains both orders across the autumn clock change in the same day',()=>{
  const groups=historyDayGroups([{createdAt:'2026-10-25T01:30:00Z'},{createdAt:'2026-10-25T00:30:00Z'}]);
  assert.equal(groups.length,1);assert.equal(groups[0].orders.length,2);
});
test('empty lists and invalid legacy dates do not lose records or throw',()=>{
  assert.deepEqual(historyDayGroups([]),[]);
  const order={createdAt:'not a date'};
  assert.deepEqual(historyDayGroups([order]),[{key:'unknown',label:'Order date unavailable',orders:[order]}]);
});
