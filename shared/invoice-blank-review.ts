import type {InvoiceCase} from './invoice-case.ts';
import type {ExtractedInvoiceRow,InvoiceExtractionDraft} from './invoice-extraction.ts';

export interface InvoiceBlankReview {documentId:string;documentHash:string;page:number;row:number;source:string;reason:string;by:string;at:string}
/** A printed zero is evidence, never a blank. A human must check the original. */
export function isBlankRowCandidate(row:ExtractedInvoiceRow):boolean {
 return [row.quantity,row.orderedQuantity??null,row.weightQuantity??null,row.unitPrice,row.netAmount,row.vatRate].every(v=>v===null);
}
const sourceIdentity=(r:ExtractedInvoiceRow)=>JSON.stringify([r.page,r.row,r.sourceSection??null,r.sourceRow??null,r.code,r.description,r.unit,r.quantity,r.orderedQuantity??null,r.weightQuantity??null,r.weightUnit??null,r.priceUnit??null,r.unitPrice,r.netAmount,r.vatRate,r.orderReference,r.uncertain]);
export function confirmedBlankReview(record:InvoiceCase,documentId:string,row:ExtractedInvoiceRow):InvoiceBlankReview|undefined {
 const document=record.documents.find(d=>d.id===documentId),saved=record.extraction.draft as InvoiceExtractionDraft|undefined;
 if(!document||saved?.documentId!==documentId||saved.documentHash!==document.sha256||!isBlankRowCandidate(row))return;
 return record.extraction.blankReviews?.find(r=>r.documentId===documentId&&r.documentHash===document.sha256&&r.page===row.page&&r.row===row.row&&r.source===sourceIdentity(row)&&r.reason.trim().length>=10&&!!r.by&&!!r.at);
}
/** Called only after server permission, revision and duplicate-request checks. */
export function reviewBlankInvoiceRow(record:InvoiceCase,input:any,by:string,at:string,restore=false):InvoiceCase {
 const saved=record.extraction.draft as InvoiceExtractionDraft|undefined,document=record.documents.find(d=>d.id===saved?.documentId);
 if(!saved||!document||saved.documentHash!==document.sha256)throw Error('Read the current original document first.');
 if(!record.receipt.submittedAt||record.status==='APPROVED'||record.claim||record.laterReceipts?.some(r=>r.status==='APPROVED'))throw Error('The original invoice figures are locked.');
 if(saved.extracted.documentType!=='INVOICE'||document.kind!=='INVOICE'||record.invoiceDocumentId&&record.invoiceDocumentId!==document.id)throw Error('Choose the current original invoice.');
 const row=saved.extracted.rows.find(r=>r.page===input.page&&r.row===input.row);
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(!row||!isBlankRowCandidate(row))throw Error('Only a wholly blank row can be excluded. Printed quantities, prices, amounts and zeros must remain in review.');
 if(input.confirmed!==true||reason.length<10||reason.length>2000)throw Error('Check the original row and record why it is blank, or why it needs review again.');
 const reviews=record.extraction.blankReviews??[];
 if(restore&&!confirmedBlankReview(record,document.id,row))throw Error('This row has no current blank confirmation.');
 const remaining=reviews.filter(r=>r.documentId!==document.id||r.page!==row.page||r.row!==row.row);
 const next:InvoiceBlankReview={documentId:document.id,documentHash:document.sha256,page:row.page,row:row.row,source:sourceIdentity(row),reason,by,at};
 return {...record,matchingVerified:false,totalsVerified:false,extraction:{...record.extraction,blankReviews:restore?remaining:[...remaining,next]}};
}
