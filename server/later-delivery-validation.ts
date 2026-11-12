import {canReviewInvoices,lineDiscrepancy,type InvoiceCase} from '../shared/invoice-case.ts';
import {assertInvoiceAccess,InvoiceCaseError} from './invoice-case-validation.ts';
import {canReportLaterDelivery,laterCaseIds,outstandingIssue,type LaterDelivery,type LaterRow,type LaterAllocation} from '../shared/later-delivery.ts';
function fail(message:string):never{throw new InvoiceCaseError(message);}
const text=(v:any,max=2000)=>typeof v==='string'?v.trim().slice(0,max):'';
const qty=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100000&&Math.abs(v*1000-Math.round(v*1000))<1e-6?v:fail('Enter a valid quantity (up to three decimal places).');
const unique=(v:string[])=>new Set(v).size===v.length;
const same=(a:number,b:number)=>Math.abs(a-b)<.000001;
export function validateLaterDelivery(event:LaterDelivery,cases:Record<string,InvoiceCase>,submit:boolean):LaterDelivery {
 const host=cases[event.hostCaseId];if(!host)fail('Original review not found.');
 if(!['SEPARATE','COMBINED'].includes(event.mode)||!Array.isArray(event.rows)||event.rows.length>100||!Array.isArray(event.documents)||event.documents.length>10)fail('Check the delivery rows and documents.');
 const e=structuredClone(event);e.caseIds=laterCaseIds(e);if(e.caseIds.length>10)fail('Link up to ten reviews per delivery.');
 for(const id of e.caseIds){const c=cases[id];if(!c||c.branchId!==host.branchId||c.supplierId!==host.supplierId)fail('Linked reviews must be for the same branch and supplier.');}
 e.reference=text(e.reference,100);e.notes=text(e.notes);e.date=text(e.date,10);
 if(submit&&(!e.reference||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(Date.parse(e.date))||new Date(e.date).toISOString().slice(0,10)!==e.date))fail('Enter a delivery reference and valid date.');
 if(!unique(e.documents.map(d=>d.caseId+'|'+d.documentId)))fail('Attach each document once.');
 for(const d of e.documents){const doc=cases[d.caseId]?.documents.find(v=>v.id===d.documentId);if(!doc||!['INVOICE','DELIVERY','LATER_INVOICE','LATER_DELIVERY'].includes(doc.kind))fail('Choose an invoice or delivery note belonging to a linked review.');
  const isNew=e.rows.some(r=>r.allocations.some(a=>a.caseId===d.caseId&&a.purpose==='NEW_ORDER'));
  if(!isNew&&!doc.kind.startsWith('LATER_'))fail('Upload a later document; do not reuse the original shortage invoice as replacement evidence.');
  if(!isNew&&cases[d.caseId].documents.some(v=>v.id===cases[d.caseId].invoiceDocumentId&&v.sha256===doc.sha256))fail('This is the original invoice, not later delivery evidence.');
 }
 const all=e.rows.flatMap(r=>r.allocations);if(!unique(e.rows.map(r=>r.id))||!unique(all.map(a=>a.id)))fail('Delivery rows and allocations need unique IDs.');
 if(!unique(e.rows.map(r=>text(r.reference).toUpperCase()).filter(v=>submit||v)))fail('Each document row reference must be entered only once. Split that row using its allocations.');
 for(const row of e.rows){row.reference=text(row.reference,80);row.description=text(row.description,200);row.quantity=qty(row.quantity);if(submit&&(!row.reference||!row.description||!row.quantity||!row.allocations.length))fail('Describe each document row and its received quantity.');
  let product='',unit='';for(const a of row.allocations){a.quantity=qty(a.quantity);const c=cases[a.caseId],l=c?.lines.find(l=>l.id===a.lineId);if(!['REPLACEMENT','NEW_ORDER'].includes(a.purpose))fail('Choose an allocation purpose.');if(!l){if(!submit&&!a.lineId&&!a.issueId)continue;fail('Match every allocation to a saved order item.');}
   if(product&&(product!==l.productId||unit!==l.unit))fail('A document row cannot mix different products or units. Add a separate row.');product=l.productId;unit=l.unit;
   if(submit&&(!a.quantity||!c.receipt.submittedAt))fail('Submit each linked order’s staff delivery report first, and enter positive allocation quantities.');
   if(a.purpose==='REPLACEMENT'){const issue=c.receipt.issues.find(i=>i.id===a.issueId&&i.lineId===a.lineId);if(!issue||!['MISSING','DAMAGED','INCORRECT','OUT_OF_STOCK'].includes(issue.kind))fail('Select the original missing, damaged, incorrect or out-of-stock item.');}
   else if(e.mode!=='COMBINED'||a.issueId)fail('New-order allocations belong only to a combined delivery.');
  }
  if(submit&&!same(row.allocations.reduce((s,a)=>s+a.quantity,0),row.quantity))fail('Allocated quantities must equal the document row quantity — count every unit once.');
 }
 if(submit){
  if(!e.documents.length||!e.readable||!e.receiptConfirmed||!e.rows.length)fail('Attach readable documents and confirm that the allocated goods physically arrived in usable condition.');
  if(!all.some(a=>a.purpose==='REPLACEMENT'))fail('Link at least one original delivery issue.');
  if(e.mode==='COMBINED'&&(!all.some(a=>a.purpose==='NEW_ORDER')||!all.some(a=>a.purpose==='REPLACEMENT'&&!all.some(n=>n.purpose==='NEW_ORDER'&&n.caseId===a.caseId))))fail('A combined delivery must link a new order and a different original issue review.');
  const grouped=new Map<string,LaterAllocation[]>();for(const a of all){const key=a.caseId+'|'+a.lineId+'|'+(a.issueId||'new');grouped.set(key,[...(grouped.get(key)||[]),a]);}
  for(const allocations of grouped.values()){const a=allocations[0],c=cases[a.caseId],l=c.lines.find(l=>l.id===a.lineId)!,total=allocations.reduce((s,v)=>s+v.quantity,0);
   const available=a.purpose==='REPLACEMENT'?outstandingIssue(c,a.issueId!,e.id):Math.max(0,(l.received??0)-(c.laterReceipts||[]).filter(r=>r.deliveryId!==e.id&&r.purpose==='NEW_ORDER'&&r.lineId===a.lineId).reduce((s,r)=>s+r.quantity,0));
   if(total>available+.000001)fail(`${l.name}: allocation exceeds the outstanding issue or the already-confirmed new delivery quantity.`);
  }
 }
 return e;
}
export function planLaterAction(current:LaterDelivery,cases:Record<string,InvoiceCase>,body:any,user:any,roles:any,at:string){
 const accounts=['approve','return'].includes(body.kind);
 if(current.version===0&&!canReportLaterDelivery(cases[current.hostCaseId]))fail('Submit the first delivery report with an outstanding item issue before adding a replacement.');
 const candidate=body.kind==='save'||body.kind==='submit'?{...current,mode:body.event?.mode,reference:body.event?.reference,date:body.event?.date,documents:body.event?.documents||[],rows:body.event?.rows||[],notes:body.event?.notes,readable:body.event?.readable===true,receiptConfirmed:body.event?.receiptConfirmed===true}:current;
 const ids=[...new Set([...current.caseIds,...laterCaseIds(candidate)])];
 for(const id of ids){if(!cases[id])fail('A linked review is missing.');assertInvoiceAccess(user,roles,cases[id],accounts||canReviewInvoices(user,roles));}
 if(!/^[\w-]{8,100}$/.test(body.requestId||''))fail('A unique request ID is required.');
 if(current.requests.includes(body.requestId))return {event:current,cases,unchanged:true};
 if(current.version!==body.expectedVersion||ids.some(id=>body.caseVersions?.[id]!==cases[id].version))throw new InvoiceCaseError('A linked review or delivery changed. Reload before saving; your edits remain available.',409);
 if(current.status==='APPROVED')fail('Approved replacement evidence is locked.');
 const next=structuredClone(cases);let event:LaterDelivery;
 if(body.kind==='save'||body.kind==='submit'){
  if(current.status!=='DRAFT')fail('Accounts must return this submitted delivery before it can be changed.');
  event=validateLaterDelivery(candidate,next,body.kind==='submit');
  // Staff never supply billing or approval fields, even when modifying a saved draft.
  event.rows=event.rows.map(({id,reference,description,quantity,allocations})=>({id,reference,description,quantity,allocations:allocations.map(({id,caseId,lineId,issueId,purpose,quantity})=>({id,caseId,lineId,issueId,purpose,quantity}))}));
  if(body.kind==='submit'){event.status='SUBMITTED';event.submittedAt=at;event.submittedBy=user.id;}
 }else if(body.kind==='return'){
  if(current.status!=='SUBMITTED'||!text(body.reason))fail('Give a reason for returning this submitted delivery.');event=structuredClone(current);event.status='DRAFT';event.returnReason=text(body.reason);
 }else if(body.kind==='approve'){
  if(current.status!=='SUBMITTED'||body.verified!==true)fail('Confirm the documents, physical receipt, prior credits and all charges before approval.');
  event=validateLaterDelivery(current,next,true);
  if(!Array.isArray(body.rows))fail('The reviewed rows were not received. Reopen this delivery and review it again.');
  if(body.rows.length!==event.rows.length)fail('The reviewed row count differs from the saved delivery. Reopen it before approval.');
  if(!unique(body.rows.map((r:any)=>r.id)))fail('Review each document row once; duplicate reviewed rows were received.');
  for(const row of event.rows){const reviewed=body.rows.find((r:any)=>r.id===row.id);if(!reviewed)fail('A reviewed row is missing.');row.billedQuantity=qty(reviewed.billedQuantity);row.unitPrice=row.billedQuantity===0&&reviewed.unitPrice==null?undefined:qty(reviewed.unitPrice);
   if(!Array.isArray(reviewed.allocations)||reviewed.allocations.length!==row.allocations.length||!unique(reviewed.allocations.map((a:any)=>a.id)))fail('Review each allocation once.');
   for(const a of row.allocations){const decision=reviewed.allocations.find((v:any)=>v.id===a.id);if(!decision)fail('An allocation decision is missing.');a.billedQuantity=qty(decision.billedQuantity);a.reason=text(decision.reason);a.billing=decision.billing;}
   if(!same(row.allocations.reduce((s,a)=>s+a.billedQuantity!,0),row.billedQuantity))fail('Split the billed quantity across allocations exactly once.');
   const billed=row.billedQuantity===0?0:Math.round(row.billedQuantity*row.unitPrice!*100),allocated=row.allocations.reduce((sum,a)=>sum+(a.billedQuantity===0?0:Math.round(a.billedQuantity!*row.unitPrice!*100)),0);if(billed!==allocated)fail('The split creates a rounding difference. Check the printed row allocations before approval.');
  }
  event.status='APPROVED';event.approvedAt=at;event.approvedBy=user.id;
 }else fail('Unknown later-delivery action.');
 // Replace only this event’s reservation; every other receipt remains immutable.
 for(const id of ids){next[id].laterReceipts=(next[id].laterReceipts||[]).filter(r=>r.deliveryId!==event.id);next[id].laterDeliveryIds=[...new Set([...(next[id].laterDeliveryIds||[]),event.id])];}
 if(event.status!=='DRAFT')for(const row of event.rows)for(const a of row.allocations){const c=next[a.caseId],line=c.lines.find(l=>l.id===a.lineId)!;let settledPence=0,creditBasisPence=0,newChargePence=0;
  if(event.status==='APPROVED'){
   newChargePence=a.billedQuantity===0?0:Math.round(a.billedQuantity!*row.unitPrice!*100);if(!Number.isSafeInteger(newChargePence)||newChargePence>100000000)fail('Check the billed amount.');
   if(a.purpose==='NEW_ORDER'){
    if(newChargePence>0&&(line.expectedPrice==null||row.unitPrice!==line.expectedPrice))fail('The new-order price differs or is unknown. Resolve it in Accounts before approving this allocation.');
    if(a.billedQuantity!>a.quantity)fail('New-order billed quantity exceeds its received allocation.');
   }else{
    if(!a.reason)fail('Record the billing decision reason for each replacement.');
    const claim=c.claim?.lines.find(l=>l.lineId===a.lineId),oldValue=line.invoicePrice!=null&&line.expectedPrice!=null?Math.round(Math.min(line.invoicePrice,line.expectedPrice)*a.quantity*100):undefined;
    if(a.billing==='NO_EXTRA_CHARGE'){
     if(newChargePence!==0)fail('This replacement has an additional charge. Check the original charge and credit before approving.');
     if(claim){if(c.status==='APPROVED')fail('This invoice is already approved. Match the prior credit; its financial decision cannot be changed by a later delivery.');if(c.claim!.state!=='SENT'||claim.creditedPence>0||c.credits.some(n=>n.status==='DRAFT'&&n.lines.some(l=>l.lineId===a.lineId)))fail('A credit exists or the claim is unconfirmed. Match the prior credit explicitly before accepting the replacement.');
      const previousUnits=(c.laterReceipts||[]).filter(v=>v.lineId===a.lineId&&v.purpose==='REPLACEMENT'&&(v.settledPence||0)>0).reduce((s,v)=>s+v.quantity,0);
      if(oldValue==null||a.quantity+previousUnits>lineDiscrepancy(c,line).quantity+.000001||oldValue>claim.netPence-claim.replacementPence)fail('Replacement exceeds the quantity or value actually claimed.');
      settledPence=oldValue;claim.replacementPence+=settledPence;
     }
    }else if(a.billing==='ALREADY_CREDITED'){
     const consumed=(c.laterReceipts||[]).filter(v=>v.lineId===a.lineId).reduce((s,v)=>s+(v.creditBasisPence||0),0);
     if(!claim||oldValue==null||oldValue<=0||claim.creditedPence-consumed<oldValue)fail('An approved credit for these units is missing or already allocated.');
     creditBasisPence=oldValue;
     if(newChargePence>0&&(line.expectedPrice==null||row.unitPrice!==line.expectedPrice||a.billedQuantity!>a.quantity))fail('The new replacement charge differs from the agreed price or received quantity.');
    }else if(a.billing==='NOT_PREVIOUSLY_CHARGED'){
     if(line.invoiceQuantity!==0||claim)fail('Confirm the original invoice explicitly billed zero before using this option.');
     if(newChargePence>0&&(line.expectedPrice==null||row.unitPrice!==line.expectedPrice||a.billedQuantity!>a.quantity))fail('Check the later supply charge against the saved agreed price and quantity.');
    }else fail('Choose how the replacement was charged.');
    c.replacements.push({lineId:a.lineId,quantity:a.quantity,netPence:settledPence,documentId:event.documents[0].documentId,notes:a.reason,at,by:user.id});
   }
  }
  c.laterReceipts!.push({deliveryId:event.id,allocationId:a.id,lineId:a.lineId,...(a.issueId?{issueId:a.issueId}:{}),purpose:a.purpose,quantity:a.quantity,status:event.status==='APPROVED'?'APPROVED':'PENDING',...(event.status==='APPROVED'?{settledPence,creditBasisPence,newChargePence}:{})});
 }
 event.version++;event.requests.push(body.requestId);event.audit.push({at,by:user.id,action:body.kind,notes:body.kind==='return'?text(body.reason):event.notes});
 for(const id of ids){const c=next[id];c.version++;c.updatedAt=at;if(c.status!=='APPROVED'&&event.status==='APPROVED'&&c.claim&&c.claim.lines.every(l=>l.netPence-l.creditedPence-l.replacementPence===0))c.status='REVIEW';c.audit.push({at,by:user.id,action:'later-delivery-'+body.kind,details:event.id+' · '+event.reference});if(new TextEncoder().encode(JSON.stringify(c)).length>650000)fail('This review has reached its evidence limit.');}
 if(new TextEncoder().encode(JSON.stringify(event)).length>650000)fail('This later delivery is too large.');
 return {event,cases:next,unchanged:false};
}
