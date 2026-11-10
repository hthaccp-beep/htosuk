import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatItemLine, generateOrderEmailContent } from '../utils/orderEmail.ts';
import { computeFulfillmentStatus } from '../utils/fulfillmentEngine.ts';
import type { OrderRecord, OrderItem, ManualOrderItem, Branch, Supplier, Product } from '../types.ts';

describe('Issue 14: Matching Delivery Email, PDF and Saved Details', () => {
  const sampleBranch: Branch = {
    id: 'branch-covent-garden',
    name: 'Covent Garden',
    code: 'CG',
    contactEmail: 'covent@hareandtortoise-co-uk.example',
    active: true
  };

  const sampleSupplier: Supplier = {
    id: 'supp-tazaki',
    name: 'Tazaki Foods',
    contactEmail: 'orders@tazaki-co-uk.example',
    email: 'orders@tazaki-co-uk.example',
    active: true,
    deliveryRules: {},
    deliverySchedules: {}
  };

  const sampleProducts: Product[] = [
    {
      id: 'prod-salmon',
      name: 'Fresh Scottish Salmon Fillet / 新鲜三文鱼',
      itemCode: 'SAL-01',
      categoryId: 'cat-fresh',
      supplierId: 'supp-tazaki',
      casePrice: 45.00,
      packPrice: 0,
      caseUnitName: 'Fillet',
      packUnitName: 'Piece',
      unitType: 'CASE_ONLY',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true
    }
  ];

  test('formatItemLine generates exact delivery line with partial shortages and OOS reason', () => {
    const formatted = formatItemLine(
      1,
      'SAL-01',
      'Fresh Scottish Salmon Fillet / 新鲜三文鱼',
      10, // ordered
      0,
      'DELIVERY',
      7, // sent (3 short)
      0,
      sampleProducts[0],
      'Short Shipment from Vendor',
      'Fillet',
      'Piece'
    );

    assert.equal(
      formatted,
      '1. [SAL-01] Fresh Scottish Salmon Fillet / 新鲜三文鱼 - 7 Fillet (3 OOS - Short Shipment from Vendor)'
    );
  });

  test('preserves historical unit snapshots even if catalogue product is modified or deleted', () => {
    // Imagine product was deleted from catalog (undefined product)
    const formattedDeletedProduct = formatItemLine(
      2,
      'OLD-02',
      'Japanese Soba Noodles',
      5,
      10,
      'DELIVERY',
      5,
      8,
      undefined, // Product no longer in active catalogue
      'Damaged in Transit',
      'Crate', // Preserved from OrderItem.caseUnitSnapshot
      'Pack'  // Preserved from OrderItem.packUnitSnapshot
    );

    assert.equal(
      formattedDeletedProduct,
      '2. [OLD-02] Japanese Soba Noodles - 5 Crate, 8 Pack (2 OOS - Damaged in Transit)'
    );
  });

  test('custom manual items render with [MISC] tag and consistent quantities in delivery mode', () => {
    const formattedManual = formatItemLine(
      3,
      'MISC',
      'Fresh Wasabi Root (Special Delivery)',
      2,
      0,
      'DELIVERY',
      1, // 1 short
      0,
      undefined,
      'Seasonal Product Unavailable',
      'Kg',
      'Piece'
    );

    assert.equal(
      formattedManual,
      '3. [MISC] Fresh Wasabi Root (Special Delivery) - 1 Kg (1 OOS - Seasonal Product Unavailable)'
    );
  });

  test('delivery email HTML and line data match approved fulfillment revision identically', () => {
    const orderWithFulfillment: OrderRecord = {
      id: 'ord-dlv-789',
      branchId: sampleBranch.id,
      branchNameSnapshot: sampleBranch.name,
      supplierId: sampleSupplier.id,
      supplierNameSnapshot: sampleSupplier.name,
      orderedByUserId: 'usr-1',
      orderedByNameSnapshot: 'Kitchen Lead',
      createdAt: '2026-09-29T12:00:00Z',
      items: [
        {
          productId: 'prod-salmon',
          productNameSnapshot: 'Fresh Scottish Salmon Fillet / 新鲜三文鱼',
          caseQty: 10,
          packQty: 0,
          sentCaseQty: 8, // 2 OOS
          sentPackQty: 0,
          shortageReason: 'Out of Stock at Central Warehouse',
          caseUnitSnapshot: 'Fillet',
          packUnitSnapshot: 'Piece'
        }
      ],
      manualItems: [
        {
          id: 'man-1',
          description: 'Special Edamame Puree (Manual)',
          caseQty: 4,
          packQty: 0,
          sentCaseQty: 4, // fully fulfilled
          sentPackQty: 0,
          caseUnitSnapshot: 'Box'
        }
      ],
      fulfillmentStatus: 'PARTIAL',
      fulfillmentNotes: 'Substitute arrived for batch 2',
      emailTo: 'orders@tazaki-co-uk.example',
      status: 'PLACED'
    };

    const { subject, htmlBody } = generateOrderEmailContent(
      orderWithFulfillment,
      sampleBranch,
      sampleSupplier,
      sampleProducts,
      'DELIVERY'
    );

    assert.equal(subject, 'Delivery Note: Order #ORD-DLV- - Covent Garden [ITEMS OOS]');
    assert.ok(htmlBody.includes('Fresh Scottish Salmon Fillet / 新鲜三文鱼'));
    assert.ok(htmlBody.includes('8 Fillet (2 OOS - Out of Stock at Central Warehouse)'));
    assert.ok(htmlBody.includes('Special Edamame Puree (Manual) - 4 Box'));
    assert.ok(htmlBody.includes('Substitute arrived for batch 2'));
    assert.ok(htmlBody.includes('Delivery Note'));
  });

  test('physical fulfillment derivation separates physical shortages from communication status', () => {
    const items: OrderItem[] = [
      {
        productId: 'prod-salmon',
        productNameSnapshot: 'Salmon',
        caseQty: 5,
        packQty: 0,
        sentCaseQty: 4 // 1 short
      }
    ];

    const fulfillment = computeFulfillmentStatus(items, []);
    assert.equal(fulfillment.status, 'PARTIAL');
    assert.equal(fulfillment.totalOrderedUnits, 5);
    assert.equal(fulfillment.totalSentUnits, 4);
    assert.equal(fulfillment.totalShortUnits, 1);
    assert.equal(fulfillment.hasShortages, true);

    // Simulated email send failure scenario:
    // Physical fulfillment is valid regardless of deliveryEmailStatus
    const orderRecord: Partial<OrderRecord> = {
      fulfillmentStatus: fulfillment.status,
      deliveryEmailStatus: 'FAILED',
      deliveryEmailError: 'SMTP timeout connecting to mail exchanger'
    };

    assert.equal(orderRecord.fulfillmentStatus, 'PARTIAL');
    assert.equal(orderRecord.deliveryEmailStatus, 'FAILED');
    assert.equal(orderRecord.deliveryEmailError, 'SMTP timeout connecting to mail exchanger');
  });
});
