import type {OrderItem, ManualOrderItem, Product} from '../../types';

export type OrderDetails = {branchId:string;supplierId:string;date:string};

// Only a confirmed change may alter the basket. Date-only edits keep every line.
export function basketAfterDetailsChange(previous:OrderDetails,next:OrderDetails,items:OrderItem[],manual:ManualOrderItem[],products:Product[]){
  const scopeChanged=previous.branchId!==next.branchId||previous.supplierId!==next.supplierId;
  const keptItems=!scopeChanged?items:items.filter(item=>products.some(p=>p.id===item.productId&&p.active&&p.supplierId===next.supplierId&&(!p.allowedBranchIds?.length||p.allowedBranchIds.includes(next.branchId))));
  const keptManual=previous.supplierId===next.supplierId?manual:[];
  return {items:keptItems,manual:keptManual,removed:[...items.filter(item=>!keptItems.includes(item)).map(item=>item.productNameSnapshot),...manual.filter(item=>!keptManual.includes(item)).map(item=>item.description||'Custom item')]};
}
