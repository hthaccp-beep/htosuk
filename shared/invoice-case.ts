import type {InvoiceBlankReview} from './invoice-blank-review.ts';
import {invoiceUnitReviewProblems,type InvoiceUnitReview} from './invoice-unit-review.ts';
import type {LaterReceipt} from './later-delivery.ts';
import type {OrderRecord} from '../types.ts';
import {hasBranchScope,hasSupplierScope,type OrderScopeUser} from './order-scope.ts';

export type ReceiptStatus='RECEIVED'|'MISSING'|'DAMAGED'|'INCORRECT'|'OTHER'|'OUT_OF_STOCK';
export const invoiceUploadLabel='Upload invoice / delivery note';
export type ReturnOutcome='DRIVER'|'COLLECTION'|'KEPT';
export type CaseStatus='DRAFT'|'CHECKING'|'REVIEW'|'HOLD'|'CLAIM_DRAFT'|'WAITING_CREDIT'|'CREDIT_REVIEW'|'CREDIT_APPROVED'|'APPROVED';
export type DocumentKind='INVOICE'|'DELIVERY'|'EVIDENCE'|'CREDIT'|'LATER_INVOICE'|'LATER_DELIVERY';
export interface InvoiceDocument {id:string;kind:DocumentKind;name:string;mime:string;size:number;sha256:string;lineId?:string;uploadedAt:string;uploadedBy:string}
export interface ReceiptIssue {id:string;kind:Exclude<ReceiptStatus,'RECEIVED'>;lineId?:string;quantity?:number;notes:string;actualItem?:string;outcome?:ReturnOutcome;documentIds:string[]}
export interface ReceiptReport {statuses:ReceiptStatus[];issues:ReceiptIssue[];documentIds:string[];readable:boolean;notes:string;submittedAt?:string;submittedBy?:string;version:number}
export interface InvoiceCaseLine {id:string;orderId:string;productId:string;name:string;code:string;unit:string;ordered:number;expectedPrice?:number;received?:number;invoiceQuantity?:number;invoicePrice?:number;vatRate?:number;reviewed:boolean;resolution:'PENDING'|'CLAIM'|'ACCEPT'|'HOLD';reason:string}
export interface CaseClaimLine {lineId:string;quantity:number;netPence:number;creditedPence:number;replacementPence:number;reason:string}
export interface InvoiceEmailApproval {fingerprint:string;from:string;fromName:string;replyTo:string;to:string[];cc:string[];subject:string;message:string;attachments:{id:string;name:string;mime:string;size:number;sha256:string}[];approvedAt:string;approvedBy:string;attemptId?:string;startedAt?:string;finishedAt?:string;accepted?:string[];rejected?:string[];confirmation?:{at:string;by:string;notes:string}}
export interface InvoiceClaim {id:string;revision:number;lines:CaseClaimLine[];recipient:string;subject:string;message:string;approvedBy?:string;approvedAt?:string;emailApprovedBy?:string;emailApprovedAt?:string;state:'DRAFT'|'APPROVED'|'SENDING'|'SENT'|'UNCERTAIN';sentAt?:string;messageId?:string;delivery?:InvoiceEmailApproval}
export interface CreditNote {id:string;reference:string;documentId:string;invoiceReference:string;supplierId:string;lines:{lineId:string;netPence:number}[];vatPence:number;grossPence:number;verified:boolean;status:'DRAFT'|'APPROVED';approvedAt?:string;approvedBy?:string}
export interface InvoiceCase {laterReceipts?:LaterReceipt[];laterDeliveryIds?:string[];id:string;version:number;orderIds:string[];branchId:string;branchName:string;supplierId:string;supplierName:string;createdAt:string;updatedAt:string;status:CaseStatus;documents:InvoiceDocument[];receipt:ReceiptReport;lines:InvoiceCaseLine[];invoiceReference:string;invoiceDate:string;invoiceDocumentId:string;invoiceNetPence?:number;invoiceVatPence?:number;invoiceGrossPence?:number;adjustmentPence:number;totalsVerified:boolean;matchingVerified:boolean;notes:string;holdReason:string;holdOwner:string;holdUntil:string;extraction:{state:'IDLE'|'PENDING'|'RUNNING'|'READY'|'NEEDS_REVIEW'|'FAILED';warnings:string[];draft?:unknown;unitReviews?:InvoiceUnitReview[];blankReviews?:InvoiceBlankReview[]};claim?:InvoiceClaim;credits:CreditNote[];replacements:{lineId:string;quantity:number;netPence:number;documentId:string;notes:string;at:string;by:string}[];audit:{at:string;by:string;action:string;details:string}[];requests:string[];approvedAt?:string;approvedBy?:string}
export const caseStatusLabels:Record<CaseStatus,string>={DRAFT:'Staff draft',CHECKING:'Checking invoice',REVIEW:'Needs Accounts review',HOLD:'On hold',CLAIM_DRAFT:'Claim being prepared',WAITING_CREDIT:'Waiting for credit note',CREDIT_REVIEW:'Credit note awaiting approval',CREDIT_APPROVED:'Credit approved · invoice pending',APPROVED:'Invoice approved'};
export const receiptStatusLabels:Record<ReceiptStatus,string>={RECEIVED:'Received — no issues noticed',MISSING:'Missing items',DAMAGED:'Damaged items',INCORRECT:'Incorrect items',OTHER:'Other issue',OUT_OF_STOCK:'Out of stock — supplier confirmed'};
export const returnLabels:Record<ReturnOutcome,string>={DRIVER:'Rejected — taken away by driver',COLLECTION:'Rejected — awaiting collection',KEPT:'Kept on site'};
export function canReviewInvoices(user:OrderScopeUser|null|undefined,roles?:Record<string,string[]>):boolean {
 if(!user?.active)return false;if(user.role==='CREATOR')return true;
 const custom=user.permissionMode==='CUSTOM'||(user.permissionMode!=='INHERITED'&&!!user.customPermissions?.length);
 return (custom?user.customPermissions:roles?.[user.role])?.includes('review_invoices')===true;
}
export function invoiceScope(user:OrderScopeUser,record:Pick<InvoiceCase,'branchId'|'supplierId'>){return hasBranchScope(user,record.branchId)&&hasSupplierScope(user,record.supplierId);}
export function orderCaseLines(order:OrderRecord):InvoiceCaseLine[]{
 const original=[...order.items.map(i=>({id:i.productId,name:i.productNameSnapshot,code:i.itemCodeSnapshot||'',caseQty:i.caseQty,packQty:i.packQty,casePrice:i.casePriceSnapshot,packPrice:i.packPriceSnapshot,caseUnit:i.caseUnitSnapshot||'cases',packUnit:i.packUnitSnapshot||'units',vatRate:i.vatRate})),...(order.manualItems||[]).map(i=>({id:i.id,name:i.description,code:'',caseQty:i.caseQty,packQty:i.packQty,casePrice:i.casePriceSnapshot,packPrice:i.packPriceSnapshot,caseUnit:i.caseUnitSnapshot||'cases',packUnit:i.packUnitSnapshot||'units',vatRate:i.vatRate}))];
 return original.flatMap(i=>(['case','pack'] as const).filter(u=>Number(i[`${u}Qty`])>0).map(u=>({id:`${order.id}:${i.id}:${u}`,orderId:order.id,productId:i.id,name:i.name,code:i.code,unit:i[`${u}Unit`],ordered:i[`${u}Qty`],...(i[`${u}Price`]!=null?{expectedPrice:i[`${u}Price`]}:{}),...(i.vatRate!=null?{vatRate:i.vatRate}:{}),reviewed:false,resolution:'PENDING' as const,reason:''})));
}
export function emptyInvoiceCase(order:OrderRecord,at:string):InvoiceCase{return {id:order.id,version:0,orderIds:[order.id],branchId:order.branchId,branchName:order.branchNameSnapshot,supplierId:order.supplierId,supplierName:order.supplierNameSnapshot,createdAt:at,updatedAt:at,status:'DRAFT',documents:[],receipt:{statuses:[],issues:[],documentIds:[],readable:false,notes:'',version:0},lines:orderCaseLines(order),invoiceReference:'',invoiceDate:'',invoiceDocumentId:'',adjustmentPence:0,totalsVerified:false,matchingVerified:false,notes:'',holdReason:'',holdOwner:'',holdUntil:'',extraction:{state:'IDLE',warnings:[]},credits:[],replacements:[],audit:[],requests:[]};}
export function lineDiscrepancy(record:InvoiceCase,line:InvoiceCaseLine){
 const bad=record.receipt.issues.filter(i=>i.lineId===line.id&&(i.kind==='DAMAGED'||i.kind==='INCORRECT')).reduce((s,i)=>s+(i.quantity||0),0);
 // An explicitly zero billed quantity has no charge; do not invent a missing unit price.
 if(line.received!=null&&line.invoiceQuantity===0)return {known:true,hasDifference:line.received-bad!==0,quantity:0,quantityPence:0,pricePence:0,totalPence:0};
 if(line.received==null||line.invoiceQuantity==null||line.invoicePrice==null||line.expectedPrice==null)return {known:false,hasDifference:false,quantity:0,quantityPence:0,pricePence:0,totalPence:0};
 const usable=Math.max(0,line.received-bad),quantity=Math.max(0,line.invoiceQuantity-usable);
 const quantityPence=Math.round(quantity*line.invoicePrice*100),pricePence=Math.round(Math.min(usable,line.invoiceQuantity)*Math.max(0,line.invoicePrice-line.expectedPrice)*100);
 return {known:true,hasDifference:line.invoiceQuantity!==usable||line.invoicePrice!==line.expectedPrice,quantity,quantityPence,pricePence,totalPence:quantityPence+pricePence};
}
export function invoiceLineNetPence(line:InvoiceCaseLine):number|undefined {
 if(line.invoiceQuantity===0)return 0;
 if(line.invoiceQuantity==null||line.invoicePrice==null)return undefined;
 return Math.round(line.invoiceQuantity*line.invoicePrice*100);
}
export function invoiceCheckFlags(record:InvoiceCase):string[]{
 const flags:string[]=[];
 if(invoiceUnitReviewProblems(record).length)flags.push('Units / price basis need Accounts review');
 if(record.laterReceipts?.some(r=>r.status==='PENDING'))flags.push('Later delivery awaiting review');
 const price=record.lines.filter(l=>l.invoiceQuantity!=null&&l.invoiceQuantity>0&&l.invoicePrice!=null&&l.expectedPrice!=null&&l.invoicePrice!==l.expectedPrice).length;
 const quantity=record.lines.filter(l=>{const bad=record.receipt.issues.filter(i=>i.lineId===l.id&&['DAMAGED','INCORRECT'].includes(i.kind)).reduce((s,i)=>s+(i.quantity||0),0);return l.received!=null&&l.invoiceQuantity!=null&&l.invoiceQuantity!==Math.max(0,l.received-bad);}).length;
 if(price)flags.push(`Price difference: ${price} item${price===1?'':'s'}`);
 if(quantity)flags.push(`Quantity difference: ${quantity} item${quantity===1?'':'s'}`);
 if(record.lines.some(l=>!lineDiscrepancy(record,l).known))flags.push('Invoice figures to check');
 if(record.receipt.issues.some(i=>i.kind==='OUT_OF_STOCK'&&record.lines.find(l=>l.id===i.lineId)?.invoiceQuantity===0))flags.push('Out of stock: not charged');
 return flags;
}
export const outstandingClaim=(record:InvoiceCase)=>record.claim?.lines.reduce((s,l)=>s+l.netPence-l.creditedPence-l.replacementPence,0)||0;
export function invoiceApprovalProblems(record:InvoiceCase):string[]{
 const errors:string[]=[...invoiceUnitReviewProblems(record)];
 if(record.laterReceipts?.some(r=>r.status==='PENDING'))errors.push('Review the submitted later delivery before approving this invoice.');
 if(!record.receipt.submittedAt)errors.push('Staff must submit the delivery report.');
 if(!record.invoiceReference||!record.invoiceDate||!record.documents.some(d=>d.id===record.invoiceDocumentId&&d.kind==='INVOICE'))errors.push('Confirm the invoice, reference and date.');
 if(!record.matchingVerified)errors.push('Confirm supplier, branch, product, unit and duplicate checks.');
 if(!record.totalsVerified||[record.invoiceNetPence,record.invoiceVatPence,record.invoiceGrossPence].some(x=>x==null))errors.push('Check invoice net, VAT and gross totals.');
 else if(record.invoiceNetPence!+record.invoiceVatPence! !==record.invoiceGrossPence)errors.push('Net plus VAT must equal gross.');
 const known=record.lines.every(l=>lineDiscrepancy(record,l).known);
 if(!known)errors.push('Complete receipt, billed quantities and prices; unknown values cannot become zero.');
 if(known&&record.invoiceNetPence!==record.lines.reduce((s,l)=>s+invoiceLineNetPence(l)!,0)+record.adjustmentPence)errors.push('Line totals plus the reviewed charges/discounts must equal invoice net.');
 if(record.lines.some(l=>!l.reviewed||l.resolution==='PENDING'||l.resolution==='HOLD'))errors.push('Review and resolve every item.');
 if(record.receipt.statuses.includes('OTHER')&&!record.notes.trim())errors.push('Record how the other delivery issue was resolved.');
 if(record.lines.some(l=>l.resolution==='CLAIM'&&!record.claim?.lines.some(c=>c.lineId===l.id)))errors.push('A selected claim item has not been included in the claim.');
 if(record.claim&&record.claim.state!=='SENT')errors.push('The claim has not been confirmed sent.');
 if(outstandingClaim(record)>0)errors.push('A credit or replacement balance remains outstanding.');
 if(record.credits.some(c=>c.status==='DRAFT'))errors.push('Review the pending credit note.');
 return [...new Set(errors)];
}
export function filterInvoiceCases(records:InvoiceCase[],filters:{branchId?:string;supplierId?:string;status?:string;search?:string}){const query=filters.search?.trim().toLowerCase()||'';return records.filter(r=>(!filters.branchId||r.branchId===filters.branchId)&&(!filters.supplierId||r.supplierId===filters.supplierId)&&(!filters.status||r.status===filters.status)&&(!query||[r.invoiceReference,...r.orderIds,r.branchName,r.supplierName].join(' ').toLowerCase().includes(query)));}
