import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { 
  isOpenOrActionable, 
  isTerminalOrder, 
  shouldRetainInLiveSync, 
  partitionOrdersByLifecycle 
} from '../utils/orderLifecycle.ts';
import type { OrderRecord } from '../types.ts';

describe('Issue 15: Keep Older Outstanding Work Visible', () => {
  const cutoffDate = '2026-08-16T00:00:00.000Z'; // 45 days prior to 2026-09-30
  const veryOldDate = '2026-05-01T10:00:00.000Z'; // 150 days ago (well outside cutoff)
  const recentDate = '2026-09-25T10:00:00.000Z'; // 5 days ago

  const oldUnfulfilledOrder: OrderRecord = {
    id: 'ord-old-unfulfilled',
    branchId: 'b-1',
    branchNameSnapshot: 'Branch 1',
    supplierId: 's-1',
    supplierNameSnapshot: 'Supplier 1',
    orderedByUserId: 'u-1',
    orderedByNameSnapshot: 'Alice',
    createdAt: veryOldDate,
    items: [],
    manualItems: [],
    emailTo: 'orders@supp-co-uk.example',
    status: 'PLACED',
    receivedStatus: 'NEW',
    fulfillmentStatus: 'UNFULFILLED'
  };

  const oldUnverifiedOrder: OrderRecord = {
    id: 'ord-old-unverified',
    branchId: 'b-1',
    branchNameSnapshot: 'Branch 1',
    supplierId: 's-1',
    supplierNameSnapshot: 'Supplier 1',
    orderedByUserId: 'u-1',
    orderedByNameSnapshot: 'Alice',
    createdAt: veryOldDate,
    items: [],
    manualItems: [],
    emailTo: 'orders@supp-co-uk.example',
    status: 'PLACED',
    receivedStatus: 'PROCESSED',
    fulfillmentStatus: 'FULFILLED',
    // invoiceVerification is missing => unverified
  };

  const oldCompletedOrder: OrderRecord = {
    id: 'ord-old-completed',
    branchId: 'b-1',
    branchNameSnapshot: 'Branch 1',
    supplierId: 's-1',
    supplierNameSnapshot: 'Supplier 1',
    orderedByUserId: 'u-1',
    orderedByNameSnapshot: 'Alice',
    createdAt: veryOldDate,
    items: [],
    manualItems: [],
    emailTo: 'orders@supp-co-uk.example',
    status: 'PLACED',
    receivedStatus: 'PROCESSED',
    fulfillmentStatus: 'FULFILLED',
    invoiceVerification: {
      verifiedAt: '2026-05-02T10:00:00.000Z',
      verifiedBy: 'Bob',
      hasDiscrepancies: false,
      totalOrderedValue: 50,
      totalInvoicedValue: 50,
      discrepancyTotal: 0
    },
    emailStatus: 'SENT'
  };

  const recentCompletedOrder: OrderRecord = {
    ...oldCompletedOrder,
    id: 'ord-recent-completed',
    createdAt: recentDate
  };

  test('isOpenOrActionable identifies unfulfilled, unverified, draft, or pending communication orders', () => {
    assert.equal(isOpenOrActionable(oldUnfulfilledOrder), true);
    assert.equal(isOpenOrActionable(oldUnverifiedOrder), true);
    assert.equal(isOpenOrActionable({ status: 'DRAFT', createdAt: veryOldDate }), true);
    assert.equal(isOpenOrActionable({ ...oldCompletedOrder, emailStatus: 'FAILED' }), true);
    assert.equal(isOpenOrActionable({ ...oldCompletedOrder, deliveryEmailStatus: 'FAILED' }), true);
    assert.equal(isOpenOrActionable(oldCompletedOrder), false);
  });

  test('shouldRetainInLiveSync keeps older open orders regardless of age', () => {
    // 150-day-old unfulfilled order must be retained
    assert.equal(shouldRetainInLiveSync(oldUnfulfilledOrder, cutoffDate), true);

    // 150-day-old unverified order must be retained
    assert.equal(shouldRetainInLiveSync(oldUnverifiedOrder, cutoffDate), true);

    // 150-day-old completed order outside cutoff must NOT be retained in live sync
    assert.equal(shouldRetainInLiveSync(oldCompletedOrder, cutoffDate), false);

    // Recent completed order inside cutoff MUST be retained in live sync
    assert.equal(shouldRetainInLiveSync(recentCompletedOrder, cutoffDate), true);
  });

  test('transitioning from open to completed moves order to terminal lifecycle', () => {
    const mutableOrder: OrderRecord = { ...oldUnverifiedOrder };
    assert.equal(isOpenOrActionable(mutableOrder), true);
    assert.equal(isTerminalOrder(mutableOrder), false);

    // User completes invoice verification
    mutableOrder.invoiceVerification = {
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'Manager',
      hasDiscrepancies: false,
      totalOrderedValue: 100,
      totalInvoicedValue: 100,
      discrepancyTotal: 0
    };
    mutableOrder.emailStatus = 'SENT';

    assert.equal(isOpenOrActionable(mutableOrder), false);
    assert.equal(isTerminalOrder(mutableOrder), true);
  });

  test('partitionOrdersByLifecycle cleanly separates outstanding work from completed history', () => {
    const list = [oldUnfulfilledOrder, oldUnverifiedOrder, oldCompletedOrder, recentCompletedOrder];
    const { openOrders, completedOrders } = partitionOrdersByLifecycle(list);

    assert.equal(openOrders.length, 2);
    assert.deepEqual(openOrders.map(o => o.id), ['ord-old-unfulfilled', 'ord-old-unverified']);

    assert.equal(completedOrders.length, 2);
    assert.deepEqual(completedOrders.map(o => o.id), ['ord-old-completed', 'ord-recent-completed']);
  });
});
