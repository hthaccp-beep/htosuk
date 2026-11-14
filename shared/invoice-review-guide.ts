import {invoiceApprovalProblems,lineDiscrepancy,type InvoiceCase} from './invoice-case.ts';
export function invoiceReviewGuide(record:InvoiceCase){
 const documents=record.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind));
 const attention=record.lines.filter(l=>{const d=lineDiscrepancy(record,l),claim=record.claim?.lines.find(c=>c.lineId===l.id);return !l.reviewed||!d.known||l.resolution==='PENDING'||l.resolution==='HOLD'||l.resolution==='CLAIM'&&(!claim||claim.netPence>claim.creditedPence+claim.replacementPence);}).length;
 const missingTotals=[record.invoiceNetPence,record.invoiceVatPence,record.invoiceGrossPence].some(n=>n==null);
 return {documents:documents.length,attention,totals:missingTotals?'Totals incomplete':record.totalsVerified?'Totals checked':'Totals to check',problems:invoiceApprovalProblems(record),next:!documents.length?'Upload the original invoice or delivery note.':!record.receipt.submittedAt?'Ask staff to submit their delivery report.':attention?'Compare the flagged items with the original and staff report.':!record.totalsVerified||missingTotals?'Check the invoice totals, VAT and any adjustments.':'Check remaining actions before invoice approval.'};
}
