import React,{useEffect,useRef,useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import type {MatchedInvoiceRow} from '../../shared/invoice-extraction';
import {invoiceExtractionDraft} from '../../shared/invoice-extraction';
import {currentUnitReviews,hasConfirmedUnitReview} from '../../shared/invoice-unit-review';
import {suggestInvoiceItems} from '../../shared/invoice-match-assistance';
import {invoiceMatchConfirmation,matchEvidence,type MatchConfirmationInput} from '../../shared/invoice-match-confirmation';
import {InvoiceField as Field} from './InvoiceCaseCommon';
import {Button,money} from './ui';
import './invoice-match-confirmation.css';

export function InvoiceMatchConfirmation({record,row,disabled,confirm,onEditing}:{record:InvoiceCase;row:MatchedInvoiceRow;disabled:boolean;confirm:(data:any)=>Promise<any>;onEditing:(id:string,dirty:boolean)=>void}){
 const suggestions=suggestInvoiceItems(record,row.source);
 // A single suggestion is a local starting choice, never a saved match. Explicit confirmation remains required.
 const initialLine=row.lineId||(suggestions.length===1?suggestions[0].lineId:'');
 const empty:MatchConfirmationInput={lineId:initialLine,pack:'',manual:false,quantity:'',price:'',evidence:'',note:'',checked:false};
 const [input,setInput]=useState(empty),[touched,setTouched]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const running=useRef(false),key=row.source.page+':'+row.source.row;
 const update=(patch:Partial<MatchConfirmationInput>)=>{setTouched(true);setError('');setInput(old=>({...old,...patch,checked:patch.checked??false}));};
 useEffect(()=>{onEditing(key,touched||saving);return()=>onEditing(key,false);},[key,touched,saving,onEditing]);
 const saved=currentUnitReviews(record).find(r=>r.page===row.source.page&&r.row===row.source.row),current=hasConfirmedUnitReview(record,row.source.page,row.source.row);
 const reading=invoiceExtractionDraft(record),line=record.lines.find(l=>l.id===input.lineId);
 const draft=invoiceMatchConfirmation(record,row,input),blocked=disabled||saving;
 const suggestedIds=[...new Set([...row.candidateIds,...suggestions.map(s=>s.lineId)])];
 if(!row.unitReviewRequired)return null;
 if(current&&saved)return <p className="ic-unit-saved" role="status"><strong>Match & pack saved.</strong> {saved.quantity} {saved.unit} × {money(saved.unitPrice)}. Invoice still needs approval.</p>;
 if(reading?.extracted.documentType!=='INVOICE'||record.documents.find(d=>d.id===reading?.documentId)?.kind!=='INVOICE')return <p className="h-notice"><strong>Invoice needed.</strong> This saved reading is a delivery note or its document type is unconfirmed. Keep it for delivery evidence; upload the supplier invoice to confirm charges.</p>;
 const save=async()=>{
  if(running.current||blocked||!draft.payload)return;
  running.current=true;setSaving(true);setError('');
  try{const result=await confirm(draft.payload);if(result){setTouched(false);setInput(empty);}else setError('Not saved. Check the message above and try again.');}
  catch(e){setError(e instanceof Error?e.message:'Could not save. Your entries are still here.');}
  finally{running.current=false;setSaving(false);}
 };
 return <div className="ic-match-form">
  <Field label="1. Match to order"><select value={input.lineId} disabled={blocked} onChange={e=>{setInput({...empty,lineId:e.target.value});setTouched(true);setError('');}}><option value="">Choose the correct item</option>
   {!!suggestedIds.length&&<optgroup label="Suggested — please check">{record.lines.filter(l=>suggestedIds.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>}
   <optgroup label="Other order items">{record.lines.filter(l=>!suggestedIds.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>
  </select></Field>
  {suggestions.length>1&&<p className="ic-match-warning">More than one possible item. Check the size or variant.</p>}
  {line&&<>
   <div className="ic-match-comparison" aria-label="Invoice and order comparison">
    <div><span>Document says</span><strong>{row.source.quantity??'?'} {row.source.unit||'unit unclear'} × {money(row.source.unitPrice??undefined)}</strong><small>Line total {money(row.source.netAmount??undefined)}</small></div>
    <div><span>Order says</span><strong>{line.ordered} {line.unit} × {line.expectedPrice!=null&&line.expectedPrice>0?money(line.expectedPrice):'price not confirmed'}</strong><small>{line.name}</small></div>
   </div>
   <h4>2. Check the pack</h4>
   {draft.comparison?.canEnterPack&&!input.manual&&<Field label={'Pack size ('+row.source.unit+' per '+line.unit+')'} hint="Use the supplier label or specification, not the order total."><input type="number" inputMode="decimal" min="0.000001" max="1000000" step="any" value={input.pack} disabled={blocked} placeholder="Enter pack size" onChange={e=>update({pack:e.target.value})}/></Field>}
   {!input.manual&&!draft.figures&&<p className="ic-match-warning" role="status">{draft.comparison?.message}</p>}
   {!input.manual&&draft.figures&&<div className="ic-match-result" role="status"><strong>{draft.figures.quantity.toLocaleString('en-GB',{maximumFractionDigits:6})} {line.unit} × {money(draft.figures.unitPrice)} per {line.unit}</strong><span>{draft.comparison?.canEnterPack?'Using your pack size':'Units converted for comparison'} · Line total {money(draft.figures.quantity*draft.figures.unitPrice)}</span><span>{line.expectedPrice==null||line.expectedPrice<=0?'Agreed price not confirmed':Math.round(draft.figures.unitPrice*100)===Math.round(line.expectedPrice*100)?'Same as agreed price':`Invoice price ${draft.figures.unitPrice>line.expectedPrice?'higher':'lower'} by ${money(Math.abs(draft.figures.unitPrice-line.expectedPrice))} per ${line.unit}`}</span></div>}
   <Button variant="quiet" disabled={blocked} aria-expanded={input.manual} onClick={()=>update({manual:!input.manual,quantity:'',price:'',pack:'',note:'',evidence:''})}>{input.manual?'Back to pack calculation':'Enter checked figures manually'}</Button>
   {input.manual&&<div className="ic-match-manual"><p>Use the original and supplier evidence. Do not guess weight or pack sizes.</p><div className="ic-match-comparison"><Field label={'Invoice quantity ('+line.unit+')'}><input type="number" inputMode="decimal" min="0" step="any" value={input.quantity} disabled={blocked} onChange={e=>update({quantity:e.target.value})}/></Field><Field label={'Invoice price per '+line.unit+' (£)'}><input type="number" inputMode="decimal" min="0" step="any" value={input.price} disabled={blocked} onChange={e=>update({price:e.target.value})}/></Field></div><p role="status">{draft.reconciled?'Line total agrees with the document.':'Both figures must agree with the printed line total.'}</p></div>}
   {draft.figures&&draft.reconciled&&<>
    <Field label="3. Evidence checked"><select value={input.evidence} disabled={blocked} onChange={e=>update({evidence:e.target.value})}><option value="">Choose what you checked</option>{Object.entries(matchEvidence).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
    {draft.needsNote&&<Field label="What confirms these figures?" hint="Include the pack size, weight or correction you checked."><input value={input.note} maxLength={1500} disabled={blocked} onChange={e=>update({note:e.target.value})}/></Field>}
    <label className="ic-match-check"><input type="checkbox" checked={input.checked} disabled={blocked||!input.evidence} onChange={e=>update({checked:e.target.checked})}/><span>I checked the product, variant and pack against this evidence.</span></label>
   </>}
   {error&&<p role="alert" className="ic-match-warning">{error}</p>}
   <div className="ic-match-save"><Button disabled={blocked||!draft.ready} busy={saving} onClick={()=>void save()}>Save match & pack</Button><small>Saves this item only. Invoice approval is separate.</small></div>
  </>}
 </div>;
}
