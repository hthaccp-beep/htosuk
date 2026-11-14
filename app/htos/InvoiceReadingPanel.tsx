import React,{useCallback,useEffect,useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceExtractionDraft,matchInvoiceExtraction} from '../../shared/invoice-extraction';
import {hasConfirmedUnitReview,invoiceUnitReviewProblems} from '../../shared/invoice-unit-review';
import {InvoiceBlankRowReview} from './InvoiceBlankRowReview';
import {useCheckWorkflow} from './CheckWorkflow';
import {Button,money} from './ui';
import {CaseDocuments,InvoiceField as Field} from './InvoiceCaseCommon';
import {InvoiceDraftFacts,InvoiceRowFacts} from './InvoiceDraftFacts';
import {InvoiceMatchConfirmation} from './InvoiceMatchConfirmation';
import {InvoiceStoredPreparation} from './InvoiceStoredPreparation';

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
 return <details id="ic-review-reading" tabIndex={-1} className="ic-section ic-reading-panel" style={{minWidth:0,overflowWrap:'anywhere'}} open={!!state?.canPrepare||!!state?.canRead}><summary>{draft?'Scanned invoice details':'Open document to read'}</summary>
  <p>Check the original, prepare a readable scan, then read it. AI results stay drafts until Accounts checks them.</p>
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
   {!!invoiceUnitReviewProblems(record).length&&<p className="ic-reading-next"><strong>Next:</strong> Open each row marked “Check item / units”. Match it to an ordered item and confirm the figures. Unclear rows stay on hold.</p>}
   <details className="ic-reading-warnings"><summary>Details needing correction or confirmation ({draft.warnings.length})</summary><ul>{draft.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>
   {draft.rows.map(row=><details id={'ic-reading-row-'+row.source.page+'-'+row.source.row} tabIndex={-1} className="ic-issue ic-reading-row" key={row.source.page+':'+row.source.row}><summary><strong>{row.source.description}</strong><span className="ic-reading-row-status">{row.blankConfirmed?'Blank — not charged':row.blankReviewRequired?'Check blank row':hasConfirmedUnitReview(record,row.source.page,row.source.row)?'Item / units saved':row.unitReviewRequired?'Check item / units':row.mayUseFigures?'Draft match':'Review required'}</span><small>Invoice: {row.source.quantity??'?'} {row.source.unit||'units unclear'} × {money(row.source.unitPrice??undefined)} = {money(row.source.netAmount??undefined)}</small></summary>
    <div className="ic-reading-row-body">
     <InvoiceMatchConfirmation key={draft.documentHash+':'+record.version} record={record} row={row} disabled={busy||dirty||lockedReading} confirm={data=>act('confirm-reading-units',data)} onEditing={onEditing}/>
     <InvoiceBlankRowReview record={record} row={row} disabled={busy||dirty||lockedReading} act={act} onEditing={onEditing}/>
     <details className="ic-reading-extra"><summary>More details from the reading{row.warnings.length?' ('+row.warnings.length+' notes)':''}</summary><p>Page {row.source.page}{row.source.sourceSection?', section '+row.source.sourceSection+', row '+row.source.sourceRow:', row '+row.source.row}. Check these draft details against the original.</p><InvoiceRowFacts row={row.source}/><ul>{row.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>
    </div>
   </details>)}
   {!lockedReading&&<Button variant="secondary" busy={busy} disabled={dirty||editing||!draft.rows.some(r=>r.mayUseFigures)} onClick={()=>void act('use-extraction')}>Use available draft figures</Button>}
   <p className="ic-step-note">Agreed prices and staff receipts stay unchanged. Invoice approval remains separate.</p></>}
 </details>;
}
