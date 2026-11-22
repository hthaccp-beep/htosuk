import React,{useEffect,useMemo,useRef,useState} from 'react';
import {buildSimpleInvoiceTable,computeClaimSummaryMetrics,computeTableTotalsCheck,formatInvoiceWorkspaceTitle,summarizeInvoiceChecklist,type ChecklistJumpTarget,type SimpleIssueTheme,type SimpleOrderedRow,type SimpleTableMark} from '../../shared/simple-invoice-table';
import {caseStatusLabels,invoiceApprovalProblems,outstandingClaim,receiptStatusLabels,type InvoiceCase} from '../../shared/invoice-case';
import {invoiceExtractionDraft} from '../../shared/invoice-extraction';
import {invoiceRecordStatus} from '../../shared/invoice-review-status';
import {canReportLaterDelivery} from '../../shared/later-delivery';
import {useAppStore} from '../../store';
import {useCheckWorkflow} from './CheckWorkflow';
import {CaseDocuments,DocumentUpload,InvoiceField as Field,useInvoiceCase,useInvoiceDraftGuard} from './InvoiceCaseCommon';
import {InvoiceClaimEmail} from './InvoiceClaimEmail';
import {InvoiceReadingPanel} from './InvoiceReadingPanel';
import {useInvoiceUploadPending} from './InvoiceUploadPreview';
import {LaterDeliveries} from './LaterDeliveries';
import {Button,Heading,Tag,day,money} from './ui';
import {Check,ChevronDown,ChevronUp,Copy,FileText,PanelRightClose,PanelRightOpen,X} from 'lucide-react';
import './invoice-cases.css';

interface RowEdit {
 status?:string;
 mark?:SimpleTableMark;
 invoiceQty?:string;
 invoicePrice?:string;
}

type WorkspaceTab='CHECK'|'CREDITS'|'AUDIT';

const SAMPLE_CREDIT_PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const toPounds=(pence?:number)=>pence==null?'':(pence/100).toFixed(2);
const parsePence=(raw:string):number|undefined=>{
 const trimmed=raw.trim();
 if(!trimmed)return undefined;
 const n=Number(trimmed);
 if(!Number.isFinite(n))return undefined;
 return Math.round(n*100);
};
const parseOptNum=(raw:string|undefined):number|undefined=>{
 if(raw==null||raw.trim()==='')return undefined;
 const n=Number(raw);
 return Number.isFinite(n)&&n>=0?n:undefined;
};

function rowVisual(r:SimpleOrderedRow & {status:string;mark:SimpleTableMark}){
 if(r.mark==='DONE'&&(r.status==='Matched'||r.status==='AI matched (confirm)'||(!r.qtyDiffers&&!r.priceDiffers&&!r.codeDiffers&&!r.nameDiffers))){
  return {rowClass:'ic-simple-row-matched',statusColor:'#286246'};
 }
 if(r.status.startsWith('Damage')||r.status.startsWith('Missing')||r.status==='Out of stock'||r.status==='Incorrect'){
  return {rowClass:'ic-simple-row-qty',statusColor:'#a23b28'};
 }
 if(r.status==='Price')return {rowClass:'ic-simple-row-price',statusColor:'#9a662a'};
 if(r.status==='ID / Name'||r.status==='Pack / Unit')return {rowClass:'ic-simple-row-detail',statusColor:'#264673'};
 const themeMap:Record<SimpleIssueTheme,{rowClass:string;statusColor:string}>={
  qty:{rowClass:'ic-simple-row-qty',statusColor:'#a23b28'},
  price:{rowClass:'ic-simple-row-price',statusColor:'#9a662a'},
  detail:{rowClass:'ic-simple-row-detail',statusColor:'#264673'},
  matched:{rowClass:'ic-simple-row-matched',statusColor:'#286246'},
 };
 return themeMap[r.issueTheme];
}

export function SimpleInvoiceTableWorkspace({
 caseId,
 onClose,
 onOpenClassic,
 preview=false,
}:{
 caseId:string;
 onClose:()=>void;
 onOpenClassic:()=>void;
 preview?:boolean;
}){
 const products=useAppStore(s=>s.products);
 const request=useCheckWorkflow();
 const {record,setRecord,error:caseError,busy,command,run}=useInvoiceCase(caseId);
 const {uploadPending,uploadBusy,onUploadPending}=useInvoiceUploadPending();

 const [activeTab,setActiveTab]=useState<WorkspaceTab>('CHECK');
 const [tableFilter,setTableFilter]=useState<'ALL'|'ACTION'>('ALL');
 const [showDocPane,setShowDocPane]=useState(false);
 const [selectedDocId,setSelectedDocId]=useState('');
 const [docPreview,setDocPreview]=useState<{id:string;url:string;name:string;mime:string}|null>(null);
 const [docLoading,setDocLoading]=useState(false);
 const [docError,setDocError]=useState('');
 const [copiedRef,setCopiedRef]=useState(false);
 const [readingOpen,setReadingOpen]=useState(false);
 const [uploadOpen,setUploadOpen]=useState(false);
 const [showAllChecks,setShowAllChecks]=useState(false);
 const [showNotesBox,setShowNotesBox]=useState(false);
 const docUrlRef=useRef('');

 const [edits,setEdits]=useState<Record<string,RowEdit>>({});
 const [editFigures,setEditFigures]=useState(false);
 const [invoiceRef,setInvoiceRef]=useState('');
 const [invoiceDate,setInvoiceDate]=useState('');
 const [invoiceDocId,setInvoiceDocId]=useState('');
 const [netInput,setNetInput]=useState('');
 const [vatInput,setVatInput]=useState('0.00');
 const [grossInput,setGrossInput]=useState('');
 const [adjInput,setAdjInput]=useState('0.00');
 const [matchingVerified,setMatchingVerified]=useState(false);
 const [totalsVerified,setTotalsVerified]=useState(false);
 const [notes,setNotes]=useState('');
 const [dirty,setDirty]=useState(false);
 const [readingDirty,setReadingDirty]=useState(false);
 const [notice,setNotice]=useState('');
 const [localError,setLocalError]=useState('');

 const [hold,setHold]=useState(false);
 const [holdReason,setHoldReason]=useState('');
 const [holdOwner,setHoldOwner]=useState('');
 const [holdUntil,setHoldUntil]=useState('');
 const [resumeOpen,setResumeOpen]=useState(false);
 const [resumeReason,setResumeReason]=useState('');

 const [recipient,setRecipient]=useState('');
 const [message,setMessage]=useState('');
 const [emailDirty,setEmailDirty]=useState(false);

 const [creditRef,setCreditRef]=useState('');
 const [creditDoc,setCreditDoc]=useState('');
 const [creditInvoice,setCreditInvoice]=useState('');
 const [creditNetInput,setCreditNetInput]=useState('');
 const [creditVatInput,setCreditVatInput]=useState('0.00');
 const [creditGrossInput,setCreditGrossInput]=useState('');
 const [creditVerified,setCreditVerified]=useState(false);
 const [creditDirty,setCreditDirty]=useState(false);

 const hasUnsaved=uploadPending||readingDirty||dirty||creditDirty||emailDirty||!!resumeReason||(hold&&!!(holdReason||holdOwner));
 useInvoiceDraftGuard(hasUnsaved,busy||uploadBusy);

 const syncFromRecord=(rec:InvoiceCase,clearEdits=false)=>{
  const ext=invoiceExtractionDraft(rec)?.extracted;
  const firstInvoice=rec.documents.find(d=>d.kind==='INVOICE')?.id||'';
  setInvoiceRef(rec.invoiceReference||ext?.reference||'');
  setInvoiceDate(rec.invoiceDate||ext?.date||'');
  setInvoiceDocId(rec.invoiceDocumentId||firstInvoice);
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
  setNotes(rec.notes||'');
  setRecipient(rec.claim?.recipient||'');
  setMessage(rec.claim?.message||'');
  const remPence=outstandingClaim(rec);
  const defaultCredRef=rec.invoiceReference?`CR-${rec.invoiceReference}`:'';
  setCreditRef(defaultCredRef);
  setCreditInvoice(rec.invoiceReference||'');
  setCreditDoc(rec.documents.find(d=>d.kind==='CREDIT')?.id||'');
  setCreditNetInput(remPence>0?(remPence/100).toFixed(2):'');
  setCreditVatInput('0.00');
  setCreditGrossInput(remPence>0?(remPence/100).toFixed(2):'');
  setCreditVerified(false);
  setCreditDirty(false);
  setDirty(false);
  if(clearEdits)setEdits({});
 };

 const syncedVersion=record?.id+':'+record?.version;
 useEffect(()=>{
  if(record)syncFromRecord(record,false);
  // Only re-sync form fields when the loaded record or version changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[syncedVersion]);

 const activeDocId=record
  ? ((selectedDocId&&record.documents.some(d=>d.id===selectedDocId))
     ? selectedDocId
     : (invoiceDocId||record.invoiceDocumentId||record.documents[0]?.id||''))
  : '';

 const requestRef=useRef(request);
 requestRef.current=request;

 useEffect(()=>{
  if(!showDocPane||!record?.id||!activeDocId)return;
  if(docPreview?.id===activeDocId&&!docError)return;
  let active=true;
  setDocLoading(true);
  setDocError('');
  requestRef.current({action:'invoice-case-document',caseId:record.id,documentId:activeDocId})
   .then(d=>{
    if(!active)return;
    const bytes=Uint8Array.from(atob(d.base64),(c:string)=>c.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:d.mime}));
    if(docUrlRef.current)URL.revokeObjectURL(docUrlRef.current);
    docUrlRef.current=url;
    setDocPreview({id:activeDocId,url,name:d.name,mime:d.mime});
   })
   .catch(e=>{if(active)setDocError((e as Error).message||'Could not open document preview.');})
   .finally(()=>{if(active)setDocLoading(false);});
  return()=>{active=false;};
  // Re-fetch only when opening the pane or switching the case/active document.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[showDocPane,record?.id,activeDocId]);

 useEffect(()=>()=>{
  if(docUrlRef.current){
   URL.revokeObjectURL(docUrlRef.current);
   docUrlRef.current='';
  }
 },[]);

 const model=useMemo(()=>record?buildSimpleInvoiceTable(record,products):null,[record,products]);

 const effectiveOrdered=useMemo(()=>{
  if(!model)return [];
  return model.ordered.map(r=>{
   const ed=edits[r.id]||{};
   const invQty=parseOptNum(ed.invoiceQty);
   const invPrice=parseOptNum(ed.invoicePrice);
   return {
    ...r,
    receiveBilledQty:invQty??r.receiveBilledQty,
    receivePrice:invPrice??r.receivePrice,
    status:ed.status??r.statusLabel,
    mark:ed.mark??r.defaultMark,
    editedQty:ed.invoiceQty,
    editedPrice:ed.invoicePrice,
   };
  });
 },[model,edits]);

 const effectiveUnmatched=useMemo(()=>{
  if(!model)return [];
  return model.unmatched.map(u=>{
   const ed=edits[u.id]||{};
   const selectedProductId=u.savedDecision==='SUPPLIER_ITEM'?(u.savedProductId||''):'';
   const matchedOpt=selectedProductId?model.supplierOptions.find(o=>o.id===selectedProductId):undefined;
   const leaveUnmatched=u.savedDecision==='LEAVE_UNMATCHED';
   const mark:SimpleTableMark=ed.mark??u.defaultMark;
   const status=matchedOpt?`Matched: ${matchedOpt.name}`:u.statusLabel;
   return {...u,matchedOpt,leaveUnmatched,selectedProductId,mark,status};
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

 const claimSummary=useMemo(
  ()=>record
   ? computeClaimSummaryMetrics(record,effectiveOrdered.filter(r=>r.mark==='FOLLOW'&&r.creditEstimatePence>0))
   : null,
  [record,effectiveOrdered],
 );

 if(!record||!model||!claimSummary){
  return <>
   <Button variant="secondary" onClick={onClose}>Back to invoice inbox</Button>
   <p role={caseError?'alert':'status'}>{caseError||'Opening invoice review…'}</p>
  </>;
 }

 const statusInfo=invoiceRecordStatus(record);
 const locked=record.status==='APPROVED'||(!!record.claim&&['SENT','SENDING','UNCERTAIN'].includes(record.claim.state));
 const claim=record.claim;
 const hasDraft=Boolean(invoiceExtractionDraft(record));

 const followOrderedCount=effectiveOrdered.filter(r=>r.mark==='FOLLOW').length;
 const followUnmatchedCount=effectiveUnmatched.filter(u=>u.mark==='FOLLOW').length;
 const followCount=followOrderedCount+followUnmatchedCount;
 const doneCount=effectiveOrdered.filter(r=>r.mark==='DONE').length+effectiveUnmatched.filter(u=>u.mark==='DONE').length;
 const claimableRows=effectiveOrdered.filter(r=>r.mark==='FOLLOW'&&r.creditEstimatePence>0);
 const noteOnlyFollowRows=effectiveOrdered.filter(r=>r.mark==='FOLLOW'&&r.creditEstimatePence===0);
 const estimatedFollowPence=claimableRows.reduce((s,r)=>s+r.creditEstimatePence,0);
 const approvalProblems=invoiceApprovalProblems(record);
 const openClaimPence=outstandingClaim(record);
 const hasReplacements=canReportLaterDelivery(record)||!!record.laterDeliveryIds?.length;

 const visibleOrdered=tableFilter==='ACTION'
  ? effectiveOrdered.filter(r=>r.mark==='FOLLOW')
  : effectiveOrdered;
 const visibleUnmatched=tableFilter==='ACTION'
  ? effectiveUnmatched.filter(u=>u.mark==='FOLLOW'||!u.savedDecision)
  : effectiveUnmatched;

 const primaryDoc=record.documents.find(d=>d.id===activeDocId)||record.documents[0];
 const titleInfo=formatInvoiceWorkspaceTitle(record);
 const pendingExtraCount=effectiveUnmatched.filter(u=>!u.savedDecision).length;
 const wordingOnlyFollowRows=effectiveOrdered.filter(
  r=>r.mark==='FOLLOW'&&r.creditEstimatePence===0&&!r.unitCheckRequired&&!r.qtyDiffers&&!r.priceDiffers&&(r.codeDiffers||r.nameDiffers),
 );
 const checklist=summarizeInvoiceChecklist(record,approvalProblems,{
  followOrderedCount,
  pendingExtraCount,
  totalsBalanced:totalsCheck.linesPlusAdjustmentMatchesNet&&totalsCheck.netPlusVatMatchesGross,
  hasRefAndDate:Boolean(invoiceRef.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate.trim())),
  matchingVerified,
  totalsVerified,
  openClaimPence,
  hasPendingLaterDelivery:Boolean(record.laterReceipts?.some(r=>r.status==='PENDING')),
  claimableCount:claimableRows.length,
 });

 const jumpToTarget=(target:ChecklistJumpTarget)=>{
  if(target==='CREDITS'){
   setActiveTab('CREDITS');
   return;
  }
  setActiveTab('CHECK');
  if(target==='READING'){
   setReadingOpen(true);
   window.setTimeout(()=>document.getElementById('ic-reading-section')?.scrollIntoView({behavior:'smooth',block:'start'}),40);
   return;
  }
  if(target==='EXTRA'){
   setTableFilter('ALL');
   window.setTimeout(()=>document.getElementById('ic-extra-items')?.scrollIntoView({behavior:'smooth',block:'start'}),40);
   return;
  }
  if(target==='ITEMS'){
   setTableFilter(followOrderedCount>0?'ACTION':'ALL');
   window.setTimeout(()=>document.getElementById('ic-comparison-table')?.scrollIntoView({behavior:'smooth',block:'start'}),40);
   return;
  }
  if(target==='SIGNOFF'){
   window.setTimeout(()=>document.getElementById('ic-signoff-card')?.scrollIntoView({behavior:'smooth',block:'start'}),40);
   return;
  }
  window.setTimeout(()=>document.getElementById('ic-totals-card')?.scrollIntoView({behavior:'smooth',block:'start'}),40);
 };

 const markWordingOnlyDone=()=>{
  if(locked||wordingOnlyFollowRows.length===0)return;
  setDirty(true);
  setEdits(prev=>{
   const next={...prev};
   for(const r of wordingOnlyFollowRows){
    next[r.id]={...next[r.id],mark:'DONE'};
   }
   return next;
  });
 };

 const copyRefToClipboard=async()=>{
  const value=invoiceRef.trim()||record.invoiceReference;
  if(!value)return;
  try{
   await navigator.clipboard?.writeText(value);
   setCopiedRef(true);
   window.setTimeout(()=>setCopiedRef(false),1800);
  }catch{
   setNotice(`Invoice ref: ${value}`);
  }
 };

 const act=async(kind:string,payload:any={})=>{
  if(uploadPending){
   setNotice('Upload or cancel the selected file before continuing.');
   return null;
  }
  setLocalError('');
  const result=await command(kind,payload);
  if(result?.record){
   syncFromRecord(result.record,kind==='use-extraction');
   setNotice('Saved — '+caseStatusLabels[result.record.status as keyof typeof caseStatusLabels]);
   return result;
  }
  return null;
 };

 const buildSavePayload=(current:InvoiceCase)=>{
  const docId=invoiceDocId||current.invoiceDocumentId||current.documents.find(d=>d.kind==='INVOICE')?.id||'';
  if(!docId)throw new Error('Choose the original invoice document before saving.');
  if(!invoiceRef.trim())throw new Error('Enter the supplier invoice reference.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate.trim()))throw new Error('Enter a valid invoice date (YYYY-MM-DD).');
  if(netPence==null||vatPence==null||grossPence==null)throw new Error('Enter Invoice Net, VAT and Gross amounts.');

  const linesPayload=current.lines.map(orig=>{
   const row=effectiveOrdered.find(r=>r.lineId===orig.id);
   const billedQty=row?.receiveBilledQty??row?.receiveQty??orig.ordered;
   const billedPrice=row?.receivePrice??orig.expectedPrice;
   const mark=row?.mark??'FOLLOW';
   const claimable=mark==='FOLLOW'&&(row?.creditEstimatePence??0)>0;
   const resolution=mark==='DONE'?'ACCEPT':row?.status==='Hold'?'HOLD':claimable?'CLAIM':'ACCEPT';
   const reasonText=(
    row?.mismatchReasons.join('; ')||
    (mark==='FOLLOW'&&!claimable?`${row?.status||'Detail check'} (£0 financial claim)`:row?.status)||
    orig.reason||
    'Checked in invoice table'
   ).trim();
   return {
    id:orig.id,
    invoiceQuantity:billedQty,
    invoicePrice:billedPrice,
    reviewed:true,
    resolution,
    reason:reasonText,
   };
  });

  const nonFinancialNotes=noteOnlyFollowRows.length
   ?`Detail checks (£0 claim): ${noteOnlyFollowRows.map(r=>`${r.orderProductName} (${r.status})`).join('; ')}`
   :'';
  const combinedNotes=notes.trim()||(nonFinancialNotes?nonFinancialNotes:'');

  return {
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
   notes:combinedNotes,
  };
 };

 const handleSaveReview=async()=>{
  setLocalError('');
  if(uploadPending){
   setNotice('Upload or cancel the selected file before continuing.');
   return;
  }
  try{
   const payload=buildSavePayload(record);
   const result=await command('save-review',payload);
   if(result?.record){
    syncFromRecord(result.record,false);
    setNotice(`Review saved for ${result.record.invoiceReference} (${doneCount} Done · ${followCount} Follow).`);
   }
  }catch(e:any){
   setLocalError(e?.message||'Could not save review.');
  }
 };

 const handlePrepareAndApproveClaim=async()=>{
  setLocalError('');
  if(uploadPending){
   setNotice('Upload or cancel the selected file before continuing.');
   return;
  }
  try{
   if(!matchingVerified||!totalsVerified){
    throw new Error('Tick both verification check boxes on 1. Invoice Check before preparing a claim.');
   }
   if(effectiveUnmatched.some(u=>!u.savedDecision)){
    throw new Error('Confirm each extra item in the comparison table (Match supplier item or Leave unmatched) first.');
   }
   if(claimableRows.length===0){
    throw new Error('Mark at least one item with a price, missing or damage difference as Follow before preparing a credit claim.');
   }

   let latest=record;
   let expectedVer=record.version;
   if(dirty||!latest.claim||latest.totalsVerified!==totalsVerified||latest.matchingVerified!==matchingVerified){
    const saved=await run({
     action:'invoice-case-command',
     command:{...buildSavePayload(latest),kind:'save-review',expectedVersion:expectedVer,requestId:crypto.randomUUID()},
    });
    if(!saved?.record)return;
    latest=saved.record;
    expectedVer=latest.version;
   }
   if(!latest.claim){
    const prep=await run({
     action:'invoice-case-command',
     command:{kind:'prepare-claim',expectedVersion:expectedVer,requestId:crypto.randomUUID()},
    });
    if(!prep?.record)return;
    latest=prep.record;
    expectedVer=latest.version;
   }
   if(latest.claim?.state==='DRAFT'){
    const appr=await run({
     action:'invoice-case-command',
     command:{kind:'approve-claim',expectedVersion:expectedVer,requestId:crypto.randomUUID()},
    });
    if(!appr?.record)return;
    latest=appr.record;
   }
   syncFromRecord(latest,false);
   const claimTotal=(latest.claim?.lines.reduce((s,l)=>s+l.netPence,0)??0)/100;
   setNotice(`Claim prepared & approved (${money(claimTotal)} net). Review supplier email below.`);
  }catch(e:any){
   setLocalError(e?.message||'Could not prepare credit claim.');
  }
 };

 const handleConfirmExtraRow=async(u:typeof effectiveUnmatched[number],decision:'SUPPLIER_ITEM'|'LEAVE_UNMATCHED'|'RESET',supplierProductId?:string)=>{
  setLocalError('');
  if(decision==='RESET'){
   await act('restore-extra-row',{page:u.page,row:u.row,reason:'Reopened extra item matching in invoice table'});
   return;
  }
  const opt=supplierProductId?model.supplierOptions.find(o=>o.id===supplierProductId):undefined;
  const reason=decision==='SUPPLIER_ITEM'
   ?`Matched extra item "${u.receiveProductName}" to supplier item ${opt?.name||supplierProductId}`
   :`Confirmed extra item "${u.receiveProductName}" is not on the order — leave unmatched`;
  await act('confirm-extra-row',{
   page:u.page,
   row:u.row,
   decision,
   ...(supplierProductId?{supplierProductId}:{}),
   reason,
  });
 };

 const handleRecordCredit=async()=>{
  if(!claim||claim.state!=='SENT')return;
  setLocalError('');
  try{
   const cNet=parsePence(creditNetInput);
   const cVat=parsePence(creditVatInput)??0;
   const cGross=parsePence(creditGrossInput);
   if(!creditRef.trim())throw new Error('Enter the supplier credit note reference.');
   if(cNet==null||cNet<=0)throw new Error('Enter a positive credit net amount.');
   if(cGross==null||cNet+cVat!==cGross)throw new Error('Credit Net + VAT must equal Credit Gross.');
   if(!creditVerified)throw new Error('Tick the box confirming credit details match the supplier credit note.');

   let latest=record;
   let expectedVer=record.version;
   let docId=creditDoc||record.documents.find(d=>d.kind==='CREDIT')?.id||'';
   if(!docId&&preview){
    const up=await run({
     action:'invoice-case-upload',
     expectedVersion:expectedVer,
     kind:'CREDIT',
     name:`SAMPLE-${creditRef.trim()}.png`,
     mime:'image/png',
     base64:SAMPLE_CREDIT_PNG,
    });
    if(!up?.record)return;
    latest=up.record;
    expectedVer=latest.version;
    docId=up.documentId;
   }
   if(!docId)throw new Error('Upload or select the original credit note first.');

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

   const recRes=await run({
    action:'invoice-case-command',
    command:{
     kind:'record-credit',
     requestId:crypto.randomUUID(),
     expectedVersion:expectedVer,
     reference:creditRef.trim(),
     invoiceReference:creditInvoice.trim()||latest.invoiceReference,
     supplierId:latest.supplierId,
     documentId:docId,
     lines:allocLines,
     vatPence:cVat,
     grossPence:cGross,
     verified:true,
    },
   });
   if(!recRes?.record)return;
   const recorded=recRes.record as InvoiceCase;
   const draftCredit=recorded.credits.find(c=>c.status==='DRAFT');
   if(draftCredit){
    const appRes=await run({
     action:'invoice-case-command',
     command:{kind:'approve-credit',requestId:crypto.randomUUID(),expectedVersion:recorded.version,creditId:draftCredit.id},
    });
    if(appRes?.record){
     syncFromRecord(appRes.record,false);
     setNotice(`Credit note ${creditRef.trim()} approved (${money(cGross/100)} gross).`);
     return;
    }
   }
   syncFromRecord(recorded,false);
   setNotice(`Credit note ${creditRef.trim()} recorded.`);
  }catch(e:any){
   setLocalError(e?.message||'Could not record credit note.');
  }
 };

 const handleApproveInvoice=async()=>{
  setLocalError('');
  if(uploadPending){
   setNotice('Upload or cancel the selected file before continuing.');
   return;
  }
  try{
   let expectedVer=record.version;
   if(!locked&&dirty){
    const saved=await run({
     action:'invoice-case-command',
     command:{...buildSavePayload(record),kind:'save-review',expectedVersion:expectedVer,requestId:crypto.randomUUID()},
    });
    if(!saved?.record)return;
    expectedVer=saved.record.version;
   }
   const appRes=await run({
    action:'invoice-case-command',
    command:{kind:'approve-invoice',expectedVersion:expectedVer,requestId:crypto.randomUUID()},
   });
   if(appRes?.record){
    syncFromRecord(appRes.record,false);
    setNotice(`Invoice ${appRes.record.invoiceReference||appRes.record.id} approved and locked.`);
   }
  }catch(e:any){
   setLocalError(e?.message||'Could not approve invoice yet.');
  }
 };

 const closeWorkspace=()=>{
  if(!busy&&!uploadBusy&&(!hasUnsaved||window.confirm('Discard unsaved Accounts changes?')))onClose();
 };
 const switchToClassic=()=>{
  if(!busy&&!uploadBusy&&(!hasUnsaved||window.confirm('Switch to classic check view? Unsaved simple-table edits will be discarded.')))onOpenClassic();
 };

 const alertMessage=localError||caseError;
 const netStatusText=totalsCheck.linesPlusAdjustmentMatchesNet
  ? 'Totals match'
  : totalsCheck.differenceToNetPence!=null
   ? `${money(Math.abs(totalsCheck.differenceToNetPence)/100)} difference`
   : 'Enter totals';

 const tabCreditsSubtitle=openClaimPence>0
  ? `${money(openClaimPence/100)} open`
  : claim
   ? `Claim ${claim.state.toLowerCase()}`
   : claimableRows.length>0
    ? `${claimableRows.length} to claim`
    : 'None';

 const notesRequired=record.receipt.statuses.includes('OTHER')||Boolean(notes.trim());

 return <div className="ic-accounts ic-simple-workspace">
  <div className="ic-toolbar ic-simple-topbar">
   <div className="ic-simple-topbar-left">
    <Button variant="secondary" onClick={closeWorkspace}>← Invoice inbox</Button>
    <Tag tone={statusInfo.tone}>{statusInfo.label}</Tag>
   </div>
   <div className="ic-simple-topbar-right">
    {record.documents.length>0&&(
     <Button
      variant={showDocPane?'primary':'secondary'}
      aria-pressed={showDocPane}
      onClick={()=>setShowDocPane(v=>!v)}>
      {showDocPane?<PanelRightClose size={16}/>:<PanelRightOpen size={16}/>}
      {showDocPane?'Hide invoice':'View invoice'}
     </Button>
    )}
    <Button variant="quiet" onClick={switchToClassic}>Classic view</Button>
   </div>
  </div>

  <div className="ic-simple-header">
   <Heading eyebrow="INVOICE CHECK" title={titleInfo.title}>
    <span>{record.branchName}</span>
    {Boolean(record.invoiceReference?.trim())&&<><span aria-hidden="true"> · </span><span>{record.supplierName}</span></>}
    {titleInfo.orderRef&&<><span aria-hidden="true"> · </span><span>Order {titleInfo.orderRef}</span></>}
   </Heading>
   <p className="ic-simple-report-meta">
    <span>Delivery report: <strong>{record.receipt.statuses.length?record.receipt.statuses.map(s=>receiptStatusLabels[s]).join(' · '):'Pending'}</strong></span>
    {record.receipt.notes&&<span> — {record.receipt.notes}</span>}
   </p>
  </div>

  {record.status==='APPROVED'?(
   <div className="ic-simple-guide-bar is-ready" role="status">
    <div className="ic-simple-guide-next">
     <Check size={16} aria-hidden="true"/>
     <span><strong>Invoice approved and locked</strong>{record.approvedBy?` · ${record.approvedBy}`:''}{record.approvedAt?` on ${day(record.approvedAt)}`:''}. This does not mark it paid or close any goods collection.</span>
    </div>
   </div>
  ):(
   <section className={`ic-simple-guide-bar ${checklist.remainingCount===0?'is-ready':''}`} aria-label="3-step invoice check progress">
    <div className="ic-simple-stepper">
     {checklist.steps.map(step=>(
      <button
       key={step.id}
       type="button"
       className={`ic-simple-step ${step.done?'is-done':step.attention?'is-attention':''}`}
       onClick={()=>jumpToTarget(step.target)}>
       <span className="ic-simple-step-badge" aria-hidden="true">
        {step.done?<Check size={13}/>:step.number}
       </span>
       <span className="ic-simple-step-copy">
        <strong>{step.title}</strong>
        <span>{step.summary}</span>
       </span>
      </button>
     ))}
    </div>
    <div className="ic-simple-guide-foot">
     <p className="ic-simple-guide-next">{checklist.nextHint}</p>
     <div className="ic-simple-guide-actions">
      {checklist.readingActionCount>0&&(
       <button type="button" className="ic-simple-inline-action" onClick={()=>jumpToTarget('READING')}>
        Open scan review →
       </button>
      )}
      {approvalProblems.length>0&&(
       <button
        type="button"
        className="ic-simple-text-toggle"
        aria-expanded={showAllChecks}
        onClick={()=>setShowAllChecks(v=>!v)}>
        {showAllChecks?'Hide checklist':`Checklist (${approvalProblems.length})`}
        {showAllChecks?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
       </button>
      )}
     </div>
    </div>
    {showAllChecks&&approvalProblems.length>0&&(
     <ol className="ic-simple-checklist-detail">
      {approvalProblems.map(problem=><li key={problem}>{problem}</li>)}
     </ol>
    )}
   </section>
  )}

  {alertMessage&&<p role="alert" className="h-notice error">{alertMessage}</p>}
  {notice&&<p role="status" className="h-notice success">{notice}</p>}

  <div className={`ic-simple-split ${showDocPane?'has-doc':''}`}>
   <div className="ic-simple-main">
    <div className="ic-simple-tabs" role="tablist" aria-label="Invoice workspace sections">
     <button
      type="button"
      role="tab"
      id="ic-tab-check"
      aria-selected={activeTab==='CHECK'}
      aria-controls="ic-panel-check"
      className={`ic-simple-tab ${activeTab==='CHECK'?'active':''}`}
      onClick={()=>setActiveTab('CHECK')}>
      <span className="ic-simple-tab-label">Invoice Check</span>
      <span className={`ic-simple-tab-meta ${followCount>0?'warn':'ok'}`}>
       {followCount>0?`${followCount} to check`:'Ready'}
      </span>
     </button>
     <button
      type="button"
      role="tab"
      id="ic-tab-credits"
      aria-selected={activeTab==='CREDITS'}
      aria-controls="ic-panel-credits"
      className={`ic-simple-tab ${activeTab==='CREDITS'?'active':''}`}
      onClick={()=>setActiveTab('CREDITS')}>
      <span className="ic-simple-tab-label">Credits &amp; Replacements</span>
      <span className={`ic-simple-tab-meta ${openClaimPence>0?'warn':''}`}>
       {tabCreditsSubtitle}
      </span>
     </button>
     <button
      type="button"
      role="tab"
      id="ic-tab-audit"
      aria-selected={activeTab==='AUDIT'}
      aria-controls="ic-panel-audit"
      className={`ic-simple-tab ${activeTab==='AUDIT'?'active':''}`}
      onClick={()=>setActiveTab('AUDIT')}>
      <span className="ic-simple-tab-label">Summary &amp; History</span>
      <span className="ic-simple-tab-meta">
       {record.audit.length} {record.audit.length===1?'event':'events'}
      </span>
     </button>
    </div>

    {activeTab==='CHECK'&&(
     <div id="ic-panel-check" role="tabpanel" aria-labelledby="ic-tab-check" className="ic-simple-tabpanel">
      <section id="ic-totals-card" className="h-panel ic-simple-card">
       <div className="h-panel-head ic-simple-card-head">
        <div>
         <h2>1. Invoice details &amp; totals</h2>
         <p>Check the invoice number, date, and totals against the items below.</p>
        </div>
        <div className="ic-simple-head-controls">
         <span className={`ic-simple-math-status ${totalsCheck.linesPlusAdjustmentMatchesNet?'ok':'warn'}`}>
          {netStatusText}
         </span>
         {hasDraft&&!locked&&(
          <Button
           variant="secondary"
           busy={busy}
           disabled={hasUnsaved}
           title={hasUnsaved?'Save or discard unsaved edits before loading AI draft':'Fill invoice number, date, totals and item prices from the scan'}
           onClick={()=>void act('use-extraction')}>
           Fill from AI draft
          </Button>
         )}
        </div>
       </div>

       <div className="ic-simple-card-body">
        <fieldset className="ic-fieldset" disabled={busy||locked}>
         <div className="ic-simple-meta-stack">
          <div className="ic-simple-meta-row ic-simple-meta-row-doc">
           <Field label="Invoice number"><input value={invoiceRef} placeholder="e.g. INV-90412" onChange={e=>{setInvoiceRef(e.target.value);setDirty(true);}}/></Field>
           <Field label="Invoice date"><input type="date" value={invoiceDate} onChange={e=>{setInvoiceDate(e.target.value);setDirty(true);}}/></Field>
           <Field label="Invoice file">
            <select value={invoiceDocId} onChange={e=>{setInvoiceDocId(e.target.value);setDirty(true);}}>
             <option value="">Choose file</option>
             {record.documents.filter(d=>d.kind==='INVOICE').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
           </Field>
          </div>
          <div className="ic-simple-meta-row ic-simple-meta-row-money">
           <Field label="Net (£)"><input type="number" step="0.01" value={netInput} onChange={e=>{setNetInput(e.target.value);setTotalsVerified(false);setDirty(true);}}/></Field>
           <Field label="Charges / discounts (£)"><input type="number" step="0.01" value={adjInput} onChange={e=>{setAdjInput(e.target.value);setTotalsVerified(false);setDirty(true);}}/></Field>
           <Field label="VAT (£)"><input type="number" step="0.01" value={vatInput} onChange={e=>{setVatInput(e.target.value);setTotalsVerified(false);setDirty(true);}}/></Field>
           <Field label="Total gross (£)"><input type="number" step="0.01" value={grossInput} onChange={e=>{setGrossInput(e.target.value);setTotalsVerified(false);setDirty(true);}}/></Field>
          </div>
         </div>

         <div className="ic-simple-totals-box">
          <div className="ic-simple-totals-line">
           <span>Items billed <strong>{money(totalsCheck.orderedLineBilledSumPence/100)}</strong></span>
           {totalsCheck.unmatchedExtraSumPence>0&&(
            <>
             <span aria-hidden="true">·</span>
             <span>Extra items <strong>{money(totalsCheck.unmatchedExtraSumPence/100)}</strong></span>
            </>
           )}
           <span aria-hidden="true">·</span>
           <span>
            Net check:{' '}
            <strong className={totalsCheck.linesPlusAdjustmentMatchesNet?'ic-text-ok':'ic-text-warn'}>
             {netStatusText}
            </strong>
           </span>
          </div>
          {!totalsCheck.linesPlusAdjustmentMatchesNet&&totalsCheck.differenceToNetPence===totalsCheck.unmatchedExtraSumPence&&totalsCheck.unmatchedExtraSumPence>0&&!locked&&(
           <Button variant="secondary" onClick={()=>{setAdjInput((totalsCheck.unmatchedExtraSumPence/100).toFixed(2));setDirty(true);}}>
            Add {money(totalsCheck.unmatchedExtraSumPence/100)} to charges
           </Button>
          )}
         </div>
        </fieldset>

        <div className="ic-simple-utility-row">
         <button
          type="button"
          className={`ic-simple-text-toggle ${checklist.readingActionCount>0?'is-warn':''}`}
          aria-expanded={readingOpen}
          onClick={()=>setReadingOpen(v=>!v)}>
          {readingOpen
           ? 'Hide AI scan & unit review'
           : checklist.readingActionCount>0
            ? `AI scan & unit review (${checklist.readingActionCount} to confirm)`
            : `AI scan & unit review${hasDraft?' (draft ready)':''}`}
          {readingOpen?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
         </button>
         {!locked&&!claim&&(
          <button
           type="button"
           className="ic-simple-text-toggle"
           aria-expanded={uploadOpen}
           onClick={()=>setUploadOpen(v=>!v)}>
           {uploadOpen?'Hide file upload':'Add another invoice scan'}
           {uploadOpen?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
          </button>
         )}
         {!showDocPane&&record.documents.length>0&&(
          <div className="ic-simple-doc-inline-links">
           <span className="ic-muted">Files:</span>
           <CaseDocuments record={record}/>
          </div>
         )}
        </div>

        {readingOpen&&(
         <div id="ic-reading-section" className="ic-simple-drawer">
          <InvoiceReadingPanel
           onDirty={setReadingDirty}
           record={record}
           busy={busy}
           dirty={uploadPending||dirty||creditDirty||emailDirty}
           locked={locked}
           preview={preview}
           run={run}
           act={act}
           onChanged={next=>{setRecord(next);syncFromRecord(next,true);setNotice('Reading saved as a draft — review highlighted items below.');}}
          />
         </div>
        )}

        {uploadOpen&&!locked&&!claim&&(
         <div className="ic-simple-drawer">
          <DocumentUpload compact onPendingChange={onUploadPending} record={record} run={run} kind="INVOICE" label="Add a later invoice"/>
         </div>
        )}
       </div>
      </section>

      <section id="ic-comparison-table" className="h-panel ic-simple-shell" aria-label="Invoice item check table">
       <div className="ic-simple-shell-head">
        <div className="ic-simple-shell-title">
         <div className="ic-simple-shell-title-row">
          <h2>2. Check items</h2>
          <div className="ic-simple-filter-group" role="group" aria-label="Filter items">
           <button
            type="button"
            className={tableFilter==='ALL'?'active':''}
            onClick={()=>setTableFilter('ALL')}>
            All ({effectiveOrdered.length})
           </button>
           <button
            type="button"
            className={tableFilter==='ACTION'?'active':''}
            onClick={()=>setTableFilter('ACTION')}>
            Needs attention ({followOrderedCount})
           </button>
          </div>
         </div>
         <div className="ic-simple-metrics">
          <span>{doneCount} Done</span>
          <span aria-hidden="true">·</span>
          <span>{followCount} Follow</span>
          {effectiveUnmatched.length>0&&<>
           <span aria-hidden="true">·</span>
           <span>{effectiveUnmatched.length} Extra</span>
          </>}
          {estimatedFollowPence>0&&<>
           <span aria-hidden="true">·</span>
           <span>Est. claim <strong>{money(estimatedFollowPence/100)}</strong></span>
          </>}
         </div>
        </div>
        <div className="ic-simple-shell-right">
         {wordingOnlyFollowRows.length>0&&!locked&&(
          <Button variant="quiet" onClick={markWordingOnlyDone}>
           Mark {wordingOnlyFollowRows.length} wording-only Done
          </Button>
         )}
         <label className="ic-simple-toggle-label">
          <input type="checkbox" checked={editFigures} disabled={locked} onChange={e=>setEditFigures(e.target.checked)}/>
          Edit qty / price
         </label>
        </div>
       </div>

       <div className="ic-simple-table-wrap">
        <table className="ic-simple-table ic-clean-table">
         <thead>
          <tr className="ic-simple-subhead">
           <th style={{textAlign:'left',width:'31%'}}>Item</th>
           <th className="ic-simple-num" style={{width:'15%'}}>Ordered</th>
           <th className="ic-simple-num" style={{width:'19%'}}>Invoice / Delivered</th>
           <th style={{textAlign:'left',width:'22%'}}>Issue / Status</th>
           <th className="ic-simple-ctr" style={{width:'13%'}}>Mark</th>
          </tr>
         </thead>
         <tbody>
          {visibleOrdered.length===0?(
           <tr>
            <td colSpan={5} style={{padding:'20px 14px',textAlign:'center',color:'var(--muted,#728078)'}}>
             No items need attention in this view.{' '}
             <button type="button" className="h-text-link" onClick={()=>setTableFilter('ALL')}>Show all {effectiveOrdered.length} items →</button>
            </td>
           </tr>
          ):visibleOrdered.map(r=>{
           const {rowClass,statusColor}=rowVisual(r);
           const billedDiff=r.receiveBilledQty!=null&&r.receiveQty!=null&&r.receiveBilledQty!==r.receiveQty;
           const showCode=r.orderProductId&&r.orderProductId!=='—';
           const showInvoiceWording=r.nameDiffers||r.codeDiffers;
           const primaryQty=r.receiveBilledQty!=null
            ? `${r.receiveBilledQty} ${r.receiveUnit}`
            : r.receiveQty!=null
             ? `${r.receiveQty} ${r.orderUnit}`
             : '—';

           return <tr key={r.id} className={rowClass}>
            <td>
             <div className="ic-clean-item">
              <div className="ic-clean-item-top">
               <span className="ic-clean-no">{r.orderNo}.</span>
               <strong>{r.orderProductName}</strong>
               {showCode&&<span className="ic-clean-code">{r.orderProductId}</span>}
              </div>
              {showInvoiceWording&&(
               <div className="ic-clean-invoice-note">
                Invoice: {r.receiveProductName}
                {r.codeDiffers&&r.receiveProductId!=='—'?` (${r.receiveProductId})`:''}
               </div>
              )}
             </div>
            </td>

            <td className="ic-simple-num ic-mobile-labeled" data-label="Ordered">
             <div className="ic-clean-figure">
              <strong>{r.orderQty} {r.orderUnit}</strong>
              <span>{r.orderPrice!=null?money(r.orderPrice):'No agreed price'}</span>
             </div>
            </td>

            <td className="ic-simple-num ic-mobile-labeled" data-label="Invoice">
             {editFigures&&!locked?(
              <div className="ic-clean-edit-grid">
               <label>
                <span>Qty</span>
                <input
                 aria-label={`Invoice billed quantity for ${r.orderProductName}`}
                 type="number"
                 min="0"
                 step="1"
                 value={r.editedQty??(r.receiveBilledQty!=null?String(r.receiveBilledQty):'')}
                 onChange={e=>{setDirty(true);setEdits(prev=>({...prev,[r.id]:{...prev[r.id],invoiceQty:e.target.value}}));}}
                />
               </label>
               <label>
                <span>£</span>
                <input
                 aria-label={`Invoice unit price for ${r.orderProductName}`}
                 type="number"
                 min="0"
                 step="0.01"
                 value={r.editedPrice??(r.receivePrice!=null?String(r.receivePrice):'')}
                 onChange={e=>{setDirty(true);setEdits(prev=>({...prev,[r.id]:{...prev[r.id],invoicePrice:e.target.value}}));}}
                />
               </label>
               {r.receiveQty!=null&&<small>Delivered: {r.receiveQty}</small>}
              </div>
             ):(
              <div className="ic-clean-figure">
               <strong className={r.qtyDiffers?'ic-val-qty':r.unitCheckRequired?'ic-val-detail':''}>
                {primaryQty}
               </strong>
               <span className={r.priceDiffers?'ic-val-price':''}>
                {r.receivePrice!=null?money(r.receivePrice):'Price —'}
               </span>
               {billedDiff&&<small className="ic-val-qty">Delivered: {r.receiveQty} {r.orderUnit}</small>}
              </div>
             )}
            </td>

            <td>
             <select
              className="ic-simple-status-select"
              aria-label={`Status for ${r.orderProductName}`}
              disabled={locked}
              value={r.status}
              onChange={e=>{
               setDirty(true);
               const val=e.target.value;
               setEdits(prev=>({...prev,[r.id]:{...prev[r.id],status:val,mark:(val==='Matched'||val==='AI matched (confirm)')?'DONE':'FOLLOW'}}));
              }}
              style={{color:statusColor}}>
              {![r.status,'Matched','AI matched (confirm)','Damage','Missing','Price','ID / Name','Out of stock','Hold'].includes(r.status)&&<option value={r.status}>{r.status}</option>}
              {Array.from(new Set([r.statusLabel,'Matched','AI matched (confirm)','Damage','Missing','Price','ID / Name','Out of stock','Hold'])).map(opt=><option key={opt} value={opt}>{opt}</option>)}
             </select>
             {r.mismatchReasons.length>0&&<div className="ic-simple-reason" style={{color:statusColor}}>{r.mismatchReasons.join(' · ')}</div>}
            </td>

            <td className="ic-simple-ctr">
             <div className="ic-simple-mark">
              {(['DONE','FOLLOW'] as const).map(choice=>(
               <button
                key={choice}
                type="button"
                className={choice==='DONE'?'done':'follow'}
                disabled={locked}
                aria-pressed={r.mark===choice}
                onClick={()=>{setDirty(true);setEdits(prev=>({...prev,[r.id]:{...prev[r.id],mark:choice}}));}}>
                {choice==='DONE'?'Done':'Follow'}
               </button>
              ))}
             </div>
            </td>
           </tr>;
          })}
         </tbody>
        </table>
       </div>

       {tableFilter==='ACTION'&&effectiveOrdered.length>visibleOrdered.length&&(
        <div className="ic-simple-table-foot">
         <span>Showing {visibleOrdered.length} of {effectiveOrdered.length} items needing attention</span>
         <button type="button" className="h-text-link" onClick={()=>setTableFilter('ALL')}>Show all {effectiveOrdered.length} items →</button>
        </div>
       )}

       {visibleUnmatched.length>0&&(
        <div id="ic-extra-items" className="ic-clean-extra-section">
         <div className="ic-clean-extra-head">
          <div>
           <h3>Extra items on invoice ({effectiveUnmatched.length} not on order)</h3>
           <p>Match each extra line to a supplier item or mark it as not on order.</p>
          </div>
         </div>
         <div className="ic-clean-extra-list">
          {visibleUnmatched.map(u=>(
           <div key={u.id} className={`ic-clean-extra-row ${u.matchedOpt&&u.mark==='DONE'?'is-resolved':''}`}>
            <div className="ic-clean-extra-info">
             <div className="ic-clean-item-top">
              <span className="ic-clean-extra-code">{u.receiveNo}</span>
              <strong>{u.receiveProductName}</strong>
             </div>
             <div className="ic-clean-extra-meta">
              <span>{u.receiveQty??'—'} {u.receiveUnit}</span>
              <span aria-hidden="true">·</span>
              <span>{u.receivePrice!=null?money(u.receivePrice):'Price —'}</span>
              <span aria-hidden="true">·</span>
              <span className={u.matchedOpt?'ic-text-ok':'ic-text-extra'}>{u.status}</span>
             </div>
            </div>
            <div className="ic-simple-extra-controls">
             <select
              aria-label={`Match supplier item for ${u.receiveProductName}`}
              disabled={locked||busy||!!claim||!hasDraft}
              value={u.selectedProductId}
              onChange={e=>{
               const pid=e.target.value;
               void handleConfirmExtraRow(u,pid?'SUPPLIER_ITEM':'RESET',pid||undefined);
              }}>
              <option value="">{u.savedDecision?'Reset extra review…':'Match supplier item…'}</option>
              {model.supplierOptions.map(opt=><option key={opt.id} value={opt.id}>{opt.code} · {opt.name}{opt.price!=null?` (${money(opt.price)})`:''}</option>)}
             </select>
             <button
              type="button"
              disabled={locked||busy||!!claim||!hasDraft}
              className={`ic-simple-unmatch-btn ${u.leaveUnmatched?'active':''}`}
              onClick={()=>void handleConfirmExtraRow(u,u.leaveUnmatched?'RESET':'LEAVE_UNMATCHED')}>
              {u.leaveUnmatched?'Left unmatched ✓':'Leave unmatched'}
             </button>
             <div className="ic-simple-mark">
              {(['DONE','FOLLOW'] as const).map(choice=>(
               <button
                key={choice}
                type="button"
                className={choice==='DONE'?'done':'follow-extra'}
                disabled={locked}
                aria-pressed={u.mark===choice}
                onClick={()=>{setDirty(true);setEdits(prev=>({...prev,[u.id]:{...prev[u.id],mark:choice}}));}}>
                {choice==='DONE'?'Done':'Follow'}
               </button>
              ))}
             </div>
            </div>
           </div>
          ))}
         </div>
        </div>
       )}
      </section>

      <section id="ic-signoff-card" aria-label="Confirm and finish invoice review" className="h-panel ic-simple-card">
       <div className="h-panel-head ic-simple-card-head">
        <div>
         <h2>3. Confirm &amp; finish</h2>
         <p>Tick both boxes once totals and items match, then approve or prepare a supplier claim.</p>
        </div>
       </div>
       <div className="ic-simple-card-body">
        <fieldset className="ic-fieldset" disabled={busy||locked} style={{display:'grid',gap:10}}>
         <div className="ic-clean-checks">
          <label className="h-check">
           <input type="checkbox" checked={matchingVerified} onChange={e=>{setMatchingVerified(e.target.checked);setDirty(true);}}/>
           Supplier, items, quantities and units match the invoice.
          </label>
          <label className="h-check">
           <input type="checkbox" checked={totalsVerified} onChange={e=>{setTotalsVerified(e.target.checked);setDirty(true);}}/>
           Net, charges/discounts, VAT and gross match the invoice total.
          </label>
         </div>

         {notesRequired||showNotesBox?(
          <Field label="Accounts notes">
           <textarea rows={2} value={notes} placeholder="Optional notes or resolution for Other delivery issues" onChange={e=>{setNotes(e.target.value);setDirty(true);}}/>
          </Field>
         ):(
          <div>
           <button type="button" className="ic-simple-text-toggle" onClick={()=>setShowNotesBox(true)}>
            + Add Accounts note (optional)
           </button>
          </div>
         )}
        </fieldset>

        {record.status==='HOLD'&&(
         <div className="ic-evidence">
          <strong>On hold:</strong> {record.holdReason} · {record.holdOwner}{record.holdUntil?' · '+day(record.holdUntil):''}
          {resumeOpen?(
           <div style={{marginTop:8,display:'grid',gap:8}}>
            <Field label="Reason for returning to review">
             <textarea rows={2} maxLength={2000} value={resumeReason} onChange={e=>setResumeReason(e.target.value)} placeholder="What new information allows review to continue?"/>
            </Field>
            <div className="ic-row">
             <Button variant="secondary" disabled={busy} onClick={()=>{setResumeOpen(false);setResumeReason('');}}>Cancel return</Button>
             <Button busy={busy} disabled={dirty||!resumeReason.trim()} onClick={async()=>{if(await act('resume',{reason:resumeReason})){setResumeOpen(false);setResumeReason('');}}}>Confirm return to review</Button>
            </div>
           </div>
          ):(
           <div style={{marginTop:8}}>
            <Button variant="secondary" disabled={hasUnsaved} busy={busy} onClick={()=>setResumeOpen(true)}>Return to review</Button>
           </div>
          )}
         </div>
        )}

        {hold&&(
         <div className="ic-evidence" style={{display:'grid',gap:8}}>
          <strong>Hold for information</strong>
          <Field label="Information needed"><textarea rows={2} value={holdReason} onChange={e=>setHoldReason(e.target.value)}/></Field>
          <div className="h-form-grid">
           <Field label="Person responsible"><input value={holdOwner} onChange={e=>setHoldOwner(e.target.value)}/></Field>
           <Field label="Follow-up date (optional)"><input type="date" value={holdUntil} onChange={e=>setHoldUntil(e.target.value)}/></Field>
          </div>
          <div className="ic-row">
           <Button variant="secondary" onClick={()=>{setHold(false);setHoldReason('');setHoldOwner('');setHoldUntil('');}}>Cancel</Button>
           <Button busy={busy} onClick={async()=>{if(await act('hold',{reason:holdReason,owner:holdOwner,until:holdUntil})){setHold(false);setHoldReason('');setHoldOwner('');setHoldUntil('');}}}>Save hold</Button>
          </div>
         </div>
        )}

        {record.status!=='APPROVED'&&(
         <div className="ic-clean-finish-bar">
          <div className="ic-clean-finish-left">
           <Button variant="secondary" busy={busy} disabled={locked} onClick={()=>void handleSaveReview()}>Save draft</Button>
           <Button variant="quiet" busy={busy} disabled={dirty} onClick={()=>setHold(v=>!v)}>Hold</Button>
          </div>
          <div className="ic-clean-finish-right">
           {claimableRows.length>0&&!claim&&(
            <Button variant="secondary" onClick={()=>setActiveTab('CREDITS')}>
             Prepare claim ({money(estimatedFollowPence/100)}) →
            </Button>
           )}
           <Button busy={busy} disabled={uploadPending||readingDirty||creditDirty||emailDirty||(!dirty&&approvalProblems.length>0)} onClick={()=>void handleApproveInvoice()}>
            Approve invoice
           </Button>
          </div>
         </div>
        )}
        {record.status!=='APPROVED'&&!dirty&&approvalProblems.length>0&&(
         <p className="ic-clean-finish-hint">{checklist.nextHint}</p>
        )}
       </div>
      </section>
     </div>
    )}

    {activeTab==='CREDITS'&&(
     <div id="ic-panel-credits" role="tabpanel" aria-labelledby="ic-tab-credits" className="ic-simple-tabpanel">
      {hasReplacements&&(
       <section id="ic-follow-up" className="h-panel ic-simple-card">
        <div className="h-panel-head">
         <div>
          <h2>Replacements &amp; Later Deliveries</h2>
          <p>Approve replacement receipts and record supplier billing decisions before invoice sign-off.</p>
         </div>
         {record.laterReceipts?.some(r=>r.status==='PENDING')&&<Tag tone="amber">Awaiting review</Tag>}
        </div>
        <div className="ic-simple-card-body">
         <LaterDeliveries
          record={record}
          accounts
          disabled={hasUnsaved||busy}
          onChanged={async()=>{
           const result=await run({action:'invoice-case-get'});
           if(result?.record)syncFromRecord(result.record,false);
          }}
         />
        </div>
       </section>
      )}

      <section aria-label="Claim and credit note follow-up" className="h-panel ic-simple-card">
       <div className="h-panel-head">
        <div>
         <h2>Claim &amp; Credit Note Follow-up</h2>
         <p>Prepare claims for marked differences, email the supplier, and reconcile supplier credit notes.</p>
        </div>
        {claim&&<Tag tone={claim.state==='SENT'?'green':'amber'}>Claim {claim.state.toLowerCase()}</Tag>}
       </div>

       <div className="ic-simple-card-body">
        {!claim&&(
         <>
          <div style={{fontSize:13,color:'#213b35',lineHeight:1.55}}>
           <div><strong>{claimableRows.length}</strong> claimable item{claimableRows.length===1?'':'s'} marked Follow · Estimated claim: <strong>{money(estimatedFollowPence/100)}</strong> net</div>
           {claimableRows.length>0?(
            <ul style={{margin:'8px 0 0',paddingLeft:18,fontSize:12,color:'var(--muted,#728078)'}}>
             {claimableRows.map(r=><li key={r.id}>{r.orderProductName}: {money(r.creditEstimatePence/100)} ({r.status})</li>)}
            </ul>
           ):(
            <p className="h-muted" style={{margin:'8px 0 0'}}>
             No claimable discrepancies marked Follow yet.{' '}
             <button type="button" className="h-text-link" onClick={()=>setActiveTab('CHECK')}>Review items in 1. Invoice Check →</button>
            </p>
           )}
           {noteOnlyFollowRows.length>0&&(
            <div style={{marginTop:8,fontSize:12,color:'#264673'}}>
             Detail notes (£0 financial claim, saved to review notes): {noteOnlyFollowRows.map(r=>`${r.orderProductName} (${r.status})`).join(', ')}
            </div>
           )}
          </div>
          <div className="ic-simple-card-foot">
           <Button busy={busy} disabled={record.status==='APPROVED'||uploadPending||claimableRows.length===0} onClick={()=>void handlePrepareAndApproveClaim()}>
            1. Prepare &amp; approve claim ({money(estimatedFollowPence/100)})
           </Button>
          </div>
         </>
        )}

        {claim&&claim.state!=='SENT'&&(
         <>
          <div style={{fontSize:13,color:'var(--forest,#173a31)',fontVariantNumeric:'tabular-nums'}}>
           <strong>Claim {claim.state.toLowerCase()}</strong> · {money(claim.lines.reduce((s,l)=>s+l.netPence,0)/100)} net
          </div>
          <ul style={{margin:0,paddingLeft:18,fontSize:12,color:'var(--muted,#728078)'}}>
           {claim.lines.map(l=><li key={l.lineId}>{record.lines.find(i=>i.id===l.lineId)?.name}: {money(l.netPence/100)} — {l.reason}</li>)}
          </ul>
          {claim.state==='DRAFT'&&(
           <Button busy={busy} disabled={dirty} onClick={()=>void act('approve-claim')}>Approve claim</Button>
          )}
          <InvoiceClaimEmail
           record={record}
           recipient={recipient}
           message={message}
           setRecipient={setRecipient}
           setMessage={setMessage}
           disabled={uploadPending||dirty||readingDirty||creditDirty}
           busy={busy}
           preview={preview}
           run={run}
           onDirty={setEmailDirty}
           onChanged={r=>{
            setRecord(r);
            syncFromRecord(r,false);
            setNotice(r.claim?.state==='SENT'?'Claim sent — record the supplier credit note below once received.':'Email progress saved.');
           }}
          />
         </>
        )}

        {claim?.state==='SENT'&&(
         <>
          <div style={{fontSize:13,color:'#213b35',fontVariantNumeric:'tabular-nums'}}>
           <strong>Claim sent</strong>{claim.recipient?` (${claim.recipient})`:''} · Remaining open balance: <strong>{money(openClaimPence/100)}</strong>
          </div>

          {record.credits.map(n=>(
           <article className="ic-issue" key={n.id} style={{margin:'4px 0',padding:12}}>
            <div className="ic-row">
             <strong>{n.reference} · {money(n.grossPence/100)} gross</strong>
             <Tag tone={n.status==='APPROVED'?'green':'amber'}>{n.status==='APPROVED'?'Credit approved':'Awaiting credit approval'}</Tag>
            </div>
            <CaseDocuments record={record} ids={[n.documentId]}/>
            {n.status==='DRAFT'&&<Button busy={busy} onClick={()=>void act('approve-credit',{creditId:n.id})}>Approve this credit note</Button>}
           </article>
          ))}

          {openClaimPence>0&&!record.credits.some(n=>n.status==='DRAFT')&&record.status!=='APPROVED'&&(
           <div className="ic-simple-credit-box">
            <DocumentUpload
             compact
             onPendingChange={onUploadPending}
             record={record}
             run={run}
             kind="CREDIT"
             label="Upload original credit note"
             onUploaded={id=>{setCreditDoc(id);setCreditDirty(true);}}
            />
            <div className="ic-simple-meta-stack">
             <div className="ic-simple-meta-row ic-simple-meta-row-doc">
              <Field label="Credit note reference"><input value={creditRef} onChange={e=>{setCreditRef(e.target.value);setCreditDirty(true);}}/></Field>
              <Field label="Original invoice ref"><input value={creditInvoice} onChange={e=>{setCreditInvoice(e.target.value);setCreditDirty(true);}}/></Field>
              <Field label="Credit document">
               <select value={creditDoc} onChange={e=>{setCreditDoc(e.target.value);setCreditDirty(true);}}>
                <option value="">{preview?'Auto sample PDF/PNG on save':'Select document'}</option>
                {record.documents.filter(d=>d.kind==='CREDIT').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
               </select>
              </Field>
             </div>
             <div className="ic-simple-meta-row ic-simple-meta-row-doc">
              <Field label="Credit net (£)"><input type="number" min="0" step="0.01" value={creditNetInput} onChange={e=>{setCreditNetInput(e.target.value);setCreditDirty(true);}}/></Field>
              <Field label="Credit VAT (£)"><input type="number" min="0" step="0.01" value={creditVatInput} onChange={e=>{setCreditVatInput(e.target.value);setCreditDirty(true);}}/></Field>
              <Field label="Credit gross (£)"><input type="number" min="0" step="0.01" value={creditGrossInput} onChange={e=>{setCreditGrossInput(e.target.value);setCreditDirty(true);}}/></Field>
             </div>
            </div>
            <label className="h-check">
             <input type="checkbox" checked={creditVerified} onChange={e=>{setCreditVerified(e.target.checked);setCreditDirty(true);}}/>
             Credit note matches supplier amount, invoice ref and VAT.
            </label>
            <div className="ic-simple-card-foot">
             <Button busy={busy} disabled={uploadPending} onClick={()=>void handleRecordCredit()}>
              Record &amp; approve credit note
             </Button>
            </div>
           </div>
          )}

          {openClaimPence===0&&!record.credits.some(n=>n.status==='DRAFT')&&(
           <p className="h-notice success" style={{margin:0}}>Claim fully resolved. Confirm totals on 1. Invoice Check and click Approve invoice when ready.</p>
          )}
         </>
        )}
       </div>
      </section>
     </div>
    )}

    {activeTab==='AUDIT'&&(
     <div id="ic-panel-audit" role="tabpanel" aria-labelledby="ic-tab-audit" className="ic-simple-tabpanel">
      <div className="ic-simple-kpi-grid" aria-label="Claim balance summary">
       <div className="ic-simple-kpi">
        <span>{claimSummary.hasConfirmedClaim?'Original Claim Net':'Estimated Claim Net'}</span>
        <strong>{money(claimSummary.originalNetPence/100)}</strong>
        <small>{claimSummary.hasConfirmedClaim?`${claimSummary.lineBreakdown.length} claimed line(s)`:claimSummary.lineBreakdown.length?'Pending claim confirmation':'No financial discrepancy'}</small>
       </div>
       <div className="ic-simple-kpi">
        <span>Resolved (Replaced / Credited)</span>
        <strong style={{color:'#286246'}}>{money(claimSummary.resolvedPence/100)}</strong>
        <small>Credited {money(claimSummary.creditedPence/100)} · Replaced {money(claimSummary.replacementPence/100)}</small>
       </div>
       <div className="ic-simple-kpi">
        <span>Remaining Open Balance</span>
        <strong style={{color:claimSummary.openBalancePence>0?'#9a662a':'#286246'}}>{money(claimSummary.openBalancePence/100)}</strong>
        <small>{claimSummary.openBalancePence>0?'Awaiting credit note or replacement':claimSummary.hasConfirmedClaim?'Claim balanced & settled':'Nothing open'}</small>
       </div>
      </div>

      {claimSummary.lineBreakdown.length>0&&(
       <section className="h-panel ic-simple-card">
        <div className="h-panel-head">
         <div>
          <h2>Claim Balance Breakdown</h2>
          <p>Itemised discrepancies, credits received and remaining supplier balance.</p>
         </div>
        </div>
        <div className="ic-simple-table-wrap">
         <table className="h-table">
          <thead>
           <tr>
            <th>Item</th>
            <th>Reason</th>
            <th className="number">Claimed Net</th>
            <th className="number">Credited</th>
            <th className="number">Replaced</th>
            <th className="number">Open Balance</th>
           </tr>
          </thead>
          <tbody>
           {claimSummary.lineBreakdown.map(line=>(
            <tr key={line.lineId}>
             <td><strong>{line.name}</strong></td>
             <td>{line.reason}</td>
             <td className="number">{money(line.netPence/100)}</td>
             <td className="number">{money(line.creditedPence/100)}</td>
             <td className="number">{money(line.replacementPence/100)}</td>
             <td className="number"><strong>{money(line.openPence/100)}</strong></td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
       </section>
      )}

      <section className="h-panel ic-simple-card">
       <div className="h-panel-head">
        <div>
         <h2>Review &amp; Credit Audit History</h2>
         <p>Chronological record of uploads, verification saves, claims, credits and replacements.</p>
        </div>
       </div>
       <div className="ic-simple-card-body">
        {record.audit.length===0?(
         <p className="h-muted" style={{margin:0}}>No audit actions recorded yet for this invoice.</p>
        ):(
         <ol className="ic-simple-audit-list">
          {record.audit.map((a,i)=>(
           <li key={i}>
            <div className="ic-simple-audit-head">
             <strong>{a.action.replaceAll('-',' ')}</strong>
             <span>{day(a.at)} · {a.by}</span>
            </div>
            {a.details&&<p>{a.details}</p>}
           </li>
          ))}
         </ol>
        )}
       </div>
      </section>
     </div>
    )}
   </div>

   {showDocPane&&(
    <aside className="ic-simple-doc-pane" aria-label="Invoice document preview">
     <div className="ic-simple-doc-head">
      <div className="ic-simple-doc-title">
       <FileText size={16} aria-hidden="true"/>
       <strong>{primaryDoc?.name||'Uploaded document'}</strong>
      </div>
      <div className="ic-simple-doc-actions">
       {(invoiceRef.trim()||record.invoiceReference)&&(
        <button type="button" className="ic-simple-doc-btn" onClick={()=>void copyRefToClipboard()}>
         <Copy size={13} aria-hidden="true"/>
         {copiedRef?'Copied':'Copy ref'}
        </button>
       )}
       <button type="button" className="ic-simple-doc-close" aria-label="Close document preview" onClick={()=>setShowDocPane(false)}>
        <X size={16}/>
       </button>
      </div>
     </div>

     {record.documents.length>1&&(
      <div className="ic-simple-doc-switcher" role="group" aria-label="Switch document">
       {record.documents.map(doc=>(
        <button
         key={doc.id}
         type="button"
         className={doc.id===activeDocId?'active':''}
         onClick={()=>setSelectedDocId(doc.id)}>
         {doc.name}
        </button>
       ))}
      </div>
     )}

     <div className="ic-simple-doc-body">
      {docLoading&&<p role="status" className="h-muted" style={{padding:16}}>Loading document…</p>}
      {docError&&<p role="alert" className="h-notice error" style={{margin:12}}>{docError}</p>}
      {!docLoading&&!docError&&docPreview&&(
       docPreview.mime==='application/pdf'
        ? <iframe title={docPreview.name} src={docPreview.url} className="ic-simple-doc-frame"/>
        : <img alt={docPreview.name} src={docPreview.url} className="ic-simple-doc-img" referrerPolicy="no-referrer"/>
      )}
     </div>

     {docPreview&&(
      <div className="ic-simple-doc-foot">
       <a className="h-text-link" href={docPreview.url} download={docPreview.name}>Download original ({docPreview.name})</a>
      </div>
     )}
    </aside>
   )}
  </div>
 </div>;
}
