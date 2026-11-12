import {reviewBlankInvoiceRow} from '../shared/invoice-blank-review.ts';
import {confirmInvoiceRowUnits,invoiceUnitReviewProblems} from '../shared/invoice-unit-review.ts';
import {useInvoiceExtractionFigures} from '../shared/invoice-extraction.ts';
import {canReviewInvoices,invoiceScope,lineDiscrepancy,invoiceApprovalProblems,outstandingClaim,type InvoiceCase,type ReceiptReport,type InvoiceCaseLine,type CreditNote} from '../shared/invoice-case.ts';
import {checkUserActionPermission} from './order-authorization.ts';

export class InvoiceCaseError extends Error {readonly status:number;constructor(message:string,status=400){super(message);this.status=status;}}
function fail(message:string):never{throw new InvoiceCaseError(message);}
const text=(value:unknown,max=2000)=>typeof value==='string'?value.trim().slice(0,max):'';
const number=(value:unknown,label:string,integer=false):number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100000000&&(!integer||Number.isSafeInteger(value))?value:fail(`Enter a valid ${label}.`);
const required=(value:unknown,label:string)=>text(value)||fail(`Enter ${label}.`);
const unique=(values:string[])=>new Set(values).size===values.length;
export function assertInvoiceAccess(user:any,roles:any,record:InvoiceCase,accounts=false){
 if(!user?.active||!invoiceScope(user,record)||!(accounts?canReviewInvoices(user,roles)&&checkUserActionPermission(user,'view_prices',roles):checkUserActionPermission(user,'scan_invoices',roles)))throw new InvoiceCaseError('You do not have access to this invoice workflow.',403);
}
export function validateReceipt(record:InvoiceCase,input:any,submit:boolean):ReceiptReport {
 if(!input||!Array.isArray(input.statuses)||!Array.isArray(input.issues)||input.issues.length>200)fail('Check the delivery report.');
 const statuses=input.statuses;
 if(!unique(statuses)||statuses.some((s:string)=>!['RECEIVED','MISSING','DAMAGED','INCORRECT','OTHER','OUT_OF_STOCK'].includes(s))||statuses.includes('RECEIVED')&&statuses.length!==1)fail('Received without issues cannot be combined with an issue.');
 const issues=input.issues.map((i:any)=>{
  if(!i||!['MISSING','DAMAGED','INCORRECT','OTHER','OUT_OF_STOCK'].includes(i.kind)||!statuses.includes(i.kind))fail('Choose the status for each issue.');
  const line=record.lines.find(l=>l.id===i.lineId);
  if(i.kind!=='OTHER'&&!line)fail('Select an ordered item.');
  const quantity=i.kind==='OUT_OF_STOCK'&&i.quantity==null?line?.ordered:i.quantity==null?undefined:number(i.quantity,'issue quantity');
  if(i.kind==='OUT_OF_STOCK'&&quantity!==line?.ordered)fail('Out of stock means none of this item arrived. Use Missing for a partial delivery.');
  if(submit&&i.kind!=='OTHER'&&(!quantity||quantity>line!.ordered))fail('Issue quantities must be positive and within the ordered quantity.');
  const notes=text(i.notes);if(submit&&!notes)fail('Add a reason for every issue.');
  if(submit&&['DAMAGED','INCORRECT'].includes(i.kind)&&!['DRIVER','COLLECTION','KEPT'].includes(i.outcome))fail('Confirm what happened to each damaged or incorrect item.');
  if(submit&&i.kind==='INCORRECT'&&!text(i.actualItem))fail('Describe the incorrect item that arrived.');
  const documentIds=Array.isArray(i.documentIds)?i.documentIds:[];
  if(!unique(documentIds)||documentIds.some((id:string)=>!record.documents.some(d=>d.id===id&&d.kind==='EVIDENCE'&&d.lineId===i.lineId)))fail('Attach evidence to the correct item.');
  return {id:required(i.id,'an issue ID'),kind:i.kind,...(line?{lineId:line.id}:{}),...(quantity!=null?{quantity}:{}),notes,actualItem:text(i.actualItem),...(['DRIVER','COLLECTION','KEPT'].includes(i.outcome)?{outcome:i.outcome}:{}),documentIds};
 });
 if(!unique(issues.map((i:any)=>i.id)))fail('Each issue must have a unique ID.');
 for(const line of record.lines){const total=issues.filter((i:any)=>i.lineId===line.id).reduce((s:number,i:any)=>s+(i.quantity||0),0);if(total>line.ordered)fail(`${line.name}: missing, out-of-stock, damaged and incorrect quantities overlap or exceed the order.`);}
 const documentIds=Array.isArray(input.documentIds)?input.documentIds:[];
 if(!unique(documentIds)||documentIds.some((id:string)=>!record.documents.some(d=>d.id===id&&['INVOICE','DELIVERY'].includes(d.kind))))fail('Choose valid invoice or delivery documents.');
 if(submit&&(!statuses.length||!documentIds.length||input.readable!==true))fail('Upload the document, check all pages are readable and choose a delivery status.');
 if(submit&&statuses.some((s:string)=>s!=='RECEIVED'&&!issues.some((i:any)=>i.kind===s)))fail('Add an item or description for each selected status.');
 return {statuses,issues,documentIds,readable:input.readable===true,notes:text(input.notes),version:record.receipt.version+1};
}
export type CaseCommand={kind:string;requestId:string;expectedVersion:number;[key:string]:any};
export function applyInvoiceCommand(current:InvoiceCase,command:CaseCommand,user:any,roles:any,at:string):InvoiceCase {
 const staff=['save-receipt','submit-receipt'].includes(command.kind);
 assertInvoiceAccess(user,roles,current,!staff);
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(command.requestId||''))fail('A unique request ID is required.');
 if(current.requests.includes(command.requestId))return current;
 if(command.expectedVersion!==current.version)throw new InvoiceCaseError('This record changed. Reload it before saving; your edits are still on screen.',409);
 if(current.status==='APPROVED')fail('This invoice is approved and locked.');
 const r=structuredClone(current),c=command,by=user.id||user.uid;
 let detail='';
 if(staff){
  if(r.receipt.submittedAt||r.claim)fail('This staff report has been submitted. Accounts must review new evidence separately.');
  r.receipt=validateReceipt(r,c.receipt,c.kind==='submit-receipt');
  if(c.kind==='submit-receipt'){
   r.receipt.submittedAt=at;r.receipt.submittedBy=by;
   r.lines=r.lines.map(l=>({...l,received:l.ordered-r.receipt.issues.filter(i=>i.lineId===l.id&&['MISSING','OUT_OF_STOCK'].includes(i.kind)).reduce((s,i)=>s+(i.quantity||0),0)}));
   // Missing quantities are staff declarations; uploaded document values stay unknown until reviewed.
   r.status='REVIEW';r.extraction={state:'NEEDS_REVIEW',warnings:['Accounts must compare the original invoice with the order and delivery report, including received-without-issues deliveries.']};
  }
 }else if(c.kind==='use-extraction'){
  if(!r.receipt.submittedAt)fail('The staff delivery report has not been submitted.');
  Object.assign(r,useInvoiceExtractionFigures(r));detail='Accounts copied unambiguous AI draft figures into blank fields; human checks and approval remain required.';
 }else if(c.kind==='confirm-blank-row'||c.kind==='restore-blank-row'){
  Object.assign(r,reviewBlankInvoiceRow(r,c,by,at,c.kind==='restore-blank-row'));detail=`Accounts ${c.kind==='restore-blank-row'?'reopened':'confirmed blank — not charged'} page ${c.page}, row ${c.row}: ${String(c.reason).trim()}`;
 }else if(c.kind==='confirm-reading-units'){
  Object.assign(r,confirmInvoiceRowUnits(r,c,by,at));detail='Accounts confirmed a document row in ordered units: '+String(c.reason).trim();
 }else if(c.kind==='save-review'){
  if(!r.receipt.submittedAt)fail('The staff delivery report has not been submitted.');
  if(r.laterReceipts?.some(v=>v.status==='APPROVED')){
   for(const old of r.lines.filter(l=>r.laterReceipts?.some(v=>v.lineId===l.id&&v.status==='APPROVED'))){const proposed=c.lines?.find((l:any)=>l.id===old.id);if(!proposed||old.invoiceQuantity!=null&&proposed.invoiceQuantity!==old.invoiceQuantity||old.invoicePrice!=null&&proposed.invoicePrice!==old.invoicePrice)fail('Approved later deliveries lock known billed quantities and prices. Preserve their billing evidence.');}
   for(const key of ['invoiceReference','invoiceDocumentId'] as const)if(r[key]&&c[key]!==r[key])fail('Approved later deliveries lock the original invoice identity.');
  }
  if(r.claim&&['SENDING','SENT','UNCERTAIN'].includes(r.claim.state))fail('A sent or uncertain claim locks its reviewed figures. Resolve it before changing the invoice.');
  if(!Array.isArray(c.lines)||c.lines.length!==r.lines.length||!unique(c.lines.map((l:any)=>l.id)))fail('Review each ordered line once.');
  r.lines=r.lines.map(original=>{
   const l=c.lines.find((v:any)=>v.id===original.id);if(!l)fail('An ordered item is missing.');
   if(!['PENDING','CLAIM','ACCEPT','HOLD'].includes(l.resolution))fail('Choose an item decision.');
   const next:InvoiceCaseLine={...original,invoiceQuantity:l.invoiceQuantity==null?undefined:number(l.invoiceQuantity,'billed quantity'),invoicePrice:l.invoicePrice==null?undefined:number(l.invoicePrice,'billed price'),reviewed:l.reviewed===true,resolution:l.resolution,reason:text(l.reason)};
   const difference=lineDiscrepancy(r,next);
   if(next.invoiceQuantity!=null&&next.invoicePrice!=null&&(!Number.isSafeInteger(Math.round(next.invoiceQuantity*next.invoicePrice*100))||next.invoiceQuantity*next.invoicePrice*100>100000000))fail('The billed line amount is too large. Check its quantity and price.');
   if(next.reviewed&&next.resolution==='ACCEPT'&&(!difference.known||difference.hasDifference)&&!next.reason)fail('Record a reason for accepting a difference or unknown amount.');
   if(['HOLD','CLAIM'].includes(next.resolution)&&!next.reason)fail('Add a reason for the item decision.');
   return next;
  });
  r.invoiceReference=text(c.invoiceReference,200);r.invoiceDate=text(c.invoiceDate,10);if(r.invoiceDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.invoiceDate)||!Number.isFinite(Date.parse(r.invoiceDate))||new Date(r.invoiceDate).toISOString().slice(0,10)!==r.invoiceDate))fail('Enter a valid invoice date.');
  r.invoiceDocumentId=text(c.invoiceDocumentId,100);
  if(r.invoiceDocumentId&&!r.documents.some(d=>d.id===r.invoiceDocumentId&&d.kind==='INVOICE'))fail('Choose the original invoice document.');
  for(const key of ['invoiceNetPence','invoiceVatPence','invoiceGrossPence'] as const)r[key]=c[key]==null?undefined:number(c[key],'invoice total in pence',true);
  if(!Number.isSafeInteger(c.adjustmentPence)||Math.abs(c.adjustmentPence)>100000000)fail('Enter valid charges or discounts.');
  r.adjustmentPence=c.adjustmentPence;r.matchingVerified=c.matchingVerified===true;r.totalsVerified=c.totalsVerified===true;r.notes=text(c.notes);
  if(r.claim){delete r.claim;detail='Previous claim and email approvals invalidated by reviewed changes.';}
  r.status='REVIEW';
 }else if(c.kind==='hold'){
  r.holdReason=required(c.reason,'the information needed');r.holdOwner=required(c.owner,'the person responsible');r.holdUntil=text(c.until,10);r.status='HOLD';detail=r.holdReason;
 }else if(c.kind==='resume'){r.status='REVIEW';detail=required(c.reason,'the new evidence or reason for returning to review');}
 else if(c.kind==='prepare-claim'){
  const unitProblems=invoiceUnitReviewProblems(r);if(unitProblems.length)fail(unitProblems.join(' '));
  if(r.claim&&['SENT','SENDING','UNCERTAIN'].includes(r.claim.state))fail('A claim already exists.');
  if(!r.invoiceReference||!r.invoiceDate||!r.documents.some(d=>d.id===r.invoiceDocumentId&&d.kind==='INVOICE')||!r.matchingVerified||!r.totalsVerified||r.invoiceNetPence==null||r.invoiceVatPence==null||r.invoiceGrossPence==null||r.invoiceNetPence+r.invoiceVatPence!==r.invoiceGrossPence)fail('Confirm the invoice, matching and totals before preparing a claim.');
  const lines=r.lines.filter(l=>l.reviewed&&l.resolution==='CLAIM');
  if(!lines.length)fail('Select reviewed items for the claim.');
  r.claim={id:c.requestId,revision:(r.claim?.revision||0)+1,state:'DRAFT',recipient:'',subject:`Credit request — ${r.invoiceReference}`,message:'',lines:lines.map(l=>{const d=lineDiscrepancy(r,l);if(!d.known||!d.totalPence)fail('Claim quantities and prices must be known, with a positive difference.');return {lineId:l.id,quantity:d.quantity,netPence:d.totalPence,creditedPence:0,replacementPence:0,reason:l.reason};})};
  r.claim.message=`Please review invoice ${r.invoiceReference}.\n\n`+r.claim.lines.map(l=>`${r.lines.find(i=>i.id===l.lineId)!.name}: £${(l.netPence/100).toFixed(2)} net — ${l.reason}`).join('\n');r.status='CLAIM_DRAFT';
 }else if(c.kind==='approve-claim'){
  if(r.claim?.state!=='DRAFT')fail('Prepare the current claim first.');r.claim.state='APPROVED';r.claim.approvedBy=by;r.claim.approvedAt=at;
 }else if(c.kind==='approve-email'){
  if(r.claim?.state!=='APPROVED')fail('Approve the claim first.');
  if(!text(c.recipient)||!/^\S+@\S+\.\S+$/.test(c.recipient))fail('Confirm the supplier email address.');
  r.claim.recipient=text(c.recipient,254);r.claim.message=required(c.message,'the reviewed email text');r.claim.emailApprovedBy=by;r.claim.emailApprovedAt=at;delete r.claim.delivery;
 }else if(c.kind==='record-credit'){
  if(!r.claim||r.claim.state!=='SENT')fail('Confirm the claim was sent before recording credit.');
  if(r.credits.some(n=>n.status==='DRAFT'))fail('Review the existing draft credit note first.');
  const reference=required(c.reference,'a credit note reference');
  if(r.credits.some(n=>n.reference.toLowerCase()===reference.toLowerCase()))fail('This credit note reference is already recorded.');
  if(c.invoiceReference!==r.invoiceReference||c.supplierId!==r.supplierId)fail('The supplier or original invoice reference does not match.');
  if(!r.documents.some(d=>d.id===c.documentId&&d.kind==='CREDIT'))fail('Upload the original credit note.');
  if(!Array.isArray(c.lines)||!c.lines.length||!unique(c.lines.map((l:any)=>l.lineId)))fail('Match credit amounts to unique claim items.');
  const lines=c.lines.map((l:any)=>{const claim=r.claim!.lines.find(i=>i.lineId===l.lineId),amount=number(l.netPence,'credit amount',true);if(!claim||!amount||amount>claim.netPence-claim.creditedPence-claim.replacementPence)fail('Credit exceeds the outstanding item amount or does not match a claim item.');return {lineId:l.lineId,netPence:amount};});
  const vatPence=number(c.vatPence,'credit VAT',true),grossPence=number(c.grossPence,'credit gross total',true);
  if(lines.reduce((s:number,l:any)=>s+l.netPence,0)+vatPence!==grossPence)fail('Credit net plus VAT must equal gross.');
  if(c.verified!==true)fail('Check credit products, quantities, prices and VAT against the original document.');
  r.credits.push({id:c.requestId,reference,documentId:c.documentId,invoiceReference:r.invoiceReference,supplierId:r.supplierId,lines,vatPence,grossPence,verified:true,status:'DRAFT'});r.status='CREDIT_REVIEW';
 }else if(c.kind==='approve-credit'){
  const credit=r.credits.find(n=>n.id===c.creditId);if(!credit||credit.status!=='DRAFT')fail('Select a credit note awaiting approval.');
  for(const l of credit.lines){const item=r.claim!.lines.find(i=>i.lineId===l.lineId)!;if(l.netPence>item.netPence-item.creditedPence-item.replacementPence)fail('The outstanding balance changed.');item.creditedPence+=l.netPence;}
  credit.status='APPROVED';credit.approvedBy=by;credit.approvedAt=at;r.status=outstandingClaim(r)>0?'WAITING_CREDIT':'CREDIT_APPROVED';
 }else if(c.kind==='approve-invoice'){
  const problems=invoiceApprovalProblems(r);if(problems.length)fail(problems.join(' '));r.status='APPROVED';r.approvedAt=at;r.approvedBy=by;
 }else fail('This workflow action is not available.');
 r.version++;r.updatedAt=at;r.requests.push(c.requestId);r.audit.push({at,by,action:c.kind,details:detail});
 if(new TextEncoder().encode(JSON.stringify(r)).length>650000)fail('This review is too large. Ask the owner to archive earlier evidence before continuing.');
 return r;
}

/** Keep Accounts figures out of staff responses, including those with no price access. */
export function staffCase(record:InvoiceCase){return {laterDeliveryIds:record.laterDeliveryIds,laterReceipts:record.laterReceipts?.map(({deliveryId,allocationId,lineId,issueId,purpose,quantity,status})=>({deliveryId,allocationId,lineId,issueId,purpose,quantity,status})),id:record.id,version:record.version,branchId:record.branchId,branchName:record.branchName,supplierId:record.supplierId,supplierName:record.supplierName,status:record.status,orderIds:record.orderIds,receipt:record.receipt,documents:record.documents.filter(d=>d.kind!=='CREDIT'),lines:record.lines.map(({id,orderId,productId,name,code,unit,ordered,received})=>({id,orderId,productId,name,code,unit,ordered,received}))};}
