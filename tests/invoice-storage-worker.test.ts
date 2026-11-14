import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {invoiceCaseAction} from '../server/invoice-case-service.ts';
import {storedInvoiceReader,configuredInvoiceReader} from '../server/invoice-reader-connection.ts';
import {invoiceReadJobId} from '../server/invoice-case-reader.ts';
import {loadStoredInvoicePreparation} from '../server/invoice-preparation-storage.ts';
import {preparationManifest,uploadInvoicePreparation} from '../shared/invoice-preparation.ts';
import type {PreparedInvoiceJob} from '../server/invoice-section-jobs.ts';
import {invoiceMemoryStore} from './fixtures/invoice-memory-store.ts';
import {sectionSample} from './fixtures/invoice-sections.ts';
import {sampleOwner,sampleStaff} from './fixtures/invoice-workflow.ts';
import readingHandler from '../api/admin/invoice-reading.ts';
import {invoiceEmailAction} from '../server/invoice-case-email.ts';
import {invoiceApprovalProblems,outstandingClaim} from '../shared/invoice-case.ts';

function png(){
 const crc=(b:Buffer)=>{let c=0xffffffff;for(const v of b){c^=v;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
 const chunk=(type:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(type),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(body));return Buffer.concat([head,body,tail]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64,0);ihdr.writeUInt32BE(64,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((64*3+1)*64))),chunk('IEND',Buffer.alloc(0))]);
}
async function setup(warnedBlank=false){
 const {record,bundle}=sectionSample(false,warnedBlank);record.documents=[];
 let memory=invoiceMemoryStore([['_invoice_cases/'+record.id,record],['users/'+sampleOwner.id,sampleOwner],['users/'+sampleStaff.id,sampleStaff],['settings/role_permissions',{map:{}}],['_invoice_read_jobs/budget-offline',{approved:true,capPence:500,allocatedPence:0}]]);
 const calls:string[]=[],reader=async(s:any)=>{calls.push(s.id);return {data:bundle.results.find(r=>r.id===s.id)!.data,chargePence:1,usage:{inputTokens:10,outputTokens:10,estimatedUsd:.0001}};};
 const call=(body:any,uid=sampleOwner.id,enabled=true)=>invoiceCaseAction(memory.db,uid,{caseId:record.id,...body},enabled,storedInvoiceReader(memory.db,'offline',reader));
 const bytes=png(),base64=bytes.toString('base64'),hash=createHash('sha256').update(bytes).digest('hex');
 const upload=await call({action:'invoice-case-upload',expectedVersion:record.version,kind:'INVOICE',name:'SAMPLE.png',mime:'image/png',base64});
 const identity={caseId:record.id,documentId:upload.documentId,expectedVersion:upload.record.version};
 const plan:PreparedInvoiceJob={documentHash:hash,confirmed:true,revision:'photo-sections-v1',sections:bundle.plan.map(s=>({...s,width:64,height:64,sha256:hash,base64,reservePence:1}))};
 return {call,identity,plan,record,base64,calls,get:()=>memory,reopen:()=>{memory=invoiceMemoryStore(memory.data);}};
}

test('full saved workflow: staff issues, prepared photo, reading, unit review, claim, email, credit and final approval',async()=>{
 const f=await setup(true),mem=f.get(),key='_invoice_cases/'+f.record.id;
 let r=mem.data.get(key);delete r.receipt.submittedAt;delete r.receipt.submittedBy;r.status='DRAFT';r.receipt.documentIds=[f.identity.documentId];r.lines.forEach((l:any)=>delete l.received);
 const evidence=await f.call({action:'invoice-case-upload',expectedVersion:r.version,kind:'EVIDENCE',name:'SAMPLE-damage.png',mime:'image/png',base64:f.base64,lineId:r.lines[2].id},sampleStaff.id);
 r=mem.data.get(key);r.receipt.issues.find((i:any)=>i.kind==='DAMAGED').documentIds=[evidence.documentId];
 const original=structuredClone(mem.data.get('_invoice_case_documents/'+f.identity.documentId)),originalPrices=r.lines.map((l:any)=>l.expectedPrice);
 const command=async(kind:string,payload:any={},user=sampleOwner.id)=>f.call({action:'invoice-case-command',command:{kind,requestId:crypto.randomUUID(),expectedVersion:mem.data.get(key).version,...payload}},user);
 const submitted=await command('submit-receipt',{receipt:r.receipt},sampleStaff.id);assert.equal(submitted.record.lines[0].expectedPrice,undefined);
 await assert.rejects(()=>command('submit-receipt',{receipt:r.receipt},sampleStaff.id),/submitted/);
 f.identity.expectedVersion=mem.data.get(key).version;
 await uploadInvoicePreparation(f.call,f.identity,f.plan);
 for(let i=0;i<4;i++)await f.call({action:'invoice-case-read',...f.identity,documentIds:[f.identity.documentId]});
 await assert.rejects(()=>command('use-extraction'),/No unambiguous/);
 const beforeBlank=structuredClone(mem.data.get(key).extraction.draft.extracted);
 await command('confirm-blank-row',{page:1,row:3,confirmed:true,reason:'Checked the original: Lemon has no quantity, price or charge.'});
 assert.deepEqual(mem.data.get(key).extraction.draft.extracted,beforeBlank);
 await command('use-extraction');await assert.rejects(()=>command('approve-invoice'),/units and price basis/);
 await command('confirm-reading-units',{page:1,row:6,lineId:mem.data.get(key).lines[4].id,quantity:2,unitPrice:40,reason:'Fictional pack specification confirms two packs at GBP 40 per pack.'});
 r=mem.data.get(key);const review={...r,lines:r.lines.map((l:any,i:number)=>({...l,reviewed:true,resolution:[0,2].includes(i)?'CLAIM':'ACCEPT',reason:[0,2].includes(i)?'Missing or damaged items and agreed-price difference.':'Checked against original.'})),matchingVerified:true,totalsVerified:true};
 await command('save-review',review);await command('prepare-claim');await command('approve-claim');assert.equal(outstandingClaim(mem.data.get(key)),5800);
 mem.data.set('branches/sample-putney',{active:true,name:'Sample branch',email:'branch@example.test'});mem.data.set('suppliers/sample-foods',{active:true,email:'supplier@example.test'});
 let sends=0;const deps={db:mem.db,env:{HTOS_ENABLE_INVOICE_CASES:'true',HTOS_ENABLE_EMAIL:'true'},account:async()=>({user:'branch@example.test',pass:'sample-only',host:'smtp.example.test',port:465,secure:true,accountsCc:['accounts@example.test']}),reserveSend:async()=>true,deliver:async(mail:any)=>{sends++;assert.equal(mail.attachments.length,2);return {accepted:[...mail.to,...mail.cc],rejected:[]};}};
 const email=(action:string,payload:any={})=>invoiceEmailAction(deps,sampleOwner.id,{action:'invoice-case-email-'+action,caseId:f.record.id,expectedVersion:mem.data.get(key).version,...payload});
 const payload={recipient:'supplier@example.test',message:mem.data.get(key).claim.message},preview=await email('preview',payload);
 await email('approve',{...payload,confirmed:true,fingerprint:preview.preview.fingerprint,requestId:crypto.randomUUID()});
 await email('send',{confirmed:true,fingerprint:preview.preview.fingerprint});assert.equal(sends,1);
 const credit=await f.call({action:'invoice-case-upload',expectedVersion:mem.data.get(key).version,kind:'CREDIT',name:'SAMPLE-credit.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nFictional GBP 58 credit note').toString('base64')});
 r=mem.data.get(key);await command('record-credit',{reference:'SAMPLE-CN-58',documentId:credit.documentId,invoiceReference:r.invoiceReference,supplierId:r.supplierId,lines:r.claim.lines.map((l:any)=>({lineId:l.lineId,netPence:l.netPence})),vatPence:0,grossPence:5800,verified:true});
 await command('approve-credit',{creditId:mem.data.get(key).credits[0].id});assert.deepEqual(invoiceApprovalProblems(mem.data.get(key)),[]);
 await command('approve-invoice');r=mem.data.get(key);assert.equal(r.status,'APPROVED');assert.equal(outstandingClaim(r),0);assert.equal(r.credits[0].status,'APPROVED');assert.equal(f.calls.length,4);assert.deepEqual(r.lines.map((l:any)=>l.expectedPrice),originalPrices);
 assert.deepEqual(mem.data.get('_invoice_case_documents/'+f.identity.documentId).document,original.document);
 assert.equal(mem.data.get('_invoice_case_documents/'+f.identity.documentId+'/parts/0').base64,f.base64);
});
test('original upload -> private prepared parts -> persisted worker -> Accounts draft, with restart',async()=>{
 const f=await setup(),original=structuredClone(f.get().data.get('_invoice_case_documents/'+f.identity.documentId));
 let status=await f.call({action:'invoice-case-reading-status',...f.identity});assert.equal(status.canPrepare,true);assert.equal(status.canRead,false);
 await assert.rejects(()=>f.call({action:'invoice-case-read',...f.identity,documentIds:[f.identity.documentId]}),/prepared photo/);assert.equal(f.calls.length,0);
 await uploadInvoicePreparation(f.call,f.identity,f.plan);
 const repeat=await uploadInvoicePreparation(f.call,f.identity,f.plan);assert.equal(repeat.ready,true);
 const loaded=await loadStoredInvoicePreparation(f.get().db,f.identity.documentId,f.plan.documentHash,invoiceReadJobId(f.record.id,f.plan.documentHash));assert.equal(loaded.sections[0].reservePence,60);
 status=await f.call({action:'invoice-case-reading-status',...f.identity});assert.equal(status.canRead,true);assert.equal(status.canPrepare,false);
 f.get().reads.length=0;
 await f.call({action:'invoice-case-read',...f.identity,documentIds:[f.identity.documentId]});assert.equal(f.calls.length,1);
 const imageReads=f.get().reads.filter(p=>p.includes('/preparations/')&&p.includes('/parts/'));assert.equal(imageReads.length,1);assert.ok(imageReads[0].endsWith('/header-0'));f.reopen();
 status=await f.call({action:'invoice-case-reading-status',...f.identity});assert.equal(status.completed,1);
 let last:any;for(let i=1;i<f.plan.sections.length;i++)last=await f.call({action:'invoice-case-read',...f.identity,documentIds:[f.identity.documentId]});
 assert.equal(last.record.extraction.draft.rows.length,5);assert.equal(last.record.extraction.draft.rows[4].unitReviewRequired,true);assert.equal(f.calls.length,4);
 assert.equal(last.record.lines[0].invoicePrice,undefined);assert.deepEqual(f.get().data.get('_invoice_case_documents/'+f.identity.documentId).document,original.document);
 assert.equal(f.get().data.get('_invoice_case_documents/'+f.identity.documentId+'/parts/0').base64,f.base64);
 assert.equal(f.get().data.get('_invoice_read_jobs/budget-offline').allocatedPence,4);
 await assert.rejects(()=>f.call({action:'invoice-case-preparation-start',...f.identity,manifest:preparationManifest(f.plan)}),/changed|started/);
});
test('interrupted upload resumes only unsaved immutable parts; incomplete preparation cannot read',async()=>{
 const f=await setup();let partCalls=0;
 const interrupt=async(body:any)=>{if(body.action==='invoice-case-preparation-part'&&++partCalls===2)throw Error('Offline interruption');return f.call(body);};
 await assert.rejects(()=>uploadInvoicePreparation(interrupt,f.identity,f.plan),/interruption/);f.reopen();
 const status=await f.call({action:'invoice-case-preparation-status',...f.identity});assert.equal(status.savedParts,1);assert.equal(status.ready,false);
 await assert.rejects(()=>f.call({action:'invoice-case-preparation-complete',...f.identity,preparationId:status.preparationId}),/missing|corrupt/);
 const resumed:string[]=[];await uploadInvoicePreparation(async b=>{if(b.action==='invoice-case-preparation-part')resumed.push(b.sectionId);return f.call(b);},f.identity,f.plan);
 assert.equal(resumed.includes(f.plan.sections[0].id),false);assert.equal(resumed.length,3);
 const part={action:'invoice-case-preparation-part',...f.identity,preparationId:status.preparationId,sectionId:f.plan.sections[0].id,index:0,base64:f.plan.sections[0].base64};
 await f.call(part);await assert.rejects(()=>f.call({...part,base64:'A'.repeat(part.base64.length)}),/overwritten/);
});
test('preparation access, version, feature gate, original binding and image hashes fail closed',async()=>{
 const f=await setup(),body={action:'invoice-case-preparation-start',...f.identity,manifest:preparationManifest(f.plan)};
 await assert.rejects(()=>f.call(body,sampleStaff.id),/access/);
 await assert.rejects(()=>f.call(body,sampleOwner.id,false),/release approval/);
 await assert.rejects(()=>f.call({...body,expectedVersion:0}),/changed/);
 await assert.rejects(()=>f.call({...body,manifest:{...body.manifest,documentHash:'a'.repeat(64)}}),/another original/);
 await assert.rejects(()=>f.call({...body,documentId:'not-linked'}),/not available/);
 f.plan.sections[0].sha256='b'.repeat(64);await assert.rejects(()=>uploadInvoicePreparation(f.call,f.identity,f.plan),/integrity/);assert.equal(f.calls.length,0);
});
test('unapproved budget stops before provider and disabled configuration never contacts anything',async()=>{
 const f=await setup();await uploadInvoicePreparation(f.call,f.identity,f.plan);f.get().data.set('_invoice_read_jobs/budget-offline',{approved:false,capPence:500,allocatedPence:0});
 await assert.rejects(()=>f.call({action:'invoice-case-read',...f.identity,documentIds:[f.identity.documentId]}),/stopped/);assert.equal(f.calls.length,0);
 const transport=async()=>{throw Error('Network forbidden');};
 assert.equal(configuredInvoiceReader(f.get().db,{},transport),undefined);
 assert.equal(configuredInvoiceReader(f.get().db,{HTOS_ENABLE_INVOICE_CASES:'true',HTOS_ENABLE_INVOICE_READING:'true',HTOS_ENABLE_OCR:'true',HTOS_MODE:'emulator',FIREBASE_PROJECT_ID:'demo-htos'},transport),undefined);
});
test('dedicated reading route rejects unauthenticated and disabled calls before Firebase',async()=>{
 const saved=process.env.HTOS_ENABLE_INVOICE_READING;delete process.env.HTOS_ENABLE_INVOICE_READING;
 try{for(const [method,headers,expected] of [['GET',{},405],['POST',{},401],['POST',{authorization:'Bearer offline'},503]] as const){let code=0;const res:any={setHeader(){},status(v:number){code=v;return this;},json(v:any){return v;}};await readingHandler({method,headers,body:{action:'invoice-case-read'}} as any,res);assert.equal(code,expected);}}
 finally{if(saved===undefined)delete process.env.HTOS_ENABLE_INVOICE_READING;else process.env.HTOS_ENABLE_INVOICE_READING=saved;}
});
test('enabled server connection uses the stored photo and server budget with mocked AI only',async()=>{
 const f=await setup();await uploadInvoicePreparation(f.call,f.identity,f.plan);let calls=0;
 const env={HTOS_ENABLE_INVOICE_CASES:'true',HTOS_ENABLE_INVOICE_READING:'true',HTOS_ENABLE_OCR:'true',HTOS_MODE:'cloud',FIREBASE_PROJECT_ID:'offline-fixture',HTOS_CLOUD_PROJECT_ID:'offline-fixture',HTOS_INVOICE_OPENAI_API_KEY:'sk-offline-placeholder',HTOS_INVOICE_READING_BUDGET_ID:'offline'};
 const gate=configuredInvoiceReader(f.get().db,env,async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const request=JSON.parse(String(options?.body));assert.equal(request.model,'gpt-5.4-mini-2026-03-17');assert.equal(request.store,false);
  return new Response(JSON.stringify({id:'offline',status:'completed',usage:{input_tokens:10,output_tokens:10},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sectionSample().bundle.results.find(r=>r.id==='header')!.data)}]}]}),{status:200});
 });
 const result=await invoiceCaseAction(f.get().db,sampleOwner.id,{action:'invoice-case-read',...f.identity,documentIds:[f.identity.documentId],budgetId:'browser-override',model:'unapproved-model'},true,gate);
 assert.equal(result.reading.completed,1);assert.equal(calls,1);assert.equal(f.get().data.get('_invoice_read_jobs/budget-offline').allocatedPence,1);
 assert.equal(f.get().data.has('_invoice_read_jobs/budget-browser-override'),false);
});
test('corrupt sealed pixels stop before AI and retain the reserved allowance',async()=>{
 const f=await setup();await uploadInvoicePreparation(f.call,f.identity,f.plan);
 const part=[...f.get().data.keys()].find(p=>p.includes('/preparations/')&&p.endsWith('/parts/header-0'))!;
 f.get().data.set(part,{base64:'AAAA'});
 await assert.rejects(()=>f.call({action:'invoice-case-read',...f.identity,documentIds:[f.identity.documentId]}),/stopped/);
 assert.equal(f.calls.length,0);assert.equal(f.get().data.get('_invoice_read_jobs/budget-offline').allocatedPence,60);
});
