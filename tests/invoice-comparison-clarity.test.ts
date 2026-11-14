import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceItemReview,invoiceItemCounts,hasKnownAgreedPrice} from '../shared/invoice-item-review.ts';
import {invoiceComparisonComplete,invoiceRecordStatus,invoiceProgress} from '../shared/invoice-review-status.ts';
import {invoiceReceiptSummary} from '../shared/invoice-receipt-summary.ts';
import {historyInvoiceStatus} from '../app/htos/historyInvoiceStatus.ts';
import {invoiceReviewGuide} from '../shared/invoice-review-guide.ts';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {sampleOrder,sampleReviewed} from './fixtures/invoice-workflow.ts';
import {attachInvoiceExtraction} from '../shared/invoice-extraction.ts';
import {invoiceItemIssueLabels} from '../shared/invoice-issue-labels.ts';

test('unmatched readings are not counted a second time as ordered items',()=>{
 const r=extractionCase(),f=extractionFixture();f.rows.forEach(row=>{row.code='SUPPLIER-'+row.row;});
 const next=attachInvoiceExtraction(r,r.documents[0].id,f),before=structuredClone(next),rows=invoiceItemReview(next);
 assert.deepEqual(invoiceItemCounts(rows),{items:5,unmatched:5});
 assert.equal(invoiceRecordStatus(next).label,'5 items to check · 5 invoice rows to match');
 assert.equal(invoiceReviewGuide(next).itemLabel,invoiceRecordStatus(next).label);
 assert.equal(historyInvoiceStatus(sampleOrder,invoiceReceiptSummary(next.id,next),true).label,invoiceRecordStatus(next).label);
 assert.equal(rows.filter(row=>row.lineId).length,5);assert.deepEqual(next,before);
});
test('unique product match keeps raw invoice units and price beside the order without converting',()=>{
 const r=extractionCase(),f=extractionFixture();f.rows[0].unit='packet';f.rows[0].quantity=24;f.rows[0].unitPrice=2;f.rows[0].netAmount=48;
 const next=attachInvoiceExtraction(r,r.documents[0].id,f),row=invoiceItemReview(next)[0];
 assert.equal(row.readings?.[0].unit,'packet');assert.equal(row.readings?.[0].quantity,24);assert.equal(row.readings?.[0].price,2);
 assert.equal(row.unit,r.lines[0].unit);assert.equal(row.billed,undefined);assert.equal(row.priceCheck,'UNKNOWN');
 assert.equal(invoiceItemCounts(invoiceItemReview(next)).unmatched,0);
});
test('zero and absent agreed prices stay unknown; stored values and invoice prices stay unchanged',()=>{
 for(const value of [0,undefined,NaN]){const r=sampleReviewed();r.lines[0].expectedPrice=value;r.lines[0].invoicePrice=0;r.lines[0].resolution='ACCEPT';const before=structuredClone(r),row=invoiceItemReview(r)[0];
 assert.equal(row.priceCheck,'UNKNOWN');assert.equal(row.priceDifference,undefined);assert.equal(row.result,'Check agreed price');assert.equal(row.invoicePrice,0);assert.equal(invoiceComparisonComplete(r),false);assert.equal(invoiceProgress(r).stage,'CHECK_ITEMS');assert.ok(invoiceItemIssueLabels(r,r.lines[0]).includes('Agreed price not confirmed'));assert.ok(!invoiceItemIssueLabels(r,r.lines[0]).includes('Price difference'));assert.deepEqual(r,before);}
 assert.equal(hasKnownAgreedPrice(18),true);assert.equal(hasKnownAgreedPrice(0),false);
});
test('ambiguous product rows remain one unmatched reading, not copied into several order items',()=>{
 const r=extractionCase(),f=extractionFixture();r.lines[1].code=r.lines[0].code;r.lines[1].unit=r.lines[0].unit;f.rows=f.rows.slice(0,1);
 const next=attachInvoiceExtraction(r,r.documents[0].id,f),rows=invoiceItemReview(next);
 assert.equal(rows.filter(row=>row.lineId).flatMap(row=>row.readings||[]).length,0);
 assert.equal(rows.filter(row=>!row.lineId).length,1);
});
test('repeated invoice rows stay visible under one order item and never get a price tick',()=>{
 const r=extractionCase(),f=extractionFixture();f.rows.push({...f.rows[0],row:99});const next=attachInvoiceExtraction(r,r.documents[0].id,f);
 next.matchingVerified=true;next.lines[0].invoicePrice=next.lines[0].expectedPrice;
 const rows=invoiceItemReview(next);assert.equal(rows[0].readings?.length,2);assert.equal(rows[0].priceCheck,'UNKNOWN');assert.equal(rows[0].result,'Check repeated invoice rows');assert.equal(invoiceItemCounts(rows).unmatched,0);
});
test('old readings remain marked and never prove a price match',()=>{
 const r=extractionCase(),f=extractionFixture(),next=attachInvoiceExtraction(r,r.documents[0].id,f);next.documents[0].sha256='changed';next.matchingVerified=true;next.lines[0].invoicePrice=next.lines[0].expectedPrice;
 const row=invoiceItemReview(next)[0];assert.equal(row.readingStale,true);assert.equal(row.priceCheck,'UNKNOWN');
});
