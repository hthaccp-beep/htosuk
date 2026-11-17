import React from 'react';
import {useInvoiceReviewNavigation} from './InvoiceReviewLayout';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceReviewGuide} from '../../shared/invoice-review-guide';
export function InvoiceReviewGuide({record}:{record:InvoiceCase}){
 const guide=invoiceReviewGuide(record);
 const focus=useInvoiceReviewNavigation();
 return <section className="ic-review-guide" aria-label="Invoice review checklist"><div className="ic-review-steps">
  <button type="button" onClick={()=>focus('ic-review-documents')}><strong>Document</strong><span>{guide.documents?'Uploaded':'Upload needed'} · {record.receipt.submittedAt?'Delivery reported':'Delivery report needed'}</span></button>
  <button type="button" onClick={()=>focus('ic-item-review')}><strong>{guide.itemLabel}</strong><span>{guide.readingAttention?'Some invoice details are unclear':guide.attention?'Price, quantity or delivery checks':'No item checks left'}</span></button>
  <button type="button" onClick={()=>focus('ic-review-totals')}><strong>Final checks</strong><span>{guide.problems.length?guide.problems.length+' remaining':'Ready for Accounts decision'}</span></button>
 </div></section>;
}
