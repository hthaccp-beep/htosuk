import type {InvoiceCase} from './invoice-case.ts';
import {invoiceExtractionDraft,matchInvoiceExtraction} from './invoice-extraction.ts';

export interface InvoiceUnitReview {documentHash:string;page:number;row:number;lineId:string;quantity:number;unitPrice:number;unit:string;reason:string;by:string;at:string}
export function currentUnitReviews(record:InvoiceCase){return record.extraction.unitReviews||[];}
export function hasConfirmedUnitReview(record:InvoiceCase,page:number,row:number):boolean {
 const saved=invoiceExtractionDraft(record);
 return !!saved&&record.documents.find(d=>d.id===saved.documentId)?.sha256===saved.documentHash&&currentUnitReviews(record).some(v=>{
  const line=record.lines.find(l=>l.id===v.lineId);
  return v.documentHash===saved.documentHash&&v.page===page&&v.row===row&&!!line&&line.invoiceQuantity===v.quantity&&line.invoicePrice===v.unitPrice&&line.unit===v.unit;
 });
}
export function invoiceUnitReviewProblems(record:InvoiceCase):string[]{
 const saved=invoiceExtractionDraft(record);if(!saved)return [];
 if(record.documents.find(d=>d.id===saved.documentId)?.sha256!==saved.documentHash)return ['The invoice reading no longer matches its original document.'];
 let draft;try{draft=matchInvoiceExtraction(record,saved.documentId,saved.extracted);}catch{return ['The invoice reading is invalid; review the original before approval.'];}
 const pending=draft.rows.filter(r=>r.unitReviewRequired&&!hasConfirmedUnitReview(record,r.source.page,r.source.row));
 const blanks=draft.rows.filter(r=>r.blankReviewRequired).length;
 return [...(blanks?[`Review ${blanks} blank invoice row${blanks===1?'':'s'} against the original before approval.`]:[]),...(pending.length?[`Confirm units and price basis for ${pending.length} invoice row${pending.length===1?'':'s'} in the reading review.`]:[])];
}
/** Explicit Accounts decision with printed amount reconciliation, not an AI conversion or price approval. */
export function confirmInvoiceRowUnits(record:InvoiceCase,input:any,by:string,at:string):InvoiceCase {
 const saved=invoiceExtractionDraft(record);
 if(!saved||record.documents.find(d=>d.id===saved.documentId)?.sha256!==saved.documentHash)throw new Error('Read the current original document first.');
 if(!record.receipt.submittedAt||record.status==='APPROVED'||record.claim||record.laterReceipts?.some(r=>r.status==='APPROVED'))throw new Error('The original invoice figures are locked.');
 if(saved.extracted.documentType!=='INVOICE'||record.documents.find(d=>d.id===saved.documentId)?.kind!=='INVOICE')throw new Error('Delivery-note readings cannot establish invoice charges.');
 if(record.invoiceDocumentId&&record.invoiceDocumentId!==saved.documentId)throw new Error('The reading belongs to a different invoice.');
 const draft=matchInvoiceExtraction(record,saved.documentId,saved.extracted),row=draft.rows.find(r=>r.source.page===input.page&&r.source.row===input.row);
 const line=record.lines.find(l=>l.id===input.lineId);
 if(!row?.unitReviewRequired||!line||!row.candidateIds.includes(line.id))throw new Error('Choose a matching ordered item for the flagged unit row.');
 if(draft.rows.some(r=>r!==row&&(r.lineId===line.id||r.candidateIds.includes(line.id)))||currentUnitReviews(record).some(r=>r.lineId===line.id&&(r.page!==input.page||r.row!==input.row)))throw new Error('Repeated product rows need a separate allocation review; do not count them twice.');
 const quantity=input.quantity,unitPrice=input.unitPrice,reason=typeof input.reason==='string'?input.reason.trim():'';
 if(![quantity,unitPrice].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000)||quantity*unitPrice>1000000||reason.length<10||reason.length>2000)throw new Error('Enter valid invoice figures and explain the confirmed pack/weight and price basis.');
 if(row.source.netAmount===null||Math.round(quantity*unitPrice*100)!==Math.round(row.source.netAmount*100))throw new Error('Confirmed quantity × price must match the printed line amount. Keep unclear amounts on hold.');
 const confirmation:InvoiceUnitReview={documentHash:saved.documentHash,page:input.page,row:input.row,lineId:line.id,quantity,unitPrice,unit:line.unit,reason,by,at};
 return {...record,matchingVerified:false,totalsVerified:false,extraction:{...record.extraction,unitReviews:[...currentUnitReviews(record).filter(r=>r.page!==input.page||r.row!==input.row),confirmation]},
  lines:record.lines.map(l=>l.id===line.id?{...l,invoiceQuantity:quantity,invoicePrice:unitPrice,reviewed:false,resolution:'PENDING',reason:''}:l)};
}
