import {test} from 'node:test';
import assert from 'node:assert/strict';
import {basketAfterDetailsChange} from '../app/htos/orderDetails';
import type {Product,OrderItem,ManualOrderItem} from '../types';
const previous={branchId:'a',supplierId:'s',date:'2026-10-20'};
const items=[{productId:'shared',productNameSnapshot:'Rice',caseQty:2,packQty:0,casePriceSnapshot:24},{productId:'local',productNameSnapshot:'Sauce',caseQty:1,packQty:0}] as OrderItem[];
const manual=[{id:'custom',description:'Packaging',caseQty:1,packQty:0}] as ManualOrderItem[];
const products=[{id:'shared',supplierId:'s',active:true,allowedBranchIds:[]},{id:'local',supplierId:'s',active:true,allowedBranchIds:['a']}] as Product[];
test('date edits retain all quantities, custom items and saved prices without requiring catalogue data',()=>{
 const result=basketAfterDetailsChange(previous,{...previous,date:'2026-10-21'},items,manual,[]);
 assert.equal(result.items,items);assert.equal(result.manual,manual);assert.deepEqual(result.removed,[]);
});
test('branch edits retain eligible lines and explicitly identify unavailable lines',()=>{
 const original=structuredClone({items,manual,products});
 const result=basketAfterDetailsChange(previous,{...previous,branchId:'b'},items,manual,products);
 assert.deepEqual(result.items,[items[0]]);assert.equal(result.manual,manual);assert.deepEqual(result.removed,['Sauce']);
 assert.deepEqual({items,manual,products},original);
});
test('supplier edits do not carry unrelated catalogue or custom items across',()=>{
 const result=basketAfterDetailsChange(previous,{...previous,supplierId:'other'},items,manual,products);
 assert.deepEqual(result.items,[]);assert.deepEqual(result.manual,[]);assert.deepEqual(result.removed,['Rice','Sauce','Packaging']);
});
test('inactive and missing products cannot survive a scope change',()=>{
 const result=basketAfterDetailsChange(previous,{...previous,branchId:'b'},items,manual,[{...products[0],active:false}]);
 assert.deepEqual(result.items,[]);assert.deepEqual(result.removed,['Rice','Sauce']);
});
