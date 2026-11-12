import type {CaseStatus,InvoiceCase} from './invoice-case.ts';
export interface InvoiceReceiptSummary {id:string;receipt:'NOT_REPORTED'|'DRAFT'|'SUBMITTED';status:CaseStatus|null}
/** Deliberate allow-list: no prices, documents, notes or Accounts decisions. */
export function invoiceReceiptSummary(id:string,record?:InvoiceCase):InvoiceReceiptSummary {
 return {id,receipt:record?(record.receipt.submittedAt?'SUBMITTED':'DRAFT'):'NOT_REPORTED',status:record?.status??null};
}
export function receiptSummaryLabels(summary:InvoiceReceiptSummary|undefined){
 return {delivery:!summary?'Status unavailable':summary.receipt==='SUBMITTED'?'Submitted for checking':summary.receipt==='DRAFT'?'Draft':'Not reported',invoice:summary?.status==='APPROVED'?'Invoice approved':summary?.receipt==='SUBMITTED'?'Accounts review pending':'Awaiting delivery report'};
}
