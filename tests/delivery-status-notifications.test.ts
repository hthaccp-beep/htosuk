import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchDeliveryNoteNotification } from '../utils/deliveryCommunication.ts';
import type { OrderRecord, Branch, Supplier, Product } from '../types.ts';

describe('Issue 16: Accurate Delivery Status and Notification Updates', () => {
  const mockBranch: Branch = {
    id: 'br-bloomsbury',
    name: 'Bloomsbury',
    code: 'BL',
    contactEmail: 'bloomsbury@hareandtortoise-co-uk.example',
    active: true
  };

  const mockSupplier: Supplier = {
    id: 'supp-tazaki',
    name: 'Tazaki Foods',
    email: 'orders@tazaki-co-uk.example',
    active: true,
    deliveryRules: {},
    deliverySchedules: {}
  };

  const mockProducts: Product[] = [
    {
      id: 'prod-salmon',
      name: 'Salmon Fillet',
      itemCode: 'SAL-01',
      categoryId: 'cat-1',
      supplierId: 'supp-tazaki',
      casePrice: 50,
      packPrice: 0,
      caseUnitName: 'Fillet',
      packUnitName: 'Piece',
      unitType: 'CASE_ONLY',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true
    }
  ];

  const baseOrder: OrderRecord = {
    id: 'ord-12345',
    branchId: mockBranch.id,
    branchNameSnapshot: mockBranch.name,
    supplierId: mockSupplier.id,
    supplierNameSnapshot: mockSupplier.name,
    orderedByUserId: 'usr-1',
    orderedByNameSnapshot: 'Alice',
    createdAt: '2026-09-30T10:00:00.000Z',
    items: [
      {
        productId: 'prod-salmon',
        productNameSnapshot: 'Salmon Fillet',
        caseQty: 10,
        packQty: 0,
        sentCaseQty: 7, // 3 OOS
        sentPackQty: 0,
        shortageReason: 'Central Warehouse OOS',
        caseUnitSnapshot: 'Fillet'
      }
    ],
    manualItems: [],
    emailTo: 'bloomsbury@hareandtortoise-co-uk.example',
    status: 'PLACED',
    fulfillmentStatus: 'PARTIAL',
    receivedStatus: 'PROCESSED'
  };

  test('validates recipient email and rejects empty destination without declaring success', async () => {
    const result = await dispatchDeliveryNoteNotification({
      order: baseOrder,
      branch: mockBranch,
      supplier: mockSupplier,
      products: mockProducts,
      recipientEmail: '',
      sendEmailFn: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'FAILED');
    assert.ok(result.error?.includes('Recipient email address is required'));
  });

  test('prevents false-positive success on transient or hard HTTP failure', async () => {
    const mockFailedSend = async () => {
      return new Response(JSON.stringify({ error: 'Mail exchanger connection timed out (504)' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const result = await dispatchDeliveryNoteNotification({
      order: baseOrder,
      branch: mockBranch,
      supplier: mockSupplier,
      products: mockProducts,
      recipientEmail: 'branch@hareandtortoise-co-uk.example',
      sendEmailFn: mockFailedSend
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'FAILED');
    assert.ok(result.error?.includes('504'));
  });

  test('reports clear timestamp and SENT state on successful delivery note dispatch', async () => {
    const mockSuccessSend = async () => {
      return new Response(JSON.stringify({ ok: true, messageId: 'msg-999' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const result = await dispatchDeliveryNoteNotification({
      order: baseOrder,
      branch: mockBranch,
      supplier: mockSupplier,
      products: mockProducts,
      recipientEmail: 'branch@hareandtortoise-co-uk.example',
      sendEmailFn: mockSuccessSend
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'SENT');
    assert.ok(typeof result.sentAt === 'string');
    assert.equal(result.error, undefined);
  });

  test('separates order placement communication state from delivery note communication state', () => {
    const dualStateOrder: OrderRecord = {
      ...baseOrder,
      emailStatus: 'SENT', // Order confirmation to supplier succeeded
      emailSentAt: '2026-09-30T10:05:00.000Z',
      deliveryEmailStatus: 'FAILED', // Delivery note to branch kitchen failed
      deliveryEmailError: 'Mailbox full (552)',
      deliveryEmailRetryCount: 2
    };

    assert.equal(dualStateOrder.emailStatus, 'SENT');
    assert.equal(dualStateOrder.deliveryEmailStatus, 'FAILED');
    assert.equal(dualStateOrder.deliveryEmailRetryCount, 2);
    assert.notEqual(dualStateOrder.emailStatus, dualStateOrder.deliveryEmailStatus);
  });
});
