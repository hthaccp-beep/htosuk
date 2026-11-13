import type {OrderRecord} from '../../types';
import {uploadSummaryLabel,type InvoiceReceiptSummary} from '../../shared/invoice-receipt-summary';
export const invoiceHistoryFilters=[['ALL','All orders'],['NOT_UPLOADED','Not uploaded'],['UPLOAD_DRAFT','Uploaded · report to submit'],['REVIEW','Waiting for review'],['HOLD','On hold'],['CREDIT','Credit follow-up'],['APPROVED','Invoice approved'],['DRAFT','Order drafts'],['CANCELLED','Cancelled'],['ARCHIVED','Archived']] as const;
export function historyInvoiceStatus(order:OrderRecord,summary:InvoiceReceiptSummary|undefined,enabled:boolean,loading=false):{label:string;tone:''|'amber'|'green'|'red';detail?:string}{
 if(order.archived)return {label:'Archived',tone:''};
 if(order.status==='DRAFT')return {label:'Order draft',tone:'amber'};
 if(order.status==='CANCELLED')return {label:'Cancelled',tone:''};
 if(order.invoiceVerification||order.deliveryCheck||order.supplierCase)return {label:'Previous check · open details',tone:''};
 if(!enabled)return {label:'Order placed',tone:''};
 if(!summary)return {label:loading?'Loading invoice status…':'Status unavailable',tone:''};
 return {label:uploadSummaryLabel(summary),tone:summary.status==='APPROVED'?'green':summary.status==='HOLD'?'red':'amber',...((summary.documents||0)>0?{detail:summary.documents+' document'+(summary.documents===1?'':'s')+' uploaded'}:{})};
}
export function matchesInvoiceHistoryStatus(order:OrderRecord,summary:InvoiceReceiptSummary|undefined,status:string){
 if(['ALL','DRAFT','PLACED','OPEN','PROCESSED','CANCELLED','ARCHIVED'].includes(status))return true; // Order lifecycle filters already applied by the scoped list.
 if(order.status!=='PLACED'||order.archived||order.invoiceVerification||order.deliveryCheck||order.supplierCase||!summary)return false;
 if(status==='NOT_UPLOADED')return (summary.documents||0)===0&&summary.receipt!=='SUBMITTED';
 if(status==='UPLOAD_DRAFT')return (summary.documents||0)>0&&summary.receipt!=='SUBMITTED';
 if(status==='REVIEW')return ['CHECKING','REVIEW'].includes(summary.status||'');
 if(status==='CREDIT')return ['CLAIM_DRAFT','WAITING_CREDIT','CREDIT_REVIEW','CREDIT_APPROVED'].includes(summary.status||'');
 return summary.status===status;
}
