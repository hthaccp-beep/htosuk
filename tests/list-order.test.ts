import test from 'node:test';
import assert from 'node:assert/strict';
import {savedListOrder,planListMove,nextListPosition,canArrangeSuppliers} from '../shared/list-order.ts';

test('branches and suppliers use saved positions without changing the input',()=>{
 const input=[{id:'third',displayOrder:3000},{id:'first',displayOrder:1000},{id:'second',displayOrder:2000}];
 const before=structuredClone(input);
 assert.deepEqual(savedListOrder(input).map(s=>s.id),['first','second','third']);
 assert.deepEqual(input,before);
});
test('legacy positions remain stable, including zero and invalid old values',()=>{
 const input=[{id:'none'},{id:'zero',displayOrder:0},{id:'invalid',displayOrder:NaN},{id:'negative',displayOrder:-1000}];
 assert.deepEqual(savedListOrder(input).map(s=>s.id),['negative','none','zero','invalid']);
 assert.equal(nextListPosition(input),1000);
});
test('moving up, down and between records persists only the moved position',()=>{
 const list=[{id:'a',displayOrder:1000},{id:'b',displayOrder:2000},{id:'c',displayOrder:3000}];
 for(const [from,to,expected] of [[2,0,['c','a','b']],[0,2,['b','c','a']],[2,1,['a','c','b']]] as const){
  const changes=planListMove(list,from,to);assert.equal(changes.length,1);
  assert.deepEqual(savedListOrder(list.map(s=>({...s,...changes.find(c=>c.id===s.id)}))).map(s=>s.id),expected);
  assert.deepEqual(Object.keys(changes[0]).sort(),['displayOrder','id']);
 }
 assert.deepEqual(planListMove(list,1,1),[]);
});
test('equal old positions are repaired in one plan and survive a shuffled reload',()=>{
 const list=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
 const changes=planListMove(list,3,1);
 const next=list.map(item=>({...item,...changes.find(c=>c.id===item.id)}));
 assert.deepEqual(savedListOrder(next.reverse()).map(s=>s.id),['a','d','b','c']);
 assert.equal(nextListPosition(next),5000);
});
test('invalid drag indices fail before any persistence',()=>{
 for(const [from,to] of [[-1,0],[0,2],[0,0.5],[NaN,0]])assert.throws(()=>planListMove([{id:'a'}],from,to),/list changed/);
});
test('supplier ordering follows existing active owner and GM write access',()=>{
 for(const role of ['CREATOR','GM'])assert.equal(canArrangeSuppliers({active:true,role}),true);
 for(const role of ['ADMIN','MANAGER','STAFF','CUSTOM'])assert.equal(canArrangeSuppliers({active:true,role}),false);
 assert.equal(canArrangeSuppliers({active:false,role:'CREATOR'}),false);
 assert.equal(canArrangeSuppliers(null),false);
});
