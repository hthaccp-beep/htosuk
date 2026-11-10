import type {OrderRecord, InvoiceEvidence} from '../types.ts';

export interface DeliveryCheckLine {
 lineId:string; description:string; orderedCases:number; orderedUnits:number;
 documentCases?:number; documentUnits?:number; receivedCases?:number; receivedUnits?:number;
 damagedCases?:number; damagedUnits?:number; issue:'NONE'|'WRONG_ITEM'|'DAMAGED'|'EXTRA'; notes:string; checked:boolean;
}
export interface DeliveryCheck {
 version:number; reference:string; date:string; partial:boolean; draft:boolean; notes:string;
 lines:DeliveryCheckLine[]; evidence:InvoiceEvidence[]; checkedBy:string; checkedAt:string;
}
export interface CreditReceipt {id:string;reference:string;date:string;amount:number;notes:string;document?:{name:string;dataUrl:string};recordedBy:string;recordedAt:string}
export interface SupplierCase {
 id:string; version:number; source:'INVOICE'|'DELIVERY'; sourceVersion:number; requestedAmount:number;
 subject:string; message:string; to:string[]; cc:string[]; from:string;
 emailState:'SENDING'|'SENT'|'PARTIAL'|'UNCERTAIN'; accepted:string[]; rejected:string[];
 createdAt:string; sentAt?:string; credits:CreditReceipt[]; resolvedAt?:string; resolution?:string;
 mailboxConfirmation?:{by:string;at:string;notes:string;received:boolean};
}
export function deliveryLines(order:OrderRecord):DeliveryCheckLine[]{
 return [...order.items.map(i=>({lineId:i.productId,description:i.productNameSnapshot,orderedCases:i.caseQty,orderedUnits:i.packQty})),...(order.manualItems||[]).map(i=>({lineId:i.id,description:i.description,orderedCases:i.caseQty,orderedUnits:i.packQty}))].map(l=>({...l,issue:'NONE',notes:'',checked:false}));
}
export function deliveryIssues(line:DeliveryCheckLine,partial:boolean):string[]{
 const issues:string[]=[];
 if(line.receivedCases==null||line.receivedUnits==null)return ['Receipt not confirmed'];
 if(line.receivedCases<line.orderedCases||line.receivedUnits<line.orderedUnits)issues.push(partial?'Balance outstanding':'Short delivery');
 if(line.receivedCases>line.orderedCases||line.receivedUnits>line.orderedUnits)issues.push('Extra quantity');
 if((line.documentCases!=null&&line.documentCases!==line.receivedCases)||(line.documentUnits!=null&&line.documentUnits!==line.receivedUnits))issues.push('Document differs from receipt');
 if((line.damagedCases||0)+(line.damagedUnits||0)>0)issues.push('Damaged / rejected');
 if(line.issue!=='NONE')issues.push(line.issue.replaceAll('_',' ').toLowerCase());
 return [...new Set(issues)];
}
export function caseStatus(value?:SupplierCase):string{
 if(!value)return 'No request sent';
 if(value.resolvedAt)return 'Resolved';
 if(value.emailState!=='SENT')return value.emailState==='SENDING'?'Sending · do not resend':value.emailState==='PARTIAL'?'Some recipients rejected':'Sending outcome uncertain';
 const credit=value.credits.reduce((s,c)=>s+c.amount,0);
 return credit>0?(value.requestedAmount>0&&credit+0.005<value.requestedAmount?'Partial credit received':'Credit received · review to close'):'Awaiting supplier';
}
