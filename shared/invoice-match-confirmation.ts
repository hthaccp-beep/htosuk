import type {InvoiceCase} from './invoice-case.ts';
import type {MatchedInvoiceRow} from './invoice-extraction.ts';
import {compareInvoiceUnits} from './invoice-match-assistance.ts';

export const matchEvidence = {
 invoice: 'Original invoice',
 label: 'Supplier pack label',
 specification: 'Supplier specification',
 other: 'Other evidence',
} as const;
export type MatchEvidence = keyof typeof matchEvidence;
export interface MatchConfirmationInput {
 lineId:string; pack:string; manual:boolean; quantity:string; price:string;
 evidence:string; note:string; checked:boolean;
}
/** UI draft only. The existing server command still validates and records the decision. */
export function invoiceMatchConfirmation(record:InvoiceCase,row:MatchedInvoiceRow,input:MatchConfirmationInput){
 const line=record.lines.find(l=>l.id===input.lineId);
 const comparison=line?compareInvoiceUnits(record,row.source,line,input.pack===''?undefined:Number(input.pack)):undefined;
 const figures=input.manual
  ? input.quantity.trim()!==''&&input.price.trim()!==''?{quantity:Number(input.quantity),unitPrice:Number(input.price)}:undefined
  : comparison?.proposal;
 const finite=figures&&[figures.quantity,figures.unitPrice].every(n=>Number.isFinite(n)&&n>=0&&n<=1000000)&&figures.quantity*figures.unitPrice<=1000000;
 const reconciled=!!finite&&row.source.netAmount!=null&&Math.round(figures!.quantity*figures!.unitPrice*100)===Math.round(row.source.netAmount*100);
 const source=Object.prototype.hasOwnProperty.call(matchEvidence,input.evidence)?matchEvidence[input.evidence as MatchEvidence]:undefined;
 const needsNote=input.manual||input.evidence==='other';
 const reason=line&&figures&&source
  ? `Checked product and pack against ${source}. ${input.manual?'Manually checked figures':comparison?.basis||'Checked units'}${!input.manual&&comparison?.canEnterPack?`: 1 ${line.unit} = ${Number(input.pack)} ${row.source.unit}`:''}. Invoice: ${figures.quantity} ${line.unit} at GBP ${figures.unitPrice} each.${input.note.trim()?' '+input.note.trim():''}`
  : '';
 const ready=!!line&&reconciled&&input.checked&&!!source&&(!needsNote||input.note.trim().length>=10)&&reason.length<=2000;
 return {comparison,figures,reconciled,needsNote,ready,payload:ready?{
  page:row.source.page,row:row.source.row,lineId:line!.id,quantity:figures!.quantity,unitPrice:figures!.unitPrice,reason,productConfirmed:true,
 }:undefined};
}
