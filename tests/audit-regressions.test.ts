import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareInvoiceReview} from '../server/invoice-workflow-service.ts';
import {prepareFulfillment} from '../server/fulfillment-workflow-service.ts';
import {verifySession,activeProfile} from '../server/verified-identity.ts';
import {validCalendarDate} from '../shared/calendar-date.ts';
const order:any={id:'audit',status:'PLACED',branchId:'b',supplierId:'s',items:[{productId:'p',productNameSnapshot:'Rice',caseQty:10,packQty:0,casePriceSnapshot:10,packPriceSnapshot:2,vatRate:.2}],manualItems:[]};
const user={id:'owner',displayName:'QA'};
const line={lineId:'p',deliveredCaseQty:8,deliveredPackQty:0,invoicedCaseQty:10,invoicedPackQty:0,invoicedCasePrice:10,invoicedPackPrice:2,isReviewed:true,receiptConfirmed:true};
const invoice={invoiceNumber:'INV1',invoiceDate:'2026-10-11',lines:[line]};
test('draft save/reopen never silently fills an unentered invoice price',()=>{
 const result=prepareInvoiceReview(order,{...invoice,draft:true,lines:[{...line,invoicedCasePrice:undefined}]},user);
 const reopened=result.invoiceVerification!.lines![0];
 assert.equal(reopened.invoicedCasePrice,undefined);
 assert.throws(()=>prepareInvoiceReview(order,{...invoice,lines:[reopened]},user),/invoice price/);
});
test('calculated invoice totals recalculate after reopen; explicit discounted totals survive',()=>{
 const saved=prepareInvoiceReview(order,invoice,user).invoiceVerification!.lines![0];
 assert.equal(saved.enteredLineTotal,undefined);
 const reopened={...saved,invoicedCaseQty:9,invoicedLineTotal:saved.enteredLineTotal};
 assert.equal(prepareInvoiceReview(order,{...invoice,lines:[reopened]},user).invoiceVerification?.netTotal,90);
 const discounted=prepareInvoiceReview(order,{...invoice,lines:[{...line,invoicedLineTotal:95}]},user).invoiceVerification!.lines![0];
 assert.equal(discounted.enteredLineTotal,95);
});
test('correcting a shortage clears an unsent credit claim',()=>{
 const previous=prepareInvoiceReview(order,invoice,user);
 const fixed=prepareInvoiceReview({...order,...previous},{...invoice,lines:[{...line,deliveredCaseQty:10}]},user);
 assert.equal(fixed.creditNoteClaim,null);assert.equal(fixed.invoiceVerification?.discrepancyTotal,0);
});
test('editing a draft does not rewrite a previously confirmed claim or its evidence',()=>{
 const previous=prepareInvoiceReview(order,invoice,user);
 const before=JSON.stringify(previous.creditNoteClaim);
 const draft=prepareInvoiceReview({...order,...previous},{...invoice,draft:true,evidence:[]},user);
 assert.equal(Object.hasOwn(draft,'creditNoteClaim'),false);assert.equal(JSON.stringify(previous.creditNoteClaim),before);
});
test('invoice review retains saved VAT when the client omits it',()=>{
 assert.equal(prepareInvoiceReview(order,invoice,user).invoiceVerification?.vatTotal,20);
});
test('invoice numbers and calendar dates are validated without truncating duplicate keys',()=>{
 assert.throws(()=>prepareInvoiceReview(order,{...invoice,invoiceNumber:'x'.repeat(121)},user),/120/);
 assert.throws(()=>prepareInvoiceReview(order,{...invoice,invoiceDate:'2026-02-30'},user),/date/);
 assert.equal(validCalendarDate('2024-02-29'),true);assert.equal(validCalendarDate('2025-02-29'),false);
});
test('fulfillment cannot rewrite order prices, custom items or claim records',()=>{
 const changes={items:[{...order.items[0],sentCaseQty:8,sentPackQty:0}],manualItems:[]};
 const good=prepareFulfillment(order,changes);assert.equal(good.fulfillmentStatus,'PARTIAL');assert.equal(good.items[0].casePriceSnapshot,10);
 assert.throws(()=>prepareFulfillment(order,{...changes,items:[{...changes.items[0],casePriceSnapshot:1}]}),/historical prices/);
 assert.throws(()=>prepareFulfillment(order,{...changes,creditNoteClaim:{}}),/Only dispatch/);
 assert.throws(()=>prepareFulfillment(order,{...changes,items:[{...changes.items[0],sentCaseQty:11}]}),/ordered quantity/);
});
test('failed or revoked token verification has no weaker fallback',async()=>{
 let calls=0;
 await assert.rejects(verifySession({verifyIdToken:async(_token:string,revocation:boolean)=>{calls++;assert.equal(revocation,true);throw new Error('revoked');}},'forged.payload.signature'),/revoked/);
 assert.equal(calls,1);
});
test('missing and inactive server profiles cannot fall back to seed accounts',async()=>{
 for(const value of [undefined,{role:'CREATOR'},{role:'CREATOR',active:false}]){
  const db={collection:()=>({doc:()=>({get:async()=>({exists:!!value,data:()=>value})})})};
  assert.equal(await activeProfile(db,'u_ht_admin'),undefined);
 }
});
