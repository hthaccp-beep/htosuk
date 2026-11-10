import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lineNet,orderMinimum,validateSupplierMinimum} from '../shared/order-minimum';
const item={productId:'p',productNameSnapshot:'Rice',caseQty:2,packQty:3,casePriceSnapshot:18,packPriceSnapshot:3,vatRate:0.2};
test('branch minimum overrides default; zero removes minimum; other branches inherit',()=>{
 const supplier={minimumOrderAmount:100,branchMinimumOrderAmounts:{a:50,b:0}};
 assert.deepEqual(orderMinimum(supplier,'a',[item]),{minimum:50,subtotal:45,shortfall:5,unpricedItems:0,needsFollowUp:true});
 assert.equal(orderMinimum(supplier,'b',[item]).needsFollowUp,false);
 assert.equal(orderMinimum(supplier,'c',[item]).shortfall,55);
 assert.equal(orderMinimum(undefined,'a',[item]).minimum,0);
});
test('minimum compares net amounts with penny rounding; exactly met and over are not flagged',()=>{
 for(const min of [44,45])assert.equal(orderMinimum({minimumOrderAmount:min},'a',[item]).needsFollowUp,false);
 assert.equal(orderMinimum({minimumOrderAmount:50},'a',[item]).subtotal,45);
 assert.equal(lineNet({...item,caseQty:3,casePriceSnapshot:0.1,packQty:0}).amount,0.3);
});
test('missing selected prices and custom estimates remain unknown; unused missing prices do not',()=>{
 assert.equal(lineNet({...item,packPriceSnapshot:undefined}).unpriced,true);
 assert.deepEqual(lineNet({...item,packQty:0,packPriceSnapshot:undefined}),{amount:36,unpriced:false});
 assert.equal(lineNet({...item,casePriceSnapshot:0,packPriceSnapshot:0}).unpriced,false);
 const result=orderMinimum({minimumOrderAmount:50},'a',[{...item,packPriceSnapshot:undefined}],[{id:'m',description:'Special',caseQty:1,packQty:0,casePriceSnapshot:500,pricingStatus:'ESTIMATED'}]);
 assert.equal(result.subtotal,36);assert.equal(result.unpricedItems,2);assert.equal(result.needsFollowUp,true);
});
test('supplier minimum validation rejects invalid amounts and allows zero overrides',()=>{
 for(const amount of [-1,NaN,Infinity,1.001,1000001]) {
  assert.throws(()=>validateSupplierMinimum({minimumOrderAmount:amount}));
  assert.throws(()=>validateSupplierMinimum({branchMinimumOrderAmounts:{a:amount}}));
 }
 assert.doesNotThrow(()=>validateSupplierMinimum({minimumOrderAmount:12.34,branchMinimumOrderAmounts:{a:0}}));
});
