import {lineDiscrepancy,type InvoiceCase,type InvoiceCaseLine} from './invoice-case.ts';
export function invoiceItemIssueLabels(record:InvoiceCase,line:InvoiceCaseLine):string[]{
 const labels:string[]=[],issues=record.receipt.issues.filter(i=>i.lineId===line.id);
 for(const [kind,label] of [['MISSING','Missing'],['DAMAGED','Damaged'],['INCORRECT','Incorrect'],['OUT_OF_STOCK','Out of stock'],['OTHER','Other']] as const){const selected=issues.filter(i=>i.kind===kind);if(selected.length){const qty=selected.reduce((n,i)=>n+(i.quantity??0),0);labels.push(label+(qty?' '+qty+' '+line.unit:''));}}
 const d=lineDiscrepancy(record,line);
 if((line.invoiceQuantity??0)>0&&line.invoicePrice!=null&&line.expectedPrice!=null&&line.invoicePrice!==line.expectedPrice)labels.push('Price difference');
 if(!d.known)labels.push('Check details');
 if(!labels.length&&d.hasDifference)labels.push('Quantity difference');
 return labels.length?labels:['No difference'];
}
