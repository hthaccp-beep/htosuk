import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {invoiceCaseAction} from '../server/invoice-case-service.ts';
import {invoiceEmailAction,type InvoiceEmailDependencies} from '../server/invoice-case-email.ts';
import {invoiceMemoryStore} from './fixtures/invoice-memory-store.ts';
import {sampleOwner,sampleStaff,sampleReviewed} from './fixtures/invoice-workflow.ts';
import {invoiceBudgetConfig,ensureInvoiceReadingBudget} from '../server/invoice-reading-budget.ts';
import {invoiceApprovalProblems,outstandingClaim} from '../shared/invoice-case.ts';

export async function claimHarness(){
 const record=sampleReviewed();record.documents=[];
 const memory=invoiceMemoryStore([['_invoice_cases/'+record.id,record],['orders/'+record.id,{id:record.id,sentinel:'Original order must remain unchanged'}],['users/'+sampleOwner.id,sampleOwner],['users/'+sampleStaff.id,sampleStaff],['settings/role_permissions',{map:{}}],['branches/sample-putney',{active:true,email:'branch@example.test',name:'Sample branch'}],['suppliers/sample-foods',{active:true,email:'supplier@example.test'}]]);
 const mailbox={user:'branch@example.test',pass:'synthetic-not-a-secret',host:'smtp.example.test',port:465,secure:true,accountsCc:['accounts@example.test']};
 const sent:any[]=[];let clock='2026-11-11T20:00:00Z';
 const deps:InvoiceEmailDependencies={db:memory.db,env:{HTOS_ENABLE_INVOICE_CASES:'true',HTOS_ENABLE_EMAIL:'true'},account:async()=>mailbox,reserveSend:async()=>true,now:()=>clock,deliver:async mail=>{sent.push(mail);return {accepted:[...mail.to,...mail.cc],rejected:[]};}};
 const get=()=>structuredClone(memory.data.get('_invoice_cases/'+record.id));
 const call=(body:any,user=sampleOwner.id)=>invoiceCaseAction(memory.db,user,{caseId:record.id,...body},true);
 const command=(kind:string,payload:any={})=>call({action:'invoice-case-command',command:{kind,requestId:randomUUID(),expectedVersion:get().version,...payload}});
 const email=(action:string,payload:any={},user=sampleOwner.id)=>invoiceEmailAction(deps,user,{action:'invoice-case-email-'+action,caseId:record.id,expectedVersion:get().version,...payload});
 const upload=async(kind='INVOICE')=>call({action:'invoice-case-upload',expectedVersion:get().version,kind,name:'Fictional-'+kind+'.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nFictional '+kind+' for offline tests').toString('base64')});
 const doc=await upload();await command('save-review',{...get(),invoiceDocumentId:doc.documentId});await command('prepare-claim');await command('approve-claim');
 const approve=async()=>{const payload={recipient:'supplier@example.test',message:get().claim.message},p=await email('preview',payload);await email('approve',{...payload,fingerprint:p.preview.fingerprint,confirmed:true,requestId:randomUUID()});return {fingerprint:p.preview.fingerprint,confirmed:true};};
 return {memory,record,deps,get,call,command,email,upload,approve,sent,mailbox,clock:(v:string)=>clock=v};
}

test('claim approval -> recipient/attachment approval -> one send -> partial/final credit -> invoice approval, originals unchanged',async()=>{
 const f=await claimHarness(),order=structuredClone(f.memory.data.get('orders/'+f.record.id));
 assert.ok(invoiceApprovalProblems(f.get()).length);
 await assert.rejects(()=>f.email('send',{confirmed:true,fingerprint:'fabricated'}));
 const send=await f.approve();const r=await f.email('send',send);assert.equal(r.record.claim.state,'SENT');assert.equal(f.sent.length,1);assert.equal(f.sent[0].attachments.length,1);assert.ok(f.sent[0].cc.includes('accounts@example.test'));assert.ok(f.sent[0].cc.includes('info@hareandtortoise.co.uk'));
 await f.email('send',send);assert.equal(f.sent.length,1);assert.equal(f.get().status,'WAITING_CREDIT');
 const outstanding=outstandingClaim(f.get());assert.equal(outstanding,8550);
 let credit=await f.upload('CREDIT');
 const first=f.get().claim.lines[0];await f.command('record-credit',{reference:'CN-PART-1',documentId:credit.documentId,invoiceReference:f.get().invoiceReference,supplierId:f.record.supplierId,lines:[{lineId:first.lineId,netPence:1000}],vatPence:0,grossPence:1000,verified:true});
 await assert.rejects(()=>f.command('approve-invoice'),/outstanding|pending/);
 await f.command('approve-credit',{creditId:f.get().credits[0].id});assert.equal(outstandingClaim(f.get()),outstanding-1000);
 const lines=f.get().claim.lines.map((l:any)=>({lineId:l.lineId,netPence:l.netPence-l.creditedPence}));
 await f.command('record-credit',{reference:'CN-FINAL-2',documentId:credit.documentId,invoiceReference:f.get().invoiceReference,supplierId:f.record.supplierId,lines,vatPence:0,grossPence:outstanding-1000,verified:true});
 await f.command('approve-credit',{creditId:f.get().credits[1].id});assert.equal(outstandingClaim(f.get()),0);assert.deepEqual(invoiceApprovalProblems(f.get()),[]);
 await f.command('approve-invoice');assert.equal(f.get().status,'APPROVED');assert.deepEqual(f.memory.data.get('orders/'+f.record.id),order);
});
test('concurrent and repeated sending never dispatch the same claim twice',async()=>{
 const f=await claimHarness(),send=await f.approve();await Promise.all([f.email('send',send),f.email('send',send)]);assert.equal(f.sent.length,1);assert.equal(f.get().claim.state,'SENT');
});
test('SMTP timeout retains uncertainty, hides transport secrets and requires evidenced reconciliation',async()=>{
 const f=await claimHarness(),send=await f.approve();let calls=0;f.deps.deliver=async()=>{calls++;throw Error('secret-password must not escape');};
 const result=await f.email('send',send);assert.equal(result.record.claim.state,'UNCERTAIN');assert.equal(result.record.status,'HOLD');assert.ok(!JSON.stringify(result).includes('secret-password'));
 await f.email('send',send);assert.equal(calls,1);await assert.rejects(()=>f.email('reconcile',{verified:true,received:true,notes:''}),/Confirm receipt/);
 await assert.rejects(()=>f.command('record-credit'),/Confirm the claim/);
 await f.email('reconcile',{verified:true,received:true,notes:'Supplier and copied recipients confirmed receipt by telephone.'});assert.equal(f.get().claim.state,'SENT');assert.ok(f.get().claim.delivery.confirmation);
});
test('partial acceptance cannot unlock credit notes; server checks fresh role and scope',async()=>{
 const f=await claimHarness(),send=await f.approve();f.deps.deliver=async mail=>({accepted:mail.to,rejected:mail.cc});
 await assert.rejects(()=>f.email('send',send,sampleStaff.id),/access/);assert.equal(f.get().claim.state,'APPROVED');
 await f.email('send',send);assert.equal(f.get().claim.state,'UNCERTAIN');
 f.memory.data.set('users/scoped',{...sampleStaff,id:'scoped',customPermissions:['review_invoices','view_prices'],branchIds:['another-branch']});await assert.rejects(()=>f.email('reconcile',{verified:true,received:true,notes:'Checked all recipients.'},'scoped'),/access/);
});
test('changed recipient, CC, message or corrupt attachment prevents sending',async()=>{
 const f=await claimHarness();await assert.rejects(()=>f.email('preview',{recipient:'outside@example.test',message:'Hello'}),/saved on this supplier/);
 await assert.rejects(()=>f.email('preview',{recipient:'supplier@example.test\r\nBcc: x@example.test',message:'Hello'}),/valid/);
 const send=await f.approve();f.mailbox.accountsCc=['changed@example.test'];await assert.rejects(()=>f.email('send',send),/Review|changed/);f.mailbox.accountsCc=['accounts@example.test'];
 const doc=f.get().invoiceDocumentId;f.memory.data.set('_invoice_case_documents/'+doc+'/parts/0',{base64:Buffer.from('tampered').toString('base64')});await assert.rejects(()=>f.email('send',send),/integrity/);assert.equal(f.sent.length,0);assert.equal(f.get().claim.state,'APPROVED');
});
test('disabled sending, absent Accounts CC and unapproved routing cannot dispatch',async()=>{
 const f=await claimHarness();f.mailbox.accountsCc=[];await assert.rejects(()=>f.approve(),/Accounts CC/);f.mailbox.accountsCc=['accounts@example.test'];const send=await f.approve();f.deps.env.HTOS_ENABLE_EMAIL='false';await assert.rejects(()=>f.email('send',send),/disabled/);assert.equal(f.sent.length,0);
});
test('new £2 stage is created atomically once; old allowance is never reset or topped up',async()=>{
 const memory=invoiceMemoryStore([['_invoice_read_jobs/budget-old',{approved:true,capPence:200,allocatedPence:163}]]),old=structuredClone(memory.data.get('_invoice_read_jobs/budget-old'));
 const config=invoiceBudgetConfig({HTOS_INVOICE_READING_BUDGET_ID:'stage2',HTOS_INVOICE_READING_CAP_PENCE:'200',HTOS_INVOICE_READING_BUDGET_APPROVAL:'Owner chat 11 November 2026'})!;
 await Promise.all([ensureInvoiceReadingBudget(memory.db,config),ensureInvoiceReadingBudget(memory.db,config)]);assert.equal(memory.data.get('_invoice_read_jobs/budget-stage2').capPence,200);
 memory.data.get('_invoice_read_jobs/budget-stage2').allocatedPence=60;await ensureInvoiceReadingBudget(memory.db,config);assert.equal(memory.data.get('_invoice_read_jobs/budget-stage2').allocatedPence,60);
 await assert.rejects(()=>ensureInvoiceReadingBudget(memory.db,{...config,capPence:1000}),/No allowance was reset/);assert.deepEqual(memory.data.get('_invoice_read_jobs/budget-old'),old);
 assert.equal(invoiceBudgetConfig({HTOS_INVOICE_READING_BUDGET_ID:'stage2',HTOS_INVOICE_READING_CAP_PENCE:'200'}),null);
});
