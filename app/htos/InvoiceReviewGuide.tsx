import React from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceReviewGuide} from '../../shared/invoice-review-guide';
export function InvoiceReviewGuide({record}:{record:InvoiceCase}){
 const guide=invoiceReviewGuide(record);
 const focus=(id:string)=>{const el=document.getElementById(id);if(el instanceof HTMLDetailsElement)el.open=true;el?.scrollIntoView({behavior:'auto',block:'start'});el?.focus({preventScroll:true});};
 return <section className="ic-review-guide" aria-label="Invoice review checklist"><p><strong>Next:</strong> {guide.next}</p><div className="ic-review-steps">
  <button type="button" onClick={()=>focus('ic-review-documents')}><strong>Original & delivery</strong><span>{guide.documents} saved document{guide.documents===1?'':'s'} · {record.receipt.submittedAt?'staff report submitted':'staff report needed'}</span></button>
  <button type="button" onClick={()=>focus('ic-review-items')}><strong>Items & differences</strong><span>{guide.attention} item{guide.attention===1?'':'s'} needing attention</span></button>
  <button type="button" onClick={()=>focus('ic-review-totals')}><strong>Totals & decision</strong><span>{guide.totals} · {guide.problems.length} remaining check{guide.problems.length===1?'':'s'}</span></button>
 </div></section>;
}
