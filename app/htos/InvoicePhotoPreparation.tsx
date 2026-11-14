import React,{useEffect,useRef,useState} from 'react';
import {Button} from './ui';
import {prepareInvoicePhoto,type PreparedPhoto} from './photoPreparation';
import {canSaveInvoiceScan,defaultScanOptions,wholePageCorners,type ScanOptions} from '../../shared/invoice-scan';
import './invoice-scan.css';

const cornerNames=['Top left','Top right','Bottom right','Bottom left'];
export function InvoicePhotoPreparation({sampleFile,sourceLabel='Prepare sample photo',disabled=false,onConfirmed,onDirty}:{sampleFile?:()=>Promise<File>;sourceLabel?:string;disabled?:boolean;onConfirmed:(photo:PreparedPhoto)=>void|boolean|Promise<void|boolean>;onDirty?:(dirty:boolean)=>void}){
 const running=useRef(false),loading=useRef(false),svg=useRef<SVGSVGElement>(null),drag=useRef<number|null>(null);
 const [loadingOriginal,setLoadingOriginal]=useState(false),[file,setFile]=useState<File|null>(null),[photo,setPhoto]=useState<PreparedPhoto|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [options,setOptions]=useState<ScanOptions>({...defaultScanOptions}),[changed,setChanged]=useState(false),[confirmed,setConfirmed]=useState(false),[checked,setChecked]=useState(false),[readability,setReadability]=useState(''),[selected,setSelected]=useState(0),[sectionLines,setSectionLines]=useState(false),[view,setView]=useState<'photo'|'scan'>('scan');
 useEffect(()=>()=>{if(photo)URL.revokeObjectURL(photo.originalUrl);},[photo]);
 useEffect(()=>{onDirty?.(busy||loadingOriginal||!!photo&&!confirmed);return()=>onDirty?.(false);},[photo,confirmed,busy,loadingOriginal,onDirty]);
 const locked=disabled||busy||loadingOriginal||confirmed;
 const edit=(next:ScanOptions)=>{if(locked)return;setOptions(next);setChanged(true);setChecked(false);setReadability('');setError('');};
 const prepare=async(next:File,settings:ScanOptions={...defaultScanOptions})=>{
  if(running.current)return;running.current=true;setBusy(true);setError('');setConfirmed(false);setChecked(false);setReadability('');
  try{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const result=await prepareInvoicePhoto(next,0,false,settings);setFile(next);setPhoto(result);setOptions({...settings,corners:result.corners});setChanged(false);setView('scan');}
  catch(e){setError((e as Error).message);setChanged(true);}
  finally{running.current=false;setBusy(false);}
 };
 const moveCorner=(index:number,x:number,y:number)=>{const points=(options.corners||wholePageCorners()).map(p=>({...p}));points[index]={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};edit({...options,crop:'manual',corners:points});};
 const points=options.corners||wholePageCorners();
 const allowSave=canSaveInvoiceScan({busy:busy||loadingOriginal,disabled,changed,confirmed,readable:readability==='yes',checked,hasPreview:!!photo});
 const load=async()=>{if(!sampleFile||loading.current||running.current)return;loading.current=true;setLoadingOriginal(true);setError('');try{await prepare(await sampleFile());}catch(e){setError((e as Error).message);}finally{loading.current=false;setLoadingOriginal(false);}};
 return <section className="ic-section ic-scan" aria-label="Document scan preview">
  <div className="ic-scan-heading"><div><h3>Preview your document</h3><p>Prepared automatically. Check that the whole page is clear. Your original stays unchanged.</p></div>
   {sampleFile?<Button busy={busy||loadingOriginal} disabled={disabled||confirmed||!!photo} onClick={load}>{sourceLabel}</Button>:<label className="h-field"><span>Choose photo · JPEG or PNG, up to 3 MB</span><input type="file" accept="image/jpeg,image/png" disabled={locked} onChange={e=>{const f=e.target.files?.[0];if(f)void prepare(f);}}/></label>}
  </div>
  {(busy||loadingOriginal)&&<p role="status">{loadingOriginal&&!busy?'Opening saved photo…':'Preparing scan…'}</p>}
  {error&&<p role="alert" className="h-notice error">{error}</p>}
  {photo&&<>
   <div className="ic-scan-view-switch" aria-label="Preview view"><Button variant={view==='photo'?'':'secondary'} aria-pressed={view==='photo'} onClick={()=>setView('photo')}>Photo & crop</Button><Button variant={view==='scan'?'':'secondary'} aria-pressed={view==='scan'} onClick={()=>setView('scan')}>Prepared scan</Button></div><div className={"ic-scan-images view-"+view}>
    <figure className="ic-scan-source"><figcaption><strong>Photo & crop</strong><a href={photo.originalUrl} target="_blank" rel="noreferrer">Open original</a></figcaption>
     <div className="ic-crop-frame" style={{maxWidth:420*photo.sourceWidth/photo.sourceHeight}}><svg ref={svg} className="ic-crop-editor" viewBox={`0 0 1000 ${1000*photo.sourceHeight/photo.sourceWidth}`} aria-label="Page crop. Drag a corner or use the position controls below."
      onPointerMove={e=>{if(drag.current===null||locked)return;const box=svg.current!.getBoundingClientRect();moveCorner(drag.current,(e.clientX-box.left)/box.width,(e.clientY-box.top)/box.height);}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <image href={photo.cropSourceUrl} width="1000" height={1000*photo.sourceHeight/photo.sourceWidth}/>
      <polygon points={points.map(p=>`${p.x*1000},${p.y*1000*photo.sourceHeight/photo.sourceWidth}`).join(' ')} fill="rgba(61,90,48,.06)" stroke="#c06610" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
      {points.map((p,i)=><circle key={i} cx={p.x*1000} cy={p.y*1000*photo.sourceHeight/photo.sourceWidth} r="25" role="button" tabIndex={locked?-1:0} aria-label={`${cornerNames[i]} crop corner. Use arrow keys to move.`} aria-disabled={locked}
       className={selected===i?'selected':''} onFocus={()=>setSelected(i)} onPointerDown={e=>{if(locked)return;e.preventDefault();setSelected(i);drag.current=i;e.currentTarget.setPointerCapture(e.pointerId);}}
       onKeyDown={e=>{if(locked)return;const step=e.shiftKey?.01:.002;const directions:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};const delta=directions[e.key];if(delta){e.preventDefault();moveCorner(i,p.x+delta[0],p.y+delta[1]);}}}/>)}
     </svg></div>
    </figure>
    <figure className="ic-scan-result"><figcaption><strong>{changed?'Previous preview — apply changes':'Prepared scan'}</strong><a href={photo.scanUrl} target="_blank" rel="noreferrer">Open full size</a></figcaption><img className={changed?'ic-scan-stale':''} src={sectionLines?photo.previewUrl:photo.scanUrl} alt="Prepared document scan for readability review"/></figure>
   </div>
   <details className="ic-scan-fine"><summary>Adjust photo (optional)</summary><fieldset disabled={locked} className="ic-scan-controls"><legend>Crop, rotate & light</legend>
    <div className="ic-scan-tools">
     <Button variant="secondary" onClick={()=>file&&void prepare(file,{...options,quarterTurns:options.quarterTurns+1,crop:'auto',corners:undefined})}>Rotate 90°</Button>
     <Button variant="secondary" onClick={()=>edit({...options,crop:'whole',corners:wholePageCorners()})}>Whole photo</Button>
     <Button variant="secondary" onClick={()=>file&&void prepare(file,{...options,crop:'auto',corners:undefined})}>Find page edges</Button>
     <label className="ic-scan-toggle"><input type="checkbox" checked={options.shadowReduction} onChange={e=>edit({...options,shadowReduction:e.target.checked})}/>Reduce shadows</label>
    </div>
    <details className="ic-scan-fine"><summary>Fine crop & straightening</summary><div className="ic-scan-fields">
     <label>Corner<select value={selected} onChange={e=>setSelected(Number(e.target.value))}>{cornerNames.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>
     <label>Across (%)<input type="number" min="0" max="100" step="1" value={Math.round(points[selected].x*100)} onChange={e=>{if(e.target.value!=='')moveCorner(selected,Number(e.target.value)/100,points[selected].y);}}/></label>
     <label>Down (%)<input type="number" min="0" max="100" step="1" value={Math.round(points[selected].y*100)} onChange={e=>{if(e.target.value!=='')moveCorner(selected,points[selected].x,Number(e.target.value)/100);}}/></label>
     <label>Straighten ({options.angle}°)<input type="range" min="-10" max="10" step="0.5" value={options.angle} onChange={e=>edit({...options,angle:Number(e.target.value)})}/></label>
     </div></details><Button disabled={!changed} onClick={()=>file&&void prepare(file,options)}>Apply adjustments</Button><p className="ic-scan-help">Include the heading and totals. Use Photo & crop to adjust the corners. Rotation finds the edges again.</p>
   <label className="ic-scan-toggle"><input type="checkbox" checked={sectionLines} onChange={e=>setSectionLines(e.target.checked)}/>Show reading section lines</label>{photo.flags.some(f=>f.code==='sections')&&<small>Check section breaks; the full page is also kept for reading.</small>}</fieldset></details>
   <div className="ic-scan-review" aria-live="polite"><h4>{changed?'Apply changes before checking':'Check before saving'}</h4>
    {!changed&&photo.flags.length>0&&<ul>{photo.flags.filter(f=>f.code!=='sections').map(f=><li key={f.code}><strong>{f.title}.</strong> {f.action}</li>)}</ul>}
    {!changed&&!photo.flags.length&&<p>No obvious image warning detected. This does not confirm that every figure is readable.</p>}
    <p>Check names, branch, reference, date, quantities, units, prices and totals. Shadow reduction cannot recover hidden text.</p>
    
    <fieldset disabled={locked||changed} className="ic-scan-readability"><legend>Can you read every item and figure?</legend>
     <label><input type="radio" name={'readability-'+photo.plan.documentHash} checked={readability==='yes'} onChange={()=>setReadability('yes')}/>Yes, clearly</label>
     <label><input type="radio" name={'readability-'+photo.plan.documentHash} checked={readability==='no'} onChange={()=>{setReadability('no');setChecked(false);}}/>No — needs a clearer photo</label>
    </fieldset>
    {readability==='no'&&<p role="alert">Retake in even light, with the phone steady and the whole page visible. Upload the clearer photo to this review; keep the original as evidence.</p>}
    <label className="ic-scan-toggle"><input type="checkbox" disabled={locked||changed||readability!=='yes'} checked={checked} onChange={e=>setChecked(e.target.checked)}/>I checked the warnings and the full page is included, upright and readable.</label>
   </div>
   <div className="ic-scan-save"><Button busy={busy} disabled={!allowSave} onClick={async()=>{
    if(!allowSave||running.current)return;running.current=true;setBusy(true);setError('');try{const result=await onConfirmed({...photo,plan:{...photo.plan,confirmed:true}});if(result!==false)setConfirmed(true);else setError('The scan was not saved. Check the message above before trying again.');}catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}
   }}>Save checked scan</Button><span>{confirmed?'Scan saved. AI reading is a separate step.':'Saving does not start AI reading or approve the invoice.'}</span></div>
   {confirmed&&<p role="status">The original and prepared scan are kept separately. Accounts must still check the extracted details.</p>}
  </>}
 </section>;
}
