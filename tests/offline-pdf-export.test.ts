import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderPDF, generateOrderEmailContent, formatItemLine } from '../utils/orderEmail.ts';
import type { OrderRecord } from '../types.ts';

describe('Issue 17: Reliable PDF Export in Offline/Saved Scenarios', () => {
  const offlineSavedOrder: OrderRecord = {
    id: 'ord-offline-999',
    branchId: 'br-unknown-or-cleared',
    branchNameSnapshot: 'Hare & Tortoise Kensington',
    supplierId: 'supp-cleared',
    supplierNameSnapshot: 'JFC UK Wholesale',
    orderedByUserId: 'usr-offline',
    orderedByNameSnapshot: 'Kitchen Chef Ken',
    createdAt: '2026-09-30T10:00:00.000Z',
    deliveryDate: '2026-10-02',
    emailTo: 'orders@jfc-co-uk.example',
    status: 'PLACED',
    items: [
      {
        productId: 'prod-salmon-fresh',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        itemCodeSnapshot: 'SALM-001',
        caseQty: 4,
        packQty: 2,
        casePriceSnapshot: 65,
        packPriceSnapshot: 15,
        caseUnitSnapshot: 'Box',
        packUnitSnapshot: 'Side'
      },
      {
        productId: 'prod-dashi-powder',
        productNameSnapshot: 'Hon-Dashi Japanese Stock',
        itemCodeSnapshot: 'DSH-500',
        caseQty: 2,
        packQty: 0,
        casePriceSnapshot: 32,
        packPriceSnapshot: 0,
        caseUnitSnapshot: 'Carton',
        packUnitSnapshot: 'Pouch'
      }
    ],
    manualItems: [
      {
        id: 'man-1',
        description: 'Special Wasabi Root Fresh',
        caseQty: 1,
        packQty: 5,
        casePriceSnapshot: 40,
        packPriceSnapshot: 8,
        caseUnitSnapshot: 'Crate',
        packUnitSnapshot: 'Root'
      }
    ]
  };

  test('formatItemLine falls back cleanly to item snapshots when product entity is missing', () => {
    const formattedStandard = formatItemLine(
      1,
      offlineSavedOrder.items[0].itemCodeSnapshot || '',
      offlineSavedOrder.items[0].productNameSnapshot,
      offlineSavedOrder.items[0].caseQty,
      offlineSavedOrder.items[0].packQty,
      'ORDER',
      undefined,
      undefined,
      undefined, // Missing product entity
      undefined,
      offlineSavedOrder.items[0].caseUnitSnapshot,
      offlineSavedOrder.items[0].packUnitSnapshot
    );

    assert.ok(formattedStandard.includes('[SALM-001] Fresh Atlantic Salmon Fillet'));
    assert.ok(formattedStandard.includes('4 Box, 2 Side'));

    const formattedManual = formatItemLine(
      2,
      'MISC',
      offlineSavedOrder.manualItems[0].description,
      offlineSavedOrder.manualItems[0].caseQty,
      offlineSavedOrder.manualItems[0].packQty,
      'ORDER',
      undefined,
      undefined,
      undefined,
      undefined,
      offlineSavedOrder.manualItems[0].caseUnitSnapshot,
      offlineSavedOrder.manualItems[0].packUnitSnapshot
    );

    assert.ok(formattedManual.includes('[MISC] Special Wasabi Root Fresh'));
    assert.ok(formattedManual.includes('1 Crate, 5 Root'));
  });

  test('generateOrderEmailContent succeeds with snapshot fallbacks when branch and supplier are undefined', () => {
    // Both branch and supplier are undefined, products is empty array
    const { subject, htmlBody } = generateOrderEmailContent(
      offlineSavedOrder,
      undefined, // No branch entity
      undefined, // No supplier entity
      []         // Empty product cache
    );

    assert.ok(subject.includes('Hare & Tortoise Kensington'));
    assert.ok(htmlBody.includes('Hare &amp; Tortoise Kensington'));
    assert.ok(htmlBody.includes('JFC UK Wholesale'));
    assert.ok(htmlBody.includes('Fresh Atlantic Salmon Fillet'));
    assert.ok(htmlBody.includes('4 Box, 2 Side'));
    assert.ok(htmlBody.includes('Special Wasabi Root Fresh'));
  });

  test('generateOrderPDF generates valid non-empty PDF base64 without entity records or catalog cache', async () => {
    // In offline scenarios, catalog and branch caches may be completely empty or missing
    const pdfBase64 = await generateOrderPDF(
      offlineSavedOrder,
      undefined, // Missing branch
      undefined, // Missing supplier
      [],        // Missing products cache
      'ORDER'
    );

    assert.ok(typeof pdfBase64 === 'string');
    assert.ok(pdfBase64.length > 500, 'PDF base64 output should be substantive');
    // PDF header in base64 begins with JVBERi0 (which decodes to %PDF-)
    assert.ok(pdfBase64.startsWith('JVBERi0') || pdfBase64.length > 1000);
  });

  test('generateOrderPDF generates valid Delivery Note PDF with shortages when catalog is missing', async () => {
    const fulfilledOrder: OrderRecord = {
      ...offlineSavedOrder,
      fulfillmentStatus: 'PARTIAL',
      receivedStatus: 'PROCESSED',
      items: [
        {
          ...offlineSavedOrder.items[0],
          sentCaseQty: 2, // 2 OOS
          sentPackQty: 2,
          shortageReason: 'Out of Stock at Central Warehouse'
        }
      ]
    };

    const pdfBase64 = await generateOrderPDF(
      fulfilledOrder,
      undefined,
      undefined,
      [],
      'DELIVERY'
    );

    assert.ok(typeof pdfBase64 === 'string');
    assert.ok(pdfBase64.length > 500);
  });
});
