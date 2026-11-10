import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeProductSnapshot} from '../shared/product-snapshot.ts';
const existing=[{id:'a',supplierId:'one',name:'Old'},{id:'b',supplierId:'two',name:'Keep'},{id:'c',supplierId:'one',name:'Removed'}];
test('dashboard existence reads do not truncate a previously loaded catalogue',()=>{
 assert.equal(mergeProductSnapshot(existing,[existing[0]]).length,3);
 assert.deepEqual(mergeProductSnapshot(existing,[]),existing);
});
test('supplier snapshot refreshes its records, removes its deleted rows and preserves other suppliers',()=>{
 const result=mergeProductSnapshot(existing,[{id:'a',supplierId:'one',name:'New'}],'one');
 assert.deepEqual(result,[existing[1],{id:'a',supplierId:'one',name:'New'}]);
 assert.deepEqual(existing.map(p=>p.name),['Old','Keep','Removed']);
});
test('empty supplier snapshot removes only that supplier, and repeat snapshots do not duplicate records',()=>{
 assert.deepEqual(mergeProductSnapshot(existing,[],'one'),[existing[1]]);
 assert.equal(mergeProductSnapshot(mergeProductSnapshot(existing,existing,'one'),existing,'one').length,3);
});
