import type { OrderItem, OrderRecord, Product, User } from '../../types';
import { getCaseUnitLabel, getPackUnitLabel } from '../../types';
import { hasBranchScope, hasSupplierScope } from '../../shared/order-scope';

export function captureCurrentPrices(items: OrderItem[], products: Product[]): OrderItem[] {
  return items.map(item => {
    const product = products.find(p => p.id === item.productId);
    if (!product) throw new Error('An ordered product is no longer available.');
    return {
      productId: product.id, productNameSnapshot: product.name, chineseNameSnapshot: product.chineseName, itemCodeSnapshot: product.itemCode,
      caseQty: item.caseQty, packQty: item.packQty,
      casePriceSnapshot: product.casePrice, packPriceSnapshot: product.packPrice,
      caseUnitSnapshot: getCaseUnitLabel(product), packUnitSnapshot: getPackUnitLabel(product),
      vatRate: product.vatRate || 0,
    };
  });
}

export function canEditOutgoing(user: User, order: OrderRecord) {
  return hasBranchScope(user, order.branchId) && hasSupplierScope(user, order.supplierId);
}

export function deliveryUpdate(order: OrderRecord, user: User, items: OrderRecord['items'], manualItems: OrderRecord['manualItems'], fulfillmentStatus: OrderRecord['fulfillmentStatus'], notes: string): Partial<OrderRecord> {
  // Supplier staff may change only the fulfillment fields permitted by Firestore.
  return {items, manualItems, fulfillmentStatus, processedAt: new Date().toISOString(),
    ...(canEditOutgoing(user, order) ? {fulfillmentNotes: notes} : {})};
}
