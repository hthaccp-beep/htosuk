import React,{useEffect,useRef,useState} from 'react';
import {api,Button,Field,Modal,useAction} from './ui';
import {IssuesInbox} from './IssuesInbox';
import {prepareHelpImage} from './help-images';
import type {HelpImage,HelpRequest} from '../../shared/help';
import release from '../../app-version.json';
import './help.css';
const request:HelpRequest=body=>api('/api/admin/workspace',body);
export default function HelpPanel({owner,page,onClose,send=request}:{owner:boolean;page:string;onClose:()=>void;send?:HelpRequest}){
  const [tab,setTab]=useState<'report'|'issues'>('report'),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[steps,setSteps]=useState(''),[expected,setExpected]=useState('');
  const [images,setImages]=useState<HelpImage[]>([]),[consent,setConsent]=useState(false),[reviewed,setReviewed]=useState(false),[sent,setSent]=useState(''),[discard,setDiscard]=useState(false),[childDirty,setChildDirty]=useState(false),[childBusy,setChildBusy]=useState(false);
  const action=useAction(),id=useRef(crypto.randomUUID()),busy=action.busy||childBusy;
  const dirty=!sent&&!!(title||description||steps||expected||images.length||consent||reviewed)||childDirty;
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const close=()=>{if(busy)return;if(dirty)setDiscard(true);else onClose();};
  const reset=()=>{setTitle('');setDescription('');setSteps('');setExpected('');setImages([]);setConsent(false);setReviewed(false);setSent('');id.current=crypto.randomUUID();action.setError('');};
  return <Modal title="Help & issues" onClose={close} wide className="h-help-modal"><div className="h-help">
    <div className="h-help-tabs"><button type="button" aria-pressed={tab==='report'} disabled={busy} onClick={()=>setTab('report')}>Report a problem</button>{owner&&<button type="button" aria-pressed={tab==='issues'} disabled={busy} onClick={()=>setTab('issues')}>Owner Issues inbox</button>}</div>
    <section hidden={tab!=='report'}>
      {sent?<div className="h-help-sent" role="status"><h3>Report sent to the owner</h3><p>Reference: <strong>{sent.slice(0,8).toUpperCase()}</strong></p><p>Your business records have not changed. Any repair needs the owner’s approval before release.</p><Button onClick={reset}>Report another problem</Button></div>:<form onSubmit={event=>{event.preventDefault();void action.run(async()=>{const result=await send({action:'help-submit',id:id.current,report:{title,description,steps,expected,page,version:release.version,images,aiConsent:consent,reviewed}});setSent(result.id);},'');}}>
        <p>Tell us what went wrong. The owner can review your report and screenshots here.</p>
        <div className="h-help-context">Page: {page==='/'?'Overview':page} · Version {release.version}</div>
        <fieldset disabled={busy} className="h-help-fields">
          <Field label="Short summary"><input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="For example: CSV preview will not open"/></Field>
          <Field label="What happened?"><textarea aria-label="What happened?" required maxLength={3000} rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Include any error message, without private details."/></Field>
          <div className="h-help-columns"><Field label="Steps to repeat (optional)"><textarea aria-label="Steps to repeat (optional)" maxLength={2000} rows={3} value={steps} onChange={e=>setSteps(e.target.value)}/></Field><Field label="What should happen? (optional)"><textarea aria-label="What should happen? (optional)" maxLength={1000} rows={3} value={expected} onChange={e=>setExpected(e.target.value)}/></Field></div>
          <Field label={`Screenshots (${images.length}/2)`}><input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={images.length>=2} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void action.run(async()=>{if(files.length+images.length>2)throw new Error('Attach up to two screenshots. Remove one before adding another.');const prepared=await Promise.all(files.map(prepareHelpImage));setImages(current=>[...current,...prepared]);},'');}}/></Field>
          <small>PNG, JPEG or WebP, up to 5 MB each. Crop or hide passwords, keys and personal details first. Images are resized before sending.</small>
          <div className="h-help-images">{images.map((image,index)=><figure key={index}><img src={`data:${image.mimeType};base64,${image.data}`} alt={`Screenshot ${index+1} preview`}/><Button type="button" variant="quiet" onClick={()=>setImages(images.filter((_,i)=>i!==index))}>Remove screenshot {index+1}</Button></figure>)}</div>
          <label className="h-help-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Allow the owner to send this report and screenshots to Google Gemini for AI analysis. Optional; AI findings are suggestions.</span></label>
          <label className="h-help-check"><input type="checkbox" required checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>I have checked the report and screenshots and removed sensitive information. They will be stored privately for the owner.</span></label>
        </fieldset>{action.feedback}<div className="h-help-actions"><Button type="button" variant="quiet" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" busy={action.busy} disabled={!reviewed||busy}>Send report</Button></div>
      </form>}
    </section>
    {owner&&<section hidden={tab!=='issues'}><IssuesInbox active={tab==='issues'} send={send} onDirty={setChildDirty} onBusy={setChildBusy}/></section>}
    {discard&&<Modal title="Discard unsaved work?" onClose={()=>setDiscard(false)}><p>Your unsent report or repair proposal will be lost. Saved issues will stay in the inbox.</p><div className="h-help-actions"><Button onClick={()=>setDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard and close</Button></div></Modal>}
  </div></Modal>;
}
