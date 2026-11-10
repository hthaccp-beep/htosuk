import type { OrderRecord } from '../types.ts';

/**
 * Checks whether an order is open, actionable, or requires operational attention.
 * Open/actionable orders MUST ALWAYS be synced and visible regardless of age.
 */
export function isOpenOrActionable(order: Partial<OrderRecord>): boolean {
  if (!order) return false;

  // 1. DRAFT orders are unplaced/pending submission
  if (order.status === 'DRAFT') {
    return true;
  }

  // 2. Unprocessed by receiving/supplier branch
  if (!order.receivedStatus || order.receivedStatus === 'NEW') {
    return true;
  }

  // 3. Physical fulfillment is unfulfilled or partial
  if (!order.fulfillmentStatus || order.fulfillmentStatus === 'UNFULFILLED' || order.fulfillmentStatus === 'PARTIAL') {
    return true;
  }

  // 4. Invoice verification / cross-check is not yet completed
  if (!order.invoiceVerification) {
    return true;
  }

  // 5. Communications in pending or failed state
  if (order.emailStatus === 'PENDING' || order.emailStatus === 'FAILED') {
    return true;
  }
  if (order.deliveryEmailStatus === 'PENDING' || order.deliveryEmailStatus === 'FAILED') {
    return true;
  }
  if (order.creditNoteClaim?.emailStatus === 'PENDING' || order.creditNoteClaim?.emailStatus === 'FAILED') {
    return true;
  }

  return false;
}

/**
 * Checks whether an order is terminal/completed (fully fulfilled, verified, and communications sent).
 */
export function isTerminalOrder(order: Partial<OrderRecord>): boolean {
  return !isOpenOrActionable(order);
}

/**
 * Determines whether an order should be retained in the active live view.
 * All open/actionable orders are retained regardless of how old they are.
 * Terminal/completed orders are only retained if created on or after the cutoff date.
 */
export function shouldRetainInLiveSync(order: OrderRecord, cutoffDateIso: string): boolean {
  if (isOpenOrActionable(order)) {
    return true;
  }
  return order.createdAt >= cutoffDateIso;
}

/**
 * Partitions a list of orders into open/actionable orders and completed historical orders.
 */
export function partitionOrdersByLifecycle(orders: OrderRecord[]): {
  openOrders: OrderRecord[];
  completedOrders: OrderRecord[];
} {
  const openOrders: OrderRecord[] = [];
  const completedOrders: OrderRecord[] = [];

  for (const order of orders) {
    if (isOpenOrActionable(order)) {
      openOrders.push(order);
    } else {
      completedOrders.push(order);
    }
  }

  return { openOrders, completedOrders };
}
