import {createHash,randomUUID} from 'node:crypto';
import {branchSmtpConfig,orderEmailRouting,type Mail,type SmtpConfig} from './email-service.ts';
import {assertCheckAccess,checkTransaction} from './delivery-check-service.ts';
import {deliveryIssues,type SupplierCase,type CreditReceipt} from '../shared/delivery-check.ts';
import {validCalendarDate} from '../shared/calendar-date.ts';
import type {OrderRecord} from '../types.ts';
import {generateCreditClaimPdf} from '../utils/creditClaimPdf.ts';
import {createHtosPdf} from '../utils/pdfTheme.ts';
import autoTable from 'jspdf-autotable';

const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function caseSource(order:OrderRecord,source:string){
 if(source==='INVOICE'){
  const review=order.invoiceVerification,claim=order.creditNoteClaim;
  if(!review||!['VERIFIED','REVIEWED_WITH_EXCEPTION'].includes(review.reviewStatus||'')||(!claim?.items.length&&!review.notes?.trim()))throw new Error('Confirm an invoice review with discrepancies or flagged notes first.');
  return {version:review.version||0,amount:claim?.totalClaimAmount||0,evidence:review.evidence||[],summary:(claim?.items||[]).map(i=>`${i.description}: ${i.issueType.replaceAll('_',' ')}. Ordered ${i.orderedQtyStr}; received ${i.deliveredQtyStr}. Requested credit £${i.claimAmount.toFixed(2)}. ${i.notes||''}`).join('\n')+'\n'+(review.notes||''),reference:review.invoiceNumber||'not numbered'};
 }
 if(source!=='DELIVERY'||!order.deliveryCheck||order.deliveryCheck.draft)throw new Error('Confirm the delivery check first.');
 const review=order.deliveryCheck;
 const issues=review.lines.filter(l=>deliveryIssues(l,review.partial).length);
 if(!issues.length&&!review.notes.trim())throw new Error('Record a delivery issue before contacting the supplier.');
 return {version:review.version,amount:0,evidence:review.evidence,reference:review.reference||'not numbered',summary:issues.map(l=>`${l.description}: ${deliveryIssues(l,review.partial).join(', ')}. Ordered ${l.orderedCases} cases / ${l.orderedUnits} units; received ${l.receivedCases} cases / ${l.receivedUnits} units; damaged/rejected ${l.damagedCases||0} cases / ${l.damagedUnits||0} units. ${l.notes}`).join('\n')+'\n'+review.notes};
}
export function prepareCaseEmail(order:OrderRecord,source:string,branch:any,supplier:any,account:any,env:any){
 const facts=caseSource(order,source),route=orderEmailRouting(branch,supplier,account,env);
 const accounts=account?.accountsCc;
 if(!Array.isArray(accounts)||!accounts.length||accounts.some(a=>typeof a!=='string'||a.length>254||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(a)))throw new Error('Set Accounts CC for credit requests in this branch’s mailbox settings first.');
 const cc=[...new Set([...route.cc,...accounts.map((a:string)=>a.toLowerCase())])].filter(a=>!route.to.includes(a));
 if(route.to.length+cc.length>20)throw new Error('Use at most 20 recipients per email.');
 const subject=`${source==='INVOICE'?'Credit request':'Delivery issue'} · Order ${order.id.slice(0,8).toUpperCase()} · ${order.branchNameSnapshot}`.replace(/[\r\n]/g,' ');
 const message=`Hello,\n\nPlease review the following ${source==='INVOICE'?'invoice discrepancies':'delivery issues'} for ${order.branchNameSnapshot}.\nSupplier: ${order.supplierNameSnapshot}\nOrder: ${order.id.slice(0,8).toUpperCase()}\n${source==='INVOICE'?'Invoice':'Delivery note'}: ${facts.reference}\n\n${facts.summary}\n\n${source==='INVOICE'&&facts.amount>0?`Requested credit: £${facts.amount.toFixed(2)} (net). Please issue a credit note or corrected invoice.`:'Please confirm the outstanding delivery, replacement or credit arrangement. No credit amount is calculated for this request; please confirm the appropriate correction.'}\nThe attached report includes recorded photographs. Please reply to this branch and keep our accounts team copied.\n\nThank you,\n${branch.name}`;
 const safeRoute={from:route.from,fromName:route.fromName,replyTo:route.replyTo,to:route.to,cc,accounts};
 return {...safeRoute,subject,message,source,sourceVersion:facts.version,requestedAmount:facts.amount,evidenceCount:facts.evidence.length,previewKey:hash({safeRoute,subject,message,facts})};
}
function attachment(order:OrderRecord,source:string,branch:any,supplier:any):Mail['attachments'][number]{
 if(source==='INVOICE'){
  if(order.creditNoteClaim){const pdf=generateCreditClaimPdf(order.creditNoteClaim,branch,supplier);return {filename:'Credit-request.pdf',content:Buffer.from(pdf.base64,'base64'),contentType:'application/pdf'};}
  const review=order.invoiceVerification!,doc=createHtosPdf();doc.setFontSize(17);doc.text('Invoice issue report',14,20);doc.setFontSize(10);doc.text(`Order ${order.id.slice(0,8).toUpperCase()}`,14,29);let y=40;
  for(const line of doc.splitTextToSize(review.notes||'',180)){if(y>270){doc.addPage();y=20;}doc.text(line,14,y);y+=5;}
  for(const photo of review.evidence||[]){doc.addPage();doc.text(doc.splitTextToSize(photo.caption||'Damage evidence',180),14,20);const p=doc.getImageProperties(photo.dataUrl),scale=Math.min(180/p.width,200/p.height);doc.addImage(photo.dataUrl,'JPEG',14,60,p.width*scale,p.height*scale);}
  return {filename:'Invoice-issue.pdf',content:Buffer.from(doc.output('arraybuffer')),contentType:'application/pdf'};
 }
 const check=order.deliveryCheck!,doc=createHtosPdf();doc.setFontSize(18);doc.text('Delivery issue report',14,20);doc.setFontSize(10);doc.text(`Order ${order.id.slice(0,8).toUpperCase()} · ${check.date}`,14,29);
 autoTable(doc,{startY:36,head:[['Item','Ordered cases / units','Received','Damaged / rejected','Issue']],body:check.lines.map(l=>[l.description,`${l.orderedCases} / ${l.orderedUnits}`,`${l.receivedCases} / ${l.receivedUnits}`,`${l.damagedCases||0} / ${l.damagedUnits||0}`,deliveryIssues(l,check.partial).join(', ')+' '+l.notes]),styles:{font:'DMSans',fontSize:8},headStyles:{fillColor:[23,58,49]}});
 if(check.notes){doc.addPage();doc.text(doc.splitTextToSize(check.notes,180),14,20);}
 for(const photo of check.evidence){doc.addPage();doc.text(doc.splitTextToSize((check.lines.find(l=>l.lineId===photo.lineId)?.description||'')+' · '+photo.caption,180),14,20);const p=doc.getImageProperties(photo.dataUrl),scale=Math.min(180/p.width,210/p.height);doc.addImage(photo.dataUrl,'JPEG',14,55,p.width*scale,p.height*scale);}
 return {filename:'Delivery-issue.pdf',content:Buffer.from(doc.output('arraybuffer')),contentType:'application/pdf'};
}
export interface CaseDependencies {db:any;account:(branchId:string)=>Promise<any>;env:Record<string,string|undefined>;reserveSend:(uid:string)=>Promise<boolean>;deliver:(mail:Mail,config:SmtpConfig)=>Promise<{accepted:string[];rejected:string[]}>}
export async function supplierCaseAction(deps:CaseDependencies,uid:string,body:any){
 const {db}=deps;
 if(['case-credit','case-resolve','case-reconcile'].includes(body.action))return checkTransaction(db,uid,body.orderId,(order,user,roles)=>{if(body.action==='case-reconcile')assertCheckAccess(user,roles,order,true);return {changes:{supplierCase:updateCaseTracking(order.supplierCase,body,user)},event:body.action==='case-credit'?'CREDIT_NOTE_RECORDED':body.action==='case-reconcile'?'SUPPLIER_MAILBOX_OUTCOME_CONFIRMED':'SUPPLIER_CASE_RESOLVED'};});
 // Bounded reads, on explicit preview/send only. The transaction checks scope again before reserving a send.
 const order:OrderRecord=await checkTransaction(db,uid,body.orderId,(order,user,roles)=>{assertCheckAccess(user,roles,order,true);return {result:order};});
 if(order.supplierCase)throw new Error('A supplier request already exists. Open its tracking record; do not send a duplicate.');
 const [branchDoc,supplierDoc,account]=await Promise.all([db.collection('branches').doc(order.branchId).get(),db.collection('suppliers').doc(order.supplierId).get(),deps.account(order.branchId)]);
 const branch=branchDoc.data(),supplier=supplierDoc.data();
 if(!branch?.active||!supplier?.active)throw new Error('Branch and supplier must be active.');
 const preview=prepareCaseEmail(order,body.source,branch,supplier,account,deps.env);
 if(body.action==='case-preview')return {...preview,ready:deps.env.HTOS_ENABLE_EMAIL==='true'};
 if(body.action!=='case-send'||body.confirmed!==true||body.previewKey!==preview.previewKey)throw new Error('Review the current recipients and request before sending.');
 if(deps.env.HTOS_ENABLE_EMAIL!=='true')throw new Error('Email sending is disabled.');
 const mail:Mail={from:{name:preview.fromName,address:preview.from},to:preview.to,cc:preview.cc,replyTo:preview.replyTo,subject:preview.subject,html:`<div style="font-family:Arial,sans-serif;color:#173a31;max-width:760px"><h2>${escape(preview.subject)}</h2><div style="white-space:pre-wrap">${escape(preview.message).replace(/\n/g,'<br>')}</div></div>`,attachments:[attachment(order,body.source,branch,supplier)],disableFileAccess:true,disableUrlAccess:true};
 const config=branchSmtpConfig(deps.env,account,branch).config;
 if(!await deps.reserveSend(uid))throw new Error('Email rate limit reached. Wait a minute before trying again.');
 const record:SupplierCase={id:randomUUID(),version:1,source:body.source,sourceVersion:preview.sourceVersion,requestedAmount:preview.requestedAmount,subject:preview.subject,message:preview.message,to:preview.to,cc:preview.cc,from:preview.from,emailState:'SENDING',accepted:[],rejected:[],createdAt:new Date().toISOString(),credits:[]};
 await checkTransaction(db,uid,order.id,(current,user,roles)=>{assertCheckAccess(user,roles,current,true);if(current.supplierCase||hash(caseSource(current,body.source))!==hash(caseSource(order,body.source)))throw new Error('The review changed or a request already exists. Reopen it before sending.');return {changes:{supplierCase:record},event:'SUPPLIER_CASE_SEND_RESERVED'};});
 // Never retry SMTP automatically: a timeout can happen after acceptance.
 let emailState:SupplierCase['emailState']='UNCERTAIN',accepted:string[]=[],rejected:string[]=[];
 try{const result=await deps.deliver(mail,config);const recipients=[...preview.to,...preview.cc];accepted=result.accepted.map(a=>String(a).toLowerCase()).filter(a=>recipients.includes(a));rejected=recipients.filter(a=>!accepted.includes(a));emailState=rejected.length?'PARTIAL':'SENT';}catch{/* No raw transport errors or credentials returned. */}
 await db.runTransaction(async(tx:any)=>{const ref=db.collection('orders').doc(order.id),snap=await tx.get(ref),latest=snap.data()?.supplierCase;if(latest?.id!==record.id||latest.emailState!=='SENDING')throw new Error('Email outcome could not be saved. Do not resend; check with the supplier.');tx.update(ref,{supplierCase:{...latest,emailState,accepted,rejected,sentAt:new Date().toISOString(),version:latest.version+1}});});
 return {success:emailState==='SENT',emailState,message:emailState==='SENT'?'Email accepted for every recipient.':'Delivery could not be confirmed for every recipient. Check the saved status and mailbox before any follow-up.'};
}
export function updateCaseTracking(current:SupplierCase|undefined,body:any,user:any):SupplierCase{
 if(!current||current.version!==body.expectedVersion)throw new Error('This request changed. Close and reopen tracking.');
 if(current.resolvedAt)throw new Error('This case is already resolved.');
 if(body.action==='case-reconcile'){
  if(current.emailState==='SENT')throw new Error('Email acceptance is already recorded.');
  if(current.emailState==='SENDING'&&Date.now()-Date.parse(current.createdAt)<120000)throw new Error('Sending is still in progress. Wait two minutes before checking the mailbox outcome.');
  const notes=String(body.notes||'').trim();if(body.verified!==true||typeof body.received!=='boolean'||notes.length<10||notes.length>2000)throw new Error('Confirm the mailbox or supplier check and describe its outcome.');
  return {...current,version:current.version+1,emailState:body.received?'SENT':'UNCERTAIN',mailboxConfirmation:{by:user.displayName||user.id,at:new Date().toISOString(),notes,received:body.received}};
 }
 if(current.emailState==='SENDING')throw new Error('Wait for the sending result. If it remains pending, check the branch mailbox before recording the outcome.');
 const next={...current,version:current.version+1};
 if(body.action==='case-resolve'){
  const resolution=String(body.resolution||'').trim();if(resolution.length<10||resolution.length>2000)throw new Error('Describe the resolution, including any credit difference or replacement (10–2,000 characters).');
  return {...next,resolvedAt:new Date().toISOString(),resolution};
 }
 if(current.credits.length>=10)throw new Error('Up to ten credit notes can be recorded for one request.');
 const reference=String(body.reference||'').trim();
 if(!reference||reference.length>120||current.credits.some(c=>c.reference.toLowerCase()===reference.toLowerCase()))throw new Error('Enter a unique credit-note reference.');
 if(!validCalendarDate(body.date)||typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||body.amount>1e7||Math.abs(body.amount*100-Math.round(body.amount*100))>0.00001)throw new Error('Enter a valid date and positive net credit amount with up to two decimals.');
 const receipt:CreditReceipt={id:randomUUID(),reference,date:body.date,amount:body.amount,notes:String(body.notes||'').slice(0,1000),recordedBy:user.displayName||user.id,recordedAt:new Date().toISOString()};
 if(body.document){const d=body.document;if(typeof d.dataUrl!=='string'||d.dataUrl.length>160000||!/^data:(application\/pdf|image\/jpeg);base64,[A-Za-z0-9+/]+=*$/.test(d.dataUrl))throw new Error('Attach a PDF up to 115 KB or a compressed photo.');const bytes=Buffer.from(d.dataUrl.split(',')[1],'base64'),pdf=d.dataUrl.startsWith('data:application/pdf');if(pdf?bytes.subarray(0,5).toString()!=='%PDF-':!bytes.subarray(0,3).equals(Buffer.from([255,216,255])))throw new Error('Invalid credit document.');receipt.document={name:pdf?'Credit-note.pdf':'Credit-note.jpg',dataUrl:d.dataUrl};}
 return {...next,credits:[...current.credits,receipt]};
}

