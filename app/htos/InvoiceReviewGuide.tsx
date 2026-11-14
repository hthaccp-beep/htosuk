import React from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceReviewGuide} from '../../shared/invoice-review-guide';
export function InvoiceReviewGuide({record}:{record:InvoiceCase}){
 const guide=invoiceReviewGuide(record);
 const focus=(id:string)=>{const el=document.getElementById(id);if(el instanceof HTMLDetailsElement)el.open=true;el?.scrollIntoView({behavior:'auto',block:'start'});el?.focus({preventScroll:true});};
 return <section className="ic-review-guide" aria-label="Invoice review checklist"><div className="ic-review-steps">
  <button type="button" onClick={()=>focus('ic-review-documents')}><strong>Document</strong><span>{guide.documents?'Uploaded':'Upload needed'} · {record.receipt.submittedAt?'Delivery reported':'Delivery report needed'}</span></button>
  <button type="button" onClick={()=>focus('ic-item-review')}><strong>{guide.attention?'Check '+guide.attention+' item'+(guide.attention===1?'':'s'):'Items checked'}</strong><span>{guide.readingAttention?'Some invoice details are unclear':guide.attention?'Price, quantity or delivery checks':'No item checks left'}</span></button>
  <button type="button" onClick={()=>focus('ic-review-totals')}><strong>Total</strong><span>{guide.totals==='Totals checked'?'Checked':'Not yet confirmed'}</span></button>
 </div></section>;
}
