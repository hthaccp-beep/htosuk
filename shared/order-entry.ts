import type {OrderItem, ManualOrderItem} from '../types.ts';
export const MAX_ORDER_QUANTITY = 20;

export function validateOrderLines(items: OrderItem[], manual: ManualOrderItem[]) {
  if (!Array.isArray(items) || !Array.isArray(manual)) throw new Error('Check the items in this order.');
  if (manual.length > 5) throw new Error('An order can contain up to 5 custom items.');
  if (!items.length && !manual.length) throw new Error('Add at least one item with a quantity.');
  for (const [index, item] of [...items, ...manual].entries()) {
    const custom = index >= items.length;
    const name = custom ? (item as ManualOrderItem).description : (item as OrderItem).productNameSnapshot;
    const label = custom ? 'Custom item ' + (index - items.length + 1) : 'Item ' + (index + 1);
    if (typeof name !== 'string' || !name.trim()) throw new Error(label + ': enter a name before continuing.');
    if ([item.caseQty, item.packQty].some(q => !Number.isInteger(q) || q < 0 || q > MAX_ORDER_QUANTITY)) throw new Error(label + ': enter whole quantities from 0 to ' + MAX_ORDER_QUANTITY + '.');
    if (item.caseQty + item.packQty <= 0) throw new Error(label + ' (' + name.trim() + '): enter a box or unit quantity before continuing.');
  }
}
