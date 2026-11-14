import React,{useCallback,useEffect,useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceExtractionDraft,matchInvoiceExtraction,type MatchedInvoiceRow} from '../../shared/invoice-extraction';
import {currentUnitReviews,hasConfirmedUnitReview,invoiceUnitReviewProblems} from '../../shared/invoice-unit-review';
import {InvoiceBlankRowReview} from './InvoiceBlankRowReview';
import {useCheckWorkflow} from './CheckWorkflow';
import {Button,money} from './ui';
import {CaseDocuments,InvoiceField as Field} from './InvoiceCaseCommon';
import {InvoiceDraftFacts,InvoiceRowFacts} from './InvoiceDraftFacts';
import {suggestInvoiceItems,compareInvoiceUnits} from '../../shared/invoice-match-assistance';
import {InvoiceStoredPreparation} from './InvoiceStoredPreparation';

function UnitReview({record,row,disabled,confirm,onEditing}:{record:InvoiceCase;row:MatchedInvoiceRow;disabled:boolean;confirm:(data:any)=>Promise<any>;onEditing:(id:string,dirty:boolean)=>void}){
 const initialLine=row.lineId||'', [lineId,setLine]=useState(initialLine),[quantity,setQuantity]=useState(''),[price,setPrice]=useState(''),[reason,setReason]=useState(''),[productConfirmed,setProductConfirmed]=useState(false),[pack,setPack]=useState('');
 const suggestions=suggestInvoiceItems(record,row.source),suggestedIds=[...new Set([...row.candidateIds,...suggestions.map(s=>s.lineId)])];
 const choose=(id:string)=>{setLine(id);setQuantity('');setPrice('');setPack('');setReason('');setProductConfirmed(false);};
 const key=row.source.page+':'+row.source.row,edited=!!(lineId!==initialLine||quantity||price||reason||productConfirmed||pack);
 useEffect(()=>{onEditing(key,edited);return()=>onEditing(key,false);},[key,edited,onEditing]);
 const line=record.lines.find(l=>l.id===lineId),saved=currentUnitReviews(record).find(r=>r.page===row.source.page&&r.row===row.source.row),reading=invoiceExtractionDraft(record);
 if(!row.unitReviewRequired)return null;
 const current=saved&&hasConfirmedUnitReview(record,row.source.page,row.source.row),manual=!!line&&!row.candidateIds.includes(line.id);
 if(current)return <p className="ic-unit-saved"><strong>Item match & figures saved.</strong> {saved.quantity} {saved.unit} × £{saved.unitPrice.toFixed(2)}. Invoice approval is still separate.</p>;
 if(reading?.extracted.documentType!=='INVOICE'||record.documents.find(d=>d.id===reading?.documentId)?.kind!=='INVOICE')return <p className="h-notice">This reading is a delivery note or an unconfirmed document type. Upload and read the supplier invoice before using these figures as charges.</p>;
 const comparison=line?compareInvoiceUnits(record,row.source,line,pack===''?undefined:Number(pack)):undefined;
 const total=quantity!==''&&price!==''?Number(quantity)*Number(price):null,amountMatches=total!==null&&Number.isFinite(total)&&row.source.netAmount!==null&&Math.round(total*100)===Math.round(row.source.netAmount*100);
 const valid=!!line&&quantity!==''&&price!==''&&Number(quantity)>=0&&Number(price)>=0&&amountMatches&&reason.trim().length>=10&&(!manual||productConfirmed);
 return <div className="ic-unit-review">
  <h4>{row.candidateIds.length?'Check the pack or unit':'Choose the ordered item'}</h4>
  <Field label="Which ordered item is this?"><select value={lineId} disabled={disabled} onChange={e=>choose(e.target.value)}><option value="">Choose from this order</option>
   {!!suggestedIds.length&&<optgroup label="Suggested matches — check first">{record.lines.filter(l=>suggestedIds.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.name} · {l.ordered} {l.unit} ordered</option>)}</optgroup>}
   <optgroup label={suggestedIds.length?'Other items on this order':'Items on this order'}>{record.lines.filter(l=>!suggestedIds.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.name} · {l.ordered} {l.unit} ordered</option>)}</optgroup>
  </select></Field>
  {!!suggestions.length&&<div aria-label="Suggested order items"><p className="ic-step-note">Suggested matches — confirm before saving:</p>{suggestions.map(s=><div key={s.lineId}><Button variant="quiet" disabled={disabled} onClick={()=>choose(s.lineId)}>{s.name}</Button><small style={{display:'block'}}>{s.reason}{s.warnings.length?' · '+s.warnings.join(' '):' · Check product and pack.'}</small></div>)}</div>}
  {line&&comparison&&<div className="h-notice" aria-label="Pack and unit comparison">
   <strong>Invoice → order unit</strong>
   <p>{row.source.quantity??'?'} {row.source.unit||'unit unclear'} × {money(row.source.unitPrice??undefined)} · Printed line {money(row.source.netAmount??undefined)}</p>
   <p>Agreed order price: {line.expectedPrice!=null&&line.expectedPrice>0?money(line.expectedPrice)+' per '+line.unit:'Not confirmed'}</p>
   {comparison.canEnterPack&&<Field label={'Invoice units per ordered '+line.unit+' ('+(row.source.unit||'unit unclear')+')'}><input type="number" inputMode="decimal" min="0.000001" max="1000000" step="any" value={pack} disabled={disabled} placeholder="Use supplier pack label" onChange={e=>{setPack(e.target.value);setQuantity('');setPrice('');setReason('');setProductConfirmed(false);}}/></Field>}
   <p role="status">{comparison.message}</p>
   {comparison.proposal&&<><p><strong>{Number(comparison.proposal.quantity.toFixed(6))} {line.unit} × {money(comparison.proposal.unitPrice)} per {line.unit}</strong></p><Button variant="secondary" disabled={disabled} onClick={()=>{setQuantity(String(comparison.proposal!.quantity));setPrice(String(comparison.proposal!.unitPrice));}}>Use calculated draft</Button></>}
  </div>}
  {line&&<><p className="ic-step-note">The order uses <strong>{line.unit}</strong>. Check the pack size, then enter both figures in that unit. No conversion is guessed.</p>
   <div className="ic-unit-inputs"><Field label={'Invoice quantity ('+line.unit+')'}><input type="number" inputMode="decimal" min="0" max="1000000" step="any" value={quantity} disabled={disabled} onChange={e=>setQuantity(e.target.value)}/></Field><Field label={'Invoice price per '+line.unit+' (£)'}><input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={price} disabled={disabled} onChange={e=>setPrice(e.target.value)}/></Field></div>
   <p role="status" className={amountMatches?'ic-unit-total matched':'ic-unit-total'}>{total===null?'Enter both figures to check the total.':'Entered total £'+total.toFixed(2)} · Invoice line total {row.source.netAmount===null?'unreadable':'£'+row.source.netAmount.toFixed(2)}{total!==null&&!amountMatches?' — these must agree.':''}</p>
   {manual&&<label className="h-check"><input type="checkbox" checked={productConfirmed} disabled={disabled} onChange={e=>setProductConfirmed(e.target.checked)}/>I checked the product name/code and pack against this order item.</label>}
   <Field label="How did you check the pack or unit?"><input value={reason} maxLength={2000} disabled={disabled} placeholder="e.g. Supplier label confirms 12 packets in each ordered box" onChange={e=>setReason(e.target.value)}/></Field>
   <Button variant="secondary" disabled={disabled||!valid} onClick={async()=>{const result=await confirm({page:row.source.page,row:row.source.row,lineId,quantity:Number(quantity),unitPrice:Number(price),reason,productConfirmed});if(result){setQuantity('');setPrice('');setReason('');setProductConfirmed(false);setPack('');setLine(initialLine);}}}>Save item match & figures</Button>
  </>}
  <p className="ic-step-note">Unsure? Leave the figures blank and use Hold for information. Agreed prices will not change.</p>
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
     <UnitReview record={record} row={row} disabled={busy||dirty||lockedReading} confirm={data=>act('confirm-reading-units',data)} onEditing={onEditing}/>
     <InvoiceBlankRowReview record={record} row={row} disabled={busy||dirty||lockedReading} act={act} onEditing={onEditing}/>
     <details className="ic-reading-extra"><summary>More details from the reading{row.warnings.length?' ('+row.warnings.length+' notes)':''}</summary><p>Page {row.source.page}{row.source.sourceSection?', section '+row.source.sourceSection+', row '+row.source.sourceRow:', row '+row.source.row}. Check these draft details against the original.</p><InvoiceRowFacts row={row.source}/><ul>{row.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>
    </div>
   </details>)}
   {!lockedReading&&<Button variant="secondary" busy={busy} disabled={dirty||editing||!draft.rows.some(r=>r.mayUseFigures)} onClick={()=>void act('use-extraction')}>Use available draft figures</Button>}
   <p className="ic-step-note">Agreed prices and staff receipts stay unchanged. Invoice approval remains separate.</p></>}
 </details>;
}
