import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {preparedImageInfo} from '../shared/prepared-image.ts';
import {encodePreparedCanvas} from '../app/htos/preparedImageEncoding.ts';
import {validatePreparedInvoiceJob} from '../server/invoice-section-jobs.ts';
import {invoiceSectionProvider} from '../server/invoice-section-provider.ts';
import {parseInvoiceFilters,loadInvoiceFilters,saveInvoiceFilters} from '../shared/invoice-filter-state.ts';
import {filterInvoiceCases} from '../shared/invoice-case.ts';
import {invoiceReceiptSummary,uploadSummaryLabel} from '../shared/invoice-receipt-summary.ts';
import {sampleDraft} from './fixtures/invoice-workflow.ts';
// Bounded marker fixture exercises header validation; real browser encoders are tested separately.
const jpeg=()=>Buffer.from([255,216,255,224,0,4,0,0,255,192,0,17,8,0,64,0,80,3,1,17,0,2,17,0,3,17,0,255,218,0,2,0,255,217]);
test('JPEG dimensions are verified; truncated and foreign bytes are rejected',()=>{
 assert.deepEqual(preparedImageInfo(jpeg()),{mime:'image/jpeg',width:80,height:64});
 for(const b of [jpeg().subarray(0,-1),Buffer.from('<html>not an invoice</html>'),Buffer.alloc(35)])assert.throws(()=>preparedImageInfo(b));
 const broken=jpeg();broken[10]=255;assert.throws(()=>preparedImageInfo(broken));
});
test('large PNG falls back to bounded JPEG without changing pixel dimensions',()=>{
 const calls:any[]=[];const result=encodePreparedCanvas({toDataURL:(mime,quality)=>{calls.push([mime,quality]);return 'data:'+mime+';base64,'+Buffer.alloc(mime==='image/png'?5000:500).toString('base64');}},1024);
 assert.equal(result.mime,'image/jpeg');assert.equal(result.bytes.length,500);assert.deepEqual(calls,[['image/png',undefined],['image/jpeg',.92]]);
 assert.throws(()=>encodePreparedCanvas({toDataURL:mime=>'data:'+mime+';base64,'+Buffer.alloc(5000).toString('base64')},1024),/original is saved/);
});
test('JPEG job validation retains hash, dimensions and byte limits',async()=>{
 const bytes=jpeg(),sha256=createHash('sha256').update(bytes).digest('hex');
 const plan={documentHash:'a'.repeat(64),revision:'photo-sections-v1',confirmed:true,sections:(['header','rows','totals'] as const).map(kind=>({id:kind,kind,page:1,sha256,base64:bytes.toString('base64'),width:80,height:64,reservePence:60}))};
 await validatePreparedInvoiceJob(plan);
 await assert.rejects(()=>validatePreparedInvoiceJob({...plan,sections:plan.sections.map(s=>({...s,width:90}))}),/dimensions/);
 await assert.rejects(()=>validatePreparedInvoiceJob({...plan,sections:plan.sections.map(s=>({...s,sha256:'b'.repeat(64)}))}),/integrity/);
});
test('provider sends JPEG with correct MIME through mocked transport only',async()=>{
 const bytes=jpeg(),reader=invoiceSectionProvider({apiKey:'sk-offline-placeholder',fetch:async(url,init)=>{
  const body=JSON.parse(String(init?.body));assert.match(body.input[0].content[1].image_url,/^data:image\/jpeg;base64,/);assert.equal(body.store,false);
  return new Response(JSON.stringify({status:'completed',id:'offline',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({net:10,vat:0,gross:10,currency:'GBP',netBeforeAdjustment:null,adjustment:null,warnings:[]})}]}]}));
 }});
 const result=await reader({id:'totals',kind:'totals',page:1,width:80,height:64,base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),reservePence:60},'offline');assert.equal(result.chargePence,1);
});
test('filters intersect branch, supplier, status and search',()=>{
 const a=sampleDraft(),b={...a,id:'b',supplierId:'supplier-b'},c={...a,id:'c',branchId:'branch-c'};
 assert.deepEqual(filterInvoiceCases([a,b,c],{branchId:a.branchId,supplierId:a.supplierId,status:a.status,search:a.supplierName}).map(r=>r.id),[a.id]);
 assert.equal(filterInvoiceCases([a],{status:'APPROVED'}).length,0);
 assert.deepEqual(parseInvoiceFilters('invalid'),{branchId:'',supplierId:'',status:'',search:''});
 const map=new Map();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>map.get(k),setItem:(k:string,v:string)=>map.set(k,v)}});
 const saved={branchId:a.branchId,supplierId:a.supplierId,status:'REVIEW',search:'invoice'};saveInvoiceFilters('owner',saved);assert.deepEqual(loadInvoiceFilters('owner'),saved);assert.equal(loadInvoiceFilters('staff').branchId,'');delete (globalThis as any).sessionStorage;
});
test('saved upload and submission indicators never imply invoice approval',()=>{
 const r=sampleDraft(),summary=invoiceReceiptSummary(r.id,r);assert.equal(summary.documents,r.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind)).length);assert.equal(uploadSummaryLabel({...summary,documents:1}),'Uploaded · report to submit');
 assert.equal(uploadSummaryLabel({...summary,receipt:'SUBMITTED',status:'REVIEW'}),'Waiting for review');assert.equal(uploadSummaryLabel(undefined),'Status unavailable');
 assert.ok(!('lines' in summary));assert.ok(!('documentsData' in summary));
});
