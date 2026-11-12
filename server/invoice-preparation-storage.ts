import {createHash} from 'node:crypto';
import {preparationPartLength,preparationRevision,type PreparationManifest} from '../shared/invoice-preparation.ts';
import {validatePreparedInvoiceJob,sectionDigest,type PreparedInvoiceJob,type PreparedInvoiceSection} from './invoice-section-jobs.ts';
import {assertInvoiceAccess,InvoiceCaseError} from './invoice-case-validation.ts';
import {invoiceReadJobId} from './invoice-case-reader.ts';
import type {InvoiceCase} from '../shared/invoice-case.ts';

const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const id=(v:unknown)=>typeof v==='string'&&/^[\w-]{1,128}$/.test(v)?v:(()=>{throw new InvoiceCaseError('Invalid preparation reference.');})();
function fail(message:string):never{throw new InvoiceCaseError(message);}
interface StoredPreparation extends PreparationManifest {caseId:string;documentId:string;id:string;state:'UPLOADING'|'READY';received:string[];createdAt:string;createdBy:string;confirmedAt?:string;confirmedBy?:string}
export function validatePreparationManifest(input:any):PreparationManifest {
 if(!input||input.confirmed!==true||input.revision!==preparationRevision||!/^[a-f0-9]{64}$/.test(input.documentHash)||!Array.isArray(input.sections)||input.sections.length<3||input.sections.length>40)fail('Confirm the prepared page and all sections.');
 const sections=input.sections.map((s:any)=>{
  if(!s||typeof s.id!=='string'||!/^[\w-]{1,80}$/.test(s.id)||!['header','rows','totals'].includes(s.kind)||s.page!==1||!/^[a-f0-9]{64}$/.test(s.sha256)||![s.width,s.height,s.length,s.parts].every(Number.isSafeInteger)||s.width<32||s.width>3000||s.height<16||s.height>3000||s.length<44||s.length>4194304||s.length%4||s.parts!==Math.ceil(s.length/preparationPartLength))fail('Invalid prepared photo section.');
  return {id:s.id,kind:s.kind,page:1,sha256:s.sha256,width:s.width,height:s.height,length:s.length,parts:s.parts};
 });
 if(new Set(sections.map((s:any)=>s.id)).size!==sections.length||sections.filter((s:any)=>s.kind==='header').length!==1||sections.filter((s:any)=>s.kind==='totals').length!==1||!sections.some((s:any)=>s.kind==='rows')||sections.reduce((n:number,s:any)=>n+s.length,0)>16*1024*1024)fail('Invalid or oversized page preparation.');
 return {documentHash:input.documentHash,revision:preparationRevision,confirmed:true,sections};
}
const preparationRef=(db:any,documentId:string,preparationId:string)=>db.collection('_invoice_case_documents').doc(documentId).collection('preparations').doc(preparationId);
async function assemble(db:any,stored:StoredPreparation):Promise<PreparedInvoiceJob>{
 const manifest=validatePreparationManifest(stored),ref=preparationRef(db,stored.documentId,stored.id);
 const sections=[];
 for(const s of manifest.sections){
  const parts=await Promise.all(Array.from({length:s.parts},(_,i)=>ref.collection('parts').doc(s.id+'-'+i).get()));
  const base64=parts.map(p=>p.data()?.base64||'').join('');
  if(base64.length!==s.length||Buffer.from(base64,'base64').toString('base64')!==base64)fail('A prepared section is missing or corrupt. No reading was started.');
  sections.push({id:s.id,kind:s.kind,page:s.page,width:s.width,height:s.height,sha256:s.sha256,base64,reservePence:60});
 }
 const plan={documentHash:manifest.documentHash,revision:manifest.revision,confirmed:true,sections};
 await validatePreparedInvoiceJob(plan);return plan;
}
/** Loads only a sealed preparation bound to the original and this case's reading job. */
async function loadSealed(db:any,documentId:string,documentHash:string,jobId:string){
 const source=(await db.collection('_invoice_case_documents').doc(id(documentId)).get()).data();
 if(!source?.preparedId||source.document?.sha256!==documentHash||invoiceReadJobId(source.caseId,documentHash)!==jobId)fail('Save the prepared photo for this original before reading.');
 const stored=(await preparationRef(db,documentId,id(source.preparedId)).get()).data() as StoredPreparation;
 if(!stored||stored.state!=='READY'||stored.caseId!==source.caseId||stored.documentId!==documentId||stored.documentHash!==documentHash)fail('Prepared photo is not ready.');
 validatePreparationManifest(stored);return stored;
}
export async function loadStoredInvoicePreparation(db:any,documentId:string,documentHash:string,jobId:string){
 return assemble(db,await loadSealed(db,documentId,documentHash,jobId));
}
export async function storedInvoicePreparationLoader(db:any,documentId:string,documentHash:string,jobId:string){
 const stored=await loadSealed(db,documentId,documentHash,jobId);
 const plan:PreparedInvoiceJob={documentHash,revision:stored.revision,confirmed:true,sections:stored.sections.map(s=>({id:s.id,kind:s.kind,page:s.page,width:s.width,height:s.height,sha256:s.sha256,base64:'',reservePence:60}))};
 return {plan,async section(requested:PreparedInvoiceSection){
  const s=stored.sections.find(s=>s.id===requested.id);if(!s||s.sha256!==requested.sha256)fail('Stored section identity changed.');
  const ref=preparationRef(db,documentId,stored.id),parts=await Promise.all(Array.from({length:s.parts},(_,i)=>ref.collection('parts').doc(s.id+'-'+i).get()));
  const base64=parts.map(p=>p.data()?.base64||'').join(''),bytes=Buffer.from(base64,'base64');
  if(base64.length!==s.length||bytes.toString('base64')!==base64||await sectionDigest(bytes)!==s.sha256)fail('Stored section integrity failed. No AI request was made.');
  // Pixels were validated at sealing, are immutable, and must still match that exact hash.
  return {...requested,base64};
 }};
}
/** Existing private document collection only. Originals, orders and prices are never overwritten. */
export async function invoicePreparationAction(db:any,uid:string,body:any){
 const caseId=id(body.caseId),documentId=id(body.documentId),caseRef=db.collection('_invoice_cases').doc(caseId),docRef=db.collection('_invoice_case_documents').doc(documentId);
 const statusOnly=body.action==='invoice-case-preparation-status';
 const authorise=async(tx:any)=>{
  const [snap,profile,roles,source]=await Promise.all([tx.get(caseRef),tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions')),tx.get(docRef)]);
  if(!snap.exists)throw new InvoiceCaseError('Invoice record not found.',404);
  const record=snap.data() as InvoiceCase;assertInvoiceAccess({...profile.data(),id:uid},roles.data()?.map||{},record,true);
  const document=record.documents.find(d=>d.id===documentId&&['INVOICE','DELIVERY'].includes(d.kind));
  if(!document||source.data()?.caseId!==caseId||source.data()?.document?.sha256!==document.sha256)fail('Original document not available.');
  if(!statusOnly&&(record.version!==body.expectedVersion||!record.receipt.submittedAt||record.status==='APPROVED'||record.claim||record.laterReceipts?.some(r=>r.status==='APPROVED')))throw new InvoiceCaseError('This review changed or is locked. Save/reload before preparing.',409);
  if(!statusOnly&&!['image/jpeg','image/png'].includes(document.mime))fail('Automatic preparation currently supports JPEG and PNG photos.');
  const job=await tx.get(db.collection('_invoice_read_jobs').doc(invoiceReadJobId(caseId,document.sha256)));
  if(!statusOnly&&job.exists)throw new InvoiceCaseError('Reading has already started. Its prepared evidence is locked.',409);
  return {record,document,source:source.data(),job:job.data()};
 };
 if(statusOnly)return db.runTransaction(async(tx:any)=>{
  const {source,job}=await authorise(tx),preparationId=source.preparedId||source.pendingPreparationId;
  const stored=preparationId?(await tx.get(preparationRef(db,documentId,id(preparationId)))).data():null;
  return {ready:stored?.state==='READY',preparationId:preparationId||null,savedParts:stored?.received?.length||0,totalParts:stored?.sections?.reduce((n:number,s:any)=>n+s.parts,0)||0,locked:!!job};
 });
 if(body.action==='invoice-case-preparation-start'){
  const manifest=validatePreparationManifest(body.manifest),preparationId=hash(JSON.stringify(manifest));
  return db.runTransaction(async(tx:any)=>{
   const {source,document}=await authorise(tx);if(manifest.documentHash!==document.sha256)fail('The prepared photo belongs to another original.');
   const ref=preparationRef(db,documentId,preparationId),existing=await tx.get(ref);
   if(existing.exists){const v=existing.data();return {preparationId,ready:v.state==='READY',received:v.received};}
   const ids=source.preparationIds||[];if(ids.length>=5)fail('Five preparations already saved. Review existing evidence before adding more.');
   const stored:StoredPreparation={...manifest,caseId,documentId,id:preparationId,state:'UPLOADING',received:[],createdAt:new Date().toISOString(),createdBy:uid};
   tx.set(ref,stored);tx.set(docRef,{...source,preparationIds:[...ids,preparationId],pendingPreparationId:preparationId});return {preparationId,ready:false,received:[]};
  });
 }
 const preparationId=id(body.preparationId),ref=preparationRef(db,documentId,preparationId);
 if(body.action==='invoice-case-preparation-part')return db.runTransaction(async(tx:any)=>{
  await authorise(tx);const snap=await tx.get(ref),stored=snap.data() as StoredPreparation;
  if(!stored||stored.caseId!==caseId||stored.documentId!==documentId)fail('Preparation not found.');
  const section=stored.sections.find(s=>s.id===body.sectionId),index=body.index;
  if(!section||!Number.isSafeInteger(index)||index<0||index>=section.parts||typeof body.base64!=='string'||body.base64.length!==Math.min(preparationPartLength,section.length-index*preparationPartLength)||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))fail('Invalid prepared photo part.');
  const partRef=ref.collection('parts').doc(section.id+'-'+index),previous=await tx.get(partRef);
  if(previous.exists){if(previous.data().base64!==body.base64)fail('Saved photo parts cannot be overwritten.');return {saved:true};}
  if(stored.state!=='UPLOADING')fail('Confirmed preparation is locked.');
  tx.set(partRef,{base64:body.base64});tx.set(ref,{...stored,received:[...stored.received,section.id+':'+index]});return {saved:true};
 });
 if(body.action!=='invoice-case-preparation-complete')fail('Unknown preparation action.');
 // First authorise; verify immutable parts outside the final short transaction.
 const stored=await db.runTransaction(async(tx:any)=>{await authorise(tx);const s=(await tx.get(ref)).data() as StoredPreparation;if(!s||s.caseId!==caseId||s.documentId!==documentId)fail('Preparation not found.');return s;});
 await assemble(db,stored);
 return db.runTransaction(async(tx:any)=>{
  const {source,document}=await authorise(tx),fresh=(await tx.get(ref)).data() as StoredPreparation;
  if(fresh.documentHash!==document.sha256||fresh.received.length!==fresh.sections.reduce((n,s)=>n+s.parts,0))fail('Photo upload is incomplete.');
  if(source.preparedId&&source.preparedId!==preparationId)fail('Another preparation is already confirmed. Reload the saved view.');
  tx.set(ref,{...fresh,state:'READY',confirmedAt:fresh.confirmedAt||new Date().toISOString(),confirmedBy:fresh.confirmedBy||uid});
  tx.set(docRef,{...source,preparedId:preparationId});return {ready:true,preparationId};
 });
}
