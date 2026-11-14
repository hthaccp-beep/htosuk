import {invoiceProgress,invoiceStatusPresentation,type InvoiceProgress} from './invoice-review-status.ts';
import type {CaseStatus,InvoiceCase} from './invoice-case.ts';
export interface InvoiceReceiptSummary {id:string;receipt:'NOT_REPORTED'|'DRAFT'|'SUBMITTED';status:CaseStatus|null;documents?:number;progress?:InvoiceProgress}
/** Deliberate allow-list: only document count and generic reading progress; no prices, document contents, notes or Accounts decisions. */
export function invoiceReceiptSummary(id:string,record?:InvoiceCase):InvoiceReceiptSummary {
 return {id,receipt:record?(record.receipt.submittedAt?'SUBMITTED':'DRAFT'):'NOT_REPORTED',status:record?.status??null,...(record?.receipt.submittedAt?{progress:invoiceProgress(record)}:{}),documents:record?.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind)).length||0};
}
export function receiptSummaryLabels(summary:InvoiceReceiptSummary|undefined){
 return {delivery:!summary?'Status unavailable':summary.receipt==='SUBMITTED'?'Submitted for checking':summary.receipt==='DRAFT'?'Draft':'Not reported',invoice:summary?.status==='APPROVED'?'Invoice approved':summary?.receipt==='SUBMITTED'?'Accounts review pending':'Awaiting delivery report'};
}

export function uploadSummaryLabel(summary:InvoiceReceiptSummary|undefined){
 if(!summary)return 'Status unavailable';
 if(summary.status==='APPROVED')return 'Invoice approved';
 if(summary.receipt==='SUBMITTED')return invoiceStatusPresentation(summary.status,summary.progress).label;
 if((summary.documents||0)>0)return 'Uploaded · report to submit';
 return summary.receipt==='DRAFT'?'Report draft · no upload':'Not uploaded';
}
