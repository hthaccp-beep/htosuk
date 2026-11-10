import type {OrderRecord} from '../types.ts';
import type {ReconciledLineInput} from '../utils/invoiceReconciliation.ts';
import type {DeliveryCheckLine} from './delivery-check.ts';
export type CheckDocumentKind='DELIVERY'|'INVOICE';
export type DocumentReviewLine=ReconciledLineInput&{deliveryIssue?:DeliveryCheckLine['issue']};

export function documentReviewLines(order:OrderRecord,kind:CheckDocumentKind):DocumentReviewLine[]{
  if(kind==='INVOICE'&&order.invoiceVerification?.lines?.length)return order.invoiceVerification.lines.map(l=>({...l,lineId:l.productId||order.manualItems?.find(m=>m.id===l.lineId||m.description===l.description)?.id||l.lineId,invoicedLineTotal:l.inputVersion===2?l.enteredLineTotal:l.netAmount,...(l.receiptConfirmed?{}:{deliveredCaseQty:undefined,deliveredPackQty:undefined}),receiptConfirmed:!!l.receiptConfirmed}));
  const lines:ReconciledLineInput[]=[...order.items.map(i=>({lineId:i.productId,productId:i.productId,itemCode:i.itemCodeSnapshot,description:i.productNameSnapshot,orderedCaseQty:i.caseQty,orderedPackQty:i.packQty,expectedCasePrice:i.casePriceSnapshot,expectedPackPrice:i.packPriceSnapshot,vatRate:i.vatRate||0})),...(order.manualItems||[]).map(i=>({lineId:i.id,description:i.description,orderedCaseQty:i.caseQty,orderedPackQty:i.packQty,expectedCasePrice:i.casePriceSnapshot,expectedPackPrice:i.packPriceSnapshot,vatRate:i.vatRate||0}))];
  return lines.map(l=>{const receipt=(kind==='DELIVERY'||!order.deliveryCheck?.draft)&&order.deliveryCheck?.lines.find(d=>d.lineId===l.lineId);
    return {...l,isReviewed:kind==='DELIVERY'&&!!receipt&&receipt.checked,receiptConfirmed:!!receipt&&receipt.checked,...(receipt?{deliveredCaseQty:receipt.receivedCases,deliveredPackQty:receipt.receivedUnits,damagedCaseQty:receipt.damagedCases,damagedPackQty:receipt.damagedUnits,notes:receipt.notes,deliveryIssue:receipt.issue,issueType:receipt.issue==='WRONG_ITEM'?'WRONG_ITEM' as const:receipt.issue==='DAMAGED'?'DAMAGED' as const:'NONE' as const,...(kind==='DELIVERY'?{invoicedCaseQty:receipt.documentCases,invoicedPackQty:receipt.documentUnits}:{})}:{})};
  });
}
export function deliveryReviewLines(lines:DocumentReviewLine[]):DeliveryCheckLine[]{
  return lines.map(l=>({lineId:l.lineId||l.productId||'',description:l.description,orderedCases:l.orderedCaseQty,orderedUnits:l.orderedPackQty,documentCases:l.invoicedCaseQty,documentUnits:l.invoicedPackQty,receivedCases:l.deliveredCaseQty,receivedUnits:l.deliveredPackQty,damagedCases:l.damagedCaseQty,damagedUnits:l.damagedPackQty,issue:l.deliveryIssue||(l.issueType==='WRONG_ITEM'?'WRONG_ITEM':l.issueType==='DAMAGED'?'DAMAGED':'NONE'),notes:l.notes||'',checked:!!l.isReviewed}));
}
