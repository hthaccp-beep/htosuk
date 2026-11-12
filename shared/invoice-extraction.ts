import {confirmedBlankReview,isBlankRowCandidate} from './invoice-blank-review.ts';
import type {InvoiceCase} from './invoice-case.ts';

/** Document facts only. Null means unreadable/not printed, never zero. */
export interface ExtractedInvoiceRow {
 page:number; row:number; code:string|null; description:string; unit:string|null;
 quantity:number|null; unitPrice:number|null; netAmount:number|null; vatRate:number|null;
 orderReference:string|null; uncertain:string[];
 sourceSection?:string; sourceRow?:number;
 /** Separate printed columns; never convert pack quantity into weight. Optional for older drafts. */
 orderedQuantity?:number|null; weightQuantity?:number|null; weightUnit?:string|null; priceUnit?:string|null;
}
export interface ExtractedInvoice {
 documentType:'INVOICE'|'DELIVERY_NOTE'|'CREDIT_NOTE'|'UNKNOWN';
 reference:string|null; date:string|null; supplier:string|null; branch:string|null;
 orderReferences:string[]; currency:string|null; priceBasis:'NET'|'GROSS'|'UNKNOWN';
 rows:ExtractedInvoiceRow[]; net:number|null; vat:number|null; gross:number|null;
 adjustment:number|null; warnings:string[];
 layout?:'TABLE'|'PREPRINTED_LIST'|'UNKNOWN';
 blankRows?:ExtractedInvoiceRow[]; readingMethod?:'SECTIONS'; sectionIds?:string[];
 customerName?:string|null; supplierOrderReferences?:string[];
 linkedInvoiceReference?:string|null; linkedInvoiceDate?:string|null;
 /** Printed subtotal BEFORE adjustment. net always means the printed payable net AFTER adjustment. */
 netBeforeAdjustment?:number|null;
}
export interface MatchedInvoiceRow {
 source:ExtractedInvoiceRow; lineId?:string; candidateIds:string[];
 warnings:string[]; mayUseFigures:boolean; unitReviewRequired?:boolean; blankReviewRequired?:boolean; blankConfirmed?:boolean;
}
export interface InvoiceExtractionDraft {
 schemaVersion:1; documentId:string; documentHash:string; extracted:ExtractedInvoice;
 rows:MatchedInvoiceRow[]; warnings:string[]; unmatchedOrderLineIds:string[];
}
const nullableString={type:['string','null']};
const nullableNumber={type:['number','null']};
const stringArray={type:'array',items:{type:'string'}};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const invoiceExtractionSchema=object({
 documentType:{type:'string',enum:['INVOICE','DELIVERY_NOTE','CREDIT_NOTE','UNKNOWN']},
 reference:nullableString,date:nullableString,supplier:nullableString,branch:nullableString,
 layout:{type:'string',enum:['TABLE','PREPRINTED_LIST','UNKNOWN']},customerName:nullableString,supplierOrderReferences:stringArray,
 linkedInvoiceReference:nullableString,linkedInvoiceDate:nullableString,netBeforeAdjustment:nullableNumber,
 orderReferences:stringArray,currency:nullableString,priceBasis:{type:'string',enum:['NET','GROSS','UNKNOWN']},
 rows:{type:'array',items:object({page:{type:'integer'},row:{type:'integer'},code:nullableString,description:{type:'string'},unit:nullableString,quantity:nullableNumber,orderedQuantity:nullableNumber,weightQuantity:nullableNumber,weightUnit:nullableString,priceUnit:nullableString,unitPrice:nullableNumber,netAmount:nullableNumber,vatRate:nullableNumber,orderReference:nullableString,uncertain:stringArray})},
 net:nullableNumber,vat:nullableNumber,gross:nullableNumber,adjustment:nullableNumber,warnings:stringArray,
});
const invalid=():never=>{throw new Error('The invoice reader returned invalid or incomplete document data. Review the original; no figures were applied.');};
function boundedText(v:unknown,nullable=false):string|null {if(v===null&&nullable)return null;if(typeof v!=='string'||v.length>1000)return invalid();return v.trim();}
function strings(v:unknown):string[]{if(!Array.isArray(v)||v.length>80)return invalid();return v.map(x=>boundedText(x) as string);}
function numeric(v:unknown,signed=false):number|null {if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1000000||(!signed&&v<0))return invalid();return v;}
function dateValue(v:unknown):string|null {const date=boundedText(v,true);if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))return invalid();return date;}
export function parseInvoiceExtraction(value:unknown):ExtractedInvoice {
 const v=value as Record<string,unknown>;
 if(!v||!['INVOICE','DELIVERY_NOTE','CREDIT_NOTE','UNKNOWN'].includes(String(v.documentType))||!['NET','GROSS','UNKNOWN'].includes(String(v.priceBasis))||!Array.isArray(v.rows)||v.rows.length>400)return invalid();
 const date=dateValue(v.date);
 const layout=v.layout??'UNKNOWN';if(!['TABLE','PREPRINTED_LIST','UNKNOWN'].includes(String(layout)))return invalid();
 const parseRows=(values:unknown[])=>values.map((raw:unknown)=>{const r=raw as Record<string,unknown>;if(!r||!Number.isInteger(r.page)||Number(r.page)<1||Number(r.page)>100||!Number.isInteger(r.row)||Number(r.row)<1||Number(r.row)>1000)return invalid();
  if(r.sourceRow!==undefined&&(!Number.isInteger(r.sourceRow)||Number(r.sourceRow)<1||Number(r.sourceRow)>1000))return invalid();
  return {...(r.sourceSection!==undefined?{sourceSection:boundedText(r.sourceSection) as string}:{}),...(r.sourceRow!==undefined?{sourceRow:Number(r.sourceRow)}:{}),page:Number(r.page),row:Number(r.row),code:boundedText(r.code,true),description:boundedText(r.description) as string,unit:boundedText(r.unit,true),quantity:numeric(r.quantity),unitPrice:numeric(r.unitPrice),netAmount:numeric(r.netAmount),vatRate:numeric(r.vatRate),orderReference:boundedText(r.orderReference,true),uncertain:strings(r.uncertain),orderedQuantity:numeric(r.orderedQuantity??null),weightQuantity:numeric(r.weightQuantity??null),weightUnit:boundedText(r.weightUnit??null,true),priceUnit:boundedText(r.priceUnit??null,true)};
 });
 const rows=parseRows(v.rows);
 if(v.blankRows!==undefined&&(!Array.isArray(v.blankRows)||v.blankRows.length>400))return invalid();
 const blankRows=parseRows((v.blankRows||[]) as unknown[]);
 if(rows.length+blankRows.length>400||blankRows.some(r=>[r.quantity,r.orderedQuantity,r.weightQuantity,r.unitPrice,r.netAmount].some(n=>n!==null)||r.uncertain.length))return invalid();
 const allRows=[...rows,...blankRows];
 if(new Set(allRows.map(r=>r.page+':'+r.row)).size!==allRows.length)return invalid();
 if(v.readingMethod!==undefined&&v.readingMethod!=='SECTIONS')return invalid();
 const sectionIds=v.sectionIds===undefined?undefined:strings(v.sectionIds);
 // Customer PO cells often list multiple references separated by commas; keep distinct IDs.
 const orderReferences=[...new Set(strings(v.orderReferences).flatMap(ref=>ref.split(',').map(s=>s.trim()).filter(Boolean)))];
 if(orderReferences.length>80)return invalid();
 return {...(v.readingMethod==='SECTIONS'?{readingMethod:'SECTIONS' as const,sectionIds}:{}),...(v.blankRows!==undefined?{blankRows}:{}),documentType:v.documentType as ExtractedInvoice['documentType'],reference:boundedText(v.reference,true),date,supplier:boundedText(v.supplier,true),branch:boundedText(v.branch,true),currency:boundedText(v.currency,true),priceBasis:v.priceBasis as ExtractedInvoice['priceBasis'],orderReferences,rows,net:numeric(v.net),vat:numeric(v.vat),gross:numeric(v.gross),adjustment:numeric(v.adjustment,true),warnings:strings(v.warnings),layout:layout as ExtractedInvoice['layout'],customerName:boundedText(v.customerName??null,true),supplierOrderReferences:v.supplierOrderReferences===undefined?[]:strings(v.supplierOrderReferences),linkedInvoiceReference:boundedText(v.linkedInvoiceReference??null,true),linkedInvoiceDate:dateValue(v.linkedInvoiceDate??null),netBeforeAdjustment:numeric(v.netBeforeAdjustment??null)};
}
const norm=(v:string|null|undefined)=>(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
// Plurals only. A box, pack, bag, piece and kg are NOT interchangeable.
const unitAliases:Record<string,string>={bags:'bag',cases:'case',packs:'pack',units:'unit',pieces:'piece',bottles:'bottle',kilograms:'kg',kilogram:'kg'};
const unit=(v:string|null)=>unitAliases[norm(v)]||norm(v);
const pence=(v:number)=>Math.round(v*100);
export function matchInvoiceExtraction(record:InvoiceCase,documentId:string,input:unknown):InvoiceExtractionDraft {
 const extracted=parseInvoiceExtraction(input),document=record.documents.find(d=>d.id===documentId&&['INVOICE','DELIVERY'].includes(d.kind));
 if(!document)throw new Error('Choose an original invoice or delivery note linked to this review.');
 const warnings=[...extracted.warnings];
 const identity=!!extracted.supplier&&norm(extracted.supplier)===norm(record.supplierName)&&!!extracted.branch&&norm(extracted.branch)===norm(record.branchName);
 if(!identity)warnings.push('Confirm supplier and branch: the document names are missing or do not exactly match this order.');
 const references=[...new Set([...extracted.orderReferences,...extracted.rows.map(r=>r.orderReference).filter((x):x is string=>!!x)])];
 const foreignReference=references.some(ref=>!record.orderIds.some(id=>norm(id)===norm(ref)));
 if(foreignReference)warnings.push('This document includes another or unrecognised order reference. Allocate its rows before using figures.');
 if(references.length>1)warnings.push('Multiple order references: keep every row and allocate it to its original order.');
 if(!references.length)warnings.push('No readable order reference: confirm the order manually.');
 if(extracted.documentType!=='INVOICE')warnings.push('This is not a confirmed invoice. Delivery quantities do not establish an invoice charge.');
 if(extracted.documentType==='INVOICE'&&document.kind!=='INVOICE')warnings.push('Document was uploaded as a delivery note; Accounts must confirm its document type.');
 if(extracted.currency!=='GBP'||extracted.priceBasis!=='NET')warnings.push('Confirm currency and net/VAT price basis before comparing prices.');
 if(!extracted.reference||!extracted.date)warnings.push('Invoice reference or date needs review.');
 const chargedRows=extracted.rows.filter(r=>!confirmedBlankReview(record,documentId,r));
 let totalsSafe=true;
 if([extracted.net,extracted.vat,extracted.gross].some(v=>v===null)){totalsSafe=false;warnings.push('Totals are missing or unreadable; do not infer them.');}
 else if(pence(extracted.net!)+pence(extracted.vat!)!==pence(extracted.gross!)){totalsSafe=false;warnings.push('Net plus VAT does not equal the printed gross total.');}
 if(extracted.net!==null&&chargedRows.every(r=>r.netAmount!==null)){
  const total=chargedRows.reduce((sum,r)=>sum+pence(r.netAmount!),0)+pence(extracted.adjustment??0);
  if(total!==pence(extracted.net)){totalsSafe=false;warnings.push('Printed line amounts plus the printed adjustment do not equal the net total.');}
 }else{totalsSafe=false;warnings.push('Some line amounts or the net total are unreadable; review the original.');}
 if(extracted.netBeforeAdjustment!=null&&extracted.net!==null&&pence(extracted.netBeforeAdjustment)+pence(extracted.adjustment??0)!==pence(extracted.net)){totalsSafe=false;warnings.push('The printed subtotal and adjustment do not agree with the payable net.');}
 if(extracted.layout==='PREPRINTED_LIST')warnings.push('Preprinted product list: manually verify row alignment before using figures, even when totals agree.');
 if(extracted.adjustment)warnings.push('Document-wide discount or charge: Accounts must allocate it before using figures.');
 const rows:MatchedInvoiceRow[]=extracted.rows.map(source=>{
  if(isBlankRowCandidate(source)){
   const confirmed=confirmedBlankReview(record,documentId,source);
   return {source,candidateIds:[],mayUseFigures:false,unitReviewRequired:false,blankReviewRequired:!confirmed,blankConfirmed:!!confirmed,warnings:confirmed?['Accounts confirmed this original row is blank and not charged. Delivery and out-of-stock status are unchanged.']:[...source.uncertain,'Check the original: confirm this row is blank and not charged, or keep it on hold.']};
  }
  const candidates=record.lines.filter(l=>(source.code?!!l.code&&norm(l.code)===norm(source.code):norm(l.name)===norm(source.description))&&(!source.orderReference||norm(l.orderId)===norm(source.orderReference)));
  const exact=candidates.filter(l=>!!source.unit&&unit(l.unit)===unit(source.unit)),line=exact.length===1?exact[0]:undefined;
  const notes=[...source.uncertain];
  if(!line)notes.push(candidates.length?'Ambiguous product or unit/pack mismatch; no conversion assumed.':'No exact product match; select the correct order item.');
  if(source.quantity===null)notes.push('Quantity unreadable or absent.');
  if(source.unitPrice===null)notes.push('Unit price unreadable or absent.');
  const amountSafe=source.quantity!==null&&(source.quantity===0||source.unitPrice!==null&&source.quantity*source.unitPrice<=1000000);
  if(!amountSafe&&source.quantity!==null&&source.unitPrice!==null)notes.push('Billed line amount exceeds the review limit; check the reading.');
  const arithmeticSafe=source.quantity!==null&&source.netAmount!==null&&(source.quantity===0?pence(source.netAmount)===0:source.unitPrice!==null&&pence(source.quantity*source.unitPrice)===pence(source.netAmount));
  if(!arithmeticSafe)notes.push('Quantity × unit price differs from the printed net line amount or is unknown; check weights, discounts and rounding.');
  const weightSafe=source.weightQuantity==null&&(!source.priceUnit||!!source.unit&&unit(source.priceUnit)===unit(source.unit));
  if(!weightSafe)notes.push('Separate quantity, weight or price-unit columns need manual allocation; no conversion assumed.');
  if(line){
   if(line.expectedPrice==null)notes.push('No agreed price in the sent order; Accounts must verify a dated approved price.');
   else if(source.unitPrice!==null&&source.unitPrice!==line.expectedPrice)notes.push('Price differs from the sent order.');
   if(source.quantity!==null&&source.quantity!==line.ordered)notes.push('Quantity differs from the sent order.');
   if(line.received!=null&&source.quantity!==null&&source.quantity!==line.received)notes.push('Document quantity differs from staff received quantity.');
   if(record.receipt.issues.some(i=>i.lineId===line.id&&['DAMAGED','INCORRECT'].includes(i.kind)))notes.push('Staff reported damaged or incorrect goods; Accounts must review the charge.');
  }
  return {source,unitReviewRequired:!line||!weightSafe,...(line?{lineId:line.id}:{}),candidateIds:candidates.map(l=>l.id),warnings:notes,mayUseFigures:!!line&&identity&&!foreignReference&&references.length===1&&!!extracted.reference&&!!extracted.date&&extracted.documentType==='INVOICE'&&document.kind==='INVOICE'&&extracted.currency==='GBP'&&extracted.priceBasis==='NET'&&!source.uncertain.length&&amountSafe&&arithmeticSafe&&weightSafe&&totalsSafe&&extracted.layout!=='PREPRINTED_LIST'&&!extracted.adjustment};
 });
 for(const row of rows)if(row.lineId&&rows.filter(r=>r.lineId===row.lineId).length>1){row.mayUseFigures=false;row.warnings.push('Repeated product rows retained separately, including zero-price rows. Allocate before using figures.');}
 const unmatchedOrderLineIds=record.lines.filter(l=>!rows.some(r=>r.lineId===l.id)).map(l=>l.id);
 if(unmatchedOrderLineIds.length)warnings.push('Some ordered items have no document match. Absence from the document does not prove out of stock.');
 return {schemaVersion:1,documentId,documentHash:document.sha256,extracted,rows,warnings:[...new Set(warnings)],unmatchedOrderLineIds};
}

/** Server-owned draft: never approves, changes expected prices or overwrites reviewed figures. */
export function attachInvoiceExtraction(record:InvoiceCase,documentId:string,input:unknown):InvoiceCase {
 if(!record.receipt.submittedAt||record.status==='APPROVED'||record.claim||record.laterReceipts?.some(r=>r.status==='APPROVED'))throw new Error('This review is not open for automatic invoice reading.');
 const draft=matchInvoiceExtraction(record,documentId,input);
 return {...record,extraction:{state:'NEEDS_REVIEW',warnings:['AI draft — check against the original before approval.',...draft.warnings],draft}};
}

export function invoiceExtractionDraft(record:InvoiceCase):InvoiceExtractionDraft|null {
 const draft=record.extraction.draft as InvoiceExtractionDraft|undefined;
 return draft?.schemaVersion===1&&Array.isArray(draft.rows)&&draft.extracted?draft:null;
}

/** Accounts requests this explicitly. Only blanks are filled; human decisions stay pending. */
export function useInvoiceExtractionFigures(record:InvoiceCase):InvoiceCase {
 const saved=invoiceExtractionDraft(record);
 if(!saved||record.documents.find(d=>d.id===saved.documentId)?.sha256!==saved.documentHash)throw new Error('Read the current original document before using its draft.');
 if(record.claim||record.laterReceipts?.some(r=>r.status==='APPROVED'))throw new Error('Existing claims or approved replacements lock the invoice figures.');
 const draft=matchInvoiceExtraction(record,saved.documentId,saved.extracted);
 if(!draft.rows.some(r=>r.mayUseFigures))throw new Error('No unambiguous draft rows are available. Review the original and enter the figures manually.');
 const lines=record.lines.map(line=>{
  const row=draft.rows.find(r=>r.lineId===line.id&&r.mayUseFigures);
  if(!row||line.reviewed)return line;
  return {...line,invoiceQuantity:line.invoiceQuantity??row.source.quantity??undefined,invoicePrice:line.invoicePrice??row.source.unitPrice??undefined,reviewed:false};
 });
 const d=draft.extracted;
 // The original identity is never replaced, and totals remain subject to independent review.
 if(record.invoiceDocumentId&&record.invoiceDocumentId!==draft.documentId)throw new Error('The draft belongs to a different invoice document. Review it separately.');
 if(record.invoiceReference&&record.invoiceReference!==d.reference)throw new Error('The draft invoice reference differs from the saved review.');
 return {...record,lines,invoiceDocumentId:draft.documentId,invoiceReference:record.invoiceReference||d.reference||'',invoiceDate:record.invoiceDate||d.date||'',
  invoiceNetPence:record.invoiceNetPence??(d.net===null?undefined:pence(d.net)),invoiceVatPence:record.invoiceVatPence??(d.vat===null?undefined:pence(d.vat)),invoiceGrossPence:record.invoiceGrossPence??(d.gross===null?undefined:pence(d.gross)),matchingVerified:false,totalsVerified:false};
}
