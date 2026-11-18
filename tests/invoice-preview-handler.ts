import {applyInvoiceCommand,InvoiceCaseError} from '../server/invoice-case-validation.ts';
import {attachInvoiceExtraction,type ExtractedInvoice} from '../shared/invoice-extraction.ts';
import {emptyInvoiceCase,filterInvoiceCases,type DocumentKind,type InvoiceCase} from '../shared/invoice-case.ts';
import {invoiceReceiptSummary} from '../shared/invoice-receipt-summary.ts';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {itemReviewSample} from './fixtures/invoice-item-review.ts';
import {sampleDraft,sampleOrder,sampleOutOfStock,sampleOwner,sampleReceivedPriceDifference,sampleReviewed,sampleStaff} from './fixtures/invoice-workflow.ts';
import {replacementCases,replacementDraft} from './fixtures/later-deliveries.ts';
import type {LaterDelivery} from '../shared/later-delivery.ts';
import type {OrderRecord} from '../types.ts';

function renderSampleInvoicePng(record:InvoiceCase):string {
 const canvas=document.createElement('canvas');
 canvas.width=720;canvas.height=880;
 const ctx=canvas.getContext('2d');
 if(!ctx)return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle='#243b22';ctx.lineWidth=3;ctx.strokeRect(20,20,680,840);
 ctx.fillStyle='#243b22';ctx.font='bold 24px sans-serif';
 ctx.fillText('SYNTHETIC SAMPLE INVOICE (OFFLINE PREVIEW)',44,68);
 ctx.fillStyle='#333333';ctx.font='16px sans-serif';
 ctx.fillText(`Supplier: ${record.supplierName}`,44,106);
 ctx.fillText(`Branch: ${record.branchName}`,44,132);
 ctx.fillText(`Order ID: ${record.orderIds.join(', ')}`,44,158);
 ctx.fillText(`Invoice Ref: ${record.invoiceReference||'SAMPLE-AI-001'}   Date: ${record.invoiceDate||'2026-11-11'}`,44,184);
 ctx.strokeStyle='#cccccc';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(44,205);ctx.lineTo(676,205);ctx.stroke();
 ctx.font='bold 14px sans-serif';
 ctx.fillText('Code / Description',44,230);ctx.fillText('Qty',420,230);ctx.fillText('Unit Price',500,230);ctx.fillText('Net',610,230);
 let y=262;ctx.font='14px sans-serif';
 record.lines.forEach((l,i)=>{
  const q=l.invoiceQuantity??l.ordered;
  const p=l.invoicePrice??(l.expectedPrice!=null?l.expectedPrice+(i===0?1:0):0);
  const net=(q*p).toFixed(2);
  ctx.fillText(`${l.code||['R001','N002','S003','M004','G005'][i]||'ITEM'} - ${l.name}`.slice(0,44),44,y);
  ctx.fillText(`${q} ${l.unit}`,420,y);
  ctx.fillText(`£${p.toFixed(2)}`,500,y);
  ctx.fillText(`£${net}`,610,y);
  y+=34;
 });
 ctx.beginPath();ctx.moveTo(44,y+10);ctx.lineTo(676,y+10);ctx.stroke();
 ctx.font='bold 16px sans-serif';
 const totalNet=(record.invoiceNetPence!=null?record.invoiceNetPence/100:482).toFixed(2);
 ctx.fillText(`Payable Net: £${totalNet}   VAT: £0.00   Gross: £${totalNet}`,44,y+44);
 ctx.fillStyle='#8a5300';ctx.font='13px sans-serif';
 ctx.fillText('Fictional sample document generated locally for preview testing only.',44,825);
 return canvas.toDataURL('image/png').split(',')[1]||'';
}

function makeRichExtractionCase():InvoiceCase {
 const base=extractionCase();
 base.id='DEMO-ORDER-002';
 base.orderIds=['DEMO-ORDER-002'];
 base.documents=[{...base.documents[0],id:'sample-invoice-DEMO-ORDER-002',name:'SAMPLE-AI-invoice.png',mime:'image/png'}];
 base.lines=base.lines.map(l=>({...l,orderId:'DEMO-ORDER-002'}));
 const fx=extractionFixture();
 fx.reference='SAMPLE-AI-002';
 fx.rows=fx.rows.map((r,i)=>{
  if(i===0)return {...r,orderReference:'DEMO-ORDER-002',unitPrice:(base.lines[0].expectedPrice||18)+1,netAmount:base.lines[0].ordered*((base.lines[0].expectedPrice||18)+1)};
  if(i===1)return {...r,orderReference:'DEMO-ORDER-002',code:'N002',description:'Fresh Shanghai noodles (supplier wording)',unit:'cases'};
  return {...r,orderReference:'DEMO-ORDER-002'};
 });
 fx.rows.push({page:1,row:6,code:'EXTRA-99',description:'Mystery Truffle Oil (Not on order — check if unauthorised)',unit:'bottles',quantity:1,unitPrice:24,netAmount:24,vatRate:0,orderReference:'DEMO-ORDER-002',uncertain:[]});
 fx.net=fx.rows.reduce((s,r)=>s+(r.netAmount||0),0);
 fx.gross=fx.net;
 return attachInvoiceExtraction(base,base.documents[0].id,fx);
}

function makeUnreadExtractionCase():InvoiceCase {
 const base=extractionCase();
 base.id='DEMO-ORDER-003';
 base.orderIds=['DEMO-ORDER-003'];
 base.documents=[{...base.documents[0],id:'sample-invoice-DEMO-ORDER-003',name:'SAMPLE-unread-invoice.png',mime:'image/png'}];
 base.lines=base.lines.map(l=>({...l,orderId:'DEMO-ORDER-003'}));
 return base;
}

function makeCreditedSample():InvoiceCase {
 const now=new Date().toISOString();
 const r=sampleReviewed('DEMO-ORDER-004');
 r.invoiceReference='DEMO-INV-004';
 r.documents.push({id:'sample-credit-doc-004',kind:'CREDIT',name:'SAMPLE-credit-CR-DEMO-004.png',mime:'image/png',size:420,sha256:'sample-credit-004',uploadedAt:now,uploadedBy:sampleOwner.id});
 r.claim={
  id:'sample-claim-004',revision:1,state:'SENT',recipient:'supplier@example.invalid',
  subject:'Credit request — DEMO-INV-004',message:'Please issue credit for missing and damaged goods.',
  sentAt:now,
  lines:[
   {lineId:r.lines[0].id,quantity:2,netPence:3800,creditedPence:3800,replacementPence:0,reason:'Two missing bags credited'},
   {lineId:r.lines[1].id,quantity:1,netPence:2000,creditedPence:0,replacementPence:0,reason:'One missing case awaiting supplier credit'}
  ]
 };
 r.credits=[{
  id:'sample-credit-004',reference:'CR-DEMO-004',documentId:'sample-credit-doc-004',
  invoiceReference:'DEMO-INV-004',supplierId:r.supplierId,
  lines:[{lineId:r.lines[0].id,netPence:3800}],vatPence:0,grossPence:3800,
  verified:true,status:'APPROVED',approvedAt:now,approvedBy:'Sample Accounts'
 }];
 r.status='WAITING_CREDIT';
 return r;
}

export function createInvoicePreviewService(options:{getOrders:()=>OrderRecord[];isStaff:()=>boolean;roles:Record<string,string[]>}){
 const rep=replacementCases();
 const later=replacementDraft(rep);
 const initial:InvoiceCase[]=[
  makeRichExtractionCase(),
  sampleReviewed('DEMO-ORDER-001'),
  makeUnreadExtractionCase(),
  itemReviewSample(),
  makeCreditedSample(),
  sampleOutOfStock(),
  sampleReceivedPriceDifference(),
  ...Object.values(rep),
  {...sampleDraft('DEMO-ORDER-DRAFT'),status:'DRAFT'},
 ];
 const cases=new Map<string,InvoiceCase>(initial.map(c=>[c.id,structuredClone(c)]));
 const resolvedExtraRows=new Map<string,Set<string>>();
 const docBlobs=new Map<string,{name:string;mime:string;base64:string}>();
 const laterEvents=new Map<string,LaterDelivery[]>([[later.hostCaseId,[later]]]);
 const previewOrders:OrderRecord[]=initial.map(c=>({...sampleOrder,id:c.id,createdAt:c.createdAt,deliveryDate:'2026-11-12',items:sampleOrder.items}));

 const ensureCase=(orderId:string)=>{
  const existing=cases.get(orderId);
  if(existing)return structuredClone(existing);
  const order=options.getOrders().find(o=>o.id===orderId)||previewOrders.find(o=>o.id===orderId);
  if(!order)throw new InvoiceCaseError('Order not found in synthetic preview.',404);
  const created=emptyInvoiceCase(order,new Date().toISOString());
  cases.set(orderId,created);
  return structuredClone(created);
 };

 const actor=()=>options.isStaff()
  ?{...sampleStaff,displayName:'Sample Staff',active:true,role:'STAFF',branchIds:['sample-putney','qa-b'],supplierIds:['sample-foods','qa-s']}
  :{...sampleOwner,active:true,role:'CREATOR',allBranches:true,allSuppliers:true};

 return {
  previewOrders,
  async handle(body:any){
   const action=String(body?.action||'');
   if(action==='invoice-case-receipt-summaries'){
    const ids:string[]=Array.isArray(body.orderIds)?body.orderIds:[];
    return {summaries:ids.map(id=>invoiceReceiptSummary(id,cases.get(id)))};
   }
   if(action==='invoice-case-list'){
    const list=[...cases.values()].filter(c=>c.status!=='DRAFT').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const filtered=filterInvoiceCases(list,{branchId:body.branchId,supplierId:body.supplierId,status:body.status});
    return {records:structuredClone(filtered),cursor:null,more:false};
   }
   const caseId=String(body.caseId||body.orderId||'');
   if(action==='invoice-case-get'){
    return {record:ensureCase(caseId)};
   }
   if(action==='invoice-case-command'){
    const current=ensureCase(caseId);
    const cmd=body.command||{};
    if(cmd.kind==='save-review'&&Array.isArray(cmd.previewResolvedExtras)){
     resolvedExtraRows.set(caseId,new Set(cmd.previewResolvedExtras.map(String)));
    }
    const nowIso=new Date().toISOString();
    try{
     const next=applyInvoiceCommand(current,cmd,actor(),options.roles,nowIso);
     cases.set(next.id,next);
     return {record:structuredClone(next)};
    }catch(err:any){
     const extras=resolvedExtraRows.get(caseId);
     const msg=String(err?.message||'');
     const canBypassPreviewExtra=
      (cmd.kind==='prepare-claim'||cmd.kind==='approve-invoice')&&
      extras&&extras.size>0&&
      msg.includes('Confirm units and price basis');
     if(!canBypassPreviewExtra)throw err;
     const savedDraft=current.extraction.draft;
     const stripped=structuredClone(current);
     delete stripped.extraction.draft;
     const applied=applyInvoiceCommand(stripped,cmd,actor(),options.roles,nowIso);
     applied.extraction.draft=savedDraft;
     cases.set(applied.id,applied);
     return {record:structuredClone(applied)};
    }
   }
   if(action==='invoice-case-upload'){
    const current=ensureCase(caseId);
    if(body.expectedVersion!=null&&body.expectedVersion!==current.version)throw new InvoiceCaseError('This record changed. Reload it before uploading.',409);
    const docId='sample-doc-'+crypto.randomUUID().slice(0,8);
    const kind=(body.kind||'INVOICE') as DocumentKind;
    const base64=String(body.base64||'');
    docBlobs.set(docId,{name:String(body.name||'document'),mime:String(body.mime||'image/png'),base64});
    current.documents.push({id:docId,kind,name:String(body.name||'document'),mime:String(body.mime||'image/png'),size:Math.round(base64.length*0.75),sha256:'synthetic-'+docId,lineId:body.lineId,uploadedAt:new Date().toISOString(),uploadedBy:actor().id});
    current.version++;
    current.updatedAt=new Date().toISOString();
    cases.set(current.id,current);
    return {documentId:docId,record:structuredClone(current)};
   }
   if(action==='invoice-case-document'){
    const current=ensureCase(caseId);
    const stored=docBlobs.get(String(body.documentId||''));
    if(stored)return stored;
    const meta=current.documents.find(d=>d.id===body.documentId);
    return {name:(meta?.name||'SAMPLE-invoice').replace(/\.pdf$/i,'.png'),mime:'image/png',base64:renderSampleInvoicePng(current)};
   }
   if(action==='invoice-case-reading-status'||action==='invoice-case-reading-recover'){
    const current=ensureCase(caseId);
    return {state:'IDLE',canRead:true,canRecover:false,enabled:true,prepared:true,canPrepare:false,preparationRequired:false,record:structuredClone(current)};
   }
   if(action==='invoice-case-read'){
    const current=ensureCase(caseId);
    const docId=String(body.documentId||current.documents.find(d=>['INVOICE','DELIVERY'].includes(d.kind))?.id||'');
    const fx:ExtractedInvoice={
     ...extractionFixture(),
     reference:'SAMPLE-AI-'+current.id.slice(-3),
     orderReferences:current.orderIds,
     rows:current.lines.map((l,i)=>({
      page:1,row:i+1,code:l.code||['R001','N002','S003','M004','G005'][i]||null,
      description:i===1?`${l.name} (supplier wording)`:l.name,
      unit:l.unit,quantity:l.ordered,
      unitPrice:l.expectedPrice!=null?l.expectedPrice+(i===0?1:0):null,
      netAmount:l.expectedPrice!=null?l.ordered*(l.expectedPrice+(i===0?1:0)):null,
      vatRate:0,orderReference:current.id,uncertain:[]
     }))
    };
    fx.rows.push({page:1,row:fx.rows.length+1,code:'EXTRA-99',description:'Extra unrequested item (verify if authorised)',unit:'box',quantity:1,unitPrice:19.5,netAmount:19.5,vatRate:0,orderReference:current.id,uncertain:[]});
    fx.net=fx.rows.reduce((s,r)=>s+(r.netAmount||0),0);
    fx.gross=fx.net;
    const updated=attachInvoiceExtraction(current,docId,fx);
    cases.set(updated.id,updated);
    return {record:structuredClone(updated)};
   }
   if(action==='invoice-case-preparation-status'){
    return {prepared:true,canPrepare:false};
   }
   if(action==='invoice-case-email-preview'){
    const current=ensureCase(caseId);
    return {
     ready:true,
     preview:{
      fingerprint:'synthetic-fp-'+current.version,
      from:'accounts@example.invalid',fromName:'HTOS Accounts (Sample)',replyTo:'accounts@example.invalid',
      to:[String(body.recipient||'supplier@example.invalid')],cc:['accounts@example.invalid'],
      subject:current.claim?.subject||`Credit request — ${current.invoiceReference}`,
      message:String(body.message||current.claim?.message||''),
      attachments:current.documents.map(d=>({id:d.id,name:d.name,mime:d.mime,size:d.size,sha256:d.sha256})),
      approvedAt:'',approvedBy:''
     }
    };
   }
   if(action==='invoice-case-email-approve'){
    const current=ensureCase(caseId);
    if(!current.claim)throw new InvoiceCaseError('Approve the claim first.');
    current.claim.recipient=String(body.recipient||'supplier@example.invalid');
    current.claim.message=String(body.message||current.claim.message);
    current.claim.delivery={
     fingerprint:String(body.fingerprint||'synthetic-fp'),
     from:'accounts@example.invalid',fromName:'HTOS Accounts (Sample)',replyTo:'accounts@example.invalid',
     to:[current.claim.recipient],cc:['accounts@example.invalid'],
     subject:current.claim.subject,message:current.claim.message,
     attachments:[],approvedAt:new Date().toISOString(),approvedBy:actor().displayName||'Sample Accounts'
    };
    current.version++;
    cases.set(current.id,current);
    return {record:structuredClone(current)};
   }
   if(action==='invoice-case-email-send'||action==='invoice-case-email-reconcile'){
    const current=ensureCase(caseId);
    if(!current.claim)throw new InvoiceCaseError('Approve the email first.');
    current.claim.state='SENT';
    current.claim.sentAt=new Date().toISOString();
    current.status='WAITING_CREDIT';
    current.version++;
    current.audit.push({at:new Date().toISOString(),by:actor().id,action,details:'Simulated email delivery in offline preview (no email sent).'});
    cases.set(current.id,current);
    return {record:structuredClone(current)};
   }
   if(action==='invoice-case-later-list'){
    return {events:structuredClone(laterEvents.get(caseId)||[])};
   }
   if(action==='invoice-case-later-options'){
    return {records:[...cases.values()].map(c=>structuredClone(c)),more:false,cursor:null};
   }
   return null;
  }
 };
}
