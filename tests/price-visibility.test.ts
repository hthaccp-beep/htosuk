import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productWithoutPrices,orderWithoutPrices} from '../shared/price-visibility.ts';
test('restricted catalogue omits present and future financial fields without changing the original',()=>{
 const product={id:'p',supplierId:'s',name:'Rice',casePrice:18,packPrice:3,vatRate:.2,cost:12,futurePrice:99,packSize:'6 x 1kg'};
 assert.deepEqual(productWithoutPrices(product),{id:'p',supplierId:'s',name:'Rice',packSize:'6 x 1kg'});
 assert.equal(product.casePrice,18);
});
test('restricted order keeps quantities and identity, never invoice amounts, source documents or price snapshots',()=>{
 const order={id:'o',status:'PLACED',branchId:'b',supplierId:'s',items:[{productId:'p',caseQty:2,packQty:0,casePriceSnapshot:18,vatRate:.2}],manualItems:[{id:'m',description:'Sample',caseQty:1,packQty:0,packPriceSnapshot:3}],invoiceVerification:{total:36},scannedInvoiceUrl:'price-document',creditNoteClaim:{totalClaimAmount:3},minimumOrderCheck:{subtotal:36},_entryRevision:2};
 const before=JSON.stringify(order),safe=orderWithoutPrices(order);
 assert.deepEqual(safe.items,[{productId:'p',caseQty:2,packQty:0}]);
 assert.deepEqual(safe.manualItems,[{id:'m',description:'Sample',caseQty:1,packQty:0}]);
 for(const field of ['invoiceVerification','scannedInvoiceUrl','creditNoteClaim'])assert.ok(!(field in safe));
 assert.deepEqual(safe.minimumOrderCheck,{});
 assert.equal(safe._entryRevision,2);assert.equal(JSON.stringify(order),before);
});

test('restricted history retains operational minimum follow-up without amounts',()=>{
 assert.deepEqual(orderWithoutPrices({minimumOrderCheck:{needsFollowUp:true,unpricedItems:2,subtotal:12,minimum:50,shortfall:38}}).minimumOrderCheck,{needsFollowUp:true,unpricedItems:2});
});
