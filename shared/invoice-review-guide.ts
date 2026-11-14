import {invoiceItemReview,invoiceItemCounts,invoiceItemCountLabel} from './invoice-item-review.ts';
import {invoiceReadingAttention} from './invoice-review-status.ts';
import {invoiceApprovalProblems,type InvoiceCase} from './invoice-case.ts';
export function invoiceReviewGuide(record:InvoiceCase){
 const documents=record.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind));
 const counts=invoiceItemCounts(invoiceItemReview(record)),attention=counts.items+counts.unmatched;
 const missingTotals=[record.invoiceNetPence,record.invoiceVatPence,record.invoiceGrossPence].some(n=>n==null);
 const readingAttention=invoiceReadingAttention(record);
 return {itemLabel:invoiceItemCountLabel(counts.items,counts.unmatched),documents:documents.length,attention,readingAttention,totals:missingTotals?'Totals incomplete':record.totalsVerified?'Totals checked':'Totals to check',problems:invoiceApprovalProblems(record),next:!documents.length?'Upload the original invoice or delivery note.':!record.receipt.submittedAt?'Ask staff to submit their delivery report.':readingAttention?'Review '+readingAttention+' item'+(readingAttention===1?'':'s')+' from the scan before confirming prices.':attention?'Check the missing, damaged or price details below.':!record.totalsVerified||missingTotals?'Check the invoice totals, VAT and any adjustments.':'Check remaining actions before invoice approval.'};
}
