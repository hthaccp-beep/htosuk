import {extractionCase,extractionFixture} from './invoice-extraction.ts';
import type {InvoiceSectionBundle} from '../../shared/invoice-section-extraction.ts';
/** Fictional reading evidence only. No supplier photographs, live orders or API keys. */
export function sectionSample(received=false,warnedBlank=false){
 const record=extractionCase(),id=received?'DEMO-READ-002':'DEMO-READ-001';
 record.id=id;record.orderIds=[id];record.lines=record.lines.map(l=>({...l,id:l.id.replace('DEMO-ORDER-001',id),orderId:id}));
 record.receipt.issues=record.receipt.issues.map(i=>({...i,lineId:i.lineId?.replace('DEMO-ORDER-001',id)}));
 Object.assign(record.lines[4],{name:'Sample prawns',code:'P005',unit:'packs',ordered:2,received:2,expectedPrice:40});
 record.documents=[{...record.documents[0],id:'sample-sections-'+id,sha256:'a'.repeat(64),name:'SAMPLE-section-reading.pdf'}];record.receipt.documentIds=[record.documents[0].id];
 if(received){record.receipt.statuses=['RECEIVED'];record.receipt.issues=[];record.lines.forEach(l=>l.received=l.ordered);}
 const initial=extractionFixture();
 const rows=record.lines.map((l,i)=>({...initial.rows[i],description:l.name,code:l.code,unit:i===4?null:l.unit,quantity:l.ordered,unitPrice:l.expectedPrice!+(i===0?1:0),netAmount:l.ordered*(l.expectedPrice!+(i===0?1:0)),orderReference:id,weightQuantity:i===4?2:null,weightUnit:i===4?'kg':null,priceUnit:null}));
 const blank={...rows[0],code:null,description:'Sample lemon',unit:null,quantity:null,unitPrice:null,netAmount:null,weightQuantity:null,weightUnit:null,orderReference:null};
 if(warnedBlank){blank.vatRate=null;blank.uncertain=['Blank product row; printed cells are blank'];}
 const bundle:InvoiceSectionBundle={schemaVersion:1,documentHash:record.documents[0].sha256,plan:[{id:'header',kind:'header',page:1},{id:'items-1',kind:'rows',page:1},{id:'items-2',kind:'rows',page:1},{id:'totals',kind:'totals',page:1}],results:[
  {id:'header',data:{documentType:'INVOICE',reference:id+'-INV',date:'11/11/2026',supplier:record.supplierName,customerName:record.branchName,branch:record.branchName,branchEvidence:'Deliver to '+record.branchName,orderReferences:[id],priceBasis:'NET',layout:'TABLE',warnings:[]}},
  {id:'items-1',data:{rows:[...rows.slice(0,2),blank],warnings:[]}},
  {id:'items-2',data:{rows:rows.slice(2),warnings:[]}},
  {id:'totals',data:{net:547,vat:0,gross:547,currency:'GBP',warnings:[]}}
 ]};return {record,bundle};
}
