import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSimpleInvoiceTable,computeClaimSummaryMetrics,computeTableTotalsCheck} from './simple-invoice-table.ts';
import {attachInvoiceExtraction} from '../shared/invoice-extraction.ts';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {sampleReceivedPriceDifference,sampleReviewed} from './fixtures/invoice-workflow.ts';
import type {Product} from '../types.ts';

const catalog:Product[]=[
 {id:'p-rice',itemCode:'R001',name:'Sample rice',categoryId:'c1',supplierId:'sample-foods',displayOrder:1,allowedBranchIds:[],active:true,casePrice:18,caseUnitName:'bags'},
 {id:'p-oil',itemCode:'T006',name:'Sample truffle oil',categoryId:'c1',supplierId:'sample-foods',displayOrder:2,allowedBranchIds:[],active:true,casePrice:24,caseUnitName:'bottles'},
 {id:'p-other-supplier',itemCode:'X999',name:'Other supplier item',categoryId:'c1',supplierId:'other-supplier',displayOrder:1,allowedBranchIds:[],active:true,casePrice:10,caseUnitName:'box'},
];

test('assigns distinct colour themes (price yellow, detail blue, qty red, matched green) and per-cell mismatch flags',()=>{
 const base=extractionCase();
 const fx=extractionFixture();
 fx.rows=fx.rows.map((r,i)=>{
  if(i===0)return {...r,unitPrice:19,netAmount:base.lines[0].ordered*19};
  if(i===1)return {...r,code:'N002',description:'Fresh Shanghai noodles (supplier wording)'};
  if(i===3)return {...r,code:'M999',description:'Sample mayonnaise'};
  return r;
 });
 fx.rows.push({page:1,row:6,code:'EXTRA-99',description:'Mystery Truffle Oil',unit:'bottles',quantity:1,unitPrice:24,netAmount:24,vatRate:0,orderReference:base.id,uncertain:[]});
 fx.net=fx.rows.reduce((s,r)=>s+(r.netAmount||0),0);
 fx.gross=fx.net;
 const record=attachInvoiceExtraction(base,base.documents[0].id,fx);

 const table=buildSimpleInvoiceTable(record,catalog);
 assert.equal(table.ordered.length,5);

 // Line 0 has both missing (qty red) and price overcharge (price yellow cell flag).
 const rice=table.ordered[0];
 assert.equal(rice.issueTheme,'qty');
 assert.equal(rice.qtyDiffers,true);
 assert.equal(rice.priceDiffers,true);
 assert.equal(rice.defaultMark,'FOLLOW');

 // Line 1 has wording diff (detail blue).
 const noodles=table.ordered[1];
 assert.equal(noodles.issueTheme,'detail');
 assert.equal(noodles.detailMismatch,true);
 assert.equal(noodles.nameDiffers,true);
 assert.ok(noodles.statusLabel.includes('ID / Name'));

 // Line 2 has damage reported by staff (qty red).
 const soy=table.ordered[2];
 assert.equal(soy.issueTheme,'qty');
 assert.ok(soy.statusLabel.includes('Damage'));

 // Line 3 has matching name with different supplier code (detail blue via suggested match).
 const mayo=table.ordered[3];
 assert.equal(mayo.issueTheme,'detail');
 assert.equal(mayo.codeDiffers,true);
 assert.equal(mayo.defaultMark,'FOLLOW');

 // Line 4 is cleanly AI-matched (matched green).
 assert.equal(table.ordered[4].issueTheme,'matched');
 assert.equal(table.ordered[4].statusLabel,'AI matched (confirm)');
 assert.equal(table.ordered[4].defaultMark,'DONE');

 // Pure price difference without missing/damage gets yellow 'price' theme while clean rows stay Matched + Done.
 const purePrice=buildSimpleInvoiceTable(sampleReceivedPriceDifference(),catalog);
 assert.equal(purePrice.ordered[0].issueTheme,'price');
 assert.equal(purePrice.ordered[0].priceDiffers,true);
 assert.equal(purePrice.ordered[0].qtyDiffers,false);
 assert.equal(purePrice.ordered[0].defaultMark,'FOLLOW');
 assert.equal(purePrice.ordered[1].issueTheme,'matched');
 assert.equal(purePrice.ordered[1].statusLabel,'Matched');
 assert.equal(purePrice.ordered[1].defaultMark,'DONE');

 // Bottom unmatched item carries its line total and same-supplier options only.
 assert.equal(table.unmatched.length,1);
 assert.equal(table.unmatched[0].receiveProductId,'EXTRA-99');
 assert.equal(table.unmatched[0].lineAmountPence,2400);
 assert.deepEqual(table.supplierOptions.map(s=>s.id),['p-rice','p-oil']);
 assert.equal(table.summary.estimatedClaimPence,5800);
});

test('maps Damage and Missing statuses cleanly and marks clean matched lines as Done',()=>{
 const reviewed=sampleReviewed('DEMO-TEST-001');
 const table=buildSimpleInvoiceTable(reviewed,catalog);
 assert.ok(table.ordered.some(r=>r.statusLabel.includes('Missing')&&r.defaultMark==='FOLLOW'));
 assert.ok(table.ordered.some(r=>r.statusLabel.includes('Damage')&&r.defaultMark==='FOLLOW'));
 const cleanLine=table.ordered[4];
 assert.equal(cleanLine.statusLabel,'Matched');
 assert.equal(cleanLine.issueTheme,'matched');
 assert.equal(cleanLine.defaultMark,'DONE');
});

test('computeTableTotalsCheck detects balanced totals and unmatched extra variances',()=>{
 const base=extractionCase();
 const fx=extractionFixture();
 fx.rows=fx.rows.map((r,i)=>i===0?{...r,unitPrice:19,netAmount:base.lines[0].ordered*19}:r);
 fx.rows.push({page:1,row:6,code:'EXTRA-99',description:'Extra Item',unit:'bottles',quantity:1,unitPrice:24,netAmount:24,vatRate:0,orderReference:base.id,uncertain:[]});
 const record=attachInvoiceExtraction(base,base.documents[0].id,fx);
 const table=buildSimpleInvoiceTable(record,catalog);

 const unbalanced=computeTableTotalsCheck(table.ordered,table.unmatched,{
  netPence:50600,vatPence:0,grossPence:50600,adjustmentPence:0,
 });
 assert.equal(unbalanced.orderedLineBilledSumPence,48200);
 assert.equal(unbalanced.unmatchedExtraSumPence,2400);
 assert.equal(unbalanced.netPlusVatMatchesGross,true);
 assert.equal(unbalanced.linesPlusAdjustmentMatchesNet,false);
 assert.equal(unbalanced.differenceToNetPence,2400);

 const balanced=computeTableTotalsCheck(table.ordered,table.unmatched,{
  netPence:50600,vatPence:0,grossPence:50600,adjustmentPence:2400,
 });
 assert.equal(balanced.linesPlusAdjustmentMatchesNet,true);
 assert.equal(balanced.differenceToNetPence,0);
});

import {applyInvoiceCommand} from '../server/invoice-case-validation.ts';
import {invoiceUnitReviewProblems} from '../shared/invoice-unit-review.ts';
import {sampleOwner} from './fixtures/invoice-workflow.ts';

test('confirm-extra-row and restore-extra-row audit, resolve unit review blockers, and persist in buildSimpleInvoiceTable',()=>{
 const base=extractionCase();
 const fx=extractionFixture();
 fx.rows.push({page:1,row:6,code:'EXTRA-99',description:'Mystery Truffle Oil',unit:'bottles',quantity:1,unitPrice:24,netAmount:24,vatRate:0,orderReference:base.id,uncertain:[]});
 const attached=attachInvoiceExtraction(base,base.documents[0].id,fx);

 assert.ok(invoiceUnitReviewProblems(attached).some(msg=>msg.includes('1 invoice row')));

 const confirmed=applyInvoiceCommand(
  attached,
  {
   kind:'confirm-extra-row',
   requestId:'req-confirm-extra-1',
   expectedVersion:attached.version,
   page:1,
   row:6,
   decision:'LEAVE_UNMATCHED',
   reason:'Confirmed unrequested item on invoice; leave unmatched',
  },
  {...sampleOwner,active:true},
  {},
  '2026-11-12T10:00:00.000Z',
 );
 assert.equal(invoiceUnitReviewProblems(confirmed).length,0);
 assert.equal(confirmed.audit.at(-1)?.action,'confirm-extra-row');
 const tableConfirmed=buildSimpleInvoiceTable(confirmed,catalog);
 assert.equal(tableConfirmed.unmatched[0].savedDecision,'LEAVE_UNMATCHED');
 assert.equal(tableConfirmed.unmatched[0].defaultMark,'FOLLOW');

 const matched=applyInvoiceCommand(
  confirmed,
  {
   kind:'confirm-extra-row',
   requestId:'req-confirm-extra-2',
   expectedVersion:confirmed.version,
   page:1,
   row:6,
   decision:'SUPPLIER_ITEM',
   supplierProductId:'p-oil',
   reason:'Matched to Sample truffle oil catalogue entry',
  },
  {...sampleOwner,active:true},
  {},
  '2026-11-12T10:05:00.000Z',
 );
 const tableMatched=buildSimpleInvoiceTable(matched,catalog);
 assert.equal(tableMatched.unmatched[0].savedDecision,'SUPPLIER_ITEM');
 assert.equal(tableMatched.unmatched[0].savedProductId,'p-oil');
 assert.equal(tableMatched.unmatched[0].defaultMark,'DONE');

 const restored=applyInvoiceCommand(
  matched,
  {
   kind:'restore-extra-row',
   requestId:'req-restore-extra-1',
   expectedVersion:matched.version,
   page:1,
   row:6,
   reason:'Reopen to recheck bottle size',
  },
  {...sampleOwner,active:true},
  {},
  '2026-11-12T10:10:00.000Z',
 );
 assert.ok(invoiceUnitReviewProblems(restored).some(msg=>msg.includes('1 invoice row')));
 assert.equal(buildSimpleInvoiceTable(restored,catalog).unmatched[0].savedDecision,undefined);
});

test('does not compute bogus cross-unit credit estimates before pack/unit review is confirmed',()=>{
 const base=extractionCase();
 base.receipt={...base.receipt,statuses:['RECEIVED'],notes:'',issues:[]};
 base.lines=base.lines.map(l=>({...l,received:l.ordered,invoiceQuantity:undefined,invoicePrice:undefined}));
 const fx=extractionFixture();
 fx.rows=fx.rows.map((r,i)=>i===0?{...r,unit:'packs',quantity:24,unitPrice:19,netAmount:456}:r);
 const attached=attachInvoiceExtraction(base,base.documents[0].id,fx);

 const table=buildSimpleInvoiceTable(attached,catalog);
 assert.equal(table.ordered[0].unitCheckRequired,true);
 assert.equal(table.ordered[0].creditEstimatePence,0);
});

test('computeClaimSummaryMetrics summarizes estimated and confirmed claim balances accurately',()=>{
 const base=extractionCase();
 const est=computeClaimSummaryMetrics(base,[
  {lineId:base.lines[0].id,orderProductName:base.lines[0].name,statusLabel:'Missing (2)',creditEstimatePence:3600,mismatchReasons:['Missing 2']},
  {lineId:base.lines[1].id,orderProductName:base.lines[1].name,statusLabel:'Matched',creditEstimatePence:0,mismatchReasons:[]},
 ]);
 assert.equal(est.hasConfirmedClaim,false);
 assert.equal(est.originalNetPence,3600);
 assert.equal(est.resolvedPence,0);
 assert.equal(est.openBalancePence,3600);
 assert.equal(est.lineBreakdown.length,1);

 const confirmed=computeClaimSummaryMetrics({
  lines:base.lines,
  claim:{
   id:'c1',revision:1,state:'SENT',recipient:'a@b.invalid',subject:'s',message:'m',
   lines:[
    {lineId:base.lines[0].id,quantity:2,netPence:3800,creditedPence:2000,replacementPence:800,reason:'Missing bags'},
    {lineId:base.lines[1].id,quantity:1,netPence:2000,creditedPence:2000,replacementPence:0,reason:'Damaged case'},
   ],
  },
 });
 assert.equal(confirmed.hasConfirmedClaim,true);
 assert.equal(confirmed.originalNetPence,5800);
 assert.equal(confirmed.creditedPence,4000);
 assert.equal(confirmed.replacementPence,800);
 assert.equal(confirmed.resolvedPence,4800);
 assert.equal(confirmed.openBalancePence,1000);
 assert.equal(confirmed.lineBreakdown[0].openPence,1000);
 assert.equal(confirmed.lineBreakdown[1].openPence,0);
});
