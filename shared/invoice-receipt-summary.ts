import type {CaseStatus,InvoiceCase} from './invoice-case.ts';
export interface InvoiceReceiptSummary {id:string;receipt:'NOT_REPORTED'|'DRAFT'|'SUBMITTED';status:CaseStatus|null;documents?:number}
/** Deliberate allow-list: no prices, documents, notes or Accounts decisions. */
export function invoiceReceiptSummary(id:string,record?:InvoiceCase):InvoiceReceiptSummary {
 return {id,receipt:record?(record.receipt.submittedAt?'SUBMITTED':'DRAFT'):'NOT_REPORTED',status:record?.status??null,documents:record?.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind)).length||0};
}
export function receiptSummaryLabels(summary:InvoiceReceiptSummary|undefined){
 return {delivery:!summary?'Status unavailable':summary.receipt==='SUBMITTED'?'Submitted for checking':summary.receipt==='DRAFT'?'Draft':'Not reported',invoice:summary?.status==='APPROVED'?'Invoice approved':summary?.receipt==='SUBMITTED'?'Accounts review pending':'Awaiting delivery report'};
}

export function uploadSummaryLabel(summary:InvoiceReceiptSummary|undefined){
 if(!summary)return 'Status unavailable';
 if(summary.status==='APPROVED')return 'Invoice approved';
 if(summary.receipt==='SUBMITTED')return ({CHECKING:'Checking invoice',REVIEW:'Waiting for review',HOLD:'On hold',CLAIM_DRAFT:'Claim being prepared',WAITING_CREDIT:'Waiting for credit note',CREDIT_REVIEW:'Credit note under review',CREDIT_APPROVED:'Credit approved · invoice pending'} as Record<string,string>)[summary.status||'']||'Submitted for checking';
 if((summary.documents||0)>0)return 'Uploaded · report to submit';
 return summary.receipt==='DRAFT'?'Report draft · no upload':'Not uploaded';
}
