import {itemCreditSummary} from '../../shared/invoice-credit-summary';
import React,{useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {hasKnownAgreedPrice} from '../../shared/invoice-item-review';
import {invoiceComparison,invoiceComparisonGroup,type ComparisonRow} from '../../shared/invoice-comparison';
import {money,Button} from './ui';
import './invoice-item-review.css';
import {useInvoiceReviewNavigation} from './InvoiceReviewLayout';

const qty=(value:number|undefined,unit:string)=>value==null?'Check quantity':`${value} ${unit}`;
const price=(value:number|undefined,unit:string)=>value==null?'Price not confirmed':`${money(value)} / ${unit}`;
const issue=(s:string)=>s.replace(/^(Missing|Damaged|Incorrect) items · /,'$1 ').replace('Agreed price not confirmed','Check agreed price');
const follow=(s:string)=>s.replace('Replacement reported: ','Replacement to confirm: ').replace(' — Accounts to confirm','').replace('Replacement confirmed: ','Replaced: ').replace('Replacement settlement recorded — open history','Replacement recorded').replace('Full credit approved: ','Fully credited: ').replace('Credit approved: ','Credited: ').replace('Credit / replacement outstanding: ','Credit / replacement due: ').replace('Credit note received — Accounts to approve','Credit received — check').replace('Choose replacement, credit or other resolution','Choose follow-up');
function target(r:ComparisonRow){return r.action==='SCAN'?'ic-review-reading':'ic-edit-'+r.lineId;}

export function InvoiceItemReview({record}:{record:InvoiceCase}){
 const openSection=useInvoiceReviewNavigation();
 const [filter,setFilter]=useState<'NEEDS_REVIEW'|'RESOLVED'|'ALL'>('NEEDS_REVIEW'),[expanded,setExpanded]=useState<string|null>(null),rows=invoiceComparison(record);
 const ordered=rows.filter(r=>r.lineId),unmatched=rows.filter(r=>!r.lineId),needs=ordered.filter(r=>invoiceComparisonGroup(r)==='NEEDS_REVIEW'),resolved=ordered.filter(r=>invoiceComparisonGroup(r)==='RESOLVED');
 const visible=filter==='ALL'?[...needs,...resolved,...ordered.filter(r=>invoiceComparisonGroup(r)==='MATCHED')]:filter==='RESOLVED'?resolved:needs;
 return <section className="ic-item-list" id="ic-item-review" tabIndex={-1} aria-label="Item-by-item invoice review">
  <div className="ic-item-list-heading"><h2>Items</h2><div className="ic-comparison-toggle" aria-label="Items shown">{([['NEEDS_REVIEW','Needs attention',needs.length+unmatched.length],['RESOLVED','Resolved',resolved.length],['ALL','All items',rows.length]] as const).map(([key,label,count])=><Button key={key} variant={filter===key?'':'secondary'} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label} ({count})</Button>)}</div></div>
  {visible.length?<div className="ic-item-table-wrap"><table className="ic-item-table ic-credit-table"><thead><tr><th>Item</th><th>What’s wrong</th><th>Credit needed</th><th>Follow-up</th></tr></thead><tbody>{visible.map(r=><React.Fragment key={r.id}>
   <tr className="ic-comparison-row">
    <td className="ic-item-name"><strong>{r.name}</strong>{r.code&&<small>{r.code}</small>}<button className="ic-item-link" type="button" aria-expanded={expanded===r.id} aria-controls={'ic-detail-'+r.id} aria-label={'Details for '+r.name} onClick={()=>setExpanded(expanded===r.id?null:r.id)}>{expanded===r.id?'Hide details':'Details'}</button></td>
    <td data-label="What’s wrong" className="ic-issue-cell">{r.matches?<strong className="ic-price-match">✓ Matches</strong>:<span className="ic-price-check">{r.issues.length?r.issues.map(issue).join(' · '):r.result==='Checks complete'?'No difference recorded':r.result}</span>}{r.differingWording.length>0&&<small>Invoice name/code differs</small>}</td>
    <td data-label="Credit needed">{(()=>{const credit=itemCreditSummary(record,r);return <>{credit.pence!=null&&credit.pence>0&&<strong>{money(credit.pence/100)}</strong>}<small>{credit.label}</small></>;})()}</td>
    <td data-label="Follow-up" className="ic-follow-cell"><span>{r.followUp.length?r.followUp.map(follow).join(' · '):r.matches?'—':r.attention?'To review':'Reviewed'}</span></td>
   </tr>
   <tr id={'ic-detail-'+r.id} hidden={expanded!==r.id} className="ic-detail-row"><td colSpan={4}>
    {expanded===r.id&&<div className="ic-expanded-detail">
     <div className="ic-detail-comparison"><div><strong>Order</strong><span>{qty(r.ordered,r.unit)}</span><small>{price(hasKnownAgreedPrice(r.expectedPrice)?r.expectedPrice:undefined,r.unit)}</small></div><div><strong>Received</strong><span>{qty(r.received,r.unit)}</span></div><div><strong>Invoice</strong><span>{qty(r.billedDisplay,r.billedUnit)}</span><small>{price(r.priceDisplay,r.priceUnit)}</small></div></div>
     {r.differingWording.map((s,i)=><p key={i}><strong>Invoice item:</strong> {s.name}{s.code?' · '+s.code:''}</p>)}
     {r.draftFigures&&<p>Invoice figures are an unconfirmed reading. Check the original and pack before comparing prices.</p>}
     {r.notes.map((n,i)=><p key={i}><strong>Staff note:</strong> {n}</p>)}
     {r.followUp.map((s,i)=><p key={i}>{s}</p>)}
     <div className="ic-detail-actions"><Button variant="secondary" onClick={()=>openSection(target(r))}>Check / correct item</Button>{r.followUp.length>0&&<Button variant="secondary" onClick={()=>openSection(record.laterReceipts?.some(l=>l.lineId===r.lineId)||!record.claim?'ic-follow-up':'ic-claim-follow-up')}>Open follow-up</Button>}<Button variant="quiet" onClick={()=>openSection('ic-review-documents')}>View document</Button></div>
    </div>}
   </td></tr>
  </React.Fragment>)}</tbody></table></div>:<p className="ic-comparison-empty">{filter==='RESOLVED'?'No resolved items yet.':unmatched.length?'Unmatched invoice items are listed below.':'No ordered items need attention.'} Choose All items to see the comparison.</p>}
  {filter!=='RESOLVED'&&!!unmatched.length&&<section className="ic-unmatched-list" aria-label="Unmatched invoice rows"><h3>Not on the order ({unmatched.length})</h3>{unmatched.map(r=><div className="ic-unmatched-row" key={r.id}><div><strong>{r.name}</strong><small>{qty(r.billedDisplay,r.billedUnit)} · {price(r.priceDisplay,r.priceUnit)}</small></div><button type="button" className="ic-item-link" onClick={()=>openSection(r.readings?.[0]?'ic-reading-row-'+r.readings[0].page+'-'+r.readings[0].row:'ic-review-reading')}>Match item</button></div>)}</section>}
  <p className="ic-item-footnote">Proposed credit needs Accounts checking. Replacements and credits stay linked to the original issue.</p>
 </section>;
}
