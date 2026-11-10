import type {ReconciledLineInput} from '../utils/invoiceReconciliation';
export function invoiceFlags(l:ReconciledLineInput){
 const flags:string[]=[];
 if(((l.invoicedCaseQty??0)>0&&l.invoicedCasePrice==null)||((l.invoicedPackQty??0)>0&&l.invoicedPackPrice==null))flags.push('Document price missing');
 if(!l.receiptConfirmed)flags.push('Receipt unconfirmed');
 if(l.invoicedCaseQty==null||l.invoicedPackQty==null)flags.push('Invoice quantity missing');
 else if(l.invoicedCaseQty!==l.orderedCaseQty||l.invoicedPackQty!==l.orderedPackQty)flags.push('Ordered / invoiced quantity differs');
 if(l.receiptConfirmed&&(l.deliveredCaseQty!==l.orderedCaseQty||l.deliveredPackQty!==l.orderedPackQty))flags.push('Delivery quantity differs');
 if(l.receiptConfirmed&&(l.invoicedCaseQty!>l.deliveredCaseQty!||l.invoicedPackQty!>l.deliveredPackQty!))flags.push('Billed but not received');
 if((l.invoicedCaseQty!>0&&l.invoicedCasePrice!=null&&l.invoicedCasePrice!==l.expectedCasePrice)||(l.invoicedPackQty!>0&&l.invoicedPackPrice!=null&&l.invoicedPackPrice!==l.expectedPackPrice))flags.push('Price difference');
 if((l.damagedCaseQty||0)+(l.damagedPackQty||0)>0)flags.push('Damaged / rejected goods');
 return flags;
}
