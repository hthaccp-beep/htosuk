import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceComparisonComplete,invoiceProgress,invoiceRecordStatus} from '../shared/invoice-review-status.ts';
import {invoiceReceiptSummary} from '../shared/invoice-receipt-summary.ts';
import {historyInvoiceStatus} from '../app/htos/historyInvoiceStatus.ts';
import {sampleReviewed,sampleOrder} from './fixtures/invoice-workflow.ts';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {attachInvoiceExtraction} from '../shared/invoice-extraction.ts';
import {invoiceLineNetPence,lineDiscrepancy} from '../shared/invoice-case.ts';
test('history and Accounts use identical wording and colour for every lifecycle and reading stage',()=>{
 for(const status of ['REVIEW','CHECKING','HOLD','CLAIM_DRAFT','WAITING_CREDIT','CREDIT_REVIEW','CREDIT_APPROVED','APPROVED'] as const){for(const state of ['IDLE','PENDING','RUNNING','READY','NEEDS_REVIEW','FAILED'] as const){
 const r=extractionCase();r.status=status;r.extraction.state=state;
 const badge=invoiceRecordStatus(r),history=historyInvoiceStatus(sampleOrder,invoiceReceiptSummary(r.id,r),true);
 assert.equal(history.label,badge.label);assert.equal(history.tone,badge.tone);
 }}
});
test('four uncertain scan rows and the other unchecked item give five items to check',()=>{
 const r=extractionCase(),data=extractionFixture();for(const row of data.rows.slice(0,4))row.unit='unclear supplier pack';
 const result=attachInvoiceExtraction(r,r.documents[0].id,data);
 assert.deepEqual(invoiceProgress(result),{stage:'CHECK_READING',items:5});
 assert.equal(invoiceRecordStatus(result).label,'5 items to check');
 assert.equal(invoiceComparisonComplete(result),false);
});
test('missing, unchecked or inconsistent figures cannot display a confirmed zero',()=>{
 for(const mutate of [(r:any)=>{r.invoiceNetPence=undefined;},(r:any)=>{r.totalsVerified=false;},(r:any)=>{r.matchingVerified=false;},(r:any)=>{r.lines[0].reviewed=false;},(r:any)=>{r.lines[0].invoicePrice=undefined;},(r:any)=>{r.invoiceGrossPence++;},(r:any)=>{r.invoiceNetPence++;r.invoiceGrossPence++;},(r:any)=>{r.extraction.state='RUNNING';},(r:any)=>{r.extraction.state='FAILED';}]){
 const r=sampleReviewed();mutate(r);assert.equal(invoiceComparisonComplete(r),false);
 }
});
test('a genuine checked zero remains valid, with approval still separate',()=>{
 const r=sampleReviewed();r.receipt.issues=[];r.receipt.statuses=['RECEIVED'];
 for(const l of r.lines){l.received=l.ordered;l.invoiceQuantity=l.ordered;l.invoicePrice=l.expectedPrice;l.resolution='ACCEPT';}
 r.invoiceNetPence=r.lines.reduce((s,l)=>s+invoiceLineNetPence(l)!,0);r.invoiceGrossPence=r.invoiceNetPence;
 assert.equal(invoiceComparisonComplete(r),true);assert.equal(r.lines.reduce((s,l)=>s+lineDiscrepancy(r,l).totalPence,0),0);
 assert.equal(invoiceRecordStatus(r).label,'Ready for final review');assert.equal(r.status,'REVIEW');
});
test('permission-scoped summary exposes only safe progress, never prices or raw reading',()=>{
 const r=sampleReviewed(),before=structuredClone(r),summary=invoiceReceiptSummary(r.id,r);
 assert.deepEqual(Object.keys(summary).sort(),['documents','id','progress','receipt','status']);
 assert.deepEqual(Object.keys(summary.progress!).sort(),['stage']);
 assert.deepEqual(r,before);assert.equal(JSON.stringify(summary).includes('expectedPrice'),false);
});
test('confirmed zero-charge out-of-stock rows do not need an invented price',()=>{
 const r=sampleReviewed();r.lines[0]={...r.lines[0],received:0,invoiceQuantity:0,invoicePrice:undefined};
 r.invoiceNetPence=r.lines.reduce((s,l)=>s+invoiceLineNetPence(l)!,0);r.invoiceGrossPence=r.invoiceNetPence;
 assert.equal(invoiceComparisonComplete(r),true);
});
