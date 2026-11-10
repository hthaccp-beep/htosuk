import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentNumber,documentUnit,normaliseScannedNumbers,scannedLine,hasDocumentPrices} from '../shared/document-scan';
import {documentReviewLines} from '../shared/document-review';
import {prepareInvoiceReview} from '../server/invoice-workflow-service';
import {invoiceFlags} from '../shared/invoice-flags';
const order:any={id:'o',status:'PLACED',supplierId:'s',manualItems:[],items:[{productId:'p',productNameSnapshot:'Rice',caseQty:2,packQty:0,casePriceSnapshot:18,packPriceSnapshot:3}]};
const user={id:'u',displayName:'QA'};
const line=()=>documentReviewLines(order,'DELIVERY')[0];
test('OCR missing numbers remain missing and explicit zero survives',()=>{
 const missing=normaliseScannedNumbers({});
 assert.equal(missing.quantity,undefined);assert.equal(missing.casePrice,undefined);assert.equal(missing.totalPrice,undefined);assert.equal(missing.unitTypeDetected,'');
 assert.equal(normaliseScannedNumbers({quantity:0,casePrice:0}).quantity,0);
 for(const bad of ['',null,undefined,'unknown','1e3',-1,Infinity,'12oops'])assert.equal(documentNumber(bad),undefined);
 assert.equal(documentNumber('£1,230.50'),1230.5);
});
test('generic prices follow explicit billing unit; unknown unit is not a case',()=>{
 assert.equal(normaliseScannedNumbers({unit:'PACK',price:3}).packPrice,3);
 assert.equal(normaliseScannedNumbers({unit:'PACK',price:3}).casePrice,undefined);
 assert.equal(normaliseScannedNumbers({unit:'KG',price:3}).casePrice,undefined);
 assert.equal(documentUnit('KG'),'');assert.equal(documentUnit('BX'),'case');
 assert.equal(normaliseScannedNumbers({quantity:2,casePrice:18}).totalPrice,undefined);
});
test('scan suggests quantity and price without confirming receipt or review',()=>{
 const result=scannedLine(line(),{Quantity:2,CasePrice:19},'case');
 assert.equal(result.invoicedCaseQty,2);assert.equal(result.invoicedCasePrice,19);assert.equal(result.invoicedPackPrice,undefined);
 assert.equal(result.deliveredCaseQty,undefined);assert.equal(result.isReviewed,false);
 assert.equal(hasDocumentPrices([result]),true);
 const qtyOnly=scannedLine(line(),{Quantity:2},'case');
 assert.equal(hasDocumentPrices([qtyOnly]),false);assert.equal(qtyOnly.invoicedCasePrice,undefined);
 assert.ok(invoiceFlags(result).includes('Price difference'));
 assert.ok(invoiceFlags(qtyOnly).includes('Document price missing'));
});
const body=()=>({combined:true,expectedDeliveryVersion:0,invoiceNumber:'INV-QA',invoiceDate:'2026-10-13',lines:[{...scannedLine(line(),{Quantity:2,CasePrice:19},'case'),deliveredCaseQty:2,deliveredPackQty:0,receiptConfirmed:true,isReviewed:true}]});
test('combined confirmation saves both records and compares original price',()=>{
 const input=body();input.lines[0].expectedCasePrice=1;
 const result=prepareInvoiceReview(order,input,user);
 assert.equal(result.deliveryCheck?.draft,false);assert.equal(result.deliveryCheck?.lines[0].receivedCases,2);
 assert.equal(result.invoiceVerification?.lines?.[0].expectedCasePrice,18);
 assert.equal(result.creditNoteClaim?.totalClaimAmount,2);
});
test('combined review rejects stale receipt, locked evidence and absent physical counts',()=>{
 assert.throws(()=>prepareInvoiceReview({...order,deliveryCheck:{version:1}},body(),user),/changed/);
 assert.throws(()=>prepareInvoiceReview({...order,supplierCase:{source:'DELIVERY'}},body(),user),/locked/);
 const input:any=body();input.lines[0].deliveredCaseQty=undefined;
 assert.throws(()=>prepareInvoiceReview(order,input,user),/actual received/);
});
test('combined draft reopens unknown quantities and prices without invented defaults',()=>{
 const input={...body(),draft:true,lines:[{...line(),invoicedCasePrice:19}]};
 const result=prepareInvoiceReview(order,input,user);
 const restored=documentReviewLines({...order,...result},'INVOICE')[0];
 assert.equal(restored.invoicedCaseQty,undefined);assert.equal(restored.deliveredCaseQty,undefined);
 assert.equal(restored.invoicedPackPrice,undefined);assert.equal(restored.isReviewed,false);
 assert.equal(result.deliveryCheck?.draft,true);
});
