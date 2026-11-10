import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderRecord } from '../types.ts';

// Simulation engine for order submission workflow
interface SubmissionMocks {
  addOrder: (order: OrderRecord) => Promise<void>;
  updateOrder: (orderId: string, updates: Partial<OrderRecord>) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  sendEmail: (payload: any) => Promise<{ ok: boolean; status?: number; error?: string }>;
  onSuccess: () => void;
  showToast: (type: string, message: string, title?: string) => void;
}

async function simulateOrderSubmission(
  order: OrderRecord,
  resumingDraftId: string | null,
  isOffline: boolean,
  mocks: SubmissionMocks
) {
  let dbPersisted = false;
  let emailDispatched = false;
  let cartCleared = false;
  let draftDeleted = false;

  if (isOffline) {
    // Offline submission
    order.emailStatus = 'OFFLINE_MANUAL';
    try {
      await mocks.addOrder(order);
      dbPersisted = true;
      if (resumingDraftId) {
        await mocks.deleteOrder(resumingDraftId);
        draftDeleted = true;
      }
    } catch (err: any) {
      mocks.showToast('error', `Failed to save offline: ${err.message}`, 'Save Failed');
      return { dbPersisted, emailDispatched, cartCleared, draftDeleted, error: err };
    }
    mocks.onSuccess();
    cartCleared = true;
    return { dbPersisted, emailDispatched, cartCleared, draftDeleted, offline: true };
  }

  // STEP 1: Persist order to database first
  order.emailStatus = 'PENDING';
  try {
    await mocks.addOrder(order);
    dbPersisted = true;
    if (resumingDraftId) {
      await mocks.deleteOrder(resumingDraftId);
      draftDeleted = true;
    }
  } catch (dbErr: any) {
    mocks.showToast('error', `Database write failed: ${dbErr.message}`, 'Database Persistence Failed');
    // STOP! Do not clear cart, do not dispatch email, do not delete draft!
    return { dbPersisted, emailDispatched, cartCleared, draftDeleted, error: dbErr };
  }

  // STEP 2: Dispatch supplier email
  try {
    const res = await mocks.sendEmail({ to: order.emailTo, orderId: order.id });
    if (!res.ok) {
      throw new Error(res.error || 'SMTP delivery failed');
    }
    emailDispatched = true;
    order.emailStatus = 'SENT';
    await mocks.updateOrder(order.id, { emailStatus: 'SENT' });
    mocks.showToast('success', 'Order placed and email sent to supplier!', 'Order Complete');
  } catch (emailErr: any) {
    order.emailStatus = 'FAILED';
    await mocks.updateOrder(order.id, { emailStatus: 'FAILED' });
    mocks.showToast(
      'warning',
      `Order is saved in database, but supplier email failed: ${emailErr.message}`,
      'Email Dispatch Failed'
    );
  }

  // STEP 3: Clear cart only after verified database persistence
  mocks.onSuccess();
  cartCleared = true;

  return { dbPersisted, emailDispatched, cartCleared, draftDeleted, finalEmailStatus: order.emailStatus };
}

describe('Durable Order Saves and Honest Completion States (Issue 8)', () => {
  function createSampleOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
    return {
      id: 'ord_123',
      branchId: 'b1',
      branchNameSnapshot: 'Hare & Tortoise Ealing',
      supplierId: 'sup_tazaki',
      supplierNameSnapshot: 'Tazaki Foods',
      orderedByUserId: 'usr_staff',
      orderedByNameSnapshot: 'Alice Staff',
      createdAt: '2026-09-29T12:00:00.000Z',
      status: 'PLACED',
      emailStatus: 'PENDING',
      items: [],
      manualItems: [],
      emailTo: 'orders@tazaki-com.example',
      ...overrides,
    };
  }

  it('prevents declaring placed, deleting drafts, or sending email when database write fails', async () => {
    let emailCalled = false;
    let cartCleared = false;
    let draftDeleted = false;
    const toasts: string[] = [];

    const mocks: SubmissionMocks = {
      addOrder: async () => {
        throw new Error('FirebaseError: [code=permission-denied]: Missing or insufficient permissions.');
      },
      updateOrder: async () => {},
      deleteOrder: async () => {
        draftDeleted = true;
      },
      sendEmail: async () => {
        emailCalled = true;
        return { ok: true };
      },
      onSuccess: () => {
        cartCleared = true;
      },
      showToast: (type, msg) => toasts.push(`${type}:${msg}`),
    };

    const order = createSampleOrder();
    const result = await simulateOrderSubmission(order, 'draft_456', false, mocks);

    // Assertions
    assert.equal(result.dbPersisted, false, 'Database persistence must fail');
    assert.equal(emailCalled, false, 'Email MUST NOT be sent if DB save fails');
    assert.equal(cartCleared, false, 'Cart MUST NOT be cleared if DB save fails (work must be recoverable)');
    assert.equal(draftDeleted, false, 'Previous draft MUST NOT be deleted if new save fails');
    assert.ok(toasts.some((t) => t.includes('Database write failed')), 'Clear error toast must be shown');
  });

  it('handles email transport failure honestly: preserves order in DB, marks FAILED, informs user', async () => {
    let emailCalled = false;
    let cartCleared = false;
    let updatedEmailStatus = '';
    const toasts: string[] = [];

    const mocks: SubmissionMocks = {
      addOrder: async () => {
        // DB succeeds!
      },
      updateOrder: async (_id, updates) => {
        if (updates.emailStatus) updatedEmailStatus = updates.emailStatus;
      },
      deleteOrder: async () => {},
      sendEmail: async () => {
        emailCalled = true;
        return { ok: false, status: 500, error: 'Connection refused on port 587' };
      },
      onSuccess: () => {
        cartCleared = true;
      },
      showToast: (type, msg, title) => toasts.push(`${type}:${title}:${msg}`),
    };

    const order = createSampleOrder();
    const result = await simulateOrderSubmission(order, null, false, mocks);

    // Assertions
    assert.equal(result.dbPersisted, true, 'Order is durably saved in DB');
    assert.equal(emailCalled, true, 'Email dispatch was attempted');
    assert.equal(result.finalEmailStatus, 'FAILED', 'Email status must be marked FAILED');
    assert.equal(updatedEmailStatus, 'FAILED', 'Database record must be updated to FAILED');
    assert.equal(cartCleared, true, 'Cart cleared because order is safely in DB');
    assert.ok(
      toasts.some((t) => t.includes('Email Dispatch Failed') && t.includes('Order is saved in database')),
      'Toast must honestly distinguish database write from email failure'
    );
  });

  it('completes fully when both database write and email succeed', async () => {
    let updatedEmailStatus = '';
    let cartCleared = false;
    const toasts: string[] = [];

    const mocks: SubmissionMocks = {
      addOrder: async () => {},
      updateOrder: async (_id, updates) => {
        if (updates.emailStatus) updatedEmailStatus = updates.emailStatus;
      },
      deleteOrder: async () => {},
      sendEmail: async () => ({ ok: true }),
      onSuccess: () => {
        cartCleared = true;
      },
      showToast: (type, msg, title) => toasts.push(`${type}:${title}:${msg}`),
    };

    const order = createSampleOrder();
    const result = await simulateOrderSubmission(order, null, false, mocks);

    assert.equal(result.dbPersisted, true);
    assert.equal(result.emailDispatched, true);
    assert.equal(result.cartCleared, true);
    assert.equal(updatedEmailStatus, 'SENT');
    assert.ok(toasts.some((t) => t.includes('Order Complete')));
  });

  it('offline submission saves locally and sets OFFLINE_MANUAL status', async () => {
    let savedOrder: OrderRecord | null = null;
    let cartCleared = false;

    const mocks: SubmissionMocks = {
      addOrder: async (ord) => {
        savedOrder = ord;
      },
      updateOrder: async () => {},
      deleteOrder: async () => {},
      sendEmail: async () => ({ ok: true }),
      onSuccess: () => {
        cartCleared = true;
      },
      showToast: () => {},
    };

    const order = createSampleOrder();
    const result = await simulateOrderSubmission(order, null, true, mocks);

    assert.equal(result.dbPersisted, true);
    assert.equal((savedOrder as any)?.emailStatus, 'OFFLINE_MANUAL');
    assert.equal(cartCleared, true);
  });
});
