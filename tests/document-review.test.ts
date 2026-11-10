import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentReviewLines,deliveryReviewLines} from '../shared/document-review';
import {supplierDispatchAccess} from '../shared/dispatch-access';
const order:any={id:'o',status:'PLACED',supplierId:'s',items:[{productId:'p',productNameSnapshot:'Rice',caseQty:10,packQty:0,casePriceSnapshot:18,packPriceSnapshot:3}],manualItems:[{id:'m',description:'Special',caseQty:0,packQty:2}]};
test('new document retains unknown quantities and prices',()=>{
 for(const kind of ['DELIVERY','INVOICE'] as const){const lines=documentReviewLines(order,kind);assert.equal(lines.length,2);assert.equal(lines[0].deliveredCaseQty,undefined);assert.equal(lines[0].invoicedCasePrice,undefined);assert.equal(lines[0].invoicedCaseQty,undefined);assert.equal(lines[0].expectedCasePrice,18);}
});
test('delivery drafts round-trip manual items, extra flags and missing counts',()=>{
 const original=deliveryReviewLines(documentReviewLines(order,'DELIVERY'));original[0]={...original[0],documentCases:10,receivedCases:8,receivedUnits:0,damagedCases:1,issue:'EXTRA',notes:'Extra bag',checked:true};
 const saved={...order,deliveryCheck:{draft:true,lines:original}};
 assert.deepEqual(deliveryReviewLines(documentReviewLines(saved,'DELIVERY')),original);
 assert.equal(documentReviewLines(saved,'INVOICE')[0].deliveredCaseQty,undefined);
 saved.deliveryCheck.draft=false;const invoice=documentReviewLines(saved,'INVOICE')[0];
 assert.equal(invoice.deliveredCaseQty,8);assert.equal(invoice.invoicedCaseQty,undefined);assert.equal(invoice.invoicedCasePrice,undefined);assert.equal(invoice.isReviewed,false);
});
test('owner override still rejects inactive, external and archived orders',()=>{
 const owner:any={role:'CREATOR',active:true},suppliers:any=[{id:'s',active:true,linkedBranchId:'b'}],branches:any=[{id:'b',active:true,actsAsSupplier:true}];
 assert.equal(supplierDispatchAccess(owner,order,suppliers,branches).allowed,true);
 assert.equal(supplierDispatchAccess({...owner,role:'GM'},order,suppliers,branches).allowed,false);
 assert.equal(supplierDispatchAccess({...owner,active:false},order,suppliers,branches).allowed,false);
 assert.equal(supplierDispatchAccess(owner,{...order,archived:true},suppliers,branches).allowed,false);
 assert.equal(supplierDispatchAccess(owner,order,[{...suppliers[0],linkedBranchId:undefined}],branches).allowed,false);
 assert.equal(supplierDispatchAccess(owner,order,suppliers,[{...branches[0],active:false}]).allowed,false);
});
