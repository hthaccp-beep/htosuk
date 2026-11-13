import {emptyInvoiceCase,type InvoiceCase} from '../../shared/invoice-case.ts';
export const sampleOwner={id:'sample-owner',active:true,role:'CREATOR',displayName:'Sample Accounts'};
export const sampleStaff={id:'sample-staff',active:true,role:'STAFF',branchIds:['sample-putney'],supplierIds:['sample-foods'],permissionMode:'CUSTOM',customPermissions:['scan_invoices']};
export const sampleOrder:any={id:'DEMO-ORDER-001',status:'PLACED',branchId:'sample-putney',branchNameSnapshot:'Putney (sample)',supplierId:'sample-foods',supplierNameSnapshot:'Example Foods (sample)',manualItems:[],items:[{productId:'rice',productNameSnapshot:'Sample rice',caseQty:10,packQty:0,caseUnitSnapshot:'bags',casePriceSnapshot:18,vatRate:0},{productId:'noodles',productNameSnapshot:'Sample noodles',caseQty:8,packQty:0,caseUnitSnapshot:'cases',casePriceSnapshot:20,vatRate:0},{productId:'soy',productNameSnapshot:'Sample soy sauce',caseQty:6,packQty:0,caseUnitSnapshot:'cases',casePriceSnapshot:12,vatRate:0},{productId:'mayo',productNameSnapshot:'Sample mayonnaise',caseQty:12,packQty:0,caseUnitSnapshot:'packs',casePriceSnapshot:3.75,vatRate:0},{productId:'ginger',productNameSnapshot:'Sample ginger',caseQty:3,packQty:0,caseUnitSnapshot:'bags',casePriceSnapshot:5,vatRate:0}]};
export function sampleDraft(id=sampleOrder.id):InvoiceCase{
 const r=emptyInvoiceCase({...sampleOrder,id},'2026-11-10T12:00:00.000Z');
 r.documents=[{id:'sample-invoice-'+id,name:'SAMPLE-invoice.pdf',kind:'INVOICE',mime:'application/pdf',size:100,sha256:'synthetic-preview-only',uploadedAt:r.createdAt,uploadedBy:sampleStaff.id}];
 r.receipt={statuses:['MISSING','DAMAGED'],issues:[{id:'missing-rice',kind:'MISSING',lineId:r.lines[0].id,quantity:2,notes:'Two bags did not arrive.',documentIds:[]},{id:'missing-noodles',kind:'MISSING',lineId:r.lines[1].id,quantity:1,notes:'One case did not arrive.',documentIds:[]},{id:'damaged-soy',kind:'DAMAGED',lineId:r.lines[2].id,quantity:1,notes:'Broken bottles in one case.',outcome:'DRIVER',documentIds:[]},{id:'damaged-mayo',kind:'DAMAGED',lineId:r.lines[3].id,quantity:2,notes:'Two leaking packs; stored for collection.',outcome:'COLLECTION',documentIds:[]}],documentIds:[r.documents[0].id],readable:true,notes:'Fictional training example. No real invoice or delivery data.',version:0};return r;
}
export function sampleReviewed(id=sampleOrder.id):InvoiceCase{
 const r=sampleDraft(id);r.version=1;r.receipt.submittedAt=r.createdAt;r.receipt.submittedBy=sampleStaff.id;r.status='REVIEW';
 r.lines=r.lines.map((l,i)=>({...l,received:l.ordered-(i===0?2:i===1?1:0),invoiceQuantity:l.ordered,invoicePrice:l.expectedPrice!+(i===0?1:0),reviewed:true,resolution:i<4?'CLAIM':'ACCEPT',reason:i===0?'Missing two bags and unit price £1 above saved order.':i===1?'One case missing.':i<4?'Damaged items reported by staff.':'Matched to the original.'}));
 r.invoiceReference='DEMO-INV-001';r.invoiceDate='2026-11-10';r.invoiceDocumentId=r.documents[0].id;r.invoiceNetPence=48200;r.invoiceVatPence=0;r.invoiceGrossPence=48200;r.totalsVerified=true;r.matchingVerified=true;r.extraction={state:'NEEDS_REVIEW',warnings:['Synthetic sample figures loaded for this offline walkthrough. VAT is explicitly zero for this fictional example; real invoices require their actual VAT.']};return r;
}
export function sampleOutOfStock():InvoiceCase {
 const r=sampleReviewed('DEMO-ORDER-005');r.invoiceReference='DEMO-INV-005';
 r.receipt.statuses.push('OUT_OF_STOCK');r.receipt.issues.push({id:'ginger-out-of-stock',kind:'OUT_OF_STOCK',lineId:r.lines[4].id,quantity:3,notes:'Supplier confirmed out of stock; invoice supplied quantity is 0.',documentIds:[]});
 r.lines[4]={...r.lines[4],received:0,invoiceQuantity:0,invoicePrice:undefined,resolution:'ACCEPT',reason:'Supplier confirmed no stock and no charge.'};r.invoiceNetPence=46700;r.invoiceGrossPence=46700;return r;
}
export function sampleReceivedPriceDifference():InvoiceCase {
 const r=sampleReviewed('DEMO-ORDER-006');r.invoiceReference='DEMO-INV-006';r.receipt.statuses=['RECEIVED'];r.receipt.issues=[];r.receipt.notes='Staff counted the delivery and noticed no issues. Invoice prices still need checking.';
 r.lines=r.lines.map(l=>({...l,received:l.ordered,reviewed:false,resolution:'PENDING',reason:''}));r.matchingVerified=false;r.totalsVerified=false;return r;
}
