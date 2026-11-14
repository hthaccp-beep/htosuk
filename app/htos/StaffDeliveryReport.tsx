import {useInvoiceUploadPending} from './InvoiceUploadPreview';
import {LaterDeliveries} from './LaterDeliveries';
import React,{useEffect,useState} from 'react';
import type {OrderRecord} from '../../types';
import {returnLabels,type ReceiptReport,type ReceiptStatus,type ReceiptIssue} from '../../shared/invoice-case';
import {Button,Modal,Tag} from './ui';
import {InvoiceField as Field,useInvoiceCase,useInvoiceDraftGuard,DocumentUpload,CaseDocuments} from './InvoiceCaseCommon';
import './invoice-cases.css';

const staffStatuses:Record<ReceiptStatus,string>={RECEIVED:'Received',OUT_OF_STOCK:'Out of stock',MISSING:'Missing',DAMAGED:'Damaged',INCORRECT:'Incorrect',OTHER:'Other'};
const quantityLabels:Record<ReceiptIssue['kind'],string>={MISSING:'Qty missing',DAMAGED:'Qty damaged',INCORRECT:'Qty incorrect',OUT_OF_STOCK:'Qty out of stock',OTHER:'Quantity'};
const noteHints:Record<ReceiptIssue['kind'],string>={MISSING:'e.g. Two bags were not delivered',DAMAGED:'e.g. Bottles broken in one case',INCORRECT:'e.g. Wrong size or product supplied',OUT_OF_STOCK:'e.g. Supplier confirmed no stock',OTHER:'e.g. A page is missing from the paperwork'};

export function StaffDeliveryReport({order,onClose,showOriginal=false}:{order:OrderRecord;onClose:()=>void;showOriginal?:boolean}){
 const {record,busy,error,run,command}=useInvoiceCase(order.id);
 const [draft,setDraft]=useState<ReceiptReport|null>(null),[dirty,setDirty]=useState(false),[kind,setKind]=useState<'INVOICE'|'DELIVERY'>('INVOICE'),[saved,setSaved]=useState(''),[openItems,setOpenItems]=useState<Set<string>>(()=>new Set());
 useEffect(()=>{if(record&&!draft){setDraft(structuredClone(record.receipt));setOpenItems(new Set(record.receipt.issues.slice(0,1).map(i=>i.id)));}},[record,draft]);
 const {uploadPending,uploadBusy,onUploadPending}=useInvoiceUploadPending();
 useInvoiceDraftGuard(dirty||uploadPending,busy||uploadBusy);
 const change=(update:Partial<ReceiptReport>)=>{setDraft(d=>({...d!,...update}));setDirty(true);setSaved('');};
 const close=()=>{if(!busy&&!uploadBusy&&(!(dirty||uploadPending)||window.confirm('Discard unsaved delivery report changes?')))onClose();};
 const issue=(id:string,update:Partial<ReceiptIssue>)=>change({issues:draft!.issues.map(i=>i.id===id?{...i,...update}:i)});
 const toggle=(status:ReceiptStatus,checked:boolean)=>{
  const statuses=checked?status==='RECEIVED'?['RECEIVED'] as ReceiptStatus[]:[...draft!.statuses.filter(s=>s!=='RECEIVED'),status]:draft!.statuses.filter(s=>s!==status);
  change({statuses,issues:draft!.issues.filter(i=>statuses.includes(i.kind))});
 };
 const addIssue=(status:ReceiptIssue['kind'])=>{
  const id=crypto.randomUUID();change({issues:[...draft!.issues,{id,kind:status,notes:'',documentIds:[]}]});setOpenItems(old=>new Set([...old,id]));
 };
 const save=async(submit:boolean)=>{
  if(uploadPending)return;
  const result=await command(submit?'submit-receipt':'save-receipt',{receipt:draft});
  if(result){setDraft(structuredClone(result.record.receipt));setDirty(false);setSaved(submit?'Submitted for Accounts checking. This does not approve the invoice.':'Draft saved.');}
 };
 const locked=!!record?.receipt.submittedAt;
 return <Modal title="Upload document & report delivery" wide className="ic-compact-dialog ic-staff-report" onClose={close}>
  <div className="ic-intro"><div><h3>{order.branchNameSnapshot}</h3><p>{order.supplierNameSnapshot} · {order.id}</p></div><Tag>{locked?'Submitted for checking':'Staff delivery report'}</Tag></div>
  {error&&<p role="alert" className="h-notice error">{error}</p>}
  {saved&&<p role="status" className="h-notice">{saved}</p>}
  {!record||!draft?<p role="status">{error?'Your report has not been changed.':'Loading delivery report…'}</p>:<>
   <details className="ic-original-report" open={!locked||showOriginal}><summary hidden={!locked}>First delivery report — locked</summary>{locked&&<CaseDocuments record={record} ids={record.documents.filter(d=>['INVOICE','DELIVERY','EVIDENCE'].includes(d.kind)).map(d=>d.id)}/>}<fieldset disabled={busy||locked} className="ic-fieldset">
    <section className="ic-section">
     <h3>1. Upload invoice or delivery note</h3>
     {!locked&&<div className="ic-upload-grid">
      <Field label="Document type"><select value={kind} disabled={uploadPending} onChange={e=>setKind(e.target.value as 'INVOICE'|'DELIVERY')}><option value="INVOICE">Invoice</option><option value="DELIVERY">Delivery note</option></select></Field>
      <DocumentUpload onPendingChange={onUploadPending} record={record} run={run} kind={kind} label="Photograph or upload document" compact onUploaded={id=>change({documentIds:[...new Set([...draft.documentIds,id])],readable:false})}/>
     </div>}
     {!locked&&<CaseDocuments record={record} ids={record.documents.filter(d=>['INVOICE','DELIVERY'].includes(d.kind)).map(d=>d.id)}/>}
     <label className="h-check"><input type="checkbox" checked={draft.readable} onChange={e=>change({readable:e.target.checked})}/>I have checked all pages are complete and readable.</label>
    </section>
    <section className="ic-section">
     <h3>2. Tell Accounts what arrived</h3>
     <div className="ic-status-options">{Object.entries(staffStatuses).map(([key,label])=><label key={key} className={draft.statuses.includes(key as ReceiptStatus)?'selected':''}><input type="checkbox" checked={draft.statuses.includes(key as ReceiptStatus)} onChange={e=>toggle(key as ReceiptStatus,e.target.checked)}/>{label}</label>)}</div>
     <p className="ic-step-note">Choose all issues, or Received if there are none. HTOS still checks the invoice against the order and agreed prices.</p>
     {(Object.keys(staffStatuses) as ReceiptStatus[]).filter((s):s is ReceiptIssue['kind']=>s!=='RECEIVED'&&draft.statuses.includes(s)).map(status=><section key={status} className="ic-issue-group">
      <div className="ic-row"><h4>{staffStatuses[status]}{status==='OTHER'?'':' items'}</h4><Button variant="secondary" onClick={()=>addIssue(status)}>Add {status==='OTHER'?'description':'item'}</Button></div>
      {status==='OUT_OF_STOCK'&&<p className="ic-step-note">Select the item only: none arrived and the supplier confirmed no stock. Use Missing if some arrived.</p>}
      {draft.issues.filter(i=>i.kind===status).map((i,index)=>{
       const line=record.lines.find(l=>l.id===i.lineId);
       return <details className="ic-issue ic-report-item" key={i.id} open={openItems.has(i.id)} onToggle={e=>{const open=e.currentTarget.open;setOpenItems(old=>{if(old.has(i.id)===open)return old;const next=new Set(old);if(open)next.add(i.id);else next.delete(i.id);return next;});}}>
        <summary><span>{line?.name||(status==='OTHER'?'Other issue':'Select item '+(index+1))}</span><span className="ic-item-summary">{i.quantity!=null?i.quantity+' '+(line?.unit||'')+' '+staffStatuses[status].toLowerCase():status==='OTHER'?i.notes:'Enter quantity'}</span></summary>
        <div className="ic-item-fields">
         {status!=='OTHER'&&<div className="ic-item-grid">
          <Field label="Ordered item"><select value={i.lineId||''} onChange={e=>issue(i.id,{lineId:e.target.value,documentIds:[],quantity:status==='OUT_OF_STOCK'?record.lines.find(l=>l.id===e.target.value)?.ordered:undefined})}><option value="">Select an item</option>{record.lines.map(l=><option key={l.id} value={l.id}>{l.name} · {l.ordered} {l.unit} ordered</option>)}</select></Field>
          {status==='OUT_OF_STOCK'?<div className="ic-stock-summary">{line?<><strong>{locked?i.quantity:line.ordered} {line.unit} not supplied</strong><small>{locked?'Saved original report':'0 received · quantity recorded automatically'}</small>{!locked&&i.quantity!==line.ordered&&<small role="alert">This earlier draft has a partial quantity. Use Missing, or select the item again for full out of stock.</small>}</>:<small>Select an item to record its full quantity.</small>}</div>:<Field label={quantityLabels[status]+(line?' ('+line.unit+')':'')}><input type="number" inputMode="decimal" min="0" max={line?.ordered} step="1" value={i.quantity??''} onChange={e=>issue(i.id,{quantity:e.target.value===''?undefined:Number(e.target.value)})}/></Field>}
         </div>}
         {status==='MISSING'&&line&&<small>Enter how many are missing, not how many arrived. {line.ordered} {line.unit} ordered.</small>}
         <div className={status==='DAMAGED'||status==='INCORRECT'?'ic-item-grid':'ic-note-row'}>
          <Field label="Note / reason"><textarea rows={2} value={i.notes} maxLength={2000} placeholder={noteHints[status]} onChange={e=>issue(i.id,{notes:e.target.value})}/></Field>
          {['DAMAGED','INCORRECT'].includes(status)&&<Field label="What happened to these items?"><select value={i.outcome||''} onChange={e=>issue(i.id,{outcome:e.target.value as ReceiptIssue['outcome']})}><option value="">Choose an outcome</option>{Object.entries(returnLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>}
         </div>
         {status==='INCORRECT'&&<Field label="What actually arrived?"><input value={i.actualItem||''} onChange={e=>issue(i.id,{actualItem:e.target.value})}/></Field>}
         {i.lineId&&status==='DAMAGED'&&!locked&&<DocumentUpload onPendingChange={onUploadPending} record={record} run={run} kind="EVIDENCE" lineId={i.lineId} label="Damage photo (optional)" compact onUploaded={id=>issue(i.id,{documentIds:[...new Set([...i.documentIds,id])]})}/>}
         {!!i.documentIds.length&&<CaseDocuments record={record} ids={i.documentIds}/>}
         {!locked&&<div className="ic-item-actions"><Button variant="quiet" onClick={()=>change({issues:draft.issues.filter(v=>v.id!==i.id)})}>Remove item</Button><Button variant="secondary" onClick={()=>setOpenItems(old=>{const next=new Set(old);next.delete(i.id);return next;})}>Collapse item</Button></div>}
        </div>
       </details>;
      })}
     </section>)}
    </section>
   </fieldset></details>
   {draft.notes&&<details className="ic-saved-note"><summary>Previously saved delivery note</summary><p>{draft.notes}</p></details>}
   {locked&&<><p className="ic-step-note">Original report preserved. Accounts approval is separate.</p><LaterDeliveries record={record} disabled={busy||dirty} onChanged={async()=>{await run({action:'invoice-case-get'});}}/></>}
   {uploadPending&&<p role="status" className="ic-step-note">Finish uploading or cancel the selected file before saving the report.</p>}<div className="h-dialog-foot"><Button variant="secondary" onClick={close}>Close</Button>{!locked&&<><Button variant="secondary" busy={busy} disabled={uploadPending} onClick={()=>void save(false)}>Save draft</Button><Button busy={busy} disabled={uploadPending} onClick={()=>void save(true)}>Submit for checking</Button></>}</div>
  </>}
 </Modal>;
}
