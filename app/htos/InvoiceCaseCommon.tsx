import React,{useEffect,useRef,useState} from 'react';
import {useBlocker} from 'react-router-dom';
import {useUpdateProtection} from '../../hooks/useUpdateProtection';
import {beginPendingWork} from '../../shared/pending-work';
import type {InvoiceCase,DocumentKind} from '../../shared/invoice-case';
import {useCheckWorkflow} from './CheckWorkflow';
import {Button,Modal} from './ui';
export function InvoiceField({label,children,hint}:{label:string;children:React.ReactNode;hint?:string}){
 return <label className="h-field"><span>{label}</span>{React.Children.map(children,child=>React.isValidElement(child)&&['input','select','textarea'].includes(String(child.type))?React.cloneElement(child as React.ReactElement<any>,{'aria-label':label}):child)}{hint&&<small>{hint}</small>}</label>;
}
const Field=InvoiceField;
export function useInvoiceCase(caseId:string){
 const request=useCheckWorkflow(),[record,setRecord]=useState<InvoiceCase|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),running=useRef(false);
 useEffect(()=>{let active=true;setRecord(null);setError('');request({action:'invoice-case-get',caseId}).then(r=>{if(active)setRecord(r.record);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[caseId,request]);
 const run=async(body:any)=>{if(running.current)return null;running.current=true;setBusy(true);setError('');const end=beginPendingWork();try{const result=await request({caseId,...body});if(result.record)setRecord(result.record);return result;}catch(e){setError((e as Error).message);return null;}finally{running.current=false;setBusy(false);end();}};
 const command=(kind:string,payload:any={})=>run({action:'invoice-case-command',command:{...payload,kind,expectedVersion:record?.version,requestId:crypto.randomUUID()}});
 return {record,setRecord,error,busy,run,command};
}
export function useInvoiceDraftGuard(dirty:boolean,busy=false){
 useUpdateProtection(dirty||busy);
 const blocker=useBlocker(dirty||busy);
 useEffect(()=>{if(blocker.state==='blocked'){if(!busy&&window.confirm('Discard unsaved invoice changes and leave this screen?'))blocker.proceed();else blocker.reset();}},[blocker,busy]);
 useEffect(()=>{if(!dirty)return;const end=beginPendingWork();const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>{end();window.removeEventListener('beforeunload',warn);};},[dirty]);
}
export const filePayload=async(file:File)=>{
 if(file.size>3*1024*1024||!['image/jpeg','image/png','application/pdf'].includes(file.type))throw new Error('Choose a JPEG, PNG or PDF up to 3 MB.');
 const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('The file could not be read. Please select it again.'));reader.readAsDataURL(file);});return {name:file.name,mime:file.type,base64};
};
export function DocumentUpload({record,run,kind,onUploaded,lineId,label,compact=false}:{record:InvoiceCase;run:(body:any)=>Promise<any>;kind:DocumentKind;onUploaded?:(id:string)=>void;lineId?:string;label:string;compact?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uploadName,setUploadName]=useState(''),running=useRef(false);
 const uploaded=record.documents.filter(d=>d.kind===kind&&(!lineId||d.lineId===lineId));
 return <Field label={label} hint={(kind==='EVIDENCE'?'JPEG or PNG':'JPEG, PNG or PDF')+(compact?' · max 3 MB':' · up to 3 MB. Originals stay linked to this review.')}><input type="file" accept={kind==='EVIDENCE'?'image/jpeg,image/png':'image/jpeg,image/png,application/pdf'} disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file||running.current)return;running.current=true;setBusy(true);setUploadName(file.name);setError('');try{const payload=await filePayload(file),result=await run({action:'invoice-case-upload',expectedVersion:record.version,kind,lineId,...payload});if(result?.documentId)onUploaded?.(result.documentId);else setError('Upload was not confirmed. Check the message above before trying again.');}catch(error){setError((error as Error).message);}finally{running.current=false;setBusy(false);}}}/><span role="status" aria-live="polite">{busy?`Uploading ${uploadName} — please keep this screen open…`:uploaded.length?`✓ ${uploaded.length} ${uploaded.length===1?'document':'documents'} uploaded and saved: ${uploaded.map(d=>d.name).join(', ')}${['INVOICE','DELIVERY'].includes(kind)&&!record.receipt.submittedAt?' · Submit for checking when the delivery report is ready.':''}`:''}</span>{error&&<span role="alert">{error}</span>}</Field>;
}
export function CaseDocuments({record,ids}:{record:InvoiceCase;ids?:string[]}){
 const request=useCheckWorkflow(),[preview,setPreview]=useState<{url:string;name:string;mime:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
 const open=async(id:string)=>{setBusy(true);setError('');try{const d=await request({action:'invoice-case-document',caseId:record.id,documentId:id}),bytes=Uint8Array.from(atob(d.base64),(c:string)=>c.charCodeAt(0));setPreview({url:URL.createObjectURL(new Blob([bytes],{type:d.mime})),name:d.name,mime:d.mime});}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <><div className="ic-documents">{record.documents.filter(d=>!ids||ids.includes(d.id)).map(d=><Button key={d.id} variant="secondary" busy={busy} onClick={()=>void open(d.id)}>{d.name}</Button>)}</div>{error&&<p role="alert" className="h-notice error">{error}</p>}{preview&&<Modal title={preview.name} wide onClose={()=>setPreview(null)}>{preview.mime==='application/pdf'?<iframe className="ic-document-preview" title={preview.name} src={preview.url}/>:<img className="ic-document-preview" alt={preview.name} src={preview.url}/>}<a href={preview.url} download={preview.name}>Download original</a></Modal>}</>;
}
