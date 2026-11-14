import React,{useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {invoiceItemReview,invoiceItemCounts,invoiceItemCountLabel,hasKnownAgreedPrice,type ItemReviewRow} from '../../shared/invoice-item-review';
import {money,Button} from './ui';
import './invoice-item-review.css';

function openSection(id:string){const element=document.getElementById(id);if(!element)return;let parent:HTMLElement|null=element;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}element.scrollIntoView({block:'start'});element.focus({preventScroll:true});}
function Price({value,unit}:{value?:number;unit:string}){return <>{value==null?'Not confirmed':money(value)}{value!=null&&<small>per {unit}</small>}</>;}

export function InvoiceItemReview({record}:{record:InvoiceCase}){
 const [showChecked,setShowChecked]=useState(false),rows=invoiceItemReview(record),counts=invoiceItemCounts(rows);
 const ordered=rows.filter(r=>r.lineId),unmatched=rows.filter(r=>!r.lineId);
 const checked=ordered.filter(r=>!r.attention&&!r.reports.length&&!r.followUp.length&&r.priceCheck==='MATCH');
 const visible=ordered.filter(r=>showChecked||!checked.includes(r));
 const check=(r:ItemReviewRow)=>r.readingStale?'Check document version':(r.readings?.length||0)>1?'Check repeated invoice rows':r.billed===0?'No quantity billed':!hasKnownAgreedPrice(r.expectedPrice)?'Agreed price not confirmed':r.priceCheck==='MATCH'?'✓ Price matches':r.priceCheck==='HIGHER'?money(r.priceDifference!/100)+' higher / '+r.unit:r.priceCheck==='LOWER'?money(-r.priceDifference!/100)+' lower / '+r.unit:'Check invoice quantity / unit';
 const scan=(r:ItemReviewRow)=><>{r.readings?.length?r.readings.map((reading,i)=><div key={i} className="ic-reading-figure"><span>{reading.quantity??'Quantity unclear'} {reading.unit}</span><small>{reading.price==null?'Price not read':money(reading.price)+' per '+reading.unit}{reading.amount==null?'':' · Line '+money(reading.amount)}</small><details><summary>Invoice wording</summary><p>{reading.name||'Unclear description'}</p><small>Page {reading.page} · row {reading.row}</small></details></div>):<span>Not matched yet</span>}</>;
 return <section className="ic-item-list" id="ic-item-review" tabIndex={-1} aria-label="Item-by-item invoice review">
 <div className="ic-item-list-heading"><h2>Order and invoice</h2><span>{invoiceItemCountLabel(counts.items,counts.unmatched)}</span></div>
 <p className="ic-step-note">Each ordered item is counted once. Invoice rows without a confirmed match are listed separately below.</p>
 <div className="ic-item-table-wrap"><table className="ic-item-table"><thead><tr><th>Item</th><th>Order</th><th>Invoice</th><th>Delivery / follow-up</th><th>Check</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}>
 <td data-label="Item"><strong>{r.name}</strong></td>
 <td data-label="Order"><div>{r.ordered??'—'} {r.unit}</div><div>{hasKnownAgreedPrice(r.expectedPrice)?<Price value={r.expectedPrice} unit={r.unit}/>:<strong className="ic-price-check">Agreed price not confirmed</strong>}</div></td>
 <td data-label="Invoice">{r.billed!=null&&r.invoicePrice!=null?<><div>{r.billed} {r.unit}</div><div><Price value={r.invoicePrice} unit={r.unit}/></div>{r.priceCheck==='UNKNOWN'&&<small>Figures still need checking</small>}{!!r.readings?.length&&<details><summary>As printed on invoice</summary>{scan(r)}</details>}</>:<>{scan(r)}{!!r.readings?.length&&<small>Scan draft · confirm units before comparing</small>}</>}{r.readingStale&&<strong className="ic-price-check">Reading is from an older document version</strong>}</td>
 <td data-label="Delivery / follow-up"><div>Received {r.received??'not confirmed'}{r.received!=null?' '+r.unit:''}</div>{r.reports.length?r.reports.map((s,i)=><div key={i}>{s}</div>):<small>No issue reported</small>}{r.notes.length>0&&<details><summary>Staff notes</summary>{r.notes.map((s,i)=><p key={i}>{s}</p>)}</details>}{r.followUp.map((s,i)=><div key={i}>{s}</div>)}{r.followUp.length>0&&<button className="ic-item-link" onClick={()=>openSection(record.laterReceipts?.some(l=>l.lineId===r.lineId)||!record.claim?'ic-follow-up':'ic-claim-follow-up')}>Open follow-up</button>}</td>
 <td data-label="Check"><strong className={r.priceCheck==='MATCH'&&!r.readingStale?'ic-price-match':'ic-price-check'}>{check(r)}</strong>{!['Check price / unit','Check agreed price','Check repeated invoice rows','Checks complete'].includes(r.result)&&<small>{r.result}</small>}<button className="ic-item-link" onClick={()=>openSection(r.action==='SCAN'?'ic-review-reading':'ic-edit-'+r.lineId)}>{r.action==='SCAN'?'Check invoice details':'Open item'}</button></td>
 </tr>)}</tbody></table></div>
 {!!checked.length&&<Button variant="quiet" onClick={()=>setShowChecked(v=>!v)}>{showChecked?'Hide':'Show'} matched items ({checked.length})</Button>}
 {!!unmatched.length&&<section className="ic-unmatched-list" aria-label="Unmatched invoice rows"><h3>Invoice rows to match ({unmatched.length})</h3><p>These may belong to items above or be extra products. They are not counted as additional ordered items.</p>{unmatched.map(r=><div className="ic-unmatched-row" key={r.id}><div><strong>{r.name}</strong>{r.readings?.[0]&&<small>{r.readings[0].quantity??'Quantity unclear'} {r.readings[0].unit} · {r.invoicePrice==null?'Price not read':money(r.invoicePrice)+' per '+r.unit}</small>}{!!r.matchSuggestions?.length&&<small>Suggested: {r.matchSuggestions.map(s=>s.name).join(' / ')} — confirm match</small>}{r.reports[0]?.startsWith('Possibly blank')&&<small>May be a blank row — check the original</small>}</div><button className="ic-item-link" onClick={()=>openSection(r.readings?.[0]?'ic-reading-row-'+r.readings[0].page+'-'+r.readings[0].row:'ic-review-reading')}>Match to order</button></div>)}</section>}
 <p className="ic-item-footnote">A price tick is not invoice approval. A saved zero agreed price stays unconfirmed; no prices or original readings are changed.</p>
 </section>;
}

