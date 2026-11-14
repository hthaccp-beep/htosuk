import {invoiceItemReview,invoiceItemCounts,invoiceItemCountLabel,hasKnownAgreedPrice} from './invoice-item-review.ts';
import {caseStatusLabels,invoiceLineNetPence,lineDiscrepancy,type InvoiceCase,type CaseStatus} from './invoice-case.ts';
import {invoiceExtractionDraft,matchInvoiceExtraction} from './invoice-extraction.ts';
import {hasConfirmedUnitReview,invoiceUnitReviewProblems} from './invoice-unit-review.ts';
export type InvoiceProgress={stage:'NOT_READ'|'QUEUED'|'READING'|'FAILED'|'CHECK_READING'|'CHECK_ITEMS'|'CHECK_TOTALS'|'READY';items?:number;unmatched?:number};
export function invoiceReadingAttention(record:InvoiceCase):number{
 const saved=invoiceExtractionDraft(record);if(!saved)return 0;
 try{return matchInvoiceExtraction(record,saved.documentId,saved.extracted).rows.filter(row=>{
  if(row.blankConfirmed)return false;
  if(row.blankReviewRequired)return true;
  if(row.unitReviewRequired)return !hasConfirmedUnitReview(record,row.source.page,row.source.row);
  const line=record.lines.find(l=>l.id===row.lineId);
  return !row.mayUseFigures&&(!line||!line.reviewed||!record.matchingVerified);
 }).length;}catch{return 0;}
}
/** A display decision only. Never changes financial figures or approval rules. */
export function invoiceComparisonComplete(record:InvoiceCase):boolean{
 const totals=[record.invoiceNetPence,record.invoiceVatPence,record.invoiceGrossPence];
 return !!record.receipt.submittedAt&&!!record.invoiceReference&&!!record.invoiceDate&&record.documents.some(d=>d.id===record.invoiceDocumentId&&d.kind==='INVOICE')
  &&record.matchingVerified&&record.totalsVerified&&totals.every(n=>typeof n==='number'&&Number.isFinite(n))
  &&(record.invoiceNetPence! + record.invoiceVatPence!) === record.invoiceGrossPence
  &&record.lines.length>0&&record.lines.every(l=>l.reviewed&&(l.invoiceQuantity===0||hasKnownAgreedPrice(l.expectedPrice))&&lineDiscrepancy(record,l).known&&Number.isFinite(invoiceLineNetPence(l)))
  &&record.lines.reduce((sum,l)=>sum+invoiceLineNetPence(l)!,0)+record.adjustmentPence===record.invoiceNetPence
  &&!invoiceUnitReviewProblems(record).length&&!invoiceReadingAttention(record)
  &&!['PENDING','RUNNING','FAILED'].includes(record.extraction.state);
}
export function invoiceProgress(record:InvoiceCase):InvoiceProgress{
 if(record.extraction.state==='PENDING')return {stage:'QUEUED'};
 if(record.extraction.state==='RUNNING')return {stage:'READING'};
 if(record.extraction.state==='FAILED')return {stage:'FAILED'};
 const items=invoiceReadingAttention(record);
 const counts=invoiceItemCounts(invoiceItemReview(record));
 if(items||invoiceUnitReviewProblems(record).length)return {stage:'CHECK_READING',items:counts.items,...(counts.unmatched?{unmatched:counts.unmatched}:{})};
 if(invoiceComparisonComplete(record))return {stage:'READY'};
 if(!invoiceExtractionDraft(record)&&!record.matchingVerified&&!record.lines.some(l=>l.invoiceQuantity!=null))return {stage:'NOT_READ'};
 const unchecked=record.lines.filter(l=>!l.reviewed||!lineDiscrepancy(record,l).known||l.invoiceQuantity!==0&&!hasKnownAgreedPrice(l.expectedPrice)).length;
 if(unchecked)return {stage:'CHECK_ITEMS',items:unchecked};
 return {stage:'CHECK_TOTALS'};
}
export function invoiceStatusPresentation(status:CaseStatus|null,progress?:InvoiceProgress):{label:string;tone:''|'amber'|'red'|'green'}{
 if(status==='APPROVED')return {label:caseStatusLabels.APPROVED,tone:'green'};
 if(status==='HOLD')return {label:caseStatusLabels.HOLD,tone:'red'};
 if(status&& !['REVIEW','CHECKING'].includes(status))return {label:caseStatusLabels[status],tone:'amber'};
 const labels:Record<InvoiceProgress['stage'],string>={NOT_READ:'Reading result needed',QUEUED:'Waiting for reading',READING:'Reading invoice',FAILED:'Reading failed',CHECK_READING:'Check invoice details',CHECK_ITEMS:'Check invoice items',CHECK_TOTALS:'Check invoice totals',READY:'Ready for final review'};
 const count=progress?.items;
 return {label:progress?(count||progress.unmatched?invoiceItemCountLabel(count||0,progress.unmatched):labels[progress.stage]):status==='CHECKING'?'Checking invoice':'Waiting for review',tone:progress?.stage==='FAILED'?'red':'amber'};
}
export const invoiceRecordStatus=(record:InvoiceCase)=>invoiceStatusPresentation(record.status,invoiceProgress(record));


