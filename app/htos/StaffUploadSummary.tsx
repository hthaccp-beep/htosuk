import React,{useState} from 'react';
import type {OrderRecord} from '../../types';
import type {InvoiceCase} from '../../shared/invoice-case';
import type {InvoiceReceiptSummary} from '../../shared/invoice-receipt-summary';
import {Button,Tag,day,shortId} from './ui';
import './staff-upload-summary.css';

const labels={RECEIVED:'Received',OUT_OF_STOCK:'Out of stock',MISSING:'Missing',DAMAGED:'Damaged',INCORRECT:'Incorrect',OTHER:'Other'};
export function StaffReportSummary({record}:{record:Pick<InvoiceCase,'documents'|'receipt'|'lines'>}){
 const documents=record.documents.filter(d=>d.kind==='INVOICE'||d.kind==='DELIVERY').length;
 return <section className="ic-staff-summary" aria-label="Your upload summary">
  <div className="ic-staff-summary-heading"><strong>Your upload</strong><Tag>{documents?`${documents} document${documents===1?'':'s'} saved`:'No document saved'}</Tag><Tag>{record.receipt.submittedAt?'Report submitted':'Report not submitted'}</Tag></div>
  {record.receipt.statuses.length>0&&<p>{record.receipt.statuses.map(s=>labels[s]).join(' · ')}</p>}
  {record.receipt.issues.length>0&&<ul>{record.receipt.issues.map(i=>{const l=record.lines.find(l=>l.id===i.lineId);return <li key={i.id}><strong>{l?.name||'Delivery note'}</strong> — {labels[i.kind]}{i.quantity!=null?` ${i.quantity} ${l?.unit||''}`:''}{i.notes&&<span> · {i.notes}</span>}</li>;})}</ul>}
  <small>{record.receipt.submittedAt?'Saved for Accounts to check.':'Upload the document, report what arrived, then submit.'}</small>
 </section>;
}

export function StaffUploadList({orders,summaries,busy,error,onOpen,onRetry}:{orders:OrderRecord[];summaries:Record<string,InvoiceReceiptSummary>;busy:boolean;error:string;onOpen:(order:OrderRecord)=>void;onRetry:()=>void}){
 const [filter,setFilter]=useState('all');
 const visible=orders.filter(o=>{const s=summaries[o.id];return filter==='all'||!!s&&(filter==='submitted'?s.receipt==='SUBMITTED':s.receipt!=='SUBMITTED');}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return <section className="ic-staff-uploads"><div className="ic-staff-upload-heading"><div><h1>Upload & delivery</h1><p>Choose an order, upload the document and tell us what arrived.</p></div><select aria-label="Delivery report filter" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All orders</option><option value="todo">To upload / report</option><option value="submitted">Submitted</option></select></div>
 {error&&<p role="alert">Upload statuses could not be loaded. <Button variant="secondary" onClick={onRetry}>Retry</Button></p>}
 {busy&&<p role="status">Loading upload statuses…</p>}
 <div className="ic-staff-upload-list">{visible.map(o=>{const s=summaries[o.id],count=s?.documents||0;return <article key={o.id}><div><strong>{o.supplierNameSnapshot}</strong><small>{o.branchNameSnapshot} · {day(o.deliveryDate)} · #{shortId(o.id)}</small><div className="ic-staff-upload-tags"><Tag>{busy?'Loading…':!s?'Status unavailable':count?`${count} document${count===1?'':'s'} saved`:'Not uploaded'}</Tag>{s&&<Tag>{s.receipt==='SUBMITTED'?'Report submitted':s.receipt==='DRAFT'?'Report draft':'Report needed'}</Tag>}</div></div><Button variant="secondary" onClick={()=>onOpen(o)}>{s?.receipt==='SUBMITTED'?'View summary':'Upload / report'}</Button></article>;})}</div>
 {!visible.length&&!busy&&<p>No orders in this view.</p>}<a className="h-button quiet" href="#/orders">Older orders in Order history</a>
 </section>;
}
