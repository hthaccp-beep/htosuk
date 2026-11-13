import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceCaseAction} from '../server/invoice-case-service.ts';
import {receiptSummaryLabels,type InvoiceReceiptSummary} from '../shared/invoice-receipt-summary.ts';
import {invoiceMemoryStore} from './fixtures/invoice-memory-store.ts';
import {sampleDraft,sampleOrder,sampleStaff} from './fixtures/invoice-workflow.ts';
function fixture(){const r=sampleDraft();const f=invoiceMemoryStore([['users/'+sampleStaff.id,sampleStaff],['settings/role_permissions',{map:{}}],['orders/'+r.id,sampleOrder],['_invoice_cases/'+r.id,r]]);return {...f,r,run:(body:any)=>invoiceCaseAction(f.db,sampleStaff.id,body,true)};}
const list=(id=sampleOrder.id)=>({action:'invoice-case-receipt-summaries',orderIds:[id]});
test('submission is reflected in staff list and locked original without exposing Accounts figures',async()=>{
 const f=fixture();assert.equal((await f.run(list())).summaries[0].receipt,'DRAFT');
 await f.run({action:'invoice-case-command',caseId:f.r.id,command:{kind:'submit-receipt',receipt:f.r.receipt,expectedVersion:0,requestId:'summary-submit'}});
 const {summaries}=await f.run(list());assert.deepEqual(summaries,[{id:f.r.id,receipt:'SUBMITTED',status:'REVIEW',documents:f.r.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind)).length}]);
 assert.deepEqual(receiptSummaryLabels(summaries[0] as InvoiceReceiptSummary),{delivery:'Submitted for checking',invoice:'Accounts review pending'});
 const opened=await f.run({action:'invoice-case-get',caseId:f.r.id});assert.ok(opened.record.receipt.submittedAt);assert.equal(opened.record.lines[0].expectedPrice,undefined);
 assert.deepEqual(f.data.get('orders/'+f.r.id),sampleOrder);
});
test('missing case is explicitly unreported; summary reads create no records',async()=>{const f=fixture();f.data.delete('_invoice_cases/'+f.r.id);const before=f.data.size;assert.deepEqual((await f.run(list())).summaries,[{id:f.r.id,receipt:'NOT_REPORTED',status:null,documents:0}]);assert.equal(f.data.size,before);});
test('out-of-scope order is rejected before its private case is read',async()=>{const f=fixture();f.data.set('orders/'+f.r.id,{...sampleOrder,branchId:'foreign'});await assert.rejects(()=>f.run(list()),/access/);assert.ok(!f.reads.includes('_invoice_cases/'+f.r.id));});
test('case scope, removed permission and inactive users are each enforced',async()=>{for(const mode of ['case','permission','inactive']){const f=fixture();if(mode==='case')f.data.set('_invoice_cases/'+f.r.id,{...f.r,supplierId:'foreign'});else f.data.set('users/'+sampleStaff.id,{...sampleStaff,...(mode==='inactive'?{active:false}:{customPermissions:[]})});await assert.rejects(()=>f.run(list()),/access|active/);}});
test('legacy checks are preserved without consulting the new case',async()=>{const f=fixture();f.data.set('orders/'+f.r.id,{...sampleOrder,deliveryCheck:{version:1}});assert.deepEqual((await f.run(list())).summaries,[]);assert.ok(!f.reads.includes('_invoice_cases/'+f.r.id));});
test('bounded identifiers reject invalid requests and deduplicate reads',async()=>{const f=fixture();for(const orderIds of [null,Array(101).fill(f.r.id),['../secret']])await assert.rejects(()=>f.run({action:'invoice-case-receipt-summaries',orderIds}),/100|reference/);assert.equal((await f.run({...list(),orderIds:[f.r.id,f.r.id]})).summaries.length,1);assert.deepEqual((await f.run({...list(),orderIds:[]})).summaries,[]);});
test('approval stays separate and an unavailable summary is never labelled not checked',()=>{assert.equal(receiptSummaryLabels(undefined).delivery,'Status unavailable');assert.equal(receiptSummaryLabels({id:'x',receipt:'SUBMITTED',status:'APPROVED'}).invoice,'Invoice approved');});
