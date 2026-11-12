import {createHash,randomUUID} from 'node:crypto';
import {assertInvoiceAccess,applyInvoiceCommand,InvoiceCaseError} from './invoice-case-validation.ts';
import {branchSmtpConfig,orderEmailRouting,type Mail,type SmtpConfig} from './email-service.ts';
import type {InvoiceCase,InvoiceEmailApproval} from '../shared/invoice-case.ts';

export interface InvoiceEmailDependencies {
 db:any; env:Record<string,string|undefined>; account:(branchId:string)=>Promise<any>;
 reserveSend:(uid:string)=>Promise<boolean>;
 deliver:(mail:Mail,config:SmtpConfig)=>Promise<{accepted:string[];rejected:string[]}>;
 now?:()=>string;
}
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(message:string,status=400):never=>{throw new InvoiceCaseError(message,status);};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const email=(v:unknown):string=>typeof v==='string'&&v.length<=254&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(v.trim())?v.trim().toLowerCase():fail('Choose a valid saved supplier email address.');
const stamp=(r:InvoiceCase,at:string,by:string,action:string,details:string)=>{
 r.version++;r.updatedAt=at;r.audit.push({at,by,action,details});
 if(Buffer.byteLength(JSON.stringify(r))>650000)fail('This review has reached its storage limit.');
};

async function context(deps:InvoiceEmailDependencies,uid:string,caseId:unknown){
 if(typeof caseId!=='string'||!/^\w[\w-]{0,127}$/.test(caseId))fail('Invalid invoice reference.');
 const ref=deps.db.collection('_invoice_cases').doc(caseId);
 const read=async(tx:any)=>{
  const [snap,user,roles]=await Promise.all([tx.get(ref),tx.get(deps.db.collection('users').doc(uid)),tx.get(deps.db.collection('settings').doc('role_permissions'))]);
  if(!snap.exists)fail('Invoice not found.',404);
  const record=snap.data() as InvoiceCase,profile={...user.data(),id:uid},permissions=roles.data()?.map||{};
  assertInvoiceAccess(profile,permissions,record,true);return {record,profile,permissions};
 };
 return {ref,read,...await deps.db.runTransaction(read)};
}

export function invoiceEmailEnvelope(record:InvoiceCase,branch:any,supplier:any,account:any,env:any,recipient:unknown,message:unknown){
 if(record.claim?.state!=='APPROVED'||!record.claim.approvedAt||record.status==='APPROVED')fail('Approve the claim before preparing its email.');
 if(!branch?.active||!supplier?.active)fail('The branch and supplier must be active.');
 const to=email(recipient),route=orderEmailRouting(branch,supplier,account,env);
 if(!route.to.includes(to))fail('Use an email saved on this supplier. Update its contact details separately if needed.');
 if(!Array.isArray(account?.accountsCc)||!account.accountsCc.length)fail('Set Accounts CC in this branch’s email settings first.');
 const cc=[...new Set([...route.cc,...account.accountsCc.map(email)])].filter(a=>a!==to);
 if(cc.length+1>20)fail('Use at most 20 recipients.');
 if(typeof message!=='string'||!message.trim()||message.length>10000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message))fail('Enter the reviewed email message (up to 10,000 characters).');
 const ids=[record.invoiceDocumentId,...record.receipt.issues.filter(i=>record.claim!.lines.some(l=>l.lineId===i.lineId)).flatMap(i=>i.documentIds)];
 const attachments=[...new Set(ids)].map(id=>record.documents.find(d=>d.id===id)||fail('A claim document is missing.'));
 if(!attachments.length||attachments.reduce((sum,d)=>sum+d.size,0)>12*1024*1024)fail('Claim attachments exceed 12 MB. Keep the claim on hold for an authorised manual follow-up.');
 const claim=record.claim!;
 const envelope={from:route.from,fromName:route.fromName,to:[to],cc,replyTo:route.replyTo,subject:claim.subject.replace(/[\r\n\x00-\x1f\x7f]/g,' ').slice(0,200),message:(message as string).trim(),attachments:attachments.map(({id,name,mime,size,sha256})=>({id,name,mime,size,sha256}))};
 return {...envelope,fingerprint:digest({envelope,claimId:claim.id,revision:claim.revision,lines:claim.lines})};
}

/** Approval -> durable send reservation -> SMTP once -> saved outcome. No automatic resend. */
export async function invoiceEmailAction(deps:InvoiceEmailDependencies,uid:string,body:any){
 if(deps.env.HTOS_ENABLE_INVOICE_CASES!=='true')fail('Invoice workflow is disabled.',503);
 const ctx=await context(deps,uid,body.caseId),{ref}=ctx,now=()=>deps.now?.()||new Date().toISOString();
 if(body.action==='invoice-case-email-reconcile'){
  return deps.db.runTransaction(async(tx:any)=>{
   const {record}=await ctx.read(tx),claim=record.claim;
   if(record.version!==body.expectedVersion)fail('The claim changed. Reload before confirming its outcome.',409);
   if(!claim?.delivery||!['SENDING','UNCERTAIN'].includes(claim.state))fail('No uncertain email needs checking.');
   if(claim.state==='SENDING'&&Date.parse(now())-Date.parse(claim.delivery.startedAt||'')<120000)fail('Sending may still be in progress. Wait two minutes before checking its outcome.');
   if(body.verified!==true||body.received!==true||typeof body.notes!=='string'||body.notes.trim().length<10||body.notes.length>2000)fail('Confirm receipt with the supplier and copied recipients, then record the evidence.');
   const next=structuredClone(record),at=now();next.claim!.state='SENT';next.claim!.sentAt=at;next.claim!.delivery!.confirmation={at,by:uid,notes:body.notes.trim()};next.status='WAITING_CREDIT';
   stamp(next,at,uid,'confirm-claim-email',body.notes.trim());tx.set(ref.collection('revisions').doc(String(record.version)),record);tx.set(ref,next);return {record:next};
  });
 }
 const sending=body.action==='invoice-case-email-send';
 if(sending&&ctx.record.claim&&['SENDING','SENT','UNCERTAIN'].includes(ctx.record.claim.state))return {record:ctx.record,message:'A send attempt is already recorded. No duplicate was sent.'};
 if(!['invoice-case-email-preview','invoice-case-email-approve','invoice-case-email-send'].includes(body.action))fail('Unknown email action.');
 const [branchSnap,supplierSnap,account]=await Promise.all([deps.db.collection('branches').doc(ctx.record.branchId).get(),deps.db.collection('suppliers').doc(ctx.record.supplierId).get(),deps.account(ctx.record.branchId)]);
 const branch=branchSnap.data(),supplier=supplierSnap.data(),previous=ctx.record.claim?.delivery;
 const envelope=invoiceEmailEnvelope(ctx.record,branch,supplier,account,deps.env,sending?ctx.record.claim?.recipient:body.recipient,sending?ctx.record.claim?.message:body.message);
 if(body.action==='invoice-case-email-preview')return {preview:envelope,ready:deps.env.HTOS_ENABLE_EMAIL==='true'};
 if(body.expectedVersion!==ctx.record.version)fail('The review changed. Reload and review the email again.',409);
 if(body.fingerprint!==envelope.fingerprint||body.confirmed!==true)fail('Review the current recipients, message and attachments first.');
 if(body.action==='invoice-case-email-approve')return deps.db.runTransaction(async(tx:any)=>{
  const {record,profile,permissions}=await ctx.read(tx);
  const [b,s]=await Promise.all([tx.get(deps.db.collection('branches').doc(record.branchId)),tx.get(deps.db.collection('suppliers').doc(record.supplierId))]);
  if(record.version!==body.expectedVersion||invoiceEmailEnvelope(record,b.data(),s.data(),account,deps.env,body.recipient,body.message).fingerprint!==envelope.fingerprint)fail('The review or recipients changed. Review the email again.',409);
  const at=now(),next=applyInvoiceCommand(record,{kind:'approve-email',requestId:body.requestId,expectedVersion:body.expectedVersion,recipient:envelope.to[0],message:envelope.message},profile,permissions,at);
  next.claim!.delivery={...envelope,approvedBy:uid,approvedAt:at};tx.set(ref.collection('revisions').doc(String(record.version)),record);tx.set(ref,clone(next));return {record:next};
 });
 if(deps.env.HTOS_ENABLE_EMAIL!=='true')fail('Email sending is disabled.',503);
 if(!previous?.approvedAt||previous.fingerprint!==envelope.fingerprint)fail('Recipients or evidence changed. Review and approve the email again.');
 const attachments:Mail['attachments']=[];
 for(const d of envelope.attachments){
  const docRef=deps.db.collection('_invoice_case_documents').doc(d.id),manifest=(await docRef.get()).data();
  if(manifest?.caseId!==ctx.record.id||!Number.isInteger(manifest.parts)||manifest.parts<1||manifest.parts>6)fail('Claim attachment is unavailable.',503);
  const parts=await Promise.all(Array.from({length:manifest.parts},(_,i)=>docRef.collection('parts').doc(String(i)).get()));
  const content=Buffer.from(parts.map((p:any)=>p.data()?.base64||'').join(''),'base64');
  if(content.length!==d.size||createHash('sha256').update(content).digest('hex')!==d.sha256)fail('Claim attachment failed its integrity check.',503);
  const extension=d.mime==='application/pdf'?'pdf':d.mime==='image/png'?'png':'jpg';
  attachments.push({filename:`Claim-document-${attachments.length+1}.${extension}`,content,contentType:d.mime});
 }
 const config=branchSmtpConfig(deps.env,account,branch).config;
 if(!await deps.reserveSend(uid))fail('Email rate limit reached. Try again later.',429);
 const attempt=randomUUID();
 const reserved=await deps.db.runTransaction(async(tx:any)=>{
  const {record}=await ctx.read(tx);
  if(record.claim&&['SENDING','SENT','UNCERTAIN'].includes(record.claim.state))return false;
  const [b,s]=await Promise.all([tx.get(deps.db.collection('branches').doc(record.branchId)),tx.get(deps.db.collection('suppliers').doc(record.supplierId))]);
  if(record.version!==body.expectedVersion||record.claim?.delivery?.fingerprint!==envelope.fingerprint||invoiceEmailEnvelope(record,b.data(),s.data(),account,deps.env,record.claim?.recipient,record.claim?.message).fingerprint!==envelope.fingerprint)fail('The approved email changed. Review it again.',409);
  const next=structuredClone(record),at=now();next.claim!.state='SENDING';Object.assign(next.claim!.delivery!,{attemptId:attempt,startedAt:at});
  stamp(next,at,uid,'claim-email-reserved','Approved recipients and documents locked; one send attempt.');tx.set(ref.collection('revisions').doc(String(record.version)),record);tx.set(ref,next);return true;
 });
 if(!reserved)return {record:(await context(deps,uid,body.caseId)).record,message:'A send attempt is already recorded.'};
 const recipients=[...envelope.to,...envelope.cc];let accepted:string[]=[],rejected:string[]=[];
 try{
  const result=await deps.deliver({from:{name:envelope.fromName,address:envelope.from},to:envelope.to,cc:envelope.cc,replyTo:envelope.replyTo,subject:envelope.subject,html:`<div style="white-space:pre-wrap">${escape(envelope.message)}</div>`,attachments,disableFileAccess:true,disableUrlAccess:true},config);
  accepted=[...new Set(result.accepted.map(v=>String(v).toLowerCase()).filter(v=>recipients.includes(v)))];rejected=recipients.filter(v=>!accepted.includes(v));
 }catch{/* A timeout may follow acceptance: retain the reservation, never retry or expose SMTP errors. */}
 return deps.db.runTransaction(async(tx:any)=>{
  const snapshot=await tx.get(ref),record=snapshot.data() as InvoiceCase;
  if(record.claim?.state!=='SENDING'||record.claim.delivery?.attemptId!==attempt)fail('Email outcome needs a mailbox check. Do not resend.',503);
  const next=structuredClone(record),at=now(),sent=recipients.every(v=>accepted.includes(v));next.claim!.state=sent?'SENT':'UNCERTAIN';Object.assign(next.claim!.delivery!,{accepted,rejected,finishedAt:at});
  if(sent){next.claim!.sentAt=at;next.status='WAITING_CREDIT';}else{next.status='HOLD';next.holdReason='Supplier email acceptance is uncertain. Check the branch mailbox and supplier before continuing.';next.holdOwner='Accounts';}
  stamp(next,at,uid,sent?'claim-email-accepted':'claim-email-uncertain',sent?'Mail server accepted all recipients; delivery is not guaranteed.':'No automatic retry. Confirm the outcome manually.');tx.set(ref.collection('revisions').doc(String(record.version)),record);tx.set(ref,next);return {record:next};
 });
}
