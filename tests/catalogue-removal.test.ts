import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supplierRemoval,categoryRemoval} from '../shared/catalogue-removal.ts';
const products:any[]=[{id:'p',supplierId:'old',categoryId:'c'}];
const categories:any[]=[{id:'c',supplierId:'old',active:true},{id:'c2',supplierId:'old',active:true}];
const suppliers:any[]=[{id:'old',active:true},{id:'new',active:true}];
test('supplier reassignment moves categories with products in the same atomic plan',()=>{
 const plan=supplierRemoval('old','new',products,categories,suppliers);
 assert.deepEqual(plan.find(c=>c.id==='p')?.patch,{supplierId:'new'});assert.deepEqual(plan.find(c=>c.id==='c')?.patch,{supplierId:'new'});
 assert.deepEqual(plan.at(-1),{collection:'suppliers',id:'old'});
});
test('linked supplier and category removal cannot leave orphan records',()=>{
 assert.throws(()=>supplierRemoval('old',undefined,products,categories,suppliers),/Reassign/);
 assert.throws(()=>categoryRemoval('c',undefined,products,categories),/Reassign/);
 assert.throws(()=>supplierRemoval('old','old',products,categories,suppliers),/replacement/);
 assert.throws(()=>categoryRemoval('c','foreign',products,[...categories,{id:'foreign',supplierId:'other',active:true}] as any),/same supplier/);
});
test('oversized removal refuses before any write instead of partially moving a catalogue',()=>{
 assert.throws(()=>supplierRemoval('old','new',Array.from({length:500},(_,i)=>({...products[0],id:String(i)})),categories,suppliers),/too large/);
 assert.equal(categoryRemoval('c','c2',products,categories)[0].patch?.categoryId,'c2');
});
