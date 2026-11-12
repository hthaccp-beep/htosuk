import React,{useCallback,useEffect,useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceExtractionDraft,matchInvoiceExtraction,type MatchedInvoiceRow} from '../../shared/invoice-extraction';
import {currentUnitReviews,hasConfirmedUnitReview,invoiceUnitReviewProblems} from '../../shared/invoice-unit-review';
import {InvoiceBlankRowReview} from './InvoiceBlankRowReview';
import {useCheckWorkflow} from './CheckWorkflow';
import {Button} from './ui';
import {CaseDocuments,InvoiceField as Field} from './InvoiceCaseCommon';
import {InvoiceDraftFacts,InvoiceRowFacts} from './InvoiceDraftFacts';
import {InvoiceStoredPreparation} from './InvoiceStoredPreparation';

function UnitReview({record,row,disabled,confirm,onEditing}:{record:InvoiceCase;row:MatchedInvoiceRow;disabled:boolean;confirm:(data:any)=>Promise<any>;onEditing:(id:string,dirty:boolean)=>void}){
 const [lineId,setLine]=useState(row.lineId||row.candidateIds[0]||''),[quantity,setQuantity]=useState(''),[price,setPrice]=useState(''),[reason,setReason]=useState('');
 const key=row.source.page+':'+row.source.row,edited=!!(quantity||price||reason);
 useEffect(()=>{onEditing(key,edited);return()=>onEditing(key,false);},[key,edited,onEditing]);
 const line=record.lines.find(l=>l.id===lineId),saved=currentUnitReviews(record).find(r=>r.page===row.source.page&&r.row===row.source.row);
 if(!row.unitReviewRequired)return null;
 const current=saved&&hasConfirmedUnitReview(record,row.source.page,row.source.row);
 return <div className="ic-unit-review">
  <p className="ic-step-note"><strong>{current?'Units confirmed by Accounts':'Unclear units — Accounts review required'}</strong>{current&&<> · {saved.quantity} {saved.unit} × £{saved.unitPrice.toFixed(2)} · {saved.reason}</>}</p>
  {!current&&<><p>Confirm the supplier pack/weight and price basis first. Enter figures in the ordered unit; their amount must equal the printed row.</p>
   <div className="ic-figures"><Field label="Matching ordered item"><select value={lineId} disabled={disabled} onChange={e=>setLine(e.target.value)}><option value="">Choose item</option>{record.lines.filter(l=>row.candidateIds.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.name} · {l.unit}</option>)}</select></Field>
   <Field label={`Invoice quantity (${line?.unit||'ordered unit'})`}><input type="number" min="0" step="any" value={quantity} disabled={disabled} onChange={e=>setQuantity(e.target.value)}/></Field>
   <Field label={`Price per ${line?.unit||'ordered unit'} (£)`}><input type="number" min="0" step="0.01" value={price} disabled={disabled} onChange={e=>setPrice(e.target.value)}/></Field></div>
   <Field label="Confirmed basis and evidence"><input value={reason} maxLength={2000} disabled={disabled} placeholder="For example: supplier pack specification and agreed price checked" onChange={e=>setReason(e.target.value)}/></Field>
   <Button variant="secondary" disabled={disabled||!lineId||quantity===''||price===''||reason.trim().length<10} onClick={async()=>{const result=await confirm({page:row.source.page,row:row.source.row,lineId,quantity:Number(quantity),unitPrice:Number(price),reason});if(result){setQuantity('');setPrice('');setReason('');}}}>Confirm units and use these figures</Button>
   {!row.candidateIds.length&&<p>No exact product candidate. Keep this on hold for product allocation; do not guess a substitute.</p>}</>}
 </div>;
}

export function InvoiceReadingPanel({record,busy,dirty,locked,preview,run,act,onChanged,onDirty}:{record:InvoiceCase;busy:boolean;dirty:boolean;locked:boolean;preview:boolean;run:(body:any)=>Promise<any>;act:(kind:string,payload?:any)=>Promise<any>;onChanged:(record:InvoiceCase)=>void;onDirty:(value:boolean)=>void}){
 const request=useCheckWorkflow(),saved=invoiceExtractionDraft(record),draft=saved?matchInvoiceExtraction(record,saved.documentId,saved.extracted):null;
 const [edits,setEdits]=useState<Record<string,boolean>>({}),[photoDirty,setPhotoDirty]=useState(false),[refresh,setRefresh]=useState(0),editing=Object.values(edits).some(Boolean);
 const onEditing=useCallback((id:string,value:boolean)=>setEdits(old=>old[id]===value?old:{...old,[id]:value}),[]);
 useEffect(()=>{onDirty(editing||photoDirty);return()=>onDirty(false);},[editing,photoDirty,onDirty]);
 const documents=record.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind));
 const [documentId,setDocument]=useState(draft?.documentId||documents[0]?.id||''),[state,setState]=useState<{state:string;canRead:boolean;canRecover:boolean;enabled:boolean;completed?:number;total?:number;prepared?:boolean;canPrepare?:boolean;preparationRequired?:boolean}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setState(null);setError('');if(documentId)request({action:'invoice-case-reading-status',caseId:record.id,documentId}).then(s=>{if(active)setState(s);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request,record.id,record.version,documentId,refresh]);
 const execute=async(action:string)=>{const result=await run({action,documentId,documentIds:[documentId],expectedVersion:record.version});if(result?.record)onChanged(result.record);else if(result?.reading)setState({...result.reading,enabled:true,canRead:result.reading.state==='PAUSED',canRecover:false});else setRefresh(v=>v+1);};
 const lockedReading=locked||!!record.claim||!!record.laterReceipts?.some(r=>r.status==='APPROVED');
 return <details className="ic-section ic-reading-panel" style={{minWidth:0,overflowWrap:'anywhere'}} open={!!draft}><summary>Invoice reading & matching{draft?` · ${draft.rows.filter(r=>!r.blankConfirmed).length} billed / unclear rows`:' · awaiting reading'}</summary>
  <p>Readings are drafts. Accounts checks the original; only clear matches can fill blank fields.</p>
  {!lockedReading&&<div className="ic-row"><Field label="Document to read"><select value={documentId} disabled={busy||dirty||photoDirty||editing} onChange={e=>setDocument(e.target.value)}>{documents.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
   {state?.canRead&&<Button busy={busy} disabled={dirty||editing||photoDirty} onClick={()=>void execute('invoice-case-read')}>{state.state==='PAUSED'?'Continue unread sections':preview?'Read sample document':'Read document'}</Button>}
   {state?.canRecover&&<Button busy={busy} disabled={dirty||editing} onClick={()=>void execute('invoice-case-reading-recover')}>Recover saved reading — no new AI call</Button>}</div>}
  {dirty&&<p className="ic-step-note">Save your Accounts changes before reading or confirming units.</p>}
  {error&&<p role="alert">{error}</p>}
  {!lockedReading&&state?.canPrepare&&<InvoiceStoredPreparation key={documentId} record={record} documentId={documentId} disabled={busy||dirty||editing} onDirty={setPhotoDirty} onSaved={()=>setRefresh(v=>v+1)}/>}
  {state?.prepared&&!draft&&<p role="status">Prepared photo saved and locked to this original.</p>}
  {!photoDirty&&!busy&&<Button variant="quiet" onClick={()=>setRefresh(v=>v+1)}>Refresh reading status</Button>}
  {state?.preparationRequired&&!state.canPrepare&&!state.prepared&&!draft&&<p>Choose a JPEG or PNG photo for preparation. PDF reading is not connected to this worker yet.</p>}
  {state&&!state.enabled&&!draft&&<p>Document reading is not enabled. Accounts can review the original manually.</p>}
  {state?.state==='FAILED_OR_UNCERTAIN'&&<p role="alert">Reading stopped. No automatic retry; check the saved attempt and usage first.</p>}
  {state?.state==='RUNNING'&&<p role="status">Reading submitted. No duplicate request will be sent.</p>}
  {state?.state==='PAUSED'&&<p role="status">{state.completed} of {state.total} sections saved. Continue with unread sections; completed sections will not be requested again.</p>}
  {draft&&<><CaseDocuments record={record} ids={[draft.documentId]}/><InvoiceDraftFacts draft={draft.extracted}/>
   {!!draft.extracted.blankRows?.length&&<details><summary>{draft.extracted.blankRows.length} blank catalogue row{draft.extracted.blankRows.length===1?'':'s'} — not charged</summary><p>{draft.extracted.blankRows.map(r=>r.description).join(' · ')}</p><p>Blank does not mean zero delivered or out of stock.</p></details>}
   {invoiceUnitReviewProblems(record).map(p=><p className="h-notice" key={p}>{p}</p>)}
   <details><summary>Document checks ({draft.warnings.length})</summary><ul>{draft.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>
   {draft.rows.map(row=><details className="ic-issue" key={row.source.page+':'+row.source.row}><summary><strong>{row.source.description}</strong> · Qty {row.source.quantity??'unknown'} {row.source.unit||''} · Printed price {row.source.unitPrice??'unknown'} · {row.blankConfirmed?'Blank — not charged':row.blankReviewRequired?'Review blank row':hasConfirmedUnitReview(record,row.source.page,row.source.row)?'Units confirmed':row.unitReviewRequired?'Check units':row.mayUseFigures?'Draft match':'Review required'}</summary>
    <p>{row.source.description} · Page {row.source.page}{row.source.sourceSection?`, section ${row.source.sourceSection}, row ${row.source.sourceRow}`:`, row ${row.source.row}`} · Printed amount {row.source.netAmount??'unknown'} {draft.extracted.currency||'(currency unknown)'}</p>
    <InvoiceRowFacts row={row.source}/><ul>{row.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
    <InvoiceBlankRowReview record={record} row={row} disabled={busy||dirty||lockedReading} act={act} onEditing={onEditing}/>
    <UnitReview record={record} row={row} disabled={busy||dirty||lockedReading} confirm={data=>act('confirm-reading-units',data)} onEditing={onEditing}/>
   </details>)}
   {!lockedReading&&<Button variant="secondary" busy={busy} disabled={dirty||editing||!draft.rows.some(r=>r.mayUseFigures)} onClick={()=>void act('use-extraction')}>Use available draft figures</Button>}
   <p className="ic-step-note">Agreed prices and staff receipts stay unchanged. Invoice approval remains separate.</p></>}
 </details>;
}
