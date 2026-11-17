import {lineDiscrepancy,type InvoiceCase} from './invoice-case.ts';
import {hasKnownAgreedPrice} from './invoice-item-review.ts';
import type {ComparisonRow} from './invoice-comparison.ts';

/** Display only. Never creates a claim or treats an unconfirmed pack as money due. */
export function itemCreditSummary(record:InvoiceCase,row:ComparisonRow):{pence?:number;label:string} {
 const claim=record.claim?.lines.find(l=>l.lineId===row.lineId);
 if(claim){
  const remaining=Math.max(0,claim.netPence-claim.creditedPence-claim.replacementPence);
  return {pence:remaining,label:remaining===0?'Settled':record.claim?.state==='SENT'?'Outstanding':'Proposed'};
 }
 const line=record.lines.find(l=>l.id===row.lineId);
 if(!line||row.readingStale||row.unitCheckRequired||!row.figuresComparable||!hasKnownAgreedPrice(line.expectedPrice))return {label:'To check'};
 const difference=lineDiscrepancy(record,line);
 if(!difference.known)return {label:'To check'};
 if(line.resolution==='ACCEPT'&&line.reviewed)return {label:'Accepted — no claim'};
 return difference.totalPence>0?{pence:difference.totalPence,label:'Proposed'}:{label:'No credit identified'};
}
