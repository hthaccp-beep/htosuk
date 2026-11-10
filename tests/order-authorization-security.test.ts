import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOrderCreation,
  validateOrderUpdate,
  validateOrderDeletion,
  OrderAuthorizationError,
  type AuthenticatedUser,
} from '../server/order-authorization.ts';
import type { OrderRecord } from '../types.ts';

function createSampleOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'ord_101',
    branchId: 'branch_ealing',
    branchNameSnapshot: 'Hare & Tortoise Ealing',
    supplierId: 'sup_tazaki',
    supplierNameSnapshot: 'Tazaki Foods',
    orderedByUserId: 'usr_staff_ealing',
    orderedByNameSnapshot: 'Alice Staff',
    createdAt: '2026-09-29T10:00:00.000Z',
    deliveryDate: '2026-09-30',
    emailTo: 'orders@tazaki-com.example',
    status: 'PLACED',
    emailStatus: 'PENDING',
    items: [
      {
        productId: 'prod_salmon',
        productNameSnapshot: 'Fresh Salmon Fillet',
        caseQty: 2,
        packQty: 0,
        casePriceSnapshot: 45.0,
        packPriceSnapshot: 0,
      },
    ],
    manualItems: [],
    ...overrides,
  };
}

describe('Order Authorization and Field-Level Integrity (Issue 5)', () => {
  // Test User Identities
  const creatorUser: AuthenticatedUser = {
    id: 'usr_creator',
    role: 'CREATOR',
    active: true,
    displayName: 'Creator Boss',
  };

  const gmUser: AuthenticatedUser = {
    id: 'usr_gm',
    role: 'GM',
    active: true,
    displayName: 'General Manager',
  };

  const managerEaling: AuthenticatedUser = {
    id: 'usr_mgr_ealing',
    role: 'MANAGER',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Ealing Manager',
  };

  const managerSoho: AuthenticatedUser = {
    id: 'usr_mgr_soho',
    role: 'MANAGER',
    branchId: 'branch_soho',
    active: true,
    displayName: 'Soho Manager',
  };

  const staffEaling: AuthenticatedUser = {
    id: 'usr_staff_ealing',
    role: 'STAFF',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Alice Staff',
  };

  const staffSoho: AuthenticatedUser = {
    id: 'usr_staff_soho',
    role: 'STAFF',
    branchId: 'branch_soho',
    active: true,
    displayName: 'Bob Staff',
  };

  const inactiveUser: AuthenticatedUser = {
    id: 'usr_inactive',
    role: 'STAFF',
    branchId: 'branch_ealing',
    active: false,
    displayName: 'Inactive User',
  };

  // =========================================================================
  // 1. ORDER CREATION AUTHORIZATION & BRANCH CONTAINMENT
  // =========================================================================
  describe('Order Creation Constraints', () => {
    it('allows Staff to create an order for their own branch', () => {
      const order = createSampleOrder({ status: 'PLACED' });
      const result = validateOrderCreation(staffEaling, order);
      assert.equal(result.id, 'ord_101');
      assert.equal(result.branchId, 'branch_ealing');
    });

    it('denies Staff creating an order for another branch (403)', () => {
      const order = createSampleOrder({ branchId: 'branch_soho' });
      assert.throws(
        () => validateOrderCreation(staffEaling, order),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403
      );
    });

    it('denies Staff from forging the order author (orderedByUserId mismatch) (403)', () => {
      const order = createSampleOrder({ orderedByUserId: 'usr_other_person' });
      assert.throws(
        () => validateOrderCreation(staffEaling, order),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403
      );
    });

    it('denies Manager creating an order for a branch they do not manage (403)', () => {
      const order = createSampleOrder({
        orderedByUserId: managerSoho.id,
        branchId: 'branch_ealing',
      });
      assert.throws(
        () => validateOrderCreation(managerSoho, order),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403
      );
    });

    it('allows Admin (GM / CREATOR) to create orders across branches', () => {
      const order1 = createSampleOrder({
        id: 'ord_gm_1',
        orderedByUserId: gmUser.id,
        branchId: 'branch_ealing',
      });
      const res1 = validateOrderCreation(gmUser, order1);
      assert.equal(res1.branchId, 'branch_ealing');

      const order2 = createSampleOrder({
        id: 'ord_creator_1',
        orderedByUserId: creatorUser.id,
        branchId: 'branch_soho',
      });
      const res2 = validateOrderCreation(creatorUser, order2);
      assert.equal(res2.branchId, 'branch_soho');
    });

    it('rejects order creation by inactive users (403)', () => {
      const order = createSampleOrder({ orderedByUserId: inactiveUser.id });
      assert.throws(
        () => validateOrderCreation(inactiveUser, order),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403
      );
    });

    it('rejects malformed orders with missing mandatory fields (400)', () => {
      // Missing id
      assert.throws(
        () => validateOrderCreation(staffEaling, createSampleOrder({ id: '' })),
        (err: any) => err.status === 400
      );
      // Missing supplierId
      assert.throws(
        () => validateOrderCreation(staffEaling, createSampleOrder({ supplierId: '' })),
        (err: any) => err.status === 400
      );
      // Missing createdAt
      assert.throws(
        () => validateOrderCreation(staffEaling, createSampleOrder({ createdAt: '' })),
        (err: any) => err.status === 400
      );
      // Invalid status
      assert.throws(
        () => validateOrderCreation(staffEaling, createSampleOrder({ status: 'DELIVERED' as any })),
        (err: any) => err.status === 400
      );
    });
  });

  // =========================================================================
  // 2. IMMUTABLE IDENTITY FIELDS ON ORDER UPDATES
  // =========================================================================
  describe('Immutable Core Identity Fields', () => {
    const original = createSampleOrder();

    it('prevents modifying order ID (403)', () => {
      const tampered = { ...original, id: 'ord_tampered' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, original, tampered),
        (err: any) => err.status === 403 && err.message.includes('Order ID is immutable')
      );
    });

    it('prevents modifying order author orderedByUserId (403)', () => {
      const tampered = { ...original, orderedByUserId: 'usr_other_author' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, original, tampered),
        (err: any) => err.status === 403 && err.message.includes('orderedByUserId')
      );
    });

    it('prevents modifying order branchId (403)', () => {
      const tampered = { ...original, branchId: 'branch_soho' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, original, tampered),
        (err: any) => err.status === 403 && err.message.includes('branchId is immutable')
      );
    });

    it('prevents modifying order supplierId (403)', () => {
      const tampered = { ...original, supplierId: 'sup_other' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, original, tampered),
        (err: any) => err.status === 403 && err.message.includes('supplierId is immutable')
      );
    });

    it('prevents modifying order createdAt timestamp (403)', () => {
      const tampered = { ...original, createdAt: '2026-01-01T00:00:00.000Z' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, original, tampered),
        (err: any) => err.status === 403 && err.message.includes('createdAt')
      );
    });
  });

  // =========================================================================
  // 3. WORKFLOW STATE TRANSITIONS & PERMISSION MATRIX
  // =========================================================================
  describe('Workflow State Transitions', () => {
    it('allows author to transition DRAFT order to PLACED', () => {
      const draftOrder = createSampleOrder({ status: 'DRAFT' });
      const placedOrder = { ...draftOrder, status: 'PLACED' as const };
      const result = validateOrderUpdate(staffEaling, draftOrder, placedOrder);
      assert.equal(result.status, 'PLACED');
    });

    it('prevents reverting a PLACED order back to DRAFT (403)', () => {
      const placedOrder = createSampleOrder({ status: 'PLACED' });
      const draftAttempt = { ...placedOrder, status: 'DRAFT' as const };
      assert.throws(
        () => validateOrderUpdate(staffEaling, placedOrder, draftAttempt),
        (err: any) => err.status === 403 && err.message.includes('cannot be reverted back to DRAFT')
      );
    });

    it('prevents unauthorized staff from other branch editing a DRAFT order (403)', () => {
      const draftOrder = createSampleOrder({ status: 'DRAFT' });
      const editAttempt = { ...draftOrder, comments: 'Hacked comments' };
      assert.throws(
        () => validateOrderUpdate(staffSoho, draftOrder, editAttempt),
        (err: any) => err.status === 403
      );
    });

    it('allows Branch Manager to update DRAFT orders in their branch', () => {
      const draftOrder = createSampleOrder({ status: 'DRAFT' });
      const approvedDraft = { ...draftOrder, comments: 'Approved by Manager' };
      const res = validateOrderUpdate(managerEaling, draftOrder, approvedDraft);
      assert.equal(res.comments, 'Approved by Manager');
    });

    it('denies Branch Manager from updating DRAFT orders in other branches (403)', () => {
      const draftOrder = createSampleOrder({ status: 'DRAFT', branchId: 'branch_ealing' });
      const editAttempt = { ...draftOrder, comments: 'Attempted cross-branch edit' };
      assert.throws(
        () => validateOrderUpdate(managerSoho, draftOrder, editAttempt),
        (err: any) => err.status === 403
      );
    });
  });

  // =========================================================================
  // 4. HISTORICAL SNAPSHOT IMMUTABILITY ON PLACED ORDERS
  // =========================================================================
  describe('Historical Snapshot Immutability', () => {
    const placedOrder = createSampleOrder({ status: 'PLACED' });

    it('prevents modifying branchNameSnapshot on placed orders (403)', () => {
      const tampered = { ...placedOrder, branchNameSnapshot: 'Forged Branch Name' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, placedOrder, tampered),
        (err: any) => err.status === 403 && err.message.includes('snapshots are immutable')
      );
    });

    it('prevents modifying supplierNameSnapshot on placed orders (403)', () => {
      const tampered = { ...placedOrder, supplierNameSnapshot: 'Forged Supplier' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, placedOrder, tampered),
        (err: any) => err.status === 403 && err.message.includes('snapshots are immutable')
      );
    });

    it('prevents modifying orderedByNameSnapshot on placed orders (403)', () => {
      const tampered = { ...placedOrder, orderedByNameSnapshot: 'Forged Person' };
      assert.throws(
        () => validateOrderUpdate(staffEaling, placedOrder, tampered),
        (err: any) => err.status === 403 && err.message.includes('snapshots are immutable')
      );
    });
  });

  // =========================================================================
  // 5. SUPPLIER-SIDE MODIFICATIONS (Fulfillment tracking only)
  // =========================================================================
  describe('Supplier-Side Modifications Constraints', () => {
    const placedOrder = createSampleOrder({ status: 'PLACED' });
    const supplierUser: AuthenticatedUser = {
      id: 'usr_tazaki_sup',
      role: 'STAFF',
      active: true,
      displayName: 'Tazaki Supplier Representative',
    };

    it('allows linked supplier to update fulfillment tracking details', () => {
      const updated = {
        ...placedOrder,
        receivedStatus: 'PROCESSED' as const,
        fulfillmentStatus: 'FULFILLED' as const,
        processedAt: '2026-09-30T08:00:00.000Z',
        items: [
          {
            ...placedOrder.items[0],
            sentCaseQty: 2,
            sentPackQty: 0,
          },
        ],
      };

      const result = validateOrderUpdate(supplierUser, placedOrder, updated, true);
      assert.equal(result.receivedStatus, 'PROCESSED');
      assert.equal(result.fulfillmentStatus, 'FULFILLED');
      assert.equal(result.items[0].sentCaseQty, 2);
    });

    it('denies linked supplier from modifying ordered prices or quantities (403)', () => {
      const tamperedPrice = {
        ...placedOrder,
        items: [
          {
            ...placedOrder.items[0],
            casePriceSnapshot: 999.0, // Supplier tried to inflate agreed price!
          },
        ],
      };

      assert.throws(
        () => validateOrderUpdate(supplierUser, placedOrder, tamperedPrice, true),
        (err: any) => err.status === 403 && err.message.includes('Suppliers cannot modify ordered quantities or price snapshots')
      );
    });

    it('denies linked supplier from adding or removing order lines (403)', () => {
      const tamperedItems = {
        ...placedOrder,
        items: [], // Supplier wiped items
      };

      assert.throws(
        () => validateOrderUpdate(supplierUser, placedOrder, tamperedItems, true),
        (err: any) => err.status === 403 && err.message.includes('Suppliers cannot add or remove items')
      );
    });

    it('denies linked supplier from forging or altering restaurant invoice verification (403)', () => {
      const tamperedVerification = {
        ...placedOrder,
        invoiceVerification: {
          verifiedAt: '2026-09-30T10:00:00.000Z',
          verifiedBy: 'Supplier Impersonator',
          hasDiscrepancies: false,
          totalOrderedValue: 90,
          totalInvoicedValue: 90,
          discrepancyTotal: 0,
        },
      };

      assert.throws(
        () => validateOrderUpdate(supplierUser, placedOrder, tamperedVerification, true),
        (err: any) => err.status === 403 && err.message.includes('Suppliers cannot modify invoice verification')
      );
    });
  });

  // =========================================================================
  // 6. ORDER DELETION INTEGRITY
  // =========================================================================
  describe('Order Deletion Rules', () => {
    it('allows author to delete their own DRAFT order', () => {
      const draft = createSampleOrder({ status: 'DRAFT' });
      assert.doesNotThrow(() => validateOrderDeletion(staffEaling, draft));
    });

    it('allows Branch Manager to delete a DRAFT order in their branch', () => {
      const draft = createSampleOrder({ status: 'DRAFT', branchId: 'branch_ealing' });
      assert.doesNotThrow(() => validateOrderDeletion(managerEaling, draft));
    });

    it('denies Branch Manager deleting a DRAFT order in another branch (403)', () => {
      const draft = createSampleOrder({ status: 'DRAFT', branchId: 'branch_ealing' });
      assert.throws(
        () => validateOrderDeletion(managerSoho, draft),
        (err: any) => err.status === 403
      );
    });

    it('strictly forbids deleting PLACED orders for all users (403)', () => {
      const placed = createSampleOrder({ status: 'PLACED' });

      // Staff cannot delete placed order
      assert.throws(
        () => validateOrderDeletion(staffEaling, placed),
        (err: any) => err.status === 403 && err.message.includes('Placed orders are permanent')
      );

      // Manager cannot delete placed order
      assert.throws(
        () => validateOrderDeletion(managerEaling, placed),
        (err: any) => err.status === 403 && err.message.includes('Placed orders are permanent')
      );

      // Admin cannot delete placed order
      assert.throws(
        () => validateOrderDeletion(gmUser, placed),
        (err: any) => err.status === 403 && err.message.includes('Placed orders are permanent')
      );
    });
  });
});
