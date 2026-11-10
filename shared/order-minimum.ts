import type {Supplier,OrderItem,ManualOrderItem} from '../types';

export interface OrderMinimumCheck {
  minimum: number;
  subtotal: number;
  unpricedItems: number;
  shortfall: number;
  needsFollowUp: boolean;
}
const validPrice=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const cents=(value:number)=>Math.round((value+Number.EPSILON)*100);

/** Missing prices stay unknown; custom items are saved unpriced by order entry. */
export function lineNet(item:OrderItem) {
  let amount=0,unpriced=false;
  for(const [qty,price] of [[item.caseQty,item.casePriceSnapshot],[item.packQty,item.packPriceSnapshot]]) {
    if(!qty)continue;
    if(validPrice(price))amount+=qty*price;else unpriced=true;
  }
  return {amount:cents(amount)/100,unpriced};
}
export function orderMinimum(supplier:Partial<Supplier>|undefined,branchId:string,items:OrderItem[],manual:ManualOrderItem[]=[]):OrderMinimumCheck {
  const configured=supplier?.branchMinimumOrderAmounts?.[branchId]??supplier?.minimumOrderAmount??0;
  const minimum=validPrice(configured)?cents(configured)/100:0;
  const lines=items.map(lineNet);
  const subtotal=lines.reduce((sum,line)=>sum+cents(line.amount),0)/100;
  const unpricedItems=lines.filter(line=>line.unpriced).length+manual.filter(line=>line.caseQty>0||line.packQty>0).length;
  const shortfall=Math.max(0,cents(minimum)-cents(subtotal))/100;
  return {minimum,subtotal,unpricedItems,shortfall,needsFollowUp:minimum>0&&shortfall>0};
}
export function validateSupplierMinimum(supplier:Partial<Supplier>) {
  const amounts=[supplier.minimumOrderAmount??0,...Object.values(supplier.branchMinimumOrderAmounts??{})];
  if(amounts.some(value=>!validPrice(value)||value>1000000||Math.abs(value*100-Math.round(value*100))>0.000001))
    throw new Error('Minimum order amounts must be between £0 and £1,000,000, with at most two decimal places.');
}
