import {assertRecordSize,prepareDeliveryCheck} from './delivery-check-service.ts';
import {deliveryReviewLines} from '../shared/document-review.ts';
import {validCalendarDate} from '../shared/calendar-date.ts';
import {createHash} from 'node:crypto';
import {calculateOrderReconciliation,sanitizeVerificationUpdates,type ReconciledLineInput} from '../utils/invoiceReconciliation.ts';
import {checkUserActionPermission} from './order-authorization.ts';
import {hasBranchScope,hasSupplierScope} from '../shared/order-scope.ts';
import type {OrderRecord,InvoiceEvidence} from '../types.ts';

export function prepareInvoiceReview(order:OrderRecord,body:any,user:any){
 if(order.status!=='PLACED')throw new Error('Only placed orders can be checked.');
 const originals=[...order.items.map(i=>({lineId:i.productId,productId:i.productId,itemCode:i.itemCodeSnapshot,description:i.productNameSnapshot,orderedCaseQty:i.caseQty,orderedPackQty:i.packQty,expectedCasePrice:i.casePriceSnapshot,expectedPackPrice:i.packPriceSnapshot,vatRate:i.vatRate??0})),...(order.manualItems||[]).map(i=>({lineId:i.id,description:i.description,orderedCaseQty:i.caseQty,orderedPackQty:i.packQty,expectedCasePrice:i.casePriceSnapshot,expectedPackPrice:i.packPriceSnapshot,vatRate:i.vatRate??0}))];
 if(!Array.isArray(body.lines)||body.lines.length!==originals.length||new Set(body.lines.map((l:any)=>l.lineId)).size!==originals.length)throw new Error('Review every order line exactly once.');
 const numeric=['deliveredCaseQty','deliveredPackQty','invoicedCaseQty','invoicedPackQty','damagedCaseQty','damagedPackQty','invoicedCasePrice','invoicedPackPrice','invoicedLineTotal','vatRate'];
 const lines:ReconciledLineInput[]=body.lines.map((input:any)=>{
  const original=originals.find(l=>l.lineId===input.lineId);if(!original)throw new Error('An invoice line is not part of this order.');
  const line:any={...original};for(const key of numeric)if(input[key]!=null){if(typeof input[key]!=='number'||!Number.isFinite(input[key])||input[key]<0||input[key]>10000000||(key==='vatRate'&&input[key]>1))throw new Error(`Invalid ${key}.`);line[key]=input[key];}
  for(const key of ['isReviewed','isGenuineZeroPrice','receiptConfirmed'])line[key]=input[key]===true;
  line.issueType=['NONE','SHORTAGE','PRICE_OVERCHARGE','DAMAGED','WRONG_ITEM'].includes(input.issueType)?input.issueType:'NONE';
  line.notes=String(input.notes||'').slice(0,1000);return line;
 });
 const evidence:InvoiceEvidence[]=body.evidence||[];
 if(!Array.isArray(evidence)||evidence.length>2)throw new Error('Attach up to two damage photographs per invoice review.');
 for(const e of evidence){
  if(!originals.some(l=>l.lineId===e.lineId)||typeof e.dataUrl!=='string'||e.dataUrl.length>120000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(e.dataUrl)||!Buffer.from(e.dataUrl.split(',')[1],'base64').subarray(0,3).equals(Buffer.from([255,216,255])))throw new Error('Invalid damage photograph.');
  if(typeof e.caption!=='string'||e.caption.length>500||typeof e.fileName!=='string'||e.fileName.length>200||typeof e.id!=='string'||e.id.length>100)throw new Error('Invalid photograph description.');
 }
 const invoiceNumber=body.invoiceNumberNotProvided===true?'':String(body.invoiceNumber||'').trim();
 if(invoiceNumber.length>120)throw new Error('Invoice number must be at most 120 characters.');
 const options={comparisonOnly:true,isDraft:body.draft===true,verifierName:user.displayName||user.id,invoiceNumber,invoiceNumberNotProvided:body.invoiceNumberNotProvided===true,invoiceDate:String(body.invoiceDate||''),evidenceReference:String(body.evidenceReference||'').slice(0,500),remarks:String(body.notes||'').slice(0,3000),reviewMethod:'MANUAL' as const};
 if(!validCalendarDate(options.invoiceDate))throw new Error('Enter an invoice date.');
 const result=calculateOrderReconciliation(order,lines,options);
 if(!options.isDraft&&!result.canFinalize)throw new Error(result.blockingReasons.join(' '));
 const updates=result.sanitizedUpdates;
 if(updates.invoiceVerification){
  updates.invoiceVerification.evidence=evidence;
  updates.invoiceVerification.lines=updates.invoiceVerification.lines?.map((l,i)=>{
   const saved:any={...l,inputVersion:2,receiptConfirmed:lines[i].receiptConfirmed===true};
   // Persist missing input as missing: calculated defaults must not become reviewed facts on reopen.
   for(const key of ['deliveredCaseQty','deliveredPackQty','invoicedCaseQty','invoicedPackQty','invoicedCasePrice','invoicedPackPrice']){
    if((lines[i] as any)[key]==null)delete saved[key];else saved[key]=(lines[i] as any)[key];
   }
   if(lines[i].invoicedLineTotal!=null)saved.enteredLineTotal=lines[i].invoicedLineTotal;
   return saved;
  });
 }
 if(options.isDraft)delete updates.creditNoteClaim;
 else if(!result.hasDiscrepancies)(updates as any).creditNoteClaim=null;
 if(updates.creditNoteClaim){updates.creditNoteClaim.evidence=evidence;updates.creditNoteClaim.requestStatus='DRAFT';}
 if(body.combined===true){
  if((order.deliveryCheck?.version||0)!==body.expectedDeliveryVersion)throw new Error('This delivery check changed. Reopen it before saving.');
  updates.deliveryCheck=prepareDeliveryCheck(order,{draft:body.draft,reference:invoiceNumber,date:options.invoiceDate,partial:body.partial,notes:options.remarks,evidence,lines:deliveryReviewLines(lines)},user);
 }
 return sanitizeVerificationUpdates(updates);
}
export async function saveInvoiceReview(db:any,uid:string,body:any){
 if(typeof body.orderId!=='string'||!/^[\w-]{1,128}$/.test(body.orderId))throw new Error('Invalid order.');
 return db.runTransaction(async(tx:any)=>{
  const orderRef=db.collection('orders').doc(body.orderId);
  const [profile,roles,orderDoc]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions')),tx.get(orderRef)]);
  const user={...profile.data(),id:uid},order={...orderDoc.data(),id:body.orderId} as OrderRecord;
  if(!orderDoc.exists||!checkUserActionPermission(user,'view_prices',roles.data()?.map)||!checkUserActionPermission(user,'scan_invoices',roles.data()?.map)||!hasBranchScope(user,order.branchId)||!hasSupplierScope(user,order.supplierId))throw new Error('You cannot check this order.');
  if((order.invoiceVerification?.version||0)!==body.expectedVersion)throw new Error('This invoice review changed. Reopen it before saving.');
  if(order.supplierCase?.source==='INVOICE'||order.creditNoteClaim?.emailStatus==='SENT')throw new Error('This invoice already has a sent claim. Keep the existing review as evidence and request a management correction.');
  const previousNumber=order.invoiceVerification?.invoiceNumber;
  const incomingNumber=body.invoiceNumberNotProvided?'':String(body.invoiceNumber||'').trim();
  if(order.invoiceVerification?.reviewStatus!=='DRAFT'&&previousNumber&&previousNumber!=='[NOT_PROVIDED]'&&incomingNumber.toUpperCase()!==previousNumber.toUpperCase())throw new Error('This order already has an invoice review. Do not replace it with a different invoice.');
  const updates=prepareInvoiceReview(order,body,user);
  const ref=incomingNumber.toUpperCase();
  let registry:any;
  if(ref&&!body.invoiceNumberNotProvided){registry=db.collection('_invoice_references').doc(createHash('sha256').update(`${order.supplierId}|${ref}`).digest('hex'));const existing=await tx.get(registry);if(existing.exists&&existing.data().orderId!==order.id)throw new Error('This supplier invoice number is already assigned to another order. Review the existing invoice first.');}
  let previousRegistry:any;
  if(previousNumber&&previousNumber!=='[NOT_PROVIDED]'&&previousNumber.toUpperCase()!==ref){
   const prior=db.collection('_invoice_references').doc(createHash('sha256').update(order.supplierId+'|'+previousNumber.toUpperCase()).digest('hex'));
   const record=await tx.get(prior);if(record.exists&&record.data().orderId===order.id)previousRegistry=prior;
  }
  if(updates.invoiceVerification)updates.invoiceVerification.version=(order.invoiceVerification?.version||0)+1;
  assertRecordSize(order,updates);
  tx.update(orderRef,updates);
  if(previousRegistry)tx.delete(previousRegistry);
  if(registry)tx.set(registry,{supplierId:order.supplierId,orderId:order.id,invoiceNumber:ref});
  const audit=db.collection('_audit_logs').doc();tx.create(audit,{id:audit.id,userId:uid,userName:user.displayName||'',entityType:'ORDER',entityId:order.id,action:body.draft?'INVOICE_REVIEW_DRAFT':'INVOICE_REVIEW_CONFIRMED',timestamp:new Date().toISOString(),details:{invoiceNumber:ref,discrepancyTotal:updates.invoiceVerification?.discrepancyTotal||0,evidenceCount:body.evidence?.length||0}});
  return {success:true};
 });
}
