import React,{useEffect,useRef,useState} from 'react';
import {Button} from './ui';
import {prepareInvoicePhoto,type PreparedPhoto} from './photoPreparation';
export function InvoicePhotoPreparation({sampleFile,sourceLabel='Prepare sample photo',disabled=false,onConfirmed,onDirty}:{sampleFile?:()=>Promise<File>;sourceLabel?:string;disabled?:boolean;onConfirmed:(photo:PreparedPhoto)=>void|boolean|Promise<void|boolean>;onDirty?:(dirty:boolean)=>void}){
 const [file,setFile]=useState<File|null>(null),[photo,setPhoto]=useState<PreparedPhoto|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[turn,setTurn]=useState(0),[whole,setWhole]=useState(false),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>()=>{if(photo)URL.revokeObjectURL(photo.originalUrl);},[photo]);
 const running=useRef(false);
 useEffect(()=>{onDirty?.(busy||!!photo&&!confirmed);return()=>onDirty?.(false);},[photo,confirmed,busy,onDirty]);
 const prepare=async(next:File,rotation=0,retainWhole=false)=>{if(running.current)return;running.current=true;setBusy(true);setError('');setConfirmed(false);try{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const result=await prepareInvoicePhoto(next,rotation,retainWhole);setFile(next);setPhoto(result);setTurn(rotation);setWhole(retainWhole);}catch(e){setPhoto(null);setError((e as Error).message);}finally{running.current=false;setBusy(false);}};
 return <section className="ic-section"><h3>Prepare invoice photo</h3><p>The original stays unchanged. Check the page and section lines before reading.</p>
  {sampleFile?<Button busy={busy} disabled={disabled} onClick={async()=>{try{await prepare(await sampleFile());}catch(e){setError((e as Error).message);}}}>{sourceLabel}</Button>:<label className="h-field"><span>Invoice photo · JPEG or PNG</span><input type="file" accept="image/jpeg,image/png" disabled={busy||disabled} onChange={e=>{const f=e.target.files?.[0];if(f)void prepare(f);}}/></label>}
  {busy&&<p role="status">Preparing locally — no AI call…</p>}{error&&<p role="alert" className="h-notice error">{error}</p>}
  {photo&&<><div className="ic-photo-pair"><figure><img src={photo.originalUrl} alt="Original invoice photo"/><figcaption>Original</figcaption></figure><figure><img src={photo.previewUrl} alt="Prepared invoice with section boundaries"/><figcaption>Prepared · {photo.plan.sections.filter(s=>s.kind==='rows').length} item sections</figcaption></figure></div>
   <ul>{photo.warnings.map(w=><li key={w}>{w}</li>)}</ul><div className="ic-row"><Button variant="secondary" busy={busy} disabled={disabled||confirmed} onClick={()=>file&&void prepare(file,turn+1,whole)}>Rotate 90°</Button><Button variant="secondary" busy={busy} disabled={disabled||confirmed} onClick={()=>file&&void prepare(file,turn,!whole)}>{whole?'Try automatic page edges':'Keep whole photo'}</Button>
   <Button busy={busy} disabled={confirmed||disabled} onClick={async()=>{if(running.current)return;running.current=true;setBusy(true);setError('');try{const result=await onConfirmed({...photo,plan:{...photo.plan,confirmed:true}});if(result!==false)setConfirmed(true);}catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}}}>Confirm page and sections</Button></div>{confirmed&&<p role="status">Prepared view confirmed. Original quantities and units still require Accounts review.</p>}</>}
 </section>;
}
