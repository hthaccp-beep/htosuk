import {sampleReviewed,sampleOwner} from './invoice-workflow.ts';
import {applyInvoiceCommand} from '../../server/invoice-case-validation.ts';
import {blankLaterDelivery,type LaterDelivery} from '../../shared/later-delivery.ts';
import type {InvoiceCase} from '../../shared/invoice-case.ts';
export function replacementCases():Record<string,InvoiceCase>{
 let old=sampleReviewed('DEMO-ORDER-007');old.invoiceReference='DEMO-INV-007';old.receipt.issues=old.receipt.issues.filter(i=>i.id==='missing-rice'||i.id==='damaged-soy');old.lines=old.lines.map((l,i)=>({...l,received:i===0?8:l.ordered,resolution:i===0||i===2?'CLAIM':'ACCEPT',reason:i===0?'Two bags missing and rice price differs.':i===2?'One damaged soy sauce case returned to driver.':'Matched.'}));
 old.documents[0].sha256='sample-old-007';old.documents.push({id:'sample-separate-delivery',kind:'LATER_DELIVERY',name:'SAMPLE-separate-replacement.pdf',mime:'application/pdf',size:100,sha256:'sample-separate-007',uploadedAt:'2026-11-11T08:00:00Z',uploadedBy:sampleOwner.id});
 old=applyInvoiceCommand(old,{kind:'prepare-claim',requestId:'sample-claim-007',expectedVersion:old.version},sampleOwner,{},'2026-11-11T08:00:00Z');old.claim!.state='SENT';old.claim!.sentAt='2026-11-11T08:00:00Z';old.status='WAITING_CREDIT';
 const next=sampleReviewed('DEMO-ORDER-008');next.invoiceReference='DEMO-INV-008';next.lines=[{...next.lines[0],ordered:8,received:8,invoiceQuantity:8,invoicePrice:18,resolution:'ACCEPT',reason:'Eight new-order bags received and checked.'}];next.receipt.statuses=['RECEIVED'];next.receipt.issues=[];next.receipt.notes='New order portion counted: 8 bags. Two additional bags belong to the earlier shortage and must be allocated separately.';next.invoiceNetPence=14400;next.invoiceGrossPence=14400;next.documents[0].name='SAMPLE-combined-invoice.pdf';next.documents[0].sha256='sample-combined-008';
 return {[old.id]:old,[next.id]:next};
}
export function replacementDraft(cases:Record<string,InvoiceCase>,combined=false):LaterDelivery{
 const old=cases['DEMO-ORDER-007'],next=cases['DEMO-ORDER-008'],e=blankLaterDelivery(old,combined?'sample-combined':'sample-separate','2026-11-11T08:30:00Z',sampleOwner.id);
 e.reference=combined?'REP-C-001':'REP-S-001';e.mode=combined?'COMBINED':'SEPARATE';e.readable=true;e.receiptConfirmed=true;e.notes='Synthetic demonstration only.';
 e.documents=combined?[{caseId:next.id,documentId:next.invoiceDocumentId}]:[{caseId:old.id,documentId:'sample-separate-delivery'}];
 e.rows=[{id:'row-1',reference:'1',description:combined?'Sample rice':'Sample soy sauce',quantity:combined?10:1,allocations:combined?[{id:'replacement',caseId:old.id,lineId:old.lines[0].id,issueId:'missing-rice',purpose:'REPLACEMENT',quantity:2},{id:'new-order',caseId:next.id,lineId:next.lines[0].id,purpose:'NEW_ORDER',quantity:8}]:[{id:'replacement',caseId:old.id,lineId:old.lines[2].id,issueId:'damaged-soy',purpose:'REPLACEMENT',quantity:1}]}];return e;
}
