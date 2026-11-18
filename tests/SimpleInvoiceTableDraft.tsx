import React,{useEffect,useMemo,useState} from 'react';
import {invoiceApprovalProblems,outstandingClaim,type InvoiceCase} from '../shared/invoice-case';
import {invoiceExtractionDraft} from '../shared/invoice-extraction';
import type {Product} from '../types';
import {buildSimpleInvoiceTable,computeTableTotalsCheck,type SimpleIssueTheme,type SimpleOrderedRow,type SimpleTableMark} from './simple-invoice-table';

const money=(v?:number)=>v==null?'—':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(v);
const toPounds=(pence?:number)=>pence==null?'':(pence/100).toFixed(2);
const parsePence=(raw:string):number|undefined=>{
 const trimmed=raw.trim();
 if(!trimmed)return undefined;
 const n=Number(trimmed);
 if(!Number.isFinite(n))return undefined;
 return Math.round(n*100);
};
const reqId=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

// 1x1 transparent PNG used for synthetic sample credit-note upload in offline preview.
const SAMPLE_PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

interface RowEdit {
 status?:string;
 mark?:SimpleTableMark;
 matchedProductId?:string;
 leaveUnmatched?:boolean;
}

const ROW_THEME_BG:Record<SimpleIssueTheme,string>={
 qty:'#fff1f2',
 price:'#fef9c3',
 detail:'#eff6ff',
 matched:'#f0fdf4',
};

function deriveRowVisual(r:SimpleOrderedRow & {status:string;mark:SimpleTableMark}){
 if(r.mark==='DONE'&&(r.status==='Matched'||r.status==='AI matched (confirm)'||!r.qtyDiffers&&!r.priceDiffers&&!r.codeDiffers&&!r.nameDiffers)){
  return {rowBg:'#f0fdf4',statusColor:'#166534'};
 }
 if(r.status==='Damage'||r.status==='Missing'||r.status==='Out of stock')return {rowBg:'#fff1f2',statusColor:'#9f1239'};
 if(r.status==='Price')return {rowBg:'#fef9c3',statusColor:'#92400e'};
 if(r.status==='ID / Name')return {rowBg:'#eff6ff',statusColor:'#1e40af'};
 const rowBg=ROW_THEME_BG[r.issueTheme];
 const statusColor=r.issueTheme==='qty'?'#9f1239':r.issueTheme==='price'?'#92400e':r.issueTheme==='detail'?'#1e40af':'#166534';
 return {rowBg,statusColor};
}

export function SimpleInvoiceTableDraft({
 request,
 products,
 onOpenClassic,
 onOpenWeeklyReport,
}:{
 request:(body:any)=>Promise<any>;
 products:Product[];
 onOpenClassic:()=>void;
 onOpenWeeklyReport:()=>void;
}){
 const [records,setRecords]=useState<InvoiceCase[]>([]);
 const [selectedId,setSelectedId]=useState<string>('');
 const [edits,setEdits]=useState<Record<string,RowEdit>>({});
 const [docModal,setDocModal]=useState<{name:string;src:string}|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');

 // Step 4: Invoice metadata, totals & verification state
 const [invoiceRef,setInvoiceRef]=useState('');
 const [invoiceDate,setInvoiceDate]=useState('');
 const [netInput,setNetInput]=useState('');
 const [vatInput,setVatInput]=useState('0.00');
 const [grossInput,setGrossInput]=useState('');
 const [adjInput,setAdjInput]=useState('0.00');
 const [matchingVerified,setMatchingVerified]=useState(false);
 const [totalsVerified,setTotalsVerified]=useState(false);
 const [stepDirty,setStepDirty]=useState(false);

 // Step 4b: Email & Credit note state
 const [emailTo,setEmailTo]=useState('supplier@example.invalid');
 const [emailBody,setEmailBody]=useState('');
 const [creditRef,setCreditRef]=useState('');
 const [creditNetInput,setCreditNetInput]=useState('');
 const [creditVatInput,setCreditVatInput]=useState('0.00');
 const [creditGrossInput,setCreditGrossInput]=useState('');
 const [creditVerified,setCreditVerified]=useState(false);

 const syncFormFromRecord=(rec:InvoiceCase)=>{
  const ext=invoiceExtractionDraft(rec)?.extracted;
  setInvoiceRef(rec.invoiceReference||ext?.reference||'');
  setInvoiceDate(rec.invoiceDate||ext?.date||'2026-11-11');
  const netP=rec.invoiceNetPence??(ext?.net!=null?Math.round(ext.net*100):undefined);
  const vatP=rec.invoiceVatPence??(ext?.vat!=null?Math.round(ext.vat*100):0);
  const grossP=rec.invoiceGrossPence??(ext?.gross!=null?Math.round(ext.gross*100):undefined);
  const adjP=rec.adjustmentPence??(ext?.adjustment!=null?Math.round(ext.adjustment*100):0);
  setNetInput(toPounds(netP));
  setVatInput(toPounds(vatP));
  setGrossInput(toPounds(grossP));
  setAdjInput(toPounds(adjP));
  setMatchingVerified(rec.matchingVerified);
  setTotalsVerified(rec.totalsVerified);
  setEmailTo(rec.claim?.recipient||'supplier@example.invalid');
  setEmailBody(rec.claim?.message||'');
  const remPence=outstandingClaim(rec);
  const defaultCredRef=`CR-${rec.invoiceReference||ext?.reference||rec.id}`;
  setCreditRef(defaultCredRef);
  setCreditNetInput(remPence>0?(remPence/100).toFixed(2):'');
  setCreditVatInput('0.00');
  setCreditGrossInput(remPence>0?(remPence/100).toFixed(2):'');
  setCreditVerified(false);
  setStepDirty(false);
 };

 const load=async(preferId?:string)=>{
  setBusy(true);setError('');
  try{
   const res=await request({action:'invoice-case-list'});
   const list=(res.records||[]) as InvoiceCase[];
   setRecords(list);
   const chosen=preferId&&list.find(r=>r.id===preferId)?list.find(r=>r.id===preferId)!
    :list.find(r=>r.id==='DEMO-ORDER-002')||list[0];
   if(chosen){
    setSelectedId(chosen.id);
    syncFormFromRecord(chosen);
   }
  }catch(e:any){
   setError(e?.message||'Could not load sample invoices.');
  }finally{
   setBusy(false);
  }
 };

 useEffect(()=>{void load();},[]);

 const record=useMemo(()=>records.find(r=>r.id===selectedId)||records[0]||null,[records,selectedId]);
 const model=useMemo(()=>record?buildSimpleInvoiceTable(record,products):null,[record,products]);

 const effectiveOrdered=useMemo(()=>{
  if(!model)return [];
  return model.ordered.map(r=>{
   const ed=edits[r.id]||{};
   return {
    ...r,
    status:ed.status??r.statusLabel,
    mark:ed.mark??r.defaultMark,
   };
  });
 },[model,edits]);

 const effectiveUnmatched=useMemo(()=>{
  if(!model)return [];
  return model.unmatched.map(r=>{
   const ed=edits[r.id]||{};
   const matchedOpt=ed.matchedProductId?model.supplierOptions.find(o=>o.id===ed.matchedProductId):undefined;
   const status=matchedOpt?`Matched: ${matchedOpt.name}`:ed.leaveUnmatched?'Unauthorised (leave unmatched)':r.statusLabel;
   const mark:SimpleTableMark=ed.mark??(matchedOpt?'DONE':'FOLLOW');
   return {...r,matchedOpt,leaveUnmatched:!!ed.leaveUnmatched,status,mark,selectedProductId:ed.matchedProductId||''};
  });
 },[model,edits]);

 const netPence=parsePence(netInput);
 const vatPence=parsePence(vatInput);
 const grossPence=parsePence(grossInput);
 const adjustmentPence=parsePence(adjInput)??0;

 const totalsCheck=useMemo(
  ()=>computeTableTotalsCheck(effectiveOrdered,effectiveUnmatched,{netPence,vatPence,grossPence,adjustmentPence}),
  [effectiveOrdered,effectiveUnmatched,netPence,vatPence,grossPence,adjustmentPence],
 );

 const followCount=effectiveOrdered.filter(r=>r.mark==='FOLLOW').length+effectiveUnmatched.filter(r=>r.mark==='FOLLOW').length;
 const doneCount=effectiveOrdered.filter(r=>r.mark==='DONE').length+effectiveUnmatched.filter(r=>r.mark==='DONE').length;

 const claimableRows=effectiveOrdered.filter(r=>r.mark==='FOLLOW'&&r.creditEstimatePence>0);
 const noteOnlyFollowRows=effectiveOrdered.filter(r=>r.mark==='FOLLOW'&&r.creditEstimatePence===0);
 const estimatedFollowPence=claimableRows.reduce((s,r)=>s+r.creditEstimatePence,0);
 const claimLocked=!!record?.claim&&['SENT','SENDING','UNCERTAIN'].includes(record.claim.state);
 const isApproved=record?.status==='APPROVED';

 const updateRecordState=(next:InvoiceCase,sync=true)=>{
  setRecords(prev=>prev.map(r=>r.id===next.id?next:r));
  if(sync)syncFormFromRecord(next);
 };

 const runCommand=async(current:InvoiceCase,command:Record<string,any>):Promise<InvoiceCase>=>{
  const res=await request({
   action:'invoice-case-command',
   caseId:current.id,
   command:{...command,requestId:reqId(command.kind||'cmd'),expectedVersion:current.version},
  });
  return res.record as InvoiceCase;
 };

 const viewDoc=async()=>{
  if(!record?.documents.length)return;
  setBusy(true);setError('');
  try{
   const doc=record.documents.find(d=>d.kind==='INVOICE')||record.documents[0];
   const res=await request({action:'invoice-case-document',caseId:record.id,documentId:doc.id});
   setDocModal({name:res.name||doc.name,src:`data:${res.mime||'image/png'};base64,${res.base64}`});
  }catch(e:any){
   setError(e?.message||'Unable to load document preview.');
  }finally{
   setBusy(false);
  }
 };

 const runAiCheck=async()=>{
  if(!record)return;
  setBusy(true);setError('');setNotice('');
  try{
   const res=await request({action:'invoice-case-read',caseId:record.id,documentId:record.documents[0]?.id});
   if(res?.record){
    updateRecordState(res.record,true);
    setEdits({});
    setNotice('AI cross-check updated: colour highlights show price (yellow), ID/name (blue), quantity (red) and extra items (purple).');
   }
  }catch(e:any){
   setError(e?.message||'Unable to run sample AI check.');
  }finally{
   setBusy(false);
  }
 };

 const saveReviewCommand=async(current:InvoiceCase):Promise<InvoiceCase>=>{
  const docId=current.invoiceDocumentId||current.documents.find(d=>d.kind==='INVOICE')?.id||'';
  if(!docId)throw new Error('Upload or select an original invoice document first.');
  if(!invoiceRef.trim())throw new Error('Enter the supplier invoice reference.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate.trim()))throw new Error('Enter a valid invoice date (YYYY-MM-DD).');
  if(netPence==null||vatPence==null||grossPence==null)throw new Error('Enter Invoice Net, VAT and Gross amounts in pounds.');

  const linesPayload=current.lines.map(orig=>{
   const row=effectiveOrdered.find(r=>r.lineId===orig.id);
   const billedQty=row?.receiveBilledQty??row?.receiveQty??orig.ordered;
   const billedPrice=row?.receivePrice??orig.expectedPrice;
   const mark=row?.mark??'FOLLOW';
   const claimable=mark==='FOLLOW'&&(row?.creditEstimatePence??0)>0;
   const resolution=mark==='DONE'?'ACCEPT':row?.status==='Hold'?'HOLD':claimable?'CLAIM':'ACCEPT';
   const reasonText=(row?.mismatchReasons.join('; ')||(mark==='FOLLOW'&&!claimable?`${row?.status||'Detail check'} (£0 financial claim)`:row?.status)||orig.reason||'Confirmed in simple invoice table').trim();
   return {
    id:orig.id,
    invoiceQuantity:billedQty,
    invoicePrice:billedPrice,
    reviewed:true,
    resolution,
    reason:reasonText,
   };
  });

  const saved=await runCommand(current,{
   kind:'save-review',
   lines:linesPayload,
   invoiceReference:invoiceRef.trim(),
   invoiceDate:invoiceDate.trim(),
   invoiceDocumentId:docId,
   invoiceNetPence:netPence,
   invoiceVatPence:vatPence,
   invoiceGrossPence:grossPence,
   adjustmentPence,
   matchingVerified,
   totalsVerified,
   previewResolvedExtras:effectiveUnmatched.filter(u=>u.matchedOpt||u.leaveUnmatched).map(u=>u.id),
   notes:noteOnlyFollowRows.length?`Non-financial wording/ID notes: ${noteOnlyFollowRows.map(r=>`${r.orderProductName} (${r.status})`).join('; ')}`:current.notes,
  });
  return saved;
 };

 const handleUseAiFigures=async()=>{
  if(!record)return;
  setBusy(true);setError('');setNotice('');
  try{
   const updated=await runCommand(record,{kind:'use-extraction'});
   updateRecordState(updated,true);
   setNotice('Copied unambiguous AI figures into draft fields. Review and tick both check boxes before saving.');
  }catch(e:any){
   setError(e?.message||'Unable to copy AI draft figures.');
  }finally{
   setBusy(false);
  }
 };

 const handleSaveReview=async()=>{
  if(!record)return;
  setBusy(true);setError('');setNotice('');
  try{
   const saved=await saveReviewCommand(record);
   updateRecordState(saved,true);
   setNotice(`Review saved for ${saved.invoiceReference} (${doneCount} Done · ${followCount} Follow).`);
  }catch(e:any){
   setError(e?.message||'Could not save review.');
  }finally{
   setBusy(false);
  }
 };

 const handlePrepareAndApproveClaim=async()=>{
  if(!record)return;
  setBusy(true);setError('');setNotice('');
  try{
   if(!matchingVerified||!totalsVerified){
    throw new Error('Tick both verification check boxes (Products/units checked and Totals agree) before preparing a claim.');
   }
   if(effectiveUnmatched.some(u=>!u.matchedOpt&&!u.leaveUnmatched)){
    throw new Error('Choose a supplier item or click Leave unmatched on each extra item at the bottom of the table first.');
   }
   if(claimableRows.length===0){
    throw new Error('Mark at least one item with a price, missing or damage difference as Follow before preparing a credit claim.');
   }
   let latest=record;
   if(stepDirty||!latest.claim||latest.totalsVerified!==totalsVerified||latest.matchingVerified!==matchingVerified){
    latest=await saveReviewCommand(latest);
   }
   if(!latest.claim){
    latest=await runCommand(latest,{kind:'prepare-claim'});
   }
   if(latest.claim?.state==='DRAFT'){
    latest=await runCommand(latest,{kind:'approve-claim'});
   }
   updateRecordState(latest,true);
   const claimTotal=(latest.claim?.lines.reduce((s,l)=>s+l.netPence,0)??0)/100;
   setNotice(`Claim prepared & approved (${money(claimTotal)} net). Review supplier email below and click Send claim email (sample).`);
  }catch(e:any){
   setError(e?.message||'Could not prepare credit claim.');
  }finally{
   setBusy(false);
  }
 };

 const handleSendClaimEmail=async()=>{
  if(!record?.claim)return;
  setBusy(true);setError('');setNotice('');
  try{
   if(!emailTo.trim()||!/^\S+@\S+\.\S+$/.test(emailTo.trim())){
    throw new Error('Enter a valid supplier email address.');
   }
   if(!emailBody.trim()){
    throw new Error('Enter the email message to send to the supplier.');
   }
   const previewRes=await request({action:'invoice-case-email-preview',caseId:record.id,recipient:emailTo.trim(),message:emailBody.trim()});
   const approveRes=await request({
    action:'invoice-case-email-approve',
    caseId:record.id,
    expectedVersion:record.version,
    recipient:emailTo.trim(),
    message:emailBody.trim(),
    fingerprint:previewRes?.preview?.fingerprint||'synthetic-fp',
   });
   const sendRes=await request({
    action:'invoice-case-email-send',
    caseId:record.id,
    expectedVersion:approveRes.record.version,
   });
   const sent=sendRes.record as InvoiceCase;
   updateRecordState(sent,true);
   setNotice(`Simulated claim email recorded for ${sent.invoiceReference}. Status is now Waiting for credit note — record credit below once received.`);
  }catch(e:any){
   setError(e?.message||'Could not simulate claim email.');
  }finally{
   setBusy(false);
  }
 };

 const handleRecordAndApproveCredit=async()=>{
  if(!record?.claim||record.claim.state!=='SENT')return;
  setBusy(true);setError('');setNotice('');
  try{
   const cNet=parsePence(creditNetInput);
   const cVat=parsePence(creditVatInput)??0;
   const cGross=parsePence(creditGrossInput);
   if(!creditRef.trim())throw new Error('Enter the supplier credit note reference.');
   if(cNet==null||cNet<=0)throw new Error('Enter a positive credit net amount.');
   if(cGross==null||cNet+cVat!==cGross)throw new Error('Credit Net + VAT must equal Credit Gross.');
   if(!creditVerified)throw new Error('Tick the box confirming credit details match the supplier credit note.');

   let latest=record;
   let creditDocId=latest.documents.find(d=>d.kind==='CREDIT')?.id;
   if(!creditDocId){
    const uploadRes=await request({
     action:'invoice-case-upload',
     caseId:latest.id,
     expectedVersion:latest.version,
     kind:'CREDIT',
     name:`SAMPLE-${creditRef.trim()}.png`,
     mime:'image/png',
     base64:SAMPLE_PNG_BASE64,
    });
    creditDocId=uploadRes.documentId;
    latest=uploadRes.record as InvoiceCase;
   }

   let remaining=cNet;
   const allocLines:{lineId:string;netPence:number}[]=[];
   for(const cl of latest.claim!.lines){
    if(remaining<=0)break;
    const open=Math.max(0,cl.netPence-cl.creditedPence-cl.replacementPence);
    if(open<=0)continue;
    const take=Math.min(open,remaining);
    allocLines.push({lineId:cl.lineId,netPence:take});
    remaining-=take;
   }
   if(remaining>0||allocLines.length===0){
    throw new Error('Credit net amount exceeds the open claim balance.');
   }

   const afterRecord=await runCommand(latest,{
    kind:'record-credit',
    reference:creditRef.trim(),
    invoiceReference:latest.invoiceReference,
    supplierId:latest.supplierId,
    documentId:creditDocId,
    lines:allocLines,
    vatPence:cVat,
    grossPence:cGross,
    verified:true,
   });

   const draftCredit=afterRecord.credits.find(c=>c.status==='DRAFT');
   const afterApprove=draftCredit
    ?await runCommand(afterRecord,{kind:'approve-credit',creditId:draftCredit.id})
    :afterRecord;

   updateRecordState(afterApprove,true);
   setNotice(`Credit note ${creditRef.trim()} approved (${money(cGross/100)} gross). Weekly credit report updated.`);
  }catch(e:any){
   setError(e?.message||'Could not record and approve credit note.');
  }finally{
   setBusy(false);
  }
 };

 const handleApproveInvoice=async()=>{
  if(!record)return;
  setBusy(true);setError('');setNotice('');
  try{
   let latest=record;
   if(!claimLocked&&stepDirty){
    latest=await saveReviewCommand(latest);
   }
   const approved=await runCommand(latest,{kind:'approve-invoice'});
   updateRecordState(approved,true);
   setNotice(`Invoice ${approved.invoiceReference||approved.id} approved and locked.`);
  }catch(e:any){
   setError(e?.message||'Could not approve invoice yet.');
  }finally{
   setBusy(false);
  }
 };

 const extrasResolved=effectiveUnmatched.length>0&&effectiveUnmatched.every(u=>u.matchedOpt||u.leaveUnmatched);
 const approvalBlockers=(record?invoiceApprovalProblems(record):[]).filter(msg=>!(extrasResolved&&msg.includes('Confirm units and price basis')));
 const remainingClaimPence=record?outstandingClaim(record):0;

 return <div style={{maxWidth:1360,margin:'0 auto',padding:'48px 20px 48px',fontFamily:'inherit',color:'#1c2b1a'}}>
  <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',alignItems:'flex-end',gap:16,marginBottom:16}}>
   <div>
    <div style={{fontSize:12,fontWeight:600,letterSpacing:'0.04em',color:'#4a6147',marginBottom:4}}>Draft comparison layout · Offline sample preview</div>
    <h1 style={{margin:0,fontSize:28,fontWeight:700,color:'#162815'}}>Simple invoice check table</h1>
    <p style={{margin:'6px 0 0',fontSize:14,color:'#4c5c49'}}>
     Side-by-side Order vs Receive view with automatic colour coding by issue type and direct claim &amp; credit note follow-up below.
    </p>
   </div>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
    <button type="button" className="h-button secondary" onClick={onOpenClassic}>← Current 9.20 view</button>
    <button type="button" className="h-button secondary" onClick={onOpenWeeklyReport}>Weekly credit report →</button>
   </div>
  </div>

  <div style={{background:'#ffffff',border:'1px solid #d7ddd2',borderRadius:10,padding:16,marginBottom:14,display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:12}}>
   <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:14}}>
    <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
     <span>Sample invoice</span>
     <select
      value={selectedId}
      onChange={e=>{
       const nextId=e.target.value;
       setSelectedId(nextId);
       setEdits({});
       setNotice('');
       setError('');
       const nextRec=records.find(r=>r.id===nextId);
       if(nextRec)syncFormFromRecord(nextRec);
      }}
      style={{minWidth:300,padding:'8px 10px',borderRadius:6,border:'1px solid #c3cbbd',background:'#fff',fontSize:14}}>
      {records.map(r=><option key={r.id} value={r.id}>{r.id} · {r.invoiceReference||'Draft AI check'} ({r.supplierName})</option>)}
     </select>
    </label>
    {record&&<div style={{fontSize:13,color:'#4c5c49',lineHeight:1.5}}>
     <div>
      <strong>Branch:</strong> {record.branchName} · <strong>Supplier:</strong> {record.supplierName} · <strong>Status:</strong>{' '}
      <strong style={{color:record.status==='APPROVED'?'#166534':'#1c2b1a'}}>{record.status.replaceAll('_',' ')}</strong>
     </div>
     <div>1. Staff report → 2. AI cross-check → 3. Review &amp; mark table → 4. Totals, claim &amp; credit → 5. Weekly report</div>
    </div>}
   </div>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
    <button type="button" className="h-button secondary" disabled={busy||!record?.documents.length} onClick={()=>void viewDoc()}>View document (PNG)</button>
    <button type="button" className="h-button secondary" disabled={busy||!record||claimLocked||isApproved} onClick={()=>void runAiCheck()}>Run sample AI cross-check</button>
   </div>
  </div>

  {error&&<div role="alert" className="h-notice error" style={{marginBottom:12}}>{error}</div>}
  {notice&&<div role="status" className="h-notice success" style={{marginBottom:12}}>{notice}</div>}

  {model&&<div style={{background:'#fff',border:'1px solid #cbd3c6',borderRadius:10,overflow:'hidden',marginBottom:18}}>
   <div style={{padding:'10px 14px',background:'#f8faf6',borderBottom:'1px solid #d7ddd2',display:'flex',flexWrap:'wrap',justifyContent:'space-between',alignItems:'center',gap:12,fontSize:12,color:'#334431'}}>
    <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:14}}>
     <span style={{fontWeight:700,color:'#183016'}}>Colour key:</span>
     <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
      <span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:'#fde68a',border:'1px solid #d97706',display:'inline-block'}}/>
      <strong>Price differs</strong>
     </span>
     <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
      <span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:'#bfdbfe',border:'1px solid #2563eb',display:'inline-block'}}/>
      <strong>ID / Name / Unit differs</strong>
     </span>
     <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
      <span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:'#fecdd3',border:'1px solid #dc2626',display:'inline-block'}}/>
      <strong>Missing / Damage</strong>
     </span>
     <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
      <span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:'#e9d5ff',border:'1px solid #7c3aed',display:'inline-block'}}/>
      <strong>Extra item (not on order)</strong>
     </span>
     <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
      <span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:'#dcfce7',border:'1px solid #16a34a',display:'inline-block'}}/>
      <strong>Matched / Done</strong>
     </span>
    </div>
    <div style={{fontVariantNumeric:'tabular-nums',fontWeight:600}}>
     <span>{doneCount} Done</span> · <span>{followCount} Follow</span> · <span>{effectiveUnmatched.length} Unmatched</span> · Est. claim {money(estimatedFollowPence/100)}
    </div>
   </div>

   <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,fontVariantNumeric:'tabular-nums',minWidth:1100}}>
     <thead>
      <tr>
       <th colSpan={5} style={{background:'#edf2ea',color:'#183016',padding:'10px 10px',textAlign:'center',fontWeight:700,borderBottom:'1px solid #cbd3c6',borderRight:'2px solid #2b4429'}}>
        Order (Saved HTOS order)
       </th>
       <th colSpan={5} style={{background:'#f3f5ef',color:'#183016',padding:'10px 10px',textAlign:'center',fontWeight:700,borderBottom:'1px solid #cbd3c6',borderRight:'2px solid #2b4429'}}>
        Receive (Delivery &amp; Supplier invoice)
       </th>
       <th rowSpan={2} style={{background:'#eef1eb',color:'#183016',padding:'10px 10px',textAlign:'left',fontWeight:700,borderBottom:'2px solid #2b4429',borderRight:'1px solid #d7ddd2',minWidth:204}}>
        Status
       </th>
       <th rowSpan={2} style={{background:'#eef1eb',color:'#183016',padding:'10px 10px',textAlign:'center',fontWeight:700,borderBottom:'2px solid #2b4429',minWidth:136}}>
        Mark
       </th>
      </tr>
      <tr style={{background:'#f8faf6',color:'#3d4d3b',fontSize:12}}>
       <th style={{padding:'7px 8px',textAlign:'center',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',width:42}}>No</th>
       <th style={{padding:'7px 8px',textAlign:'left',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',width:84}}>Product ID</th>
       <th style={{padding:'7px 8px',textAlign:'left',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',minWidth:155}}>Product Name</th>
       <th style={{padding:'7px 8px',textAlign:'right',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',width:78}}>Price</th>
       <th style={{padding:'7px 8px',textAlign:'right',borderBottom:'2px solid #2b4429',borderRight:'2px solid #2b4429',width:78}}>Qty</th>
       <th style={{padding:'7px 8px',textAlign:'center',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',width:42}}>No</th>
       <th style={{padding:'7px 8px',textAlign:'left',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',width:84}}>Product ID</th>
       <th style={{padding:'7px 8px',textAlign:'left',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',minWidth:175}}>Product Name</th>
       <th style={{padding:'7px 8px',textAlign:'right',borderBottom:'2px solid #2b4429',borderRight:'1px solid #e1e6dd',width:82}}>Price</th>
       <th style={{padding:'7px 8px',textAlign:'right',borderBottom:'2px solid #2b4429',borderRight:'2px solid #2b4429',width:108}}>Qty</th>
      </tr>
     </thead>
     <tbody>
      {effectiveOrdered.map(r=>{
       const {rowBg,statusColor}=deriveRowVisual(r);
       const billedDiff=r.receiveBilledQty!=null&&r.receiveQty!=null&&r.receiveBilledQty!==r.receiveQty;
       const idCellBg=r.codeDiffers?'#bfdbfe':undefined;
       const nameCellBg=r.nameDiffers?'#bfdbfe':undefined;
       const priceCellBg=r.priceDiffers?'#fde68a':undefined;
       const qtyCellBg=r.qtyDiffers?'#fecdd3':r.unitCheckRequired?'#bfdbfe':undefined;

       return <tr key={r.id} style={{background:rowBg,borderBottom:'1px solid #dde3d8'}}>
        <td style={{padding:'9px 8px',textAlign:'center',borderRight:'1px solid #e6ebe2',color:'#5c6a5a'}}>{r.orderNo}</td>
        <td style={{padding:'9px 8px',borderRight:'1px solid #e6ebe2',fontWeight:600}}>{r.orderProductId}</td>
        <td style={{padding:'9px 8px',borderRight:'1px solid #e6ebe2'}}><strong>{r.orderProductName}</strong></td>
        <td style={{padding:'9px 8px',textAlign:'right',borderRight:'1px solid #e6ebe2'}}>{money(r.orderPrice)}</td>
        <td style={{padding:'9px 8px',textAlign:'right',borderRight:'2px solid #2b4429'}}>{r.orderQty} {r.orderUnit}</td>

        <td style={{padding:'9px 8px',textAlign:'center',borderRight:'1px solid #e6ebe2',color:'#5c6a5a'}}>{r.receiveNo}</td>
        <td style={{padding:'9px 8px',borderRight:'1px solid #e6ebe2',background:idCellBg,color:r.codeDiffers?'#1e40af':undefined,fontWeight:r.codeDiffers?700:500}}>{r.receiveProductId}</td>
        <td style={{padding:'9px 8px',borderRight:'1px solid #e6ebe2',background:nameCellBg,color:r.nameDiffers?'#1e40af':undefined,fontWeight:r.nameDiffers?600:400}}>{r.receiveProductName}</td>
        <td style={{padding:'9px 8px',textAlign:'right',borderRight:'1px solid #e6ebe2',background:priceCellBg,color:r.priceDiffers?'#92400e':undefined,fontWeight:r.priceDiffers?700:500}}>{money(r.receivePrice)}</td>
        <td style={{padding:'9px 8px',textAlign:'right',borderRight:'2px solid #2b4429',background:qtyCellBg,color:r.qtyDiffers?'#9f1239':r.unitCheckRequired?'#1e40af':undefined,fontWeight:r.qtyDiffers||r.unitCheckRequired?700:500}}>
         <div>{r.receiveQty!=null?`${r.receiveQty} ${r.orderUnit}`:(r.receiveBilledQty!=null?`${r.receiveBilledQty} ${r.receiveUnit}`:'—')}</div>
         {billedDiff&&<div style={{fontSize:11,color:'#475569',fontWeight:500}}>Invoiced: {r.receiveBilledQty} {r.receiveUnit}</div>}
        </td>

        <td style={{padding:'8px 8px',borderRight:'1px solid #e6ebe2'}}>
         <select
          aria-label={`Status for ${r.orderProductName}`}
          disabled={claimLocked||isApproved}
          value={r.status}
          onChange={e=>{
           setStepDirty(true);
           setEdits(prev=>({...prev,[r.id]:{...prev[r.id],status:e.target.value,mark:(e.target.value==='Matched'||e.target.value==='AI matched (confirm)')?'DONE':'FOLLOW'}}));
          }}
          style={{width:'100%',minWidth:188,padding:'5px 6px',borderRadius:5,border:'1px solid #cfd6ca',background:'#fff',fontSize:12,fontWeight:600,color:statusColor}}>
          {![r.status,'Matched','AI matched (confirm)','Damage','Missing','Price','ID / Name','Out of stock','Hold'].includes(r.status)&&<option value={r.status}>{r.status}</option>}
          {Array.from(new Set([r.statusLabel,'Matched','AI matched (confirm)','Damage','Missing','Price','ID / Name','Out of stock','Hold'])).map(opt=><option key={opt} value={opt}>{opt}</option>)}
         </select>
         {r.mismatchReasons.length>0&&<div style={{fontSize:11,color:statusColor,marginTop:3,fontWeight:500}}>{r.mismatchReasons.join(' · ')}</div>}
        </td>

        <td style={{padding:'8px 8px',textAlign:'center'}}>
         <div style={{display:'inline-flex',border:'1px solid #c3cbbd',borderRadius:6,overflow:'hidden',background:'#fff'}}>
          {(['DONE','FOLLOW'] as const).map(choice=>(
           <button
            key={choice}
            type="button"
            disabled={claimLocked||isApproved}
            aria-pressed={r.mark===choice}
            onClick={()=>{
             setStepDirty(true);
             setEdits(prev=>({...prev,[r.id]:{...prev[r.id],mark:choice}}));
            }}
            style={{
             padding:'5px 10px',
             border:'none',
             fontSize:12,
             fontWeight:600,
             cursor:claimLocked||isApproved?'default':'pointer',
             background:r.mark===choice?(choice==='DONE'?'#1d3b1b':'#b45309'):'transparent',
             color:r.mark===choice?'#fff':'#3d4d3b',
            }}>
            {choice==='DONE'?'Done':'Follow'}
           </button>
          ))}
         </div>
        </td>
       </tr>;
      })}

      <tr style={{background:'#f3f5ef',borderTop:'2px solid #2b4429',borderBottom:'1px solid #cbd3c6'}}>
       <td colSpan={5} style={{padding:'8px 10px',fontWeight:600,color:'#4c5c49',borderRight:'2px solid #2b4429'}}>
        Match to an existing item from {record?.supplierName} or leave unmatched
       </td>
       <td colSpan={7} style={{padding:'8px 10px',fontWeight:700,color:'#5b21b6'}}>
        Extra / unmatched items from invoice (not on original order: {effectiveUnmatched.length})
       </td>
      </tr>

      {effectiveUnmatched.length===0?<tr>
       <td colSpan={12} style={{padding:'12px 10px',color:'#5c6a5a',textAlign:'center'}}>
        No extra or unmatched items on this invoice.
       </td>
      </tr>:effectiveUnmatched.map(u=>(
       <tr key={u.id} style={{background:u.matchedOpt&&u.mark==='DONE'?'#f0fdf4':'#f3e8ff',borderBottom:'1px solid #dde3d8'}}>
        <td colSpan={5} style={{padding:'9px 10px',borderRight:'2px solid #2b4429'}}>
         <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
          <select
           aria-label={`Match supplier item for ${u.receiveProductName}`}
           value={u.selectedProductId}
           onChange={e=>{
            const pid=e.target.value;
            setStepDirty(true);
            setEdits(prev=>({...prev,[u.id]:{matchedProductId:pid||undefined,leaveUnmatched:false,mark:pid?'DONE':'FOLLOW'}}));
           }}
           style={{flex:'1 1 200px',padding:'6px 8px',borderRadius:5,border:'1px solid #c3cbbd',background:'#fff',fontSize:12}}>
           <option value="">Match supplier item…</option>
           {model.supplierOptions.map(opt=><option key={opt.id} value={opt.id}>{opt.code} · {opt.name}{opt.price!=null?` (${money(opt.price)})`:''}</option>)}
          </select>
          <button
           type="button"
           onClick={()=>{
            setStepDirty(true);
            setEdits(prev=>({...prev,[u.id]:{matchedProductId:undefined,leaveUnmatched:true,mark:'FOLLOW'}}));
           }}
           style={{padding:'6px 9px',borderRadius:5,border:'1px solid #6d28d9',background:u.leaveUnmatched?'#6d28d9':'#fff',color:u.leaveUnmatched?'#fff':'#5b21b6',fontSize:12,fontWeight:600,cursor:'pointer'}}>
           Leave unmatched
          </button>
         </div>
        </td>
        <td style={{padding:'9px 8px',textAlign:'center',borderRight:'1px solid #e6ebe2',color:'#5b21b6',fontWeight:600}}>{u.receiveNo}</td>
        <td style={{padding:'9px 8px',borderRight:'1px solid #e6ebe2',fontWeight:700,color:'#5b21b6'}}>{u.receiveProductId}</td>
        <td style={{padding:'9px 8px',borderRight:'1px solid #e6ebe2',color:'#3b0764'}}><strong>{u.receiveProductName}</strong></td>
        <td style={{padding:'9px 8px',textAlign:'right',borderRight:'1px solid #e6ebe2'}}>{money(u.receivePrice)}</td>
        <td style={{padding:'9px 8px',textAlign:'right',borderRight:'2px solid #2b4429'}}>{u.receiveQty??'—'} {u.receiveUnit}</td>
        <td style={{padding:'9px 8px',borderRight:'1px solid #e6ebe2',fontWeight:600,color:u.matchedOpt?'#166534':'#5b21b6'}}>
         {u.status}
        </td>
        <td style={{padding:'9px 8px',textAlign:'center'}}>
         <div style={{display:'inline-flex',border:'1px solid #c3cbbd',borderRadius:6,overflow:'hidden',background:'#fff'}}>
          {(['DONE','FOLLOW'] as const).map(choice=>(
           <button
            key={choice}
            type="button"
            aria-pressed={u.mark===choice}
            onClick={()=>{
             setStepDirty(true);
             setEdits(prev=>({...prev,[u.id]:{...prev[u.id],mark:choice}}));
            }}
            style={{
             padding:'5px 10px',
             border:'none',
             fontSize:12,
             fontWeight:600,
             cursor:'pointer',
             background:u.mark===choice?(choice==='DONE'?'#1d3b1b':'#6d28d9'):'transparent',
             color:u.mark===choice?'#fff':'#3d4d3b',
            }}>
            {choice==='DONE'?'Done':'Follow'}
           </button>
          ))}
         </div>
        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>
  </div>}

  {record&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:16,alignItems:'stretch'}}>
   <section aria-label="Step 4a: Invoice totals and approval" style={{background:'#fff',border:'1px solid #cbd3c6',borderRadius:10,padding:18,display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
     <h2 style={{margin:0,fontSize:17,fontWeight:700,color:'#162815'}}>Step 4a · Totals &amp; Invoice Check</h2>
     {invoiceExtractionDraft(record)&&!claimLocked&&!isApproved&&(
      <button type="button" className="h-button secondary" style={{padding:'5px 10px',fontSize:12}} disabled={busy} onClick={()=>void handleUseAiFigures()}>
       Use AI draft figures
      </button>
     )}
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
     <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
      <span>Invoice reference</span>
      <input value={invoiceRef} disabled={claimLocked||isApproved} onChange={e=>{setInvoiceRef(e.target.value);setStepDirty(true);}} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13}}/>
     </label>
     <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
      <span>Invoice date</span>
      <input type="date" value={invoiceDate} disabled={claimLocked||isApproved} onChange={e=>{setInvoiceDate(e.target.value);setStepDirty(true);}} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13}}/>
     </label>
     <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
      <span>Invoice net (£)</span>
      <input type="number" step="0.01" value={netInput} disabled={claimLocked||isApproved} onChange={e=>{setNetInput(e.target.value);setStepDirty(true);}} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13,fontVariantNumeric:'tabular-nums'}}/>
     </label>
     <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
      <span>VAT (£)</span>
      <input type="number" step="0.01" value={vatInput} disabled={claimLocked||isApproved} onChange={e=>{setVatInput(e.target.value);setStepDirty(true);}} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13,fontVariantNumeric:'tabular-nums'}}/>
     </label>
     <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
      <span>Invoice gross (£)</span>
      <input type="number" step="0.01" value={grossInput} disabled={claimLocked||isApproved} onChange={e=>{setGrossInput(e.target.value);setStepDirty(true);}} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13,fontVariantNumeric:'tabular-nums'}}/>
     </label>
     <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
      <span>Charges / extras (£)</span>
      <input type="number" step="0.01" value={adjInput} disabled={claimLocked||isApproved} onChange={e=>{setAdjInput(e.target.value);setStepDirty(true);}} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13,fontVariantNumeric:'tabular-nums'}}/>
     </label>
    </div>

    <div style={{background:'#f8faf6',border:'1px solid #e1e6dd',borderRadius:6,padding:'10px 12px',fontSize:12.5,color:'#334431',fontVariantNumeric:'tabular-nums',display:'flex',flexWrap:'wrap',justifyContent:'space-between',alignItems:'center',gap:8}}>
     <div>
      <div>Ordered lines billed: <strong>{money(totalsCheck.orderedLineBilledSumPence/100)}</strong> · Extra unmatched: <strong>{money(totalsCheck.unmatchedExtraSumPence/100)}</strong> · Net check:{' '}
       <strong style={{color:totalsCheck.linesPlusAdjustmentMatchesNet?'#166534':'#92400e'}}>
        {totalsCheck.linesPlusAdjustmentMatchesNet?'Matches Invoice Net':totalsCheck.differenceToNetPence!=null?`${money(totalsCheck.differenceToNetPence/100)} difference`:'Check figures'}
       </strong>
      </div>
     </div>
     {!totalsCheck.linesPlusAdjustmentMatchesNet&&totalsCheck.differenceToNetPence===totalsCheck.unmatchedExtraSumPence&&totalsCheck.unmatchedExtraSumPence>0&&!claimLocked&&!isApproved&&(
      <button type="button" className="h-button secondary" style={{padding:'4px 9px',fontSize:12}} onClick={()=>{setAdjInput((totalsCheck.unmatchedExtraSumPence/100).toFixed(2));setStepDirty(true);}}>
       Allocate extra {money(totalsCheck.unmatchedExtraSumPence/100)} to charges
      </button>
     )}
    </div>

    <div style={{display:'flex',flexDirection:'column',gap:6,fontSize:13}}>
     <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:claimLocked||isApproved?'default':'pointer'}}>
      <input type="checkbox" checked={matchingVerified} disabled={claimLocked||isApproved} onChange={e=>{setMatchingVerified(e.target.checked);setStepDirty(true);}}/>
      <span>Supplier, branch, products, packs/units and extra items checked against original document.</span>
     </label>
     <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:claimLocked||isApproved?'default':'pointer'}}>
      <input type="checkbox" checked={totalsVerified} disabled={claimLocked||isApproved} onChange={e=>{setTotalsVerified(e.target.checked);setStepDirty(true);}}/>
      <span>Line totals, charges/discounts and VAT agree with printed invoice totals.</span>
     </label>
    </div>

    {!isApproved&&approvalBlockers.length>0&&(
     <div style={{fontSize:12,color:'#5c6a5a',background:'#f8faf6',border:'1px solid #e1e6dd',borderRadius:6,padding:'8px 10px'}}>
      <strong>Before invoice approval:</strong> {approvalBlockers.slice(0,2).join(' · ')}{approvalBlockers.length>2?` (+${approvalBlockers.length-2} more)`:''}
     </div>
    )}

    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:'auto'}}>
     <button type="button" className="h-button secondary" disabled={busy||claimLocked||isApproved} onClick={()=>void handleSaveReview()}>
      Save review
     </button>
     <button type="button" className="h-button" disabled={busy||isApproved} onClick={()=>void handleApproveInvoice()}>
      {isApproved?'Invoice approved':'Approve invoice'}
     </button>
    </div>
   </section>

   <section aria-label="Step 4b: Claim and credit note follow-up" style={{background:'#fff',border:'1px solid #cbd3c6',borderRadius:10,padding:18,display:'flex',flexDirection:'column',gap:12}}>
    <h2 style={{margin:0,fontSize:17,fontWeight:700,color:'#162815'}}>Step 4b · Claim &amp; Credit Note Follow-up</h2>

    {!record.claim&&(
     <>
      <div style={{fontSize:13,color:'#334431'}}>
       <div><strong>{claimableRows.length}</strong> claimable item{claimableRows.length===1?'':'s'} marked Follow · Estimated claim: <strong>{money(estimatedFollowPence/100)}</strong> net</div>
       {claimableRows.length>0&&<ul style={{margin:'6px 0 0',paddingLeft:18,fontSize:12.5,color:'#4c5c49'}}>
        {claimableRows.map(r=><li key={r.id}>{r.orderProductName}: {money(r.creditEstimatePence/100)} ({r.status})</li>)}
       </ul>}
       {noteOnlyFollowRows.length>0&&<div style={{marginTop:6,fontSize:12,color:'#1e40af'}}>
        Detail notes (£0 financial claim, saved to review notes): {noteOnlyFollowRows.map(r=>`${r.orderProductName} (${r.status})`).join(', ')}
       </div>}
      </div>
      <div style={{marginTop:'auto'}}>
       <button type="button" className="h-button" disabled={busy||isApproved||claimableRows.length===0} onClick={()=>void handlePrepareAndApproveClaim()}>
        1. Prepare &amp; approve claim ({money(estimatedFollowPence/100)})
       </button>
      </div>
     </>
    )}

    {record.claim&&record.claim.state!=='SENT'&&(
     <>
      <div style={{fontSize:13,color:'#162815',fontVariantNumeric:'tabular-nums'}}>
       <strong>Claim {record.claim.state.toLowerCase()}</strong> · {money(record.claim.lines.reduce((s,l)=>s+l.netPence,0)/100)} net
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
       <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
        <span>Supplier email</span>
        <input type="email" value={emailTo} onChange={e=>setEmailTo(e.target.value)} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13}}/>
       </label>
       <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,fontWeight:600,color:'#41543f'}}>
        <span>Claim email message</span>
        <textarea rows={3} value={emailBody} onChange={e=>setEmailBody(e.target.value)} style={{padding:'7px 9px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:12.5}}/>
       </label>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:'auto'}}>
       {record.claim.state==='DRAFT'&&<button type="button" className="h-button secondary" disabled={busy} onClick={()=>void handlePrepareAndApproveClaim()}>Approve claim</button>}
       <button type="button" className="h-button" disabled={busy||record.claim.state!=='APPROVED'} onClick={()=>void handleSendClaimEmail()}>
        2. Send claim email (sample)
       </button>
      </div>
     </>
    )}

    {record.claim?.state==='SENT'&&(
     <>
      <div style={{fontSize:13,color:'#334431',fontVariantNumeric:'tabular-nums'}}>
       <div><strong>Claim sent</strong> ({record.claim.recipient}) · Remaining open balance: <strong>{money(remainingClaimPence/100)}</strong></div>
       {record.credits.length>0&&<ul style={{margin:'6px 0 0',paddingLeft:18,fontSize:12.5,color:'#166534'}}>
        {record.credits.map(c=><li key={c.id}>{c.reference} · {money(c.grossPence/100)} gross ({c.status==='APPROVED'?'Approved':'Awaiting approval'})</li>)}
       </ul>}
      </div>

      {remainingClaimPence>0&&!isApproved?(
       <div style={{display:'flex',flexDirection:'column',gap:8,borderTop:'1px solid #e1e6dd',paddingTop:10}}>
        <div style={{fontSize:13,fontWeight:700,color:'#162815'}}>3. Record &amp; approve supplier credit note</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8}}>
         <label style={{display:'flex',flexDirection:'column',gap:3,fontSize:12,fontWeight:600,color:'#41543f'}}>
          <span>Credit ref</span>
          <input value={creditRef} onChange={e=>setCreditRef(e.target.value)} style={{padding:'6px 8px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13}}/>
         </label>
         <label style={{display:'flex',flexDirection:'column',gap:3,fontSize:12,fontWeight:600,color:'#41543f'}}>
          <span>Credit net (£)</span>
          <input type="number" step="0.01" value={creditNetInput} onChange={e=>setCreditNetInput(e.target.value)} style={{padding:'6px 8px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13,fontVariantNumeric:'tabular-nums'}}/>
         </label>
         <label style={{display:'flex',flexDirection:'column',gap:3,fontSize:12,fontWeight:600,color:'#41543f'}}>
          <span>VAT (£)</span>
          <input type="number" step="0.01" value={creditVatInput} onChange={e=>setCreditVatInput(e.target.value)} style={{padding:'6px 8px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13,fontVariantNumeric:'tabular-nums'}}/>
         </label>
         <label style={{display:'flex',flexDirection:'column',gap:3,fontSize:12,fontWeight:600,color:'#41543f'}}>
          <span>Credit gross (£)</span>
          <input type="number" step="0.01" value={creditGrossInput} onChange={e=>setCreditGrossInput(e.target.value)} style={{padding:'6px 8px',border:'1px solid #c3cbbd',borderRadius:6,fontSize:13,fontVariantNumeric:'tabular-nums'}}/>
         </label>
        </div>
        <label style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:12.5,cursor:'pointer'}}>
         <input type="checkbox" checked={creditVerified} onChange={e=>setCreditVerified(e.target.checked)}/>
         <span>Supplier credit document uploaded and amounts verified.</span>
        </label>
        <div>
         <button type="button" className="h-button" disabled={busy} onClick={()=>void handleRecordAndApproveCredit()}>
          Record &amp; approve credit note
         </button>
        </div>
       </div>
      ):(
       <div style={{fontSize:13,color:'#166534',fontWeight:600}}>
        All claim items settled. Check Weekly credit report → or approve invoice on the left.
       </div>
      )}
     </>
    )}
   </section>
  </div>}

  {docModal&&<div role="dialog" aria-modal="true" aria-label={docModal.name} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,zIndex:50}}>
   <div style={{background:'#fff',borderRadius:10,maxWidth:760,width:'100%',maxHeight:'90vh',overflow:'auto',padding:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
     <strong>{docModal.name}</strong>
     <button type="button" className="h-button secondary" onClick={()=>setDocModal(null)}>Close</button>
    </div>
    <img src={docModal.src} alt={docModal.name} style={{width:'100%',height:'auto',border:'1px solid #d7ddd2',borderRadius:6}}/>
   </div>
  </div>}
 </div>;
}
