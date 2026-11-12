import {createHash} from 'node:crypto';
import {FieldPath} from 'firebase-admin/firestore';
import {blankLaterDelivery,laterCaseIds,staffLaterDelivery,type LaterDelivery} from '../shared/later-delivery.ts';
import {canReviewInvoices,type InvoiceCase} from '../shared/invoice-case.ts';
import {assertInvoiceAccess,staffCase,InvoiceCaseError} from './invoice-case-validation.ts';
import {checkUserActionPermission} from './order-authorization.ts';
import {planLaterAction} from './later-delivery-validation.ts';
const clean=(v:any)=>JSON.parse(JSON.stringify(v));
const id=(v:any)=>typeof v==='string'&&/^[\w-]{1,128}$/.test(v)?v:(()=>{throw new InvoiceCaseError('Invalid delivery or review reference.');})();
const key=(value:string)=>createHash('sha256').update(value).digest('hex');
const account=(u:any,p:any)=>canReviewInvoices(u,p)&&checkUserActionPermission(u,'view_prices',p);
function guard(u:any,p:any,r:InvoiceCase){assertInvoiceAccess(u,p,r,account(u,p));}
export async function laterDeliveryAction(db:any,uid:string,body:any){
 const hostId=id(body.caseId),hostRef=db.collection('_invoice_cases').doc(hostId);
 const [u,p,h]=await Promise.all([db.collection('users').doc(uid).get(),db.collection('settings').doc('role_permissions').get(),hostRef.get()]);
 const user={...u.data(),id:uid},roles=p.data()?.map||{},host=h.data() as InvoiceCase;if(!h.exists)throw new InvoiceCaseError('Submit the original delivery report first.');guard(user,roles,host);
 if(body.action==='invoice-case-later-options'){
  let query=db.collection('_invoice_cases').where('branchId','==',host.branchId).where('supplierId','==',host.supplierId).orderBy(FieldPath.documentId());if(body.cursor)query=query.startAfter(id(body.cursor));
  const page=await query.limit(101).get();const records=page.docs.slice(0,100).map((d:any)=>d.data()).filter((r:InvoiceCase)=>r.receipt.submittedAt);
  return {records:records.map((r:InvoiceCase)=>account(user,roles)?r:staffCase(r)),more:page.docs.length>100,cursor:page.docs.slice(0,100).at(-1)?.id||null};
 }
 if(body.action==='invoice-case-later-list'){
  const ids=host.laterDeliveryIds||[];if(ids.length>100)throw new InvoiceCaseError('This review has reached its later-delivery limit.');
  const snapshots=await Promise.all(ids.map(v=>db.collection('_invoice_later_deliveries').doc(id(v)).get()));
  return {events:snapshots.filter(s=>s.exists).map(s=>s.data()).filter(e=>e.branchId===host.branchId&&e.supplierId===host.supplierId).map(e=>account(user,roles)?e:staffLaterDelivery(e))};
 }
 if(body.action!=='invoice-case-later-save')throw new InvoiceCaseError('Unknown later-delivery action.');
 const deliveryId=id(body.deliveryId),ref=db.collection('_invoice_later_deliveries').doc(deliveryId);
 return db.runTransaction(async(tx:any)=>{
  const [snap,profile,roleSnap,hostSnap]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions')),tx.get(hostRef)]);
  const user={...profile.data(),id:uid},roles=roleSnap.data()?.map||{},host=hostSnap.data() as InvoiceCase;if(!hostSnap.exists)throw new InvoiceCaseError('Review not found.');guard(user,roles,host);
  const current:LaterDelivery=snap.exists?snap.data():blankLaterDelivery(host,deliveryId,new Date().toISOString(),uid);
  if(current.hostCaseId!==hostId)throw new InvoiceCaseError('Open this delivery from its original review.');
  if(!snap.exists&&!['save','submit'].includes(body.command?.kind))throw new InvoiceCaseError('Save the delivery first.');
  const candidate=['save','submit'].includes(body.command?.kind)?{...current,...body.command.event,hostCaseId:hostId}:current;
  if(!Array.isArray(candidate.rows)||!Array.isArray(candidate.documents))throw new InvoiceCaseError('Check delivery rows and documents.');
  const ids=[...new Set([...current.caseIds,...laterCaseIds(candidate)])];if(ids.length>10)throw new InvoiceCaseError('Link up to ten reviews.');
  const cases:Record<string,InvoiceCase>={};for(const caseId of ids){const s=caseId===hostId?hostSnap:await tx.get(db.collection('_invoice_cases').doc(id(caseId)));if(!s.exists)throw new InvoiceCaseError('Linked review not found.');cases[caseId]=s.data();guard(user,roles,cases[caseId]);}
  const planned=planLaterAction(current,cases,body.command,user,roles,new Date().toISOString());
  const view=(r:InvoiceCase)=>account(user,roles)?r:staffCase(r),eventView=(e:LaterDelivery)=>account(user,roles)?e:staffLaterDelivery(e);
  if(planned.unchanged)return {event:eventView(planned.event),record:view(host),records:Object.values(cases).map(view)};
  const reservations:any[]=[];
  if(planned.event.status!=='DRAFT'){
   reservations.push(db.collection('_invoice_later_references').doc(key(host.supplierId+'|'+planned.event.reference.toUpperCase())));
   for(const d of planned.event.documents){const doc=cases[d.caseId].documents.find(v=>v.id===d.documentId)!;reservations.push(db.collection('_invoice_later_documents').doc(key(host.supplierId+'|'+doc.sha256)));}
   for(const r of reservations){const s=await tx.get(r);if(s.exists&&s.data().deliveryId!==deliveryId)throw new InvoiceCaseError('This delivery reference or original document is already allocated. Reopen that delivery instead of recording it twice.');}
  }
  for(const r of reservations)tx.set(r,{deliveryId,hostCaseId:hostId});
  if(snap.exists)tx.set(ref.collection('revisions').doc(String(current.version)),clean(current));tx.set(ref,clean(planned.event));
  for(const caseId of ids){if((planned.cases[caseId].laterDeliveryIds||[]).length>100)throw new InvoiceCaseError('This review has reached its later-delivery limit.');const r=db.collection('_invoice_cases').doc(caseId);tx.set(r.collection('revisions').doc(String(cases[caseId].version)),clean(cases[caseId]));tx.set(r,clean(planned.cases[caseId]));}
  return {event:eventView(planned.event),record:view(planned.cases[hostId]),records:Object.values(planned.cases).map(view)};
 });
}
