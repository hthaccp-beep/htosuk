import {invoiceItemReview,hasKnownAgreedPrice,type ItemReviewRow} from './invoice-item-review.ts';
import type {InvoiceCase} from './invoice-case.ts';

const known=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const normal=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
export interface ComparisonRow extends ItemReviewRow {
  issues:string[]; matches:boolean; differingWording:{name:string;code:string}[];
  billedDisplay?:number; billedUnit:string; priceDisplay?:number; priceUnit:string; draftFigures:boolean;
}
/** A display-only comparison. Preserve raw evidence, original issues and saved decisions. */
export function invoiceComparison(record:InvoiceCase):ComparisonRow[]{
 return invoiceItemReview(record).map(r=>{
  const readings=r.readings||[],single=readings.length===1?readings[0]:undefined;
  const comparable=r.figuresComparable===true&&!r.readingStale&&readings.length<=1;
  const issues=[...r.reports];
  if(r.readingStale)issues.push('Check document version');
  if(readings.length>1)issues.push('Check repeated invoice rows');
  else if(r.unitCheckRequired)issues.push('Check pack');
  if(r.lineId){
   if(!known(r.received))issues.push('Received quantity not confirmed');
   else if(known(r.ordered)&&r.received<r.ordered&&!r.reports.some(s=>s.startsWith('Missing')||s.startsWith('Out of stock')))issues.push(`Missing ${r.ordered-r.received} ${r.unit}`);
   else if(known(r.ordered)&&r.received>r.ordered)issues.push(`Extra ${r.received-r.ordered} ${r.unit} received`);
   if(comparable&&known(r.billed)&&known(r.received)&&r.billed!==r.received)issues.push(`Invoiced ${r.billed}; received ${r.received} ${r.unit}`);
   if(!hasKnownAgreedPrice(r.expectedPrice)&&r.billed!==0)issues.push('Agreed price not confirmed');
   if(r.priceCheck==='HIGHER'||r.priceCheck==='LOWER')issues.push(`Price ${r.priceCheck==='HIGHER'?'+':'−'}£${(Math.abs(r.priceDifference!)/100).toFixed(2)} / ${r.unit}`);
   if(!r.unitCheckRequired&&!r.readingStale&&readings.length<2&&(!comparable||!known(r.billed)||(!known(r.invoicePrice)&&r.billed!==0)))issues.push('Check invoice figures');
   if(r.result==='On hold')issues.push('On hold');
  }
  const matches=!!r.lineId&&comparable&&r.priceCheck==='MATCH'&&known(r.ordered)&&known(r.received)&&known(r.billed)&&r.ordered===r.received&&r.received===r.billed&&issues.length===0;
  // Raw quantities/prices stay in their printed units until a valid comparison exists.
  const draftFigures=!comparable;
  return {...r,issues:[...new Set(issues)],matches,draftFigures,
   differingWording:readings.filter(s=>(s.name&&normal(s.name)!==normal(r.name))||(s.code&&normal(s.code)!==normal(r.code||''))).map(s=>({name:s.name,code:s.code||''})),
   billedDisplay:comparable&&known(r.billed)?r.billed:single?.quantity,
   billedUnit:comparable?r.unit:single?.unit||'Unit unclear',
   priceDisplay:comparable&&known(r.invoicePrice)?r.invoicePrice:single?.price,
   priceUnit:comparable?r.unit:single?.priceUnit||single?.unit||'Unit unclear',
  };
 });
}

/** Display filters retain unresolved readings and pending decisions in the attention queue. */
export function invoiceComparisonGroup(row:ComparisonRow):'NEEDS_REVIEW'|'RESOLVED'|'MATCHED'{
 if(row.attention||!row.lineId||row.readingStale||row.unitCheckRequired||!row.figuresComparable)return 'NEEDS_REVIEW';
 return row.matches?'MATCHED':'RESOLVED';
}
