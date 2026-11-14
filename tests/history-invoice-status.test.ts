import test from 'node:test';
import assert from 'node:assert/strict';
import {historyInvoiceStatus,matchesInvoiceHistoryStatus} from '../app/htos/historyInvoiceStatus';
import {matchesHistoryFilters} from '../app/htos/historyFilters';
import {sampleOrder} from './fixtures/invoice-workflow';
import type {InvoiceReceiptSummary} from '../shared/invoice-receipt-summary';

const summary=(values:Partial<InvoiceReceiptSummary>={}):InvoiceReceiptSummary=>({id:sampleOrder.id,receipt:'SUBMITTED',status:'REVIEW',documents:1,...values});
test('uploaded, submitted and approved are distinct; every workflow stage has a clear label',()=>{
 const stages={CHECKING:'Checking invoice',REVIEW:'Waiting for review',HOLD:'On hold',CLAIM_DRAFT:'Claim being prepared',WAITING_CREDIT:'Waiting for credit note',CREDIT_REVIEW:'Credit note awaiting approval',CREDIT_APPROVED:'Credit approved · invoice pending',APPROVED:'Invoice approved'} as const;
 for(const [status,label] of Object.entries(stages)){const actual=historyInvoiceStatus(sampleOrder,summary({status:status as keyof typeof stages}),true);assert.equal(actual.label,label);assert.equal(actual.tone==='green',status==='APPROVED');assert.equal(actual.detail,'1 document uploaded');}
 assert.equal(historyInvoiceStatus(sampleOrder,summary({receipt:'DRAFT',status:'DRAFT'}),true).label,'Uploaded · report to submit');
 assert.equal(historyInvoiceStatus(sampleOrder,summary({receipt:'DRAFT',status:'DRAFT',documents:0}),true).label,'Report draft · no upload');
 assert.equal(historyInvoiceStatus(sampleOrder,summary({receipt:'NOT_REPORTED',status:null,documents:0}),true).label,'Not uploaded');
});
test('unknown status never claims no upload or approval; order lifecycle and legacy records stay explicit',()=>{
 assert.equal(historyInvoiceStatus(sampleOrder,undefined,true,true).label,'Loading invoice status…');
 assert.equal(historyInvoiceStatus(sampleOrder,undefined,true).label,'Status unavailable');
 assert.equal(historyInvoiceStatus(sampleOrder,undefined,false).label,'Order placed');
 assert.equal(historyInvoiceStatus({...sampleOrder,status:'DRAFT'},undefined,true).label,'Order draft');
 assert.equal(historyInvoiceStatus({...sampleOrder,status:'CANCELLED'},undefined,true).label,'Cancelled');
 assert.equal(historyInvoiceStatus({...sampleOrder,archived:true},undefined,true).label,'Archived');
 assert.equal(historyInvoiceStatus({...sampleOrder,deliveryCheck:{} as any},undefined,true).label,'Previous check · open details');
});
test('invoice filters match stored progress, exclude unknown data and preserve order/branch/supplier scope',()=>{
 for(const filter of ['NOT_UPLOADED','UPLOAD_DRAFT','REVIEW','HOLD','CREDIT','APPROVED'])assert.equal(matchesInvoiceHistoryStatus(sampleOrder,undefined,filter),false);
 const cases:[string,InvoiceReceiptSummary][]=[['NOT_UPLOADED',summary({receipt:'NOT_REPORTED',status:null,documents:0})],['UPLOAD_DRAFT',summary({receipt:'DRAFT',status:'DRAFT'})],['REVIEW',summary()],['HOLD',summary({status:'HOLD'})],['CREDIT',summary({status:'WAITING_CREDIT'})],['APPROVED',summary({status:'APPROVED'})]];
 for(const [wanted,s] of cases){for(const [filter] of cases)assert.equal(matchesInvoiceHistoryStatus(sampleOrder,s,filter),filter===wanted);assert.equal(matchesInvoiceHistoryStatus({...sampleOrder,status:'CANCELLED'},s,wanted),false);assert.equal(matchesInvoiceHistoryStatus({...sampleOrder,archived:true},s,wanted),false);}
 const snapshot=JSON.stringify(sampleOrder),s=summary();
 const matches=(branchId:string,supplierId:string)=>matchesHistoryFilters(sampleOrder,{branchId,supplierId,status:'ALL',search:''})&&matchesInvoiceHistoryStatus(sampleOrder,s,'REVIEW');
 assert(matches(sampleOrder.branchId,sampleOrder.supplierId));assert(!matches('other',sampleOrder.supplierId));assert(!matches(sampleOrder.branchId,'other'));assert.equal(JSON.stringify(sampleOrder),snapshot);
});
