import {lineDiscrepancy,receiptStatusLabels,type InvoiceCase} from './invoice-case.ts';
import {invoiceExtractionDraft,matchInvoiceExtraction} from './invoice-extraction.ts';
import {hasConfirmedUnitReview,currentUnitReviews} from './invoice-unit-review.ts';
export interface InvoiceReadingSummary {name:string;quantity?:number;unit:string;price?:number;amount?:number;page:number;row:number}
export interface ItemReviewRow {readings?:InvoiceReadingSummary[];readingStale?:boolean;id:string;lineId?:string;name:string;unit:string;ordered?:number;received?:number;billed?:number;reports:string[];notes:string[];followUp:string[];expectedPrice?:number;invoicePrice?:number;priceCheck:'MATCH'|'HIGHER'|'LOWER'|'UNKNOWN'|'UNMATCHED';priceDifference?:number;attention:boolean;action:'ITEM'|'SCAN';result:string}
const gbp=(pence:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100);
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
/** Legacy zero snapshots have no evidence that a free price was agreed. Display only; keep the stored value. */
export const hasKnownAgreedPrice=(price:unknown):price is number=>finite(price)&&price>0;
export function invoiceItemCounts(rows:ItemReviewRow[]){return {items:rows.filter(r=>r.lineId&&r.attention).length,unmatched:rows.filter(r=>!r.lineId&&r.attention).length};}
export function invoiceItemCountLabel(items:number,unmatched=0){return [items?items+' item'+(items===1?'':'s')+' to check':'',unmatched?unmatched+' invoice row'+(unmatched===1?'':'s')+' to match':''].filter(Boolean).join(' · ')||'Items checked';}
/** Read-only projection of recorded evidence. Never infer a replacement promise or approve a charge. */
export function invoiceItemReview(record:InvoiceCase):ItemReviewRow[]{
 const saved=invoiceExtractionDraft(record);let scan:ReturnType<typeof matchInvoiceExtraction>|null=null;
 try{if(saved)scan=matchInvoiceExtraction(record,saved.documentId,saved.extracted);}catch{/* Unknown document is kept for Accounts review. */}
 const allocated=(page:number,row:number)=>hasConfirmedUnitReview(record,page,row)?currentUnitReviews(record).find(v=>v.page===page&&v.row===row)?.lineId:undefined;
 const current=!!saved&&record.documents.some(d=>d.id===saved.documentId&&d.sha256===saved.documentHash);
 // Only an existing unique match or explicit allocation can pair an invoice row. Never guess product identity.
 const target=(r:NonNullable<typeof scan>['rows'][number])=>allocated(r.source.page,r.source.row)||r.lineId||(r.candidateIds.length===1?r.candidateIds[0]:undefined);
 const reading=(r:NonNullable<typeof scan>['rows'][number]):InvoiceReadingSummary=>({name:r.source.description,quantity:r.source.quantity??undefined,unit:r.source.unit||'Unit unclear',price:r.source.unitPrice??undefined,amount:r.source.netAmount??undefined,page:r.source.page,row:r.source.row});
 const rows:ItemReviewRow[]=record.lines.map(line=>{
  const issues=record.receipt.issues.filter(i=>i.lineId===line.id),claim=record.claim?.lines.find(c=>c.lineId===line.id);
  const linked=scan?.rows.filter(r=>!r.blankConfirmed&&target(r)===line.id)||[];
  const unclear=linked.length>1||linked.some(r=>r.unitReviewRequired&&!hasConfirmedUnitReview(record,r.source.page,r.source.row));
  const basisKnown=(!saved||!!scan&&record.documents.some(d=>d.id===saved.documentId&&d.sha256===saved.documentHash))&&!unclear&&(record.matchingVerified||linked.some(r=>r.mayUseFigures||hasConfirmedUnitReview(record,r.source.page,r.source.row)));
  const known=basisKnown&&hasKnownAgreedPrice(line.expectedPrice)&&finite(line.invoicePrice)&&line.invoiceQuantity!==0;
  const delta=known?Math.round((line.invoicePrice!-line.expectedPrice!)*100):undefined;
  const priceCheck:ItemReviewRow['priceCheck']=delta===undefined?'UNKNOWN':delta===0?'MATCH':delta>0?'HIGHER':'LOWER';
  const followUp:string[]=[];
  const later=(record.laterReceipts||[]).filter(r=>r.lineId===line.id&&r.purpose==='REPLACEMENT');
  const pending=later.filter(r=>r.status==='PENDING').reduce((s,r)=>s+r.quantity,0),approved=later.filter(r=>r.status==='APPROVED').reduce((s,r)=>s+r.quantity,0);
  if(pending)followUp.push('Replacement reported: '+pending+' '+line.unit+' — Accounts to confirm');
  if(approved)followUp.push('Replacement confirmed: '+approved+' '+line.unit);
  if(record.replacements.some(r=>r.lineId===line.id)&&!approved)followUp.push('Replacement settlement recorded — open history');
  if(claim){
   if(claim.creditedPence>0)followUp.push((claim.creditedPence>=claim.netPence?'Full credit approved: ':'Credit approved: ')+gbp(claim.creditedPence)+' net');
   const outstanding=Math.max(0,claim.netPence-claim.creditedPence-claim.replacementPence);
   if(outstanding)followUp.push((record.claim?.state==='SENT'?'Credit / replacement outstanding: ':'Proposed claim: ')+gbp(outstanding)+' net');
   if(record.credits.some(c=>c.status==='DRAFT'&&c.lines.some(l=>l.lineId===line.id)))followUp.push('Credit note received — Accounts to approve');
  }
  const remainingClaim=claim?Math.max(0,claim.netPence-claim.creditedPence-claim.replacementPence):0;
  const issuesResolved=issues.length===0||!!claim&&remainingClaim===0&&record.claim?.state==='SENT'||line.reviewed&&line.resolution==='ACCEPT';
  if(!followUp.length&&issues.length)followUp.push(issuesResolved?'Accounts accepted / resolved':'Choose replacement, credit or other resolution');
  const d=lineDiscrepancy(record,line),attention=priceCheck==='UNKNOWN'&&line.invoiceQuantity!==0||!line.reviewed||!d.known||pending>0||remainingClaim>0||!issuesResolved||line.resolution==='PENDING'||line.resolution==='HOLD'||line.resolution==='CLAIM'&&(!claim||record.claim?.state!=='SENT')||unclear;
  const result=!hasKnownAgreedPrice(line.expectedPrice)&&line.invoiceQuantity!==0?'Check agreed price':linked.length>1?'Check repeated invoice rows':unclear||priceCheck==='UNKNOWN'&&line.invoiceQuantity!==0?'Check price / unit':line.resolution==='HOLD'?'On hold':pending?'Confirm replacement':remainingClaim?'Follow up claim':!line.reviewed||!d.known?'Accounts to check':!issuesResolved?'Resolve delivery issue':d.hasDifference||issues.length?'Resolution recorded':'Checks complete';
  return {readings:linked.map(reading),readingStale:!!saved&&!current,id:line.id,lineId:line.id,name:line.name,unit:line.unit,ordered:line.ordered,received:line.received,billed:line.invoiceQuantity,reports:issues.map(i=>receiptStatusLabels[i.kind]+(finite(i.quantity)?' · '+i.quantity+' '+line.unit:'')),notes:issues.map(i=>i.notes).filter(Boolean),followUp,expectedPrice:line.expectedPrice,invoicePrice:line.invoicePrice,priceCheck,priceDifference:delta,attention,action:unclear||linked.length>0&&line.invoiceQuantity==null?'SCAN' as const:'ITEM' as const,result};
 });
 for(const row of scan?.rows||[]){
  if(row.blankConfirmed||target(row))continue;
  rows.push({readings:[reading(row)],readingStale:!current,id:'scan:'+row.source.page+':'+row.source.row,name:row.source.description||'Unclear invoice row',unit:row.source.unit||'Unit unclear',ordered:undefined,received:undefined,billed:row.source.quantity??undefined,reports:[row.blankReviewRequired?'Possibly blank — check original':'Not matched to an ordered item'],notes:[],followUp:['Accounts must identify this item before accepting any charge'],expectedPrice:undefined,invoicePrice:row.source.unitPrice??undefined,priceCheck:'UNMATCHED',priceDifference:undefined,attention:true,action:'SCAN',result:'Review invoice item',lineId:undefined});
 }
 return rows;
}
