import {preparedImageInfo} from '../shared/prepared-image.ts';
import {invoiceFromSections,type InvoiceSectionBundle,type InvoiceSectionPlan} from '../shared/invoice-section-extraction.ts';
import type {InvoiceReaderResult,InvoiceReaderUsage} from './invoice-reader.ts';

export interface PreparedInvoiceSection extends InvoiceSectionPlan {sha256:string;base64:string;width:number;height:number;reservePence:number}
export interface PreparedInvoiceJob {documentHash:string;revision:string;sections:PreparedInvoiceSection[];confirmed:boolean}
export interface SectionJob {fingerprint:string;documentHash:string;sections:{id:string;state:'PENDING'|'RESERVED'|'COMPLETE'|'UNCERTAIN';token?:string;data?:unknown;chargePence?:number;usage?:InvoiceReaderUsage;failure?:Record<string,string|number>}[]}
export interface SectionBudget {approved:boolean;capPence:number;allocatedPence:number}
export interface SectionJobStore {
 transaction<T>(jobId:string,budgetId:string,fn:(state:{job?:SectionJob;budget?:SectionBudget})=>{job:SectionJob;budget:SectionBudget;value:T}):Promise<T>;
}
export interface SectionReadResult {data:unknown;chargePence:number;usage:InvoiceReaderUsage}
export type SectionReader=(section:PreparedInvoiceSection,requestId:string)=>Promise<SectionReadResult>;
export const sectionDigest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('');
const bytes=(s:string)=>Uint8Array.from(atob(s),v=>v.charCodeAt(0));
export async function validatePreparedInvoiceJob(plan:PreparedInvoiceJob,storedMetadataOnly=false){
 if(!plan?.confirmed||!/^[a-f0-9]{64}$/.test(plan.documentHash)||!/^[\w.-]{1,80}$/.test(plan.revision)||!Array.isArray(plan.sections)||plan.sections.length<3||plan.sections.length>40)throw new Error('Confirm a complete preparation before reading.');
 if(new Set(plan.sections.map(s=>s.id)).size!==plan.sections.length||plan.sections.filter(s=>s.kind==='header').length!==1||plan.sections.filter(s=>s.kind==='totals').length!==1||!plan.sections.some(s=>s.kind==='rows'))throw new Error('Invalid section plan.');
 let total=0;
 for(const s of plan.sections){
  if(!/^[\w-]{1,80}$/.test(s.id)||!['header','rows','totals'].includes(s.kind)||!Number.isInteger(s.page)||s.page<1||s.page>100||!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<32||s.height<16||s.width>3000||s.height>3000||!Number.isSafeInteger(s.reservePence)||s.reservePence<1||s.reservePence>200||typeof s.base64!=='string'||s.base64.length>4194304)throw new Error('Invalid prepared section.');
  // Only the server's sealed, already-verified storage loader may omit pixels here.
  if(storedMetadataOnly&&s.base64===''&&/^[a-f0-9]{64}$/.test(s.sha256))continue;
  const b=bytes(s.base64);total+=b.length;
  if(b.length<33||b.length>3*1024*1024||btoa(String.fromCharCode(...b.subarray(0,24)))!==s.base64.slice(0,32)||await sectionDigest(b)!==s.sha256)throw new Error('Prepared image integrity failed.');
  const info=preparedImageInfo(b);if(info.width!==s.width||info.height!==s.height)throw new Error('Prepared dimensions do not match the image.');
 }
 if(total>12*1024*1024)throw new Error('Prepared sections exceed the 12 MB limit.');
 return sectionDigest(new TextEncoder().encode(JSON.stringify({documentHash:plan.documentHash,revision:plan.revision,sections:plan.sections.map(({base64,...s})=>s)})));
}
const header={documentType:'UNKNOWN',reference:null,date:null,supplier:null,customerName:null,branch:null,branchEvidence:null,warnings:[]};
const totals={net:null,vat:null,gross:null,currency:null,warnings:[]};
export function validateInvoiceSectionResult(kind:InvoiceSectionPlan['kind'],data:unknown){
 const kinds=['header','rows','totals'] as const;
 invoiceFromSections({schemaVersion:1,documentHash:'a'.repeat(64),plan:kinds.map(k=>({id:k,kind:k,page:1})),results:kinds.map(k=>({id:k,data:k===kind?data:k==='header'?header:k==='totals'?totals:{rows:[],warnings:[]}}))},'a'.repeat(64));
 if(JSON.stringify(data).length>120000)throw new Error('Section result is too large.');
}
/** A single bounded dispatch. Caller may resume only after this durable step completes. */
export async function runInvoiceSectionStep(store:SectionJobStore,jobId:string,budgetId:string,plan:PreparedInvoiceJob,read:SectionReader,storedMetadataOnly=false){
 if(!/^[\w-]{1,128}$/.test(jobId)||!/^[\w-]{1,80}$/.test(budgetId))throw new Error('Invalid reading job identity.');
 const fingerprint=await validatePreparedInvoiceJob(plan,storedMetadataOnly),token=crypto.randomUUID();
 const selection=await store.transaction(jobId,budgetId,({job,budget})=>{
  if(!budget?.approved||!Number.isSafeInteger(budget.capPence)||budget.capPence<0||!Number.isSafeInteger(budget.allocatedPence)||budget.allocatedPence<0)throw new Error('No approved reading budget.');
  const current:SectionJob=job||{fingerprint,documentHash:plan.documentHash,sections:plan.sections.map(s=>({id:s.id,state:'PENDING' as const}))};
  if(current.fingerprint!==fingerprint||current.documentHash!==plan.documentHash)throw new Error('Preparation changed. Keep existing job evidence; do not reuse its budget.');
  if(current.sections.some(s=>['RESERVED','UNCERTAIN'].includes(s.state)))throw new Error('A previous section has uncertain usage. No retry is allowed until reconciled.');
  const next=current.sections.find(s=>s.state==='PENDING');
  if(!next)return {job:current,budget,value:{sectionId:null as string|null,job:current}};
  const section=plan.sections.find(s=>s.id===next.id)!;
  if(budget.allocatedPence+section.reservePence>budget.capPence)throw new Error('Reading budget reached. Completed sections are saved.');
  next.state='RESERVED';next.token=token;
  return {job:current,budget:{...budget,allocatedPence:budget.allocatedPence+section.reservePence},value:{sectionId:next.id,job:current}};
 });
 let job=selection.job;
 if(selection.sectionId){
  const section=plan.sections.find(s=>s.id===selection.sectionId)!;
  try{
   const result=await read(section,jobId+'-'+token);
   validateInvoiceSectionResult(section.kind,result.data);
   if(!Number.isSafeInteger(result.chargePence)||result.chargePence<0||result.chargePence>section.reservePence||!result.usage||![result.usage.inputTokens,result.usage.outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(result.usage.estimatedUsd)||result.usage.estimatedUsd<0)throw new Error('Unverified or excessive section usage.');
   job=await store.transaction(jobId,budgetId,state=>{
    if(!state.job||!state.budget)throw new Error('Reading reservation missing.');
    const saved=state.job.sections.find(s=>s.id===section.id);
    if(saved?.state!=='RESERVED'||saved.token!==token)throw new Error('Reading reservation changed.');
    saved.state='COMPLETE';saved.data=result.data;saved.chargePence=result.chargePence;saved.usage=result.usage;
    if(JSON.stringify(state.job).length>650000)throw new Error('Reading job exceeds its private storage limit.');
    return {job:state.job,budget:{...state.budget,allocatedPence:state.budget.allocatedPence-section.reservePence+result.chargePence},value:state.job};
   });
  }catch(error){
   // Persist only bounded diagnostic codes, never raw error text, images or credentials.
   const diagnostic=(error as {diagnostics?:Record<string,unknown>})?.diagnostics;
   const failure:Record<string,string|number>={};
   for(const name of ['phase','errorCode','providerRequestId','clientRequestId']){
    const v=diagnostic?.[name];if(typeof v==='string'&&/^[\w-]{1,200}$/.test(v))failure[name]=v;
   }
   for(const name of ['httpStatus','elapsedMs']){
    const v=diagnostic?.[name];if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=86400000)failure[name]=v;
   }
   await store.transaction(jobId,budgetId,state=>{
    if(!state.job||!state.budget)throw new Error('Reading state unavailable.');
    const saved=state.job.sections.find(s=>s.id===section.id);
    if(saved?.state==='RESERVED'&&saved.token===token){saved.state='UNCERTAIN';saved.failure=failure;}
    return {job:state.job,budget:state.budget,value:null};
   });
   throw new Error('Section reading stopped. Completed sections and uncertain usage are retained; no automatic retry.');
  }
 }
 const completed=job.sections.filter(s=>s.state==='COMPLETE').length,total=job.sections.length;
 if(completed!==total)return {state:'PAUSED' as const,completed,total};
 const bundle:InvoiceSectionBundle={schemaVersion:1,documentHash:plan.documentHash,plan:plan.sections.map(({id,kind,page})=>({id,kind,page})),results:job.sections.map(s=>({id:s.id,data:s.data}))};
 const usage=job.sections.reduce((v,s)=>({inputTokens:v.inputTokens+(s.usage?.inputTokens||0),outputTokens:v.outputTokens+(s.usage?.outputTokens||0),estimatedUsd:v.estimatedUsd+(s.usage?.estimatedUsd||0)}),{inputTokens:0,outputTokens:0,estimatedUsd:0});
 const result:InvoiceReaderResult={draft:invoiceFromSections(bundle,plan.documentHash),usage,model:plan.revision,responseId:'section-job-'+jobId};
 // The real per-section allowance ledger is authoritative; aggregate result does not claim new token usage.
 return {state:'COMPLETE' as const,completed,total,result};
}

/** Same database, private job subtree. Budgets are provisioned server-side; browser input cannot create one. */
export function firestoreSectionJobStore(db:any):SectionJobStore{
 return {transaction:async(jobId,budgetId,update)=>db.runTransaction(async(tx:any)=>{
  const jobRef=db.collection('_invoice_read_jobs').doc(jobId).collection('sections').doc('state'),budgetRef=db.collection('_invoice_read_jobs').doc('budget-'+budgetId);
  const [job,budget]=await Promise.all([tx.get(jobRef),tx.get(budgetRef)]);
  const next=update({job:job.exists?job.data():undefined,budget:budget.exists?budget.data():undefined});
  tx.set(jobRef,JSON.parse(JSON.stringify(next.job)));tx.set(budgetRef,JSON.parse(JSON.stringify(next.budget)));return next.value;
 })};
}
