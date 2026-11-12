import {createHash} from 'node:crypto';
import {attachInvoiceExtraction} from '../shared/invoice-extraction.ts';
import type {InvoiceCase} from '../shared/invoice-case.ts';
import {assertInvoiceAccess,InvoiceCaseError} from './invoice-case-validation.ts';
import type {InvoiceReaderResult,ReaderDocument} from './invoice-reader.ts';

export interface InvoiceReadGate {
 resumable?:boolean;
 requiresPreparation?:boolean;
 /** Must reserve a durable budget before dispatch and account for uncertain failures. */
 read:(documents:ReaderDocument[],jobId:string)=>Promise<InvoiceReaderResult>;
}
export class InvoiceReadingPending extends Error {
 readonly completed:number;readonly total:number;
 constructor(completed:number,total:number){super('Completed sections saved. Continue with unread sections.');this.completed=completed;this.total=total;}
}
const clean=(v:unknown)=>JSON.parse(JSON.stringify(v));
export const invoiceReadJobId=(caseId:string,hash:string)=>createHash('sha256').update(caseId+'|'+hash).digest('hex');
/** Status and recovery never contact a provider. Browser input cannot supply a draft. */
export async function invoiceCaseReadingState(db:any,uid:string,body:any,gate?:InvoiceReadGate){
 if(typeof body.caseId!=='string'||!/^[\w-]{1,128}$/.test(body.caseId)||typeof body.documentId!=='string')throw new InvoiceCaseError('Choose an original invoice document.');
 const ref=db.collection('_invoice_cases').doc(body.caseId);
 return db.runTransaction(async(tx:any)=>{
  const [snapshot,profile,roles]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions'))]);
  if(!snapshot.exists)throw new InvoiceCaseError('Invoice record not found.',404);
  const record=snapshot.data() as InvoiceCase;assertInvoiceAccess({...profile.data(),id:uid},roles.data()?.map||{},record,true);
  const document=record.documents.find(d=>d.id===body.documentId&&['INVOICE','DELIVERY'].includes(d.kind));
  if(!document)throw new InvoiceCaseError('Original document not found.');
  const jobRef=db.collection('_invoice_read_jobs').doc(invoiceReadJobId(record.id,document.sha256)),job=(await tx.get(jobRef)).data();
  const open=!!record.receipt.submittedAt&&record.status!=='APPROVED'&&!record.claim&&!record.laterReceipts?.some(r=>r.status==='APPROVED');
  if(body.action!=='invoice-case-reading-recover'){
   const photo=['image/jpeg','image/png'].includes(document.mime);
   const source=photo?(await tx.get(db.collection('_invoice_case_documents').doc(document.id))).data():null;
   const preparation=source?.preparedId?(await tx.get(db.collection('_invoice_case_documents').doc(document.id).collection('preparations').doc(source.preparedId))).data():null;
   const prepared=preparation?.state==='READY'&&preparation.documentHash===document.sha256;
   return {state:job?.state||'NOT_READ',completed:job?.completed,total:job?.total,canRead:!!gate&&open&&(!gate.requiresPreparation||prepared)&&(!job||gate.resumable===true&&job.state==='PAUSED'),canRecover:open&&job?.state==='RESULT_REQUIRES_RECOVERY',enabled:!!gate,prepared,canPrepare:open&&photo&&!job&&!prepared,preparationRequired:!!gate?.requiresPreparation};
  }
  if(!open||record.version!==body.expectedVersion)throw new InvoiceCaseError('This review is locked or changed. Reload before recovering.',409);
  if(job?.state!=='RESULT_REQUIRES_RECOVERY'||!job.result?.draft||job.documentId!==document.id||job.caseId!==record.id)throw new InvoiceCaseError('No completed result is available for recovery.',409);
  const at=new Date().toISOString(),next=attachInvoiceExtraction(record,document.id,job.result.draft);
  next.version++;next.updatedAt=at;next.audit.push({at,by:uid,action:'recover-invoice-reading',details:'Recovered the saved reading without another AI call; existing manual figures preserved.'});
  if(JSON.stringify(next).length>650000)throw new InvoiceCaseError('This review is too large for a reading draft.');
  tx.set(ref.collection('revisions').doc(String(record.version)),clean(record));tx.set(ref,clean(next));
  tx.set(jobRef,{...job,state:'COMPLETE',recoveredAt:at,recoveredBy:uid});
  return {record:next};
 });
}
/** Private, injectable worker. No provider is configured by default or by browser input. */
export async function invoiceCaseRead(db:any,uid:string,body:any,gate?:InvoiceReadGate){
 if(!gate)throw new InvoiceCaseError('Invoice AI is not enabled. Use the authorised local sample trial.',503);
 if(typeof body.caseId!=='string'||!/^[\w-]{1,128}$/.test(body.caseId)||!Array.isArray(body.documentIds)||body.documentIds.length!==1)throw new InvoiceCaseError('Choose one original document. Multi-page PDFs are supported; separate page files need grouping first.');
 const ref=db.collection('_invoice_cases').doc(body.caseId);
 const started=await db.runTransaction(async(tx:any)=>{
  const [snapshot,profile,roles]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions'))]);
  if(!snapshot.exists)throw new InvoiceCaseError('Invoice record not found.',404);
  const record=snapshot.data() as InvoiceCase;assertInvoiceAccess({...profile.data(),id:uid},roles.data()?.map||{},record,true);
  if(record.version!==body.expectedVersion)throw new InvoiceCaseError('This review changed. Reload before reading.',409);
  if(!record.receipt.submittedAt||record.status==='APPROVED'||record.claim||record.laterReceipts?.some(r=>r.status==='APPROVED'))throw new InvoiceCaseError('The original invoice figures are locked or the delivery report is not submitted.');
  const document=record.documents.find(d=>d.id===body.documentIds[0]&&['INVOICE','DELIVERY'].includes(d.kind));
  if(!document)throw new InvoiceCaseError('Choose an original invoice or delivery note.');
  const jobId=invoiceReadJobId(record.id,document.sha256),jobRef=db.collection('_invoice_read_jobs').doc(jobId),existing=await tx.get(jobRef);
  if(gate.requiresPreparation){
   const source=(await tx.get(db.collection('_invoice_case_documents').doc(document.id))).data();
   const prepared=source?.preparedId?(await tx.get(db.collection('_invoice_case_documents').doc(document.id).collection('preparations').doc(source.preparedId))).data():null;
   if(prepared?.state!=='READY'||prepared.documentHash!==document.sha256||prepared.caseId!==record.id)throw new InvoiceCaseError('Save the prepared photo before starting the reading.');
  }
  if(existing.exists&&!(gate.resumable===true&&existing.data()?.state==='PAUSED'))throw new InvoiceCaseError('This document has already been submitted for AI reading. Review its result or reconcile the failed attempt before retrying.',409);
  tx.set(jobRef,{caseId:record.id,documentId:document.id,startedBy:uid,state:'RUNNING',startedAt:new Date().toISOString()});
  return {record,document,jobId,jobRef};
 });
 let result:InvoiceReaderResult|undefined;
 try {
  const docRef=db.collection('_invoice_case_documents').doc(started.document.id),manifest=await docRef.get(),data=manifest.data();
  if(data?.caseId!==body.caseId||!Number.isInteger(data.parts)||data.parts<1||data.parts>6)throw new Error('Document unavailable.');
  const chunks=await Promise.all(Array.from({length:data.parts},(_,i)=>docRef.collection('parts').doc(String(i)).get()));
  const base64=chunks.map((s:any)=>s.data()?.base64||'').join('');
  if(createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex')!==started.document.sha256)throw new Error('Document integrity failure.');
  result=await gate.read([{id:started.document.id,name:started.document.name,mime:started.document.mime,sha256:started.document.sha256,base64}],started.jobId);
  return await db.runTransaction(async(tx:any)=>{
   const [snapshot,profile,roles]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions'))]);
   const current=snapshot.data() as InvoiceCase;assertInvoiceAccess({...profile.data(),id:uid},roles.data()?.map||{},current,true);
   if(current.version!==started.record.version)throw new InvoiceCaseError('The review changed while AI was reading. Its result is retained for recovery; no figures were overwritten.',409);
   const at=new Date().toISOString(),next=attachInvoiceExtraction(current,started.document.id,result!.draft);
   next.version++;next.updatedAt=at;next.audit.push({at,by:uid,action:'read-invoice-draft',details:'AI extraction retained as an unapproved draft.'});
   if(JSON.stringify(next).length>650000)throw new InvoiceCaseError('This review is too large for an AI draft.');
   tx.set(ref.collection('revisions').doc(String(current.version)),clean(current));tx.set(ref,clean(next));
   tx.set(started.jobRef,{caseId:current.id,documentId:started.document.id,state:'COMPLETE',result:clean(result),completedAt:at});
   return {record:next};
  });
 }catch(error){
  if(error instanceof InvoiceReadingPending){
   await db.runTransaction(async(tx:any)=>{tx.set(started.jobRef,{caseId:body.caseId,documentId:started.document.id,state:'PAUSED',completed:error.completed,total:error.total,updatedAt:new Date().toISOString()});});
   return {reading:{state:'PAUSED',completed:error.completed,total:error.total}};
  }
  // Retain failed/uncertain attempts: a second click must never cause an automatic paid retry.
  await db.runTransaction(async(tx:any)=>{tx.set(started.jobRef,{caseId:body.caseId,documentId:started.document.id,state:result?'RESULT_REQUIRES_RECOVERY':'FAILED_OR_UNCERTAIN',...(result?{result:clean(result)}:{}),finishedAt:new Date().toISOString()});});
  if(error instanceof InvoiceCaseError)throw error;
  throw new InvoiceCaseError('Invoice reading stopped. No figures changed and no automatic retry was made. Check the trial result and usage before retrying.',503);
 }
}
