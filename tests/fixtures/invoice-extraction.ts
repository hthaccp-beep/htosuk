import {sampleReviewed} from './invoice-workflow.ts';
import type {ExtractedInvoice} from '../../shared/invoice-extraction.ts';
export function extractionCase(){
 const r=sampleReviewed();
 r.receipt.issues=r.receipt.issues.filter(i=>['missing-rice','damaged-soy'].includes(i.id));
 r.lines=r.lines.map((l,i)=>({...l,code:['R001','N002','S003','M004','G005'][i],received:l.ordered-(i===0?2:0),invoiceQuantity:undefined,invoicePrice:undefined,reviewed:false,resolution:'PENDING' as const,reason:''}));
 r.invoiceReference='';r.invoiceDate='';r.invoiceDocumentId='';r.invoiceNetPence=undefined;r.invoiceVatPence=undefined;r.invoiceGrossPence=undefined;r.matchingVerified=false;r.totalsVerified=false;
 return r;
}
export function extractionFixture():ExtractedInvoice {
 const r=extractionCase();
 return {documentType:'INVOICE',reference:'SAMPLE-AI-001',date:'2026-11-11',supplier:r.supplierName,branch:r.branchName,orderReferences:r.orderIds,currency:'GBP',priceBasis:'NET',
  rows:r.lines.map((l,i)=>({page:1,row:i+1,code:l.code,description:l.name,unit:l.unit,quantity:l.ordered,unitPrice:l.expectedPrice!+(i===0?1:0),netAmount:l.ordered*(l.expectedPrice!+(i===0?1:0)),vatRate:0,orderReference:r.id,uncertain:[]})),
  net:482,vat:0,gross:482,adjustment:null,warnings:[]};
}
