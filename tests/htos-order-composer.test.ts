import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureCurrentPrices, deliveryUpdate, canEditOutgoing } from '../app/htos/orderModel.ts';
import type { OrderRecord, Product, User } from '../types.ts';

const product = {id:'p',name:'Rice',supplierId:'s',casePrice:18,packPrice:3,vatRate:.2,caseUnitName:'Box',packUnitName:'Bag'} as Product;
const order = {id:'o',branchNameSnapshot:'Branch',supplierNameSnapshot:'Supplier',orderedByUserId:'staff',orderedByNameSnapshot:'Staff',createdAt:'2026-10-10',status:'PLACED',emailStatus:'SKIPPED',emailTo:'supplier@example.invalid',branchId:'b',supplierId:'s',items:[{productId:'p',productNameSnapshot:'Old rice name',caseQty:2,packQty:1,casePriceSnapshot:10,packPriceSnapshot:2,sentCaseQty:1,shortageReason:'Last delivery shortage'}],manualItems:[]} as OrderRecord;

test('repeating an order uses current prices and strips previous fulfillment without mutating history',()=>{
  const copy=structuredClone(order);const items=captureCurrentPrices(order.items,[product]);
  assert.equal(items[0].casePriceSnapshot,18);assert.equal(items[0].packPriceSnapshot,3);
  assert.equal(items[0].productNameSnapshot,'Rice');assert.equal(items[0].caseQty,2);
  assert.equal(items[0].caseUnitSnapshot,'Box');assert.equal(items[0].vatRate,.2);
  assert.equal(items[0].sentCaseQty,undefined);assert.equal(items[0].shortageReason,undefined);
  assert.deepEqual(order,copy);
});
test('a deleted product cannot silently produce a new order with stale pricing',()=>{
  assert.throws(()=>captureCurrentPrices(order.items,[]),/no longer available/);
});
test('supplier fulfillment payload uses only the permitted fields',()=>{
  const user={id:'dispatch',username:'dispatch@example.invalid',displayName:'Dispatch',active:true,role:'STAFF',branchIds:['supplier-branch'],supplierIds:[]} as User;
  const update=deliveryUpdate(order,user,order.items,[],'PARTIAL','Should not be sent');
  assert.deepEqual(Object.keys(update).sort(),['fulfillmentStatus','items','manualItems','processedAt']);
  assert.equal(canEditOutgoing(user,order),false);
});
test('outgoing fulfillment retains notes only while both assignments remain valid',()=>{
  const user={id:'staff',active:true,role:'STAFF',branchIds:['b'],supplierIds:['s']} as User;
  assert.equal(deliveryUpdate(order,user,order.items,[],'FULFILLED','Arrived').fulfillmentNotes,'Arrived');
  assert.equal(canEditOutgoing({...user,supplierIds:[]},order),false);
  assert.equal(canEditOutgoing({...user,active:false},order),false);
});
