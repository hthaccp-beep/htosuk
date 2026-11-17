import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceComparison,invoiceComparisonGroup} from '../shared/invoice-comparison.ts';
import {itemReviewSample} from './fixtures/invoice-item-review.ts';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {attachInvoiceExtraction} from '../shared/invoice-extraction.ts';
test('pending replacement/partial credit need attention; settled issues stay in Resolved',()=>{
 const record=itemReviewSample(),before=structuredClone(record),rows=invoiceComparison(record);
 assert.deepEqual(rows.map(invoiceComparisonGroup),['NEEDS_REVIEW','NEEDS_REVIEW','RESOLVED','RESOLVED','MATCHED']);
 assert.ok(rows[2].reports.some(s=>s.includes('Damaged')));assert.deepEqual(record,before);
});
test('a numerical match still needs attention until required item review is complete',()=>{
 const record=itemReviewSample();record.lines[4].reviewed=false;
 const row=invoiceComparison(record)[4];assert.equal(row.matches,true);assert.equal(invoiceComparisonGroup(row),'NEEDS_REVIEW');
});
test('unknown price, pack mismatch and unmatched item cannot appear resolved',()=>{
 const record=extractionCase(),reading=extractionFixture();reading.rows[0].unit='packet';reading.rows.push({...reading.rows[0],row:99,code:'EXTRA',description:'Unknown sample item',orderReference:null});
 const next=attachInvoiceExtraction(record,record.documents[0].id,reading);next.lines[4].expectedPrice=undefined;
 const rows=invoiceComparison(next);assert.equal(invoiceComparisonGroup(rows[0]),'NEEDS_REVIEW');assert.equal(invoiceComparisonGroup(rows[4]),'NEEDS_REVIEW');assert.equal(invoiceComparisonGroup(rows.find(r=>!r.lineId)!),'NEEDS_REVIEW');
});
test('remaining price credit stays in attention after replacement confirmation',()=>{
 const record=itemReviewSample();record.lines[0].invoicePrice=19;record.claim!.lines[0].netPence=4600;record.claim!.lines[0].replacementPence=3600;record.laterReceipts![0].status='APPROVED';
 const row=invoiceComparison(record)[0];assert.equal(invoiceComparisonGroup(row),'NEEDS_REVIEW');assert.match(row.followUp.join(' '),/£10.00/);assert.match(row.reports.join(' '),/Missing/);
});
