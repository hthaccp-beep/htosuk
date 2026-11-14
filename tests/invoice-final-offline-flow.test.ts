import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {invoiceCaseAction} from '../server/invoice-case-service.ts';
import {invoiceEmailAction,type InvoiceEmailDependencies} from '../server/invoice-case-email.ts';
import {invoiceMemoryStore} from './fixtures/invoice-memory-store.ts';
import {sampleDraft,sampleReviewed,sampleOrder,sampleOwner,sampleStaff} from './fixtures/invoice-workflow.ts';
import {blankLaterDelivery} from '../shared/later-delivery.ts';
import {invoiceApprovalProblems,outstandingClaim} from '../shared/invoice-case.ts';
import {invoiceItemReview} from '../shared/invoice-item-review.ts';

test('offline full flow: locked missing/damage report, separate and combined replacements, partial/final credit, separate Accounts approval',async t=>{
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Network forbidden in offline workflow test');};
 t.after(()=>{globalThis.fetch=previousFetch;});
 const draft=sampleDraft();draft.documents=[];
 draft.receipt.issues=draft.receipt.issues.filter(i=>['missing-rice','damaged-soy'].includes(i.id));
 const memory=invoiceMemoryStore([
  ['_invoice_cases/'+draft.id,draft],['orders/'+draft.id,sampleOrder],
  ['users/'+sampleOwner.id,sampleOwner],['users/'+sampleStaff.id,sampleStaff],
  ['settings/role_permissions',{map:{}}],
  ['branches/sample-putney',{active:true,email:'branch@example.test',name:'Sample branch'}],
  ['suppliers/sample-foods',{active:true,email:'supplier@example.test'}]
 ]);
 const get=(id=draft.id)=>structuredClone(memory.data.get('_invoice_cases/'+id));
 const call=(body:any,user=sampleOwner.id)=>invoiceCaseAction(memory.db,user,{caseId:draft.id,...body},true);
 const command=(kind:string,payload:any={},user=sampleOwner.id)=>call({action:'invoice-case-command',command:{kind,requestId:randomUUID(),expectedVersion:get().version,...payload}},user);
 const upload=async(kind:string,reference:string,user=sampleOwner.id)=>call({action:'invoice-case-upload',expectedVersion:get().version,kind,name:reference+'.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nFictional offline evidence '+reference).toString('base64')},user);
 const originalOrder=structuredClone(memory.data.get('orders/'+draft.id));
 const uploaded=await upload('INVOICE','SAMPLE-ORIGINAL',sampleStaff.id);
 const receipt={...draft.receipt,documentIds:[uploaded.documentId]};
 await command('submit-receipt',{receipt},sampleStaff.id);
 const originalReceipt=structuredClone(get().receipt);
 const originalDocument=structuredClone(memory.data.get('_invoice_case_documents/'+uploaded.documentId+'/parts/0'));
 assert.ok(originalDocument);
 assert.equal(get().lines[0].received,8);
 assert.match(invoiceItemReview(get())[0].reports.join(' '),/Missing.*2 bags/);
 assert.match(invoiceItemReview(get())[2].reports.join(' '),/Damaged.*1 cases/);
 await assert.rejects(()=>command('save-receipt',{receipt},sampleStaff.id),/submitted/);
 await assert.rejects(()=>command('approve-invoice'),/Confirm|Check|Review|review|invoice/i);

 const reviewed=sampleReviewed();
 reviewed.lines=reviewed.lines.map((l,i)=>({...l,resolution:i===0||i===2?'CLAIM':'ACCEPT',reason:i===0?'Two bags missing and unit price £1 above agreed.':i===2?'One damaged case returned to driver.':'Checked against fictional invoice.'}));
 await command('save-review',{...reviewed,invoiceDocumentId:uploaded.documentId});
 const originalPrices=get().lines.map((l:any)=>[l.id,l.expectedPrice,l.invoicePrice,l.invoiceQuantity]);
 await command('prepare-claim');await command('approve-claim');
 assert.equal(outstandingClaim(get()),5800);
 let sends=0;
 const deps:InvoiceEmailDependencies={db:memory.db,env:{HTOS_ENABLE_INVOICE_CASES:'true',HTOS_ENABLE_EMAIL:'true'},
  account:async()=>({user:'branch@example.test',pass:'synthetic-not-a-secret',host:'smtp.example.test',port:465,secure:true,accountsCc:['accounts@example.test']}),
  reserveSend:async()=>true,now:()=> '2026-11-14T12:00:00Z',
  deliver:async mail=>{sends++;return {accepted:[...mail.to,...mail.cc],rejected:[]};}};
 const email=(action:string,payload:any)=>invoiceEmailAction(deps,sampleOwner.id,{action:'invoice-case-email-'+action,caseId:draft.id,expectedVersion:get().version,...payload});
 const content={recipient:'supplier@example.test',message:get().claim.message};
 const preview=await email('preview',content);
 await email('approve',{...content,fingerprint:preview.preview.fingerprint,confirmed:true,requestId:randomUUID()});
 await email('send',{fingerprint:preview.preview.fingerprint,confirmed:true});
 assert.equal(sends,1); // Injected in-memory delivery; no SMTP connection.
 const balances:number[]=[outstandingClaim(get())];

 const later=async(event:any,kind:string,payload:any={},user=sampleOwner.id)=>{
  const current=memory.data.get('_invoice_later_deliveries/'+event.id);
  const caseIds=[...new Set([draft.id,...event.rows.flatMap((r:any)=>r.allocations.map((a:any)=>a.caseId))])] as string[];
  return call({action:'invoice-case-later-save',deliveryId:event.id,command:{kind,requestId:randomUUID(),expectedVersion:current?.version||0,caseVersions:Object.fromEntries(caseIds.map(id=>[id,get(id).version])),...payload}},user);
 };
 const separate=blankLaterDelivery(get(),'offline-separate','2026-11-14T12:01:00Z',sampleStaff.id);
 const separateDoc=await upload('LATER_DELIVERY','SAMPLE-REPLACEMENT-1',sampleStaff.id);
 Object.assign(separate,{reference:'SAMPLE-REP-1',mode:'SEPARATE',readable:true,receiptConfirmed:true,documents:[{caseId:draft.id,documentId:separateDoc.documentId}],rows:[
  {id:'rice-part',reference:'1',description:'Sample rice',quantity:1,allocations:[{id:'rice-one',caseId:draft.id,lineId:get().lines[0].id,issueId:'missing-rice',purpose:'REPLACEMENT',quantity:1}]},
  {id:'soy-replacement',reference:'2',description:'Sample soy sauce',quantity:1,allocations:[{id:'soy-one',caseId:draft.id,lineId:get().lines[2].id,issueId:'damaged-soy',purpose:'REPLACEMENT',quantity:1}]}
 ]});
 await later(separate,'submit',{event:separate},sampleStaff.id);
 assert.equal(outstandingClaim(get()),5800);
 assert.match(invoiceItemReview(get())[0].followUp.join(' '),/Accounts to confirm/);
 await assert.rejects(()=>command('approve-invoice'),/later delivery|outstanding/);
 const approval=(event:any,combined=false)=>({verified:true,rows:event.rows.map((r:any)=>({...r,billedQuantity:combined?8:0,unitPrice:combined?18:undefined,allocations:r.allocations.map((a:any)=>({...a,billedQuantity:a.purpose==='NEW_ORDER'?a.quantity:0,billing:'NO_EXTRA_CHARGE',reason:'Checked original charge; replacement has no extra charge.'}))}))});
 await assert.rejects(()=>later(separate,'approve',approval(separate),sampleStaff.id),/access/);
 await later(separate,'approve',approval(separate));
 assert.equal(outstandingClaim(get()),2800);balances.push(outstandingClaim(get()));
 assert.match(invoiceItemReview(get())[2].followUp.join(' '),/Replacement confirmed: 1 cases/);
 assert.equal(invoiceItemReview(get())[2].attention,false);
 assert.equal(invoiceItemReview(get())[0].attention,true);

 const next=sampleReviewed('DEMO-NEXT-OFFLINE');
 next.lines=[{...next.lines[0],ordered:8,received:8,invoiceQuantity:8,invoicePrice:18,resolution:'ACCEPT',reason:'Eight new bags confirmed.'}];
 next.receipt.statuses=['RECEIVED'];next.receipt.issues=[];
 next.invoiceReference='SAMPLE-NEXT';next.invoiceNetPence=14400;next.invoiceGrossPence=14400;
 next.documents[0].sha256='synthetic-next-document';
 memory.data.set('_invoice_cases/'+next.id,structuredClone(next));
 const originalNext=structuredClone(next);
 const combined=blankLaterDelivery(get(),'offline-combined','2026-11-14T12:02:00Z',sampleStaff.id);
 Object.assign(combined,{reference:'SAMPLE-REP-2',mode:'COMBINED',readable:true,receiptConfirmed:true,documents:[{caseId:next.id,documentId:next.invoiceDocumentId}],rows:[
  {id:'combined-rice',reference:'1',description:'Sample rice',quantity:9,allocations:[
   {id:'old-rice',caseId:draft.id,lineId:get().lines[0].id,issueId:'missing-rice',purpose:'REPLACEMENT',quantity:1},
   {id:'new-rice',caseId:next.id,lineId:next.lines[0].id,purpose:'NEW_ORDER',quantity:8}
  ]}
 ]});
 await later(combined,'submit',{event:combined},sampleStaff.id);
 await later(combined,'approve',approval(combined,true));
 assert.equal(outstandingClaim(get()),1000);balances.push(outstandingClaim(get()));
 assert.deepEqual(get(next.id).lines,originalNext.lines);
 assert.deepEqual(get(next.id).receipt,originalNext.receipt);
 const rice=invoiceItemReview(get())[0];
 assert.equal(rice.priceCheck,'HIGHER');assert.equal(rice.priceDifference,100);
 assert.match(rice.followUp.join(' '),/Replacement confirmed: 2 bags/);
 assert.match(rice.followUp.join(' '),/outstanding: £10.00/);
 assert.equal(rice.attention,true);
 await assert.rejects(()=>command('approve-invoice'),/outstanding/);

 for(const [reference,pence,remaining] of [['SAMPLE-CN-1',400,600],['SAMPLE-CN-2',600,0]] as const){
  const creditDoc=await upload('CREDIT',reference);
  const before=outstandingClaim(get());
  await command('record-credit',{reference,documentId:creditDoc.documentId,invoiceReference:get().invoiceReference,supplierId:draft.supplierId,lines:[{lineId:get().lines[0].id,netPence:pence}],vatPence:0,grossPence:pence,verified:true});
  assert.equal(outstandingClaim(get()),before);
  assert.match(invoiceItemReview(get())[0].followUp.join(' '),/Accounts to approve/);
  await assert.rejects(()=>command('approve-invoice'),/outstanding|pending/);
  const creditId=get().credits.at(-1).id;
  await assert.rejects(()=>command('approve-credit',{creditId},sampleStaff.id),/access/);
  await command('approve-credit',{creditId});
  assert.equal(outstandingClaim(get()),remaining);balances.push(remaining);
  assert.equal(get().approvedAt,undefined);
 }
 assert.deepEqual(invoiceApprovalProblems(get()),[]);
 assert.equal(invoiceItemReview(get()).some(r=>r.attention),false);
 await assert.rejects(()=>command('approve-invoice',{},sampleStaff.id),/access/);
 await command('approve-invoice');assert.equal(get().status,'APPROVED');
 assert.deepEqual(get().receipt,originalReceipt);
 assert.deepEqual(memory.data.get('orders/'+draft.id),originalOrder);
 assert.deepEqual(memory.data.get('_invoice_case_documents/'+uploaded.documentId+'/parts/0'),originalDocument);
 assert.deepEqual(get().lines.map((l:any)=>[l.id,l.expectedPrice,l.invoicePrice,l.invoiceQuantity]),originalPrices);
 assert.deepEqual(balances,[5800,2800,1000,600,0]);
 t.diagnostic('Synthetic claim balances (net GBP): £58 -> £28 -> £10 -> £6 -> £0. Original report, order prices and original file bytes preserved. Final invoice approved separately; no network, AI or real email.');
});
