import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  computeFulfillmentStatus, 
  canUserProcessFulfillment, 
  STANDARD_SHORTAGE_REASONS 
} from '../utils/fulfillmentEngine.ts';
import { generateOrderEmailContent } from '../utils/orderEmail.ts';
import type { OrderRecord, OrderItem, ManualOrderItem, User, Supplier, Branch, Product } from '../types.ts';

describe('Supplier Processing and Fulfillment Tracking (Issue 11)', () => {
  const mockBranches: Branch[] = [
    { id: 'b_piccadilly', name: 'Piccadilly Circus', code: 'PIC', active: true, email: 'piccadilly@ht-com.example' },
    { id: 'b_warehouse', name: 'Central Warehouse / Production', code: 'WH', active: true, actsAsSupplier: true, email: 'warehouse@ht-com.example' },
  ];

  const mockSuppliers: Supplier[] = [
    {
      id: 's_internal_wh',
      name: 'HT Central Warehouse',
      email: 'warehouse@ht-com.example',
      active: true,
      linkedBranchId: 'b_warehouse',
      deliveryRules: {},
      deliverySchedules: { default: 'Internal Transfer (1-2 Days)' },
    },
    {
      id: 's_external_jfc',
      name: 'JFC International',
      email: 'orders@jfc-eu.example',
      active: true,
      deliveryRules: {},
      deliverySchedules: { default: 'Order by 10pm' },
    },
  ];

  const sampleProducts: Product[] = [
    {
      id: 'p_noodles',
      name: 'Ramen Fresh Noodles',
      categoryId: 'cat_fresh',
      supplierId: 's_internal_wh',
      active: true,
      casePrice: 40.00,
      packPrice: 4.00,
      caseUnitName: 'Box (10kg)',
      packUnitName: 'Pack (1kg)',
      displayOrder: 1,
      allowedBranchIds: [],
    },
    {
      id: 'p_broth',
      name: 'Tonkotsu Broth Base',
      categoryId: 'cat_fresh',
      supplierId: 's_internal_wh',
      active: true,
      casePrice: 65.00,
      packPrice: 7.00,
      caseUnitName: 'Tub (10L)',
      packUnitName: 'Pouch (1L)',
      displayOrder: 2,
      allowedBranchIds: [],
    },
  ];

  // Base Order Record
  const baseOrder: OrderRecord = {
    id: 'ord_12345678',
    branchId: 'b_piccadilly',
    branchNameSnapshot: 'Piccadilly Circus',
    supplierId: 's_internal_wh',
    supplierNameSnapshot: 'HT Central Warehouse',
    orderedByUserId: 'usr_staff_pic',
    orderedByNameSnapshot: 'Alice Staff',
    createdAt: '2026-09-29T10:00:00.000Z',
    deliveryDate: '2026-09-30',
    emailTo: 'warehouse@ht-com.example',
    status: 'PLACED',
    items: [],
    manualItems: [],
  };

  // =========================================================================
  // 1. FULFILLMENT STATUS CALCULATION
  // =========================================================================
  describe('Fulfillment Status Calculation', () => {
    it('computes FULFILLED when all quantities are dispatched completely', () => {
      const items: OrderItem[] = [
        {
          productId: 'p_noodles',
          productNameSnapshot: 'Ramen Fresh Noodles',
          caseQty: 5,
          packQty: 2,
          sentCaseQty: 5,
          sentPackQty: 2,
        },
      ];

      const manualItems: ManualOrderItem[] = [
        {
          id: 'man_1',
          description: 'Special Gyoza Wrappers',
          caseQty: 2,
          packQty: 0,
          sentCaseQty: 2,
          sentPackQty: 0,
        },
      ];

      const result = computeFulfillmentStatus(items, manualItems);

      assert.equal(result.status, 'FULFILLED');
      assert.equal(result.hasShortages, false);
      assert.equal(result.totalOrderedUnits, 9); // (5+2) + 2
      assert.equal(result.totalSentUnits, 9);
      assert.equal(result.totalShortUnits, 0);
      assert.equal(result.shortItemCount, 0);
      assert.ok(result.summaryText.includes('Fully fulfilled'));
    });

    it('computes PARTIAL when some quantities are short and tracks reasons', () => {
      const items: OrderItem[] = [
        {
          productId: 'p_noodles',
          productNameSnapshot: 'Ramen Fresh Noodles',
          caseQty: 10,
          packQty: 0,
          sentCaseQty: 7, // 3 short!
          sentPackQty: 0,
          shortageReason: 'Out of Stock at Central Warehouse',
        },
        {
          productId: 'p_broth',
          productNameSnapshot: 'Tonkotsu Broth Base',
          caseQty: 4,
          packQty: 0,
          sentCaseQty: 4, // Full
          sentPackQty: 0,
        },
      ];

      const result = computeFulfillmentStatus(items, []);

      assert.equal(result.status, 'PARTIAL');
      assert.equal(result.hasShortages, true);
      assert.equal(result.totalOrderedUnits, 14);
      assert.equal(result.totalSentUnits, 11);
      assert.equal(result.totalShortUnits, 3);
      assert.equal(result.shortItemCount, 1);
      assert.ok(result.summaryText.includes('Partially fulfilled'));

      const shortLine = result.lines.find((l) => l.id === 'p_noodles');
      assert.ok(shortLine);
      assert.equal(shortLine.shortCaseQty, 3);
      assert.equal(shortLine.shortageReason, 'Out of Stock at Central Warehouse');
    });

    it('computes UNFULFILLED when entire order has zero dispatched units', () => {
      const items: OrderItem[] = [
        {
          productId: 'p_noodles',
          productNameSnapshot: 'Ramen Fresh Noodles',
          caseQty: 5,
          packQty: 0,
          sentCaseQty: 0,
          sentPackQty: 0,
          shortageReason: 'Quality Rejection / Damaged',
        },
      ];

      const result = computeFulfillmentStatus(items, []);

      assert.equal(result.status, 'UNFULFILLED');
      assert.equal(result.hasShortages, true);
      assert.equal(result.totalOrderedUnits, 5);
      assert.equal(result.totalSentUnits, 0);
      assert.equal(result.totalShortUnits, 5);
      assert.ok(result.summaryText.includes('Unfulfilled'));
    });
  });

  // =========================================================================
  // 2. RBAC AUTHORIZATION CHECKS
  // =========================================================================
  describe('RBAC Authorization for Supplier Fulfillment', () => {
    it('allows workspace owner across branches but requires assignment for GM', () => {
      const creatorUser: User = { id: 'usr_c', username: 'c@ht-com.example', displayName: 'Creator', role: 'CREATOR', active: true };
      const gmUser: User = { id: 'usr_gm', username: 'gm@ht-com.example', displayName: 'General Manager', role: 'GM', active: true };

      const resCreator = canUserProcessFulfillment(creatorUser, baseOrder, mockSuppliers, mockBranches);
      const resGm = canUserProcessFulfillment(gmUser, baseOrder, mockSuppliers, mockBranches);

      assert.equal(resCreator.allowed, true);
      assert.equal(resGm.allowed, false);
    });

    it('allows internal supplier branch staff/manager to process fulfillment for their branch', () => {
      const warehouseManager: User = {
        id: 'usr_wh_mgr',
        username: 'whmgr@ht-com.example',
        displayName: 'Warehouse Manager',
        role: 'MANAGER',
        branchId: 'b_warehouse',
        active: true,
      };

      const warehouseStaff: User = {
        id: 'usr_wh_staff',
        username: 'whstaff@ht-com.example',
        displayName: 'Warehouse Picker',
        role: 'STAFF',
        branchId: 'b_warehouse',
        active: true,
      };

      const resMgr = canUserProcessFulfillment(warehouseManager, baseOrder, mockSuppliers, mockBranches);
      const resStaff = canUserProcessFulfillment(warehouseStaff, baseOrder, mockSuppliers, mockBranches);

      assert.equal(resMgr.allowed, true);
      assert.equal(resStaff.allowed, true);
    });

    it('denies branch staff or managers from processing fulfillment for other supplier branches', () => {
      const piccadillyManager: User = {
        id: 'usr_pic_mgr',
        username: 'picmgr@ht-com.example',
        displayName: 'Piccadilly Manager',
        role: 'MANAGER',
        branchId: 'b_piccadilly',
        active: true,
      };

      const piccadillyStaff: User = {
        id: 'usr_pic_staff',
        username: 'picstaff@ht-com.example',
        displayName: 'Piccadilly Staff',
        role: 'STAFF',
        branchId: 'b_piccadilly',
        active: true,
      };

      const resMgr = canUserProcessFulfillment(piccadillyManager, baseOrder, mockSuppliers, mockBranches);
      const resStaff = canUserProcessFulfillment(piccadillyStaff, baseOrder, mockSuppliers, mockBranches);

      assert.equal(resMgr.allowed, false);
      assert.ok(resMgr.reason?.includes('Only staff assigned to internal supplier branch'));
      assert.equal(resStaff.allowed, false);
    });

    it('denies unauthenticated or deactivated users', () => {
      const deactivatedUser: User = {
        id: 'usr_wh_deactivated',
        username: 'inactive@ht-com.example',
        displayName: 'Inactive User',
        role: 'MANAGER',
        branchId: 'b_warehouse',
        active: false,
      };

      assert.equal(canUserProcessFulfillment(null, baseOrder, mockSuppliers, mockBranches).allowed, false);
      assert.equal(canUserProcessFulfillment(deactivatedUser, baseOrder, mockSuppliers, mockBranches).allowed, false);
    });
  });

  // =========================================================================
  // 3. DELIVERY NOTE NOTIFICATION FORMATTING
  // =========================================================================
  describe('Delivery Note Email Notification Formatting', () => {
    it('generates delivery note email with shortages and OOS reasons highlighted', () => {
      const orderWithShortages: OrderRecord = {
        ...baseOrder,
        fulfillmentStatus: 'PARTIAL',
        items: [
          {
            productId: 'p_noodles',
            productNameSnapshot: 'Ramen Fresh Noodles',
            caseQty: 10,
            packQty: 0,
            sentCaseQty: 8, // 2 short
            sentPackQty: 0,
            shortageReason: 'Short Shipment from Vendor',
          },
        ],
      };

      const email = generateOrderEmailContent(
        orderWithShortages,
        mockBranches[0],
        mockSuppliers[0],
        sampleProducts,
        'DELIVERY'
      );

      // Subject indicates shortages
      assert.ok(email.subject.includes('[ITEMS OOS]') || email.subject.includes('Delivery Note'));
      // Body includes itemized shortage and reason
      assert.ok(email.htmlBody.includes('8 Box (10kg) (2 OOS - Short Shipment from Vendor)'));
      assert.ok(email.htmlBody.includes('color: #dc2626')); // Red style for OOS
    });
  });
});
