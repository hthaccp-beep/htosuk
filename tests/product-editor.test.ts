import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changedProductFields,moveProductRow,productEditorErrors} from '../shared/product-editor.ts';
import type {Product} from '../types.ts';
const product={id:'one',name:'Rice',categoryId:'dry',supplierId:'supplier',active:true,allowedBranchIds:[],casePrice:12,packPrice:2,displayOrder:1} as Product;
test('edit tracking handles undo, blank optional values and branch changes',()=>{
 assert.deepEqual(changedProductFields(product,{...product,chineseName:undefined}),[]);
 assert.deepEqual(changedProductFields(product,{...product,name:'Brown rice',allowedBranchIds:['branch']}),['name','allowedBranchIds']);
 assert.deepEqual(changedProductFields(product,{...product}),[]);
});
test('row move clamps positions, preserves all products and does not mutate source',()=>{
 const rows=[{id:'one'},{id:'two'},{id:'three'}];
 assert.deepEqual(moveProductRow(rows,'three',1).map(r=>r.id),['three','one','two']);
 assert.deepEqual(moveProductRow(rows,'one',99).map(r=>r.id),['two','three','one']);
 assert.deepEqual(moveProductRow(rows,'two',-1).map(r=>r.id),['two','one','three']);
 assert.equal(moveProductRow(rows,'unknown',2),rows);assert.equal(moveProductRow(rows,'one',NaN),rows);
 assert.deepEqual(rows.map(r=>r.id),['one','two','three']);
});
test('review validation distinguishes missing names and invalid prices from zero or unchanged prices',()=>{
 assert.deepEqual(productEditorErrors({...product,casePrice:0,packPrice:undefined}),[]);
 assert.equal(productEditorErrors({...product,name:' ',categoryId:'',casePrice:-1,packPrice:Infinity}).length,4);
});
