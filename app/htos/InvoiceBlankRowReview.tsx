import React,{useEffect,useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import type {MatchedInvoiceRow,InvoiceExtractionDraft} from '../../shared/invoice-extraction';
import {confirmedBlankReview} from '../../shared/invoice-blank-review';
import {InvoiceField as Field} from './InvoiceCaseCommon';
import {Button} from './ui';

export function InvoiceBlankRowReview({record,row,disabled,act,onEditing}:{record:InvoiceCase;row:MatchedInvoiceRow;disabled:boolean;act:(kind:string,data:any)=>Promise<any>;onEditing:(id:string,dirty:boolean)=>void}){
 const [reason,setReason]=useState(''),[checked,setChecked]=useState(false);
 const key='blank:'+row.source.page+':'+row.source.row,edited=!!reason||checked;
 useEffect(()=>{onEditing(key,edited);return()=>onEditing(key,false);},[key,edited,onEditing]);
 if(!row.blankReviewRequired&&!row.blankConfirmed)return null;
 const draft=record.extraction.draft as InvoiceExtractionDraft;
 const saved=confirmedBlankReview(record,draft.documentId,row.source);
 return <div className="ic-unit-review">
  <p className="ic-step-note"><strong>{saved?'Confirmed blank — not charged':'Blank row — check the original'}</strong>{saved&&<> · {saved.reason}</>}</p>
  <p>{saved?'The original row and review history are retained.':'Confirm only if the original has no quantity, weight, price or amount. If unclear, leave it for review.'} This does not mark goods received or out of stock.</p>
  {!disabled&&<><Field label={saved?'Reason to reopen this row':'Reason for confirming blank'}><input value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder={saved?'Explain why the row needs checking again':'For example: checked the original; all charge fields are blank'}/></Field>
   <label className="ic-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>{saved?'This row needs review again.':'I checked the original: this row is blank and not charged.'}</label>
   <Button variant="secondary" disabled={!checked||reason.trim().length<10} onClick={async()=>{const result=await act(saved?'restore-blank-row':'confirm-blank-row',{page:row.source.page,row:row.source.row,confirmed:checked,reason});if(result){setReason('');setChecked(false);}}}>{saved?'Reopen blank row':'Confirm blank — not charged'}</Button></>}
 </div>;
}
