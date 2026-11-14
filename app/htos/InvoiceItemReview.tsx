import React,{useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceItemReview,type ItemReviewRow} from '../../shared/invoice-item-review';
import {money,Button} from './ui';
import './invoice-item-review.css';
function openSection(id:string){const element=document.getElementById(id);if(!element)return;let parent:HTMLElement|null=element;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}element.scrollIntoView({block:'start'});element.focus({preventScroll:true});}
export function InvoiceItemReview({record}:{record:InvoiceCase}){
 const [showChecked,setShowChecked]=useState(false),rows=invoiceItemReview(record),attention=rows.filter(r=>r.attention),resolved=rows.filter(r=>!r.attention&&(r.reports.length||r.followUp.length||r.priceCheck!=='MATCH')),checked=rows.filter(r=>!r.attention&&!resolved.includes(r));
 const visible=showChecked?[...attention,...resolved,...checked]:[...attention,...resolved];
 const price=(r:ItemReviewRow)=>r.priceCheck==='MATCH'?'✓ Price matches':r.priceCheck==='HIGHER'?money(r.priceDifference!/100)+' higher / '+r.unit:r.priceCheck==='LOWER'?money(-r.priceDifference!/100)+' lower / '+r.unit:r.priceCheck==='UNMATCHED'?'No agreed match':r.billed===0?'No quantity billed':'Check price / unit';
 return <section className="ic-item-list" id="ic-item-review" tabIndex={-1} aria-label="Item-by-item invoice review"><div className="ic-item-list-heading"><h2>Items & follow-up</h2><span>{attention.length} to check</span></div><p className="ic-step-note">A price tick checks the price only. Accounts approval is separate.</p>
 <div className="ic-item-table-wrap"><table className="ic-item-table"><thead><tr><th>Item / quantity</th><th>Staff report</th><th>Replacement / credit</th><th>Agreed / order price</th><th>Invoice price</th><th>Check / next action</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}>
 <td data-label="Item / quantity"><strong>{r.name}</strong><small>Unit: {r.unit}</small><small>Ordered {r.ordered??'—'} · Received {r.received??'—'} · Billed {r.billed??'—'}</small></td>
 <td data-label="Staff report">{r.reports.length?r.reports.map((s,i)=><div key={i}>{s}</div>):<span>{r.lineId?(r.received==null?'Receipt to check':'No issue reported'):'Not on the matched order list'}</span>}{r.notes.length>0&&<details><summary>Staff notes</summary>{r.notes.map((s,i)=><p key={i}>{s}</p>)}</details>}</td>
 <td data-label="Replacement / credit">{r.followUp.length?r.followUp.map((s,i)=><div key={i}>{s}</div>):'—'}{r.followUp.length>0&&r.lineId&&<button className="ic-item-link" onClick={()=>openSection(record.laterReceipts?.some(l=>l.lineId===r.lineId)||!record.claim?'ic-follow-up':'ic-claim-follow-up')}>Open follow-up</button>}</td>
 <td data-label="Agreed / order price">{r.expectedPrice==null?'Not available':money(r.expectedPrice)}{r.expectedPrice!=null&&<small>per {r.unit}</small>}</td>
 <td data-label="Invoice price">{r.invoicePrice==null?'Not confirmed':money(r.invoicePrice)}{r.invoicePrice!=null&&<small>{r.priceCheck==='UNKNOWN'||r.priceCheck==='UNMATCHED'?'Unit to confirm':'per '+r.unit}</small>}</td>
 <td data-label="Check / next action"><strong className={r.priceCheck==='MATCH'?'ic-price-match':'ic-price-check'}>{price(r)}</strong><small>{r.result}</small><button className="ic-item-link" onClick={()=>openSection(r.action==='SCAN'?'ic-review-reading':'ic-edit-'+r.lineId)}>{r.action==='SCAN'?'Review scan':'Open item'}</button></td>
 </tr>)}</tbody></table></div>
 {!attention.length&&!showChecked&&<p>No outstanding item checks. Review the invoice totals before approval.</p>}
 {!!checked.length&&<Button variant="quiet" onClick={()=>setShowChecked(v=>!v)}>{showChecked?'Hide':'Show'} matched items ({checked.length})</Button>}
 <p className="ic-item-footnote">Agreed prices are the saved order prices. Unclear packs or units must be checked before comparison.</p>
 </section>;
}
