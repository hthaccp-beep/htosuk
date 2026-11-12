import {invoiceReceiptSummary} from '../shared/invoice-receipt-summary.ts';
import {invoiceCaseRead,invoiceCaseReadingState,type InvoiceReadGate} from './invoice-case-reader.ts';
import {invoicePreparationAction} from './invoice-preparation-storage.ts';
import {laterDeliveryAction} from './later-delivery-service.ts';
import {createHash} from 'node:crypto';
import {FieldPath} from 'firebase-admin/firestore';
import {emptyInvoiceCase,canReviewInvoices,invoiceScope,filterInvoiceCases,type InvoiceCase,type InvoiceDocument} from '../shared/invoice-case.ts';
import {outgoingOrderPartitions} from '../shared/order-scope.ts';
import {applyInvoiceCommand,assertInvoiceAccess,staffCase,InvoiceCaseError} from './invoice-case-validation.ts';
import {checkUserActionPermission} from './order-authorization.ts';

const clean=(v:any)=>JSON.parse(JSON.stringify(v));
const id=(v:any)=>typeof v==='string'&&/^[\w-]{1,128}$/.test(v)?v:(()=>{throw new InvoiceCaseError('Invalid record reference.');})();
const referenceKey=(supplier:string,reference:string)=>createHash('sha256').update(supplier+'|'+reference.trim().toUpperCase()).digest('hex');
const access=(u:any,p:any,r:InvoiceCase)=>{if(canReviewInvoices(u,p)&&checkUserActionPermission(u,'view_prices',p))assertInvoiceAccess(u,p,r,true);else assertInvoiceAccess(u,p,r);};
const view=(u:any,p:any,r:InvoiceCase)=>canReviewInvoices(u,p)&&checkUserActionPermission(u,'view_prices',p)?r:staffCase(r);

export function validateInvoiceDocument(input:any){
 if(!input||!['INVOICE','DELIVERY','EVIDENCE','CREDIT','LATER_INVOICE','LATER_DELIVERY'].includes(input.kind)||typeof input.name!=='string'||!input.name.trim()||input.name.length>180)throw new InvoiceCaseError('Choose an invoice, delivery note, photo or credit note.');
 if(typeof input.base64!=='string'||input.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw new InvoiceCaseError('Upload a valid file up to 3 MB.');
 const bytes=Buffer.from(input.base64,'base64');if(bytes.length===0||bytes.length>3*1024*1024||bytes.toString('base64')!==input.base64)throw new InvoiceCaseError('Upload a valid file up to 3 MB.');
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),pdf=bytes.subarray(0,5).toString()==='%PDF-';
 const mime=jpeg?'image/jpeg':png?'image/png':pdf?'application/pdf':'';
 if(!mime||mime!==input.mime||input.kind==='EVIDENCE'&&pdf)throw new InvoiceCaseError('Use a genuine JPEG, PNG or PDF; item evidence must be a photo.');
 return {bytes,mime,sha256:createHash('sha256').update(bytes).digest('hex')};
}

/** Private collections in the existing database. No client listeners or direct client writes. */
export async function invoiceCaseAction(db:any,uid:string,body:any,enabled=false,reader?:InvoiceReadGate){
 if(!enabled)throw new InvoiceCaseError('The new invoice workflow is awaiting release approval. Use the offline preview.',503);
 if(typeof body.action==='string'&&body.action.startsWith('invoice-case-preparation-'))return invoicePreparationAction(db,uid,body);
 if(body.action==='invoice-case-read')return invoiceCaseRead(db,uid,body,reader);
 if(['invoice-case-reading-status','invoice-case-reading-recover'].includes(body.action))return invoiceCaseReadingState(db,uid,body,reader);
 if(typeof body.action==='string'&&body.action.startsWith('invoice-case-later-'))return laterDeliveryAction(db,uid,body);
 const [profile,roleSnapshot]=await Promise.all([db.collection('users').doc(uid).get(),db.collection('settings').doc('role_permissions').get()]);
 const user={...profile.data(),id:uid},roles=roleSnapshot.data()?.map||{};
 if(!user.active)throw new InvoiceCaseError('Please sign in with an active account.',403);
 if(body.action==='invoice-case-receipt-summaries'){
  if(!Array.isArray(body.orderIds)||body.orderIds.length>100)throw new InvoiceCaseError('Choose up to 100 loaded orders.');
  const ids=[...new Set<string>(body.orderIds.map(id))];
  const summaries=[];
  // Exact loaded orders only: never enumerate the private collection for staff.
  for(const orderId of ids){
   const orderSnap=await db.collection('orders').doc(orderId).get();
   if(!orderSnap.exists)throw new InvoiceCaseError('Order not available.',404);
   const order=orderSnap.data();access(user,roles,order);
   if(order.invoiceVerification||order.deliveryCheck||order.supplierCase)continue;
   const snap=await db.collection('_invoice_cases').doc(orderId).get();
   const record=snap.exists?snap.data() as InvoiceCase:undefined;
   if(record)access(user,roles,record);
   summaries.push(invoiceReceiptSummary(orderId,record));
  }
  return {summaries};
 }
 if(body.action==='invoice-case-list'){

  if(!canReviewInvoices(user,roles)||!checkUserActionPermission(user,'view_prices',roles))throw new InvoiceCaseError('Accounts review permission is required.',403);
  const filters={branchId:body.branchId? id(body.branchId):'',supplierId:body.supplierId?id(body.supplierId):'',status:typeof body.status==='string'?body.status:''};
  if(filters.branchId&&!invoiceScope(user,{branchId:filters.branchId,supplierId:filters.supplierId||user.supplierIds?.[0]||''})&&filters.supplierId)throw new InvoiceCaseError('This filter is outside your access.',403);
  const partitions=outgoingOrderPartitions(user);
  const selected=partitions.filter((p:any)=>(!filters.branchId||!p.branchId||p.branchId===filters.branchId)&&(!filters.supplierId||!p.supplierId||p.supplierId===filters.supplierId));
  if(selected.length>40)throw new InvoiceCaseError('Choose a branch and supplier to narrow this list.');
  const rows:InvoiceCase[]=[];let more=false;
  for(const p of selected){
   let q=db.collection('_invoice_cases');const branch=filters.branchId||p.branchId,supplier=filters.supplierId||p.supplierId;
   if(branch)q=q.where('branchId','==',branch);if(supplier)q=q.where('supplierId','==',supplier);if(filters.status)q=q.where('status','==',filters.status);
   q=q.orderBy(FieldPath.documentId());if(body.cursor)q=q.startAfter(id(body.cursor));
   const page=await q.limit(101).get();more ||= page.docs.length===101;
   for(const d of page.docs){const r=d.data();if(invoiceScope(user,r))rows.push(r);}
  }
  const ordered=[...new Map(rows.map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const page=ordered.slice(0,100);return {records:page,more:more||ordered.length>100,cursor:page.at(-1)?.id||null};
 }
 const caseId=id(body.caseId),ref=db.collection('_invoice_cases').doc(caseId);
 if(body.action==='invoice-case-document'){
  const snap=await ref.get();if(!snap.exists)throw new InvoiceCaseError('Invoice record not found.',404);
  const record=snap.data() as InvoiceCase;access(user,roles,record);
  const document=record.documents.find(d=>d.id===body.documentId);if(!document||document.kind==='CREDIT'&&!canReviewInvoices(user,roles))throw new InvoiceCaseError('Document not available.',404);
  const docRef=db.collection('_invoice_case_documents').doc(id(document.id)),manifest=await docRef.get();if(manifest.data()?.caseId!==caseId)throw new InvoiceCaseError('Document not available.',404);
  const chunks=await Promise.all(Array.from({length:manifest.data().parts},(_,i)=>docRef.collection('parts').doc(String(i)).get()));
  const base64=chunks.map((d:any)=>d.data()?.base64||'').join('');if(createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex')!==document.sha256)throw new InvoiceCaseError('Document integrity check failed.',503);
  return {mime:document.mime,name:document.name,base64};
 }
 return db.runTransaction(async(tx:any)=>{
  const [snap,orderSnap,freshUser,freshRoles]=await Promise.all([tx.get(ref),tx.get(db.collection('orders').doc(caseId)),tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions'))]);
  const u={...freshUser.data(),id:uid},p=freshRoles.data()?.map||{},order={...orderSnap.data(),id:caseId};
  if(!snap.exists&&(!orderSnap.exists||order.status!=='PLACED'))throw new InvoiceCaseError('Choose a placed order.');
  if(!snap.exists&&(order.invoiceVerification||order.deliveryCheck||order.supplierCase))throw new InvoiceCaseError('This order has an existing check. Continue in its original review to preserve its history.');
  const record:InvoiceCase=snap.exists?snap.data():emptyInvoiceCase(order,new Date().toISOString());access(u,p,record);
  if(body.action==='invoice-case-get')return {record:view(u,p,record)};
  if(body.action==='invoice-case-upload'){
   const account=canReviewInvoices(u,p)&&checkUserActionPermission(u,'view_prices',p);
   if(record.status==='APPROVED'&&!['LATER_INVOICE','LATER_DELIVERY'].includes(body.kind)||record.claim&&!['CREDIT','LATER_INVOICE','LATER_DELIVERY'].includes(body.kind)||record.receipt.submittedAt&&!account&&!['LATER_INVOICE','LATER_DELIVERY'].includes(body.kind))throw new InvoiceCaseError('This evidence is locked. Accounts must review any further documents.');
   if(body.kind==='CREDIT'&&!account)throw new InvoiceCaseError('Only Accounts can add credit notes.',403);
   const upload=validateInvoiceDocument(body),documentId=createHash('sha256').update(caseId+'|'+body.kind+'|'+(body.lineId||'')+'|'+upload.sha256).digest('hex');
   if(record.documents.some(d=>d.id===documentId))return {record:view(u,p,record),documentId};
   if(record.version!==body.expectedVersion)throw new InvoiceCaseError('The record changed. Reload before uploading.',409);
   if(record.documents.length>=100)throw new InvoiceCaseError('This record has reached its document limit.');
   if(body.kind==='EVIDENCE'&&!record.lines.some(l=>l.id===body.lineId))throw new InvoiceCaseError('Choose the item for this photo.');
   const at=new Date().toISOString(),document:InvoiceDocument={id:documentId,kind:body.kind,name:body.name,mime:upload.mime,size:upload.bytes.length,sha256:upload.sha256,uploadedAt:at,uploadedBy:uid,...(body.lineId?{lineId:body.lineId}:{})};
   const next=clean({...record,documents:[...record.documents,document],version:record.version+1,updatedAt:at,audit:[...record.audit,{at,by:uid,action:'upload-document',details:document.kind}]});
   const docRef=db.collection('_invoice_case_documents').doc(documentId),parts=body.base64.match(/.{1,700000}/g);
   tx.set(docRef,{caseId,parts:parts.length,document});parts.forEach((base64:string,i:number)=>tx.set(docRef.collection('parts').doc(String(i)),{base64}));
   tx.set(ref.collection('revisions').doc(String(record.version)),clean(record));tx.set(ref,next);return {record:view(u,p,next),documentId};
  }
  if(body.action!=='invoice-case-command')throw new InvoiceCaseError('Unknown invoice action.');
  const next=applyInvoiceCommand(record,body.command,u,p,new Date().toISOString());
  if(next===record)return {record:view(u,p,record)};
  // References are reserved atomically; duplicate recording cannot depend on a browser check.
  const refs:{ref:any;type:string;value:string}[]=[];
  if(next.invoiceReference&&next.invoiceReference!==record.invoiceReference)refs.push({ref:db.collection('_invoice_case_references').doc(referenceKey(next.supplierId,next.invoiceReference)),type:'invoice',value:next.invoiceReference});
  for(const n of next.credits.filter(n=>!record.credits.some(old=>old.id===n.id)))refs.push({ref:db.collection('_invoice_case_credit_references').doc(referenceKey(next.supplierId,n.reference)),type:'credit',value:n.reference});
  for(const item of refs){const found=await tx.get(item.ref);if(found.exists&&found.data().caseId!==caseId)throw new InvoiceCaseError(`This ${item.type} reference is already linked to another review.`);}
  for(const item of refs)tx.set(item.ref,{caseId,value:item.value});
  tx.set(ref.collection('revisions').doc(String(record.version)),clean(record));tx.set(ref,clean(next));return {record:view(u,p,next)};
 });
}
