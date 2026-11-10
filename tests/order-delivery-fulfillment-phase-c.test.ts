import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getLondonDateTime,
  resolveSupplierSchedule,
  getCutoffStatus,
  getNextAvailableDeliveryDate,
  validateDeliveryDate,
} from '../utils/deliveryScheduler.ts';

import {
  computeFulfillmentStatus,
  canUserProcessFulfillment,
  STANDARD_SHORTAGE_REASONS,
} from '../utils/fulfillmentEngine.ts';

import {
  formatItemLine,
  generateOrderEmailContent,
} from '../utils/orderEmail.ts';

import {
  isOpenOrActionable,
  isTerminalOrder,
  shouldRetainInLiveSync,
  partitionOrdersByLifecycle,
} from '../utils/orderLifecycle.ts';

import type {
  OrderRecord,
  OrderItem,
  ManualOrderItem,
  Branch,
  Supplier,
  Product,
  User,
} from '../types.ts';

describe('Phase C: Order Lifecycle, Delivery Operations & Fulfillment Tracking', () => {

  const sampleBranch: Branch = {
    id: 'branch_bloomsbury',
    name: 'Hare & Tortoise Bloomsbury',
    code: 'BL',
    contactEmail: 'bloomsbury@hareandtortoise-co-uk.example',
    active: true,
  };

  const internalWarehouseBranch: Branch = {
    id: 'branch_central_wh',
    name: 'Central Kitchen & Warehouse',
    code: 'CKWH',
    contactEmail: 'warehouse@hareandtortoise-co-uk.example',
    active: true,
    actsAsSupplier: true,
  };

  const tazakiSupplier: Supplier = {
    id: 'sup_tazaki',
    name: 'Tazaki Foods Ltd',
    email: 'orders@tazaki-co-uk.example',
    active: true,
    deliveryRules: {
      default: [1, 3, 5], // Mon, Wed, Fri delivery only
    },
    deliverySchedules: {
      default: 'Mon/Wed/Fri Delivery only. Order by 5pm.',
    },
  };

  const internalSupplier: Supplier = {
    id: 'sup_central_wh',
    name: 'Central Kitchen & Warehouse',
    email: 'warehouse@hareandtortoise-co-uk.example',
    active: true,
    linkedBranchId: 'branch_central_wh',
    deliveryRules: {
      default: [1, 2, 3, 4, 5, 6], // Mon-Sat
    },
    deliverySchedules: {
      default: 'Internal transfer. Order by 4pm for next day.',
    },
  };

  const sampleProduct: Product = {
    id: 'prod_ramen_noodles',
    name: 'Fresh Ramen Noodles 100g',
    itemCode: 'RAM-100',
    categoryId: 'cat_fresh',
    supplierId: 'sup_central_wh',
    active: true,
    casePrice: 35.00,
    packPrice: 0,
    caseUnitName: 'Box (50 packs)',
    packUnitName: 'Pack (100g)',
    unitType: 'CASE_ONLY',
    displayOrder: 1,
    allowedBranchIds: [],
    vatRate: 0,
  };

  // ---------------------------------------------------------------------------
  // 1. DELIVERY SCHEDULING, CUTOFF CLOCK & LONDON TIMEZONE
  // ---------------------------------------------------------------------------
  describe('1. Delivery Scheduling & London Cutoff Clock', () => {
    it('correctly maps UTC to London Daylight Saving Time (BST)', () => {
      // 2026-07-15 15:30 UTC is 16:30 London (BST, UTC+1)
      const summerUtc = new Date('2026-07-15T15:30:00.000Z');
      const london = getLondonDateTime(summerUtc);
      assert.equal(london.year, 2026);
      assert.equal(london.month, 7);
      assert.equal(london.day, 15);
      assert.equal(london.hour, 16);
      assert.equal(london.minute, 30);
    });

    it('computes next available delivery date adhering to supplier delivery day rules', () => {
      // Reference: Tuesday 2026-10-06 at 10:00 AM London
      // Tazaki only delivers on Mon, Wed, Fri.
      // Ordered Tuesday morning (before cutoff), next delivery day must be Wednesday 2026-10-07.
      const tuesdayMorning = new Date('2026-10-06T09:00:00.000Z');
      const nextDate = getNextAvailableDeliveryDate(tazakiSupplier, sampleBranch.id, tuesdayMorning);
      assert.equal(nextDate.dateStr, '2026-10-07');
    });

    it('rolls over to next schedule window if ordering after daily cutoff time', () => {
      // Tuesday 2026-10-06 at 18:30 London (after 5pm cutoff)
      // Wednesday delivery is missed, so next available is Friday 2026-10-09
      const tuesdayEvening = new Date('2026-10-06T17:30:00.000Z');
      const nextDate = getNextAvailableDeliveryDate(tazakiSupplier, sampleBranch.id, tuesdayEvening);
      assert.equal(nextDate.dateStr, '2026-10-09');
    });

    it('validates selected delivery date and rejects non-delivery days', () => {
      // 2026-10-08 is Thursday (Tazaki only delivers Mon, Wed, Fri)
      const tuesdayMorning = new Date('2026-10-06T09:00:00.000Z');
      const validation = validateDeliveryDate('2026-10-08', tazakiSupplier, sampleBranch.id, tuesdayMorning);
      assert.equal(validation.valid, false);
      assert.ok(validation.error?.includes('does not deliver on Thursdays'));
    });
  });

  // ---------------------------------------------------------------------------
  // 2. ORDER SUBMISSION, DOCUMENTATION & EMAIL/PDF MATCHING
  // ---------------------------------------------------------------------------
  describe('2. Order Documentation & Email Consistency', () => {
    it('formats delivery note line items matching sent quantities and shortage notes', () => {
      const formattedLine = formatItemLine(
        1,
        'RAM-100',
        'Fresh Ramen Noodles 100g',
        10, // ordered 10 boxes
        0,
        'DELIVERY',
        8, // sent 8 boxes (2 short)
        0,
        sampleProduct,
        'Short Shipment from Vendor',
        'Box (50 packs)',
        'Pack (100g)'
      );

      assert.ok(formattedLine.includes('Fresh Ramen Noodles 100g'));
      assert.ok(formattedLine.includes('RAM-100'));
      assert.ok(formattedLine.includes('8 Box (50 packs) (2 OOS - Short Shipment from Vendor)'));
    });

    it('generates consistent email subject and body for supplier delivery notes', () => {
      const order: OrderRecord = {
        id: 'ord_covent_001',
        branchId: sampleBranch.id,
        branchNameSnapshot: sampleBranch.name,
        supplierId: internalSupplier.id,
        supplierNameSnapshot: internalSupplier.name,
        orderedByUserId: 'usr_chef_1',
        orderedByNameSnapshot: 'Master Chef',
        createdAt: '2026-10-04T10:00:00.000Z',
        deliveryDate: '2026-10-05',
        emailTo: internalSupplier.email,
        status: 'PLACED',
        receivedStatus: 'PROCESSED',
        fulfillmentStatus: 'PARTIAL',
        items: [
          {
            productId: 'prod_ramen_noodles',
            productNameSnapshot: 'Fresh Ramen Noodles 100g',
            caseQty: 10,
            packQty: 0,
            sentCaseQty: 8,
            sentPackQty: 0,
            shortageReason: 'Central Warehouse OOS',
          },
        ],
        manualItems: [],
      };

      const email = generateOrderEmailContent(order, sampleBranch, internalSupplier, [sampleProduct], 'DELIVERY');
      assert.ok(email.subject.includes('Delivery Note'));
      assert.ok(email.subject.includes(order.id.slice(0, 5).toUpperCase()));
      assert.ok(email.htmlBody.includes('Fresh Ramen Noodles 100g'));
      assert.ok(email.htmlBody.includes('Central Warehouse OOS'));
    });
  });

  // ---------------------------------------------------------------------------
  // 3. SUPPLIER PROCESSING & FULFILLMENT TRACKING ENGINE
  // ---------------------------------------------------------------------------
  describe('3. Supplier Fulfillment Engine & RBAC Verification', () => {
    it('computes FULFILLED when all ordered lines are sent in full', () => {
      const items: OrderItem[] = [
        {
          productId: 'prod_1',
          productNameSnapshot: 'Edamame',
          caseQty: 5,
          packQty: 0,
          sentCaseQty: 5,
          sentPackQty: 0,
        },
      ];

      const result = computeFulfillmentStatus(items, []);
      assert.equal(result.status, 'FULFILLED');
      assert.equal(result.hasShortages, false);
      assert.equal(result.totalSentUnits, 5);
    });

    it('computes PARTIAL when at least one item has shortages or is out of stock', () => {
      const items: OrderItem[] = [
        {
          productId: 'prod_1',
          productNameSnapshot: 'Edamame',
          caseQty: 5,
          packQty: 0,
          sentCaseQty: 3, // 2 short
          sentPackQty: 0,
          shortageReason: 'OOS',
        },
      ];

      const result = computeFulfillmentStatus(items, []);
      assert.equal(result.status, 'PARTIAL');
      assert.equal(result.hasShortages, true);
      assert.equal(result.totalShortUnits, 2);
    });

    it('computes UNFULFILLED when zero items were sent', () => {
      const items: OrderItem[] = [
        {
          productId: 'prod_1',
          productNameSnapshot: 'Edamame',
          caseQty: 5,
          packQty: 0,
          sentCaseQty: 0,
          sentPackQty: 0,
          shortageReason: 'Entire run cancelled',
        },
      ];

      const result = computeFulfillmentStatus(items, []);
      assert.equal(result.status, 'UNFULFILLED');
      assert.equal(result.totalSentUnits, 0);
      assert.equal(result.totalShortUnits, 5);
    });

    it('authorizes only designated branch warehouse staff to process internal supplier orders', () => {
      const warehouseUser: User = {
        id: 'usr_wh_staff',
        username: 'wh@ht-com.example',
        displayName: 'Warehouse Staff',
        role: 'STAFF',
        branchId: internalWarehouseBranch.id,
        active: true,
      };

      const regularBranchStaff: User = {
        id: 'usr_bloomsbury_staff',
        username: 'bloomsbury@ht-com.example',
        displayName: 'Bloomsbury Staff',
        role: 'STAFF',
        branchId: sampleBranch.id, // Bloomsbury branch cannot fulfill warehouse orders
        active: true,
      };

      const internalOrder: OrderRecord = {
        id: 'ord_wh_001',
        branchId: sampleBranch.id,
        branchNameSnapshot: sampleBranch.name,
        supplierId: internalSupplier.id,
        supplierNameSnapshot: internalSupplier.name,
        orderedByUserId: 'usr_chef',
        orderedByNameSnapshot: 'Chef',
        createdAt: '2026-10-04T10:00:00Z',
        emailTo: internalSupplier.email,
        status: 'PLACED',
        items: [],
        manualItems: [],
      };

      const warehouseCheck = canUserProcessFulfillment(
        warehouseUser,
        internalOrder,
        [internalSupplier],
        [internalWarehouseBranch, sampleBranch]
      );
      assert.equal(warehouseCheck.allowed, true);

      const regularCheck = canUserProcessFulfillment(
        regularBranchStaff,
        internalOrder,
        [internalSupplier],
        [internalWarehouseBranch, sampleBranch]
      );
      assert.equal(regularCheck.allowed, false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ORDER LIFECYCLE RETENTION & VISIBILITY SAFEGUARDS
  // ---------------------------------------------------------------------------
  describe('4. Order Lifecycle Retention & Outstanding Work Visibility', () => {
    const syncCutoffDate = '2026-08-20T00:00:00.000Z'; // 45 days prior
    const oldCreatedDate = '2026-04-15T10:00:00.000Z'; // 170 days ago

    it('retains old unfulfilled order in live synchronization regardless of age', () => {
      const oldUnfulfilledOrder: OrderRecord = {
        id: 'ord_old_actionable_01',
        branchId: sampleBranch.id,
        branchNameSnapshot: sampleBranch.name,
        supplierId: tazakiSupplier.id,
        supplierNameSnapshot: tazakiSupplier.name,
        orderedByUserId: 'usr_chef',
        orderedByNameSnapshot: 'Chef',
        createdAt: oldCreatedDate,
        emailTo: tazakiSupplier.email,
        status: 'PLACED',
        receivedStatus: 'NEW', // Still NEW / Unfulfilled!
        fulfillmentStatus: 'UNFULFILLED',
        items: [],
        manualItems: [],
      };

      assert.equal(isOpenOrActionable(oldUnfulfilledOrder), true);
      assert.equal(shouldRetainInLiveSync(oldUnfulfilledOrder, syncCutoffDate), true);
    });

    it('retains old unverified invoice order in live synchronization so pending audit is never hidden', () => {
      const oldUnverifiedOrder: OrderRecord = {
        id: 'ord_old_actionable_02',
        branchId: sampleBranch.id,
        branchNameSnapshot: sampleBranch.name,
        supplierId: tazakiSupplier.id,
        supplierNameSnapshot: tazakiSupplier.name,
        orderedByUserId: 'usr_chef',
        orderedByNameSnapshot: 'Chef',
        createdAt: oldCreatedDate,
        emailTo: tazakiSupplier.email,
        status: 'PLACED',
        receivedStatus: 'PROCESSED',
        fulfillmentStatus: 'FULFILLED',
        // Missing invoiceVerification!
        items: [],
        manualItems: [],
      };

      assert.equal(isOpenOrActionable(oldUnverifiedOrder), true);
      assert.equal(shouldRetainInLiveSync(oldUnverifiedOrder, syncCutoffDate), true);
    });

    it('prunes fully completed terminal orders that are older than the retention cutoff', () => {
      const oldCompletedOrder: OrderRecord = {
        id: 'ord_old_completed_01',
        branchId: sampleBranch.id,
        branchNameSnapshot: sampleBranch.name,
        supplierId: tazakiSupplier.id,
        supplierNameSnapshot: tazakiSupplier.name,
        orderedByUserId: 'usr_chef',
        orderedByNameSnapshot: 'Chef',
        createdAt: oldCreatedDate,
        emailTo: tazakiSupplier.email,
        status: 'PLACED',
        receivedStatus: 'PROCESSED',
        fulfillmentStatus: 'FULFILLED',
        invoiceVerification: {
          verifiedAt: '2026-04-16T12:00:00.000Z',
          verifiedBy: 'Manager Bob',
          hasDiscrepancies: false,
          totalOrderedValue: 150,
          totalInvoicedValue: 150,
          discrepancyTotal: 0,
        },
        items: [],
        manualItems: [],
      };

      assert.equal(isTerminalOrder(oldCompletedOrder), true);
      assert.equal(isOpenOrActionable(oldCompletedOrder), false);
      assert.equal(shouldRetainInLiveSync(oldCompletedOrder, syncCutoffDate), false);
    });
  });

});
