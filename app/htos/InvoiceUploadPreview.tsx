import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {Button} from './ui';
import {validateInvoiceUploadFile,canUploadInvoicePreview} from '../../shared/invoice-upload-preview';
import {beginPendingWork} from '../../shared/pending-work';

export type UploadPendingChange=(id:string,pending:boolean,busy?:boolean)=>void;
export function useInvoiceUploadPending(){
 const [items,setItems]=useState<Record<string,{pending:boolean;busy:boolean}>>({});
 const onUploadPending=useCallback<UploadPendingChange>((id,pending,busy=false)=>setItems(old=>old[id]?.pending===pending&&old[id]?.busy===busy?old:{...old,[id]:{pending,busy}}),[]);
 return {uploadPending:Object.values(items).some(v=>v.pending),uploadBusy:Object.values(items).some(v=>v.busy),onUploadPending};
}
/** Preview is entirely local. The original is sent only after an explicit upload click. */
export function InvoiceUploadPreview({label,evidence=false,upload,onPendingChange}:{label:string;evidence?:boolean;upload:(file:File)=>Promise<boolean>;onPendingChange?:UploadPendingChange}){
 const id=useId(),[file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),running=useRef(false),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!file){setUrl('');return;}const u=URL.createObjectURL(file);setUrl(u);return()=>URL.revokeObjectURL(u);},[file]);
 useEffect(()=>{onPendingChange?.(id,!!file||busy,busy);return()=>onPendingChange?.(id,false,false);},[id,file,busy,onPendingChange]);
 useEffect(()=>{if(!file)return;const end=beginPendingWork(),warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>{end();window.removeEventListener('beforeunload',warn);};},[file]);
 const select=(next:File)=>{if(running.current)return;if(file&&!window.confirm('Replace this unsaved file preview?'))return;setError('');setChecked(false);try{validateInvoiceUploadFile(next,evidence);setFile(next);}catch(e){setError((e as Error).message);}};
 return <div className="ic-upload-preview">
  <label className="h-field"><span>{label}</span><input ref={input} type="file" accept={evidence?'image/jpeg,image/png':'image/jpeg,image/png,application/pdf'} disabled={busy} onChange={e=>{const next=e.target.files?.[0];e.target.value='';if(next)select(next);}}/><small>{evidence?'JPEG or PNG':'JPEG, PNG or PDF'} · up to 3 MB · preview before upload</small></label>
  {error&&<p className="h-notice error" role="alert">{error}</p>}
  {file&&<section className="ic-upload-selected" aria-label="Preview before upload">
   <div className="ic-row"><strong>{file.name}</strong><span className="h-tag">Not uploaded yet</span></div>
   {url&&(file.type==='application/pdf'?<p>PDF selected. <a href={url} target="_blank" rel="noreferrer">Open every page for checking</a></p>:<a href={url} target="_blank" rel="noreferrer" aria-label="Open selected photo full size"><img src={url} alt="Selected photo before upload"/></a>)}
   <label className="h-check"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>{evidence?'This photo clearly shows the damage.':'The whole document is visible and every page is readable.'}</label>
   <div className="ic-row"><Button variant="secondary" disabled={busy} onClick={()=>{setFile(null);setChecked(false);setError('');input.current?.focus();}}>Cancel selection</Button><Button busy={busy} disabled={!canUploadInvoicePreview(!!file,checked,busy)} onClick={async()=>{if(running.current||!canUploadInvoicePreview(!!file,checked,busy))return;running.current=true;setBusy(true);setError('');try{if(await upload(file)){setFile(null);setChecked(false);}else setError('Upload was not confirmed. Your selected file is still here; check the message above.');}catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}}}>Upload original</Button></div>
   <p className="ic-step-note" role="status">{busy?'Uploading — keep this screen open…':'No AI reading starts here. Accounts checks the saved scan separately.'}</p>
  </section>}
 </div>;
}
