import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOrderCreation,
  validateOrderUpdate,
  validateOrderDeletion,
  checkUserActionPermission,
  OrderAuthorizationError,
  type AuthenticatedUser
} from '../server/order-authorization.ts';
import {
  hasActionPermission,
  isSupplierEligibleForOrder,
  filterSuppliersForOrdering
} from '../utils/accessControl.ts';
import type { User, OrderRecord, Supplier } from '../types.ts';

describe('Phase A - Correction 3: Consistent Action Permissions Throughout Application', () => {

  const sampleSupplier: Supplier = {
    id: 'sup_tazaki',
    name: 'Tazaki Foods',
    email: 'orders@tazaki-com.example',
    active: true,
    allBranches: true,
    deliveryRules: {},
    deliverySchedules: { default: 'Next day delivery' },
    contactEmail: 'orders@tazaki-com.example',
  };

  const sampleOrder: OrderRecord = {
    id: 'ord_consistent_001',
    branchId: 'branch_ealing',
    branchNameSnapshot: 'Hare & Tortoise Ealing',
    supplierId: 'sup_tazaki',
    supplierNameSnapshot: 'Tazaki Foods',
    orderedByUserId: 'usr_staff_1',
    orderedByNameSnapshot: 'Alice Staff',
    createdAt: '2026-10-04T10:00:00.000Z',
    deliveryDate: '2026-10-05',
    emailTo: 'orders@tazaki-com.example',
    status: 'PLACED',
    items: [
      {
        productId: 'prod_1',
        productNameSnapshot: 'Edamame',
        caseQty: 2,
        packQty: 0,
        casePriceSnapshot: 20,
        packPriceSnapshot: 0
      }
    ],
    manualItems: []
  };

  // -------------------------------------------------------------------------
  // 1. DISTINGUISHING INHERITED FROM CUSTOM PERMISSIONS
  // -------------------------------------------------------------------------
  describe('Inherited vs. Custom Permissions & "No Actions = No Actions"', () => {
    it('grants standard role permissions when user is in INHERITED mode', () => {
      const inheritedStaff: User = {
        id: 'usr_inherited_staff',
        username: 'staff@example.com',
        displayName: 'Inherited Staff',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        permissionMode: 'INHERITED',
        customPermissions: [], // empty or undefined in inherited mode
      };

      assert.equal(hasActionPermission(inheritedStaff, 'create_orders'), true);
      assert.equal(hasActionPermission(inheritedStaff, 'submit_orders'), true);
      assert.equal(hasActionPermission(inheritedStaff, 'view_order_history'), true);
      assert.equal(hasActionPermission(inheritedStaff, 'view_prices'), true);
      // Staff role does not have admin permissions
      assert.equal(hasActionPermission(inheritedStaff, 'manage_users'), false);
    });

    it('enforces Custom with NO actions means NO actions at store level', () => {
      const strippedCustomStaff: User = {
        id: 'usr_stripped_staff',
        username: 'stripped@example.com',
        displayName: 'Stripped Staff',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        permissionMode: 'CUSTOM',
        customPermissions: [], // Explicitly 0 actions selected!
      };

      // Every displayed action must be rejected!
      assert.equal(hasActionPermission(strippedCustomStaff, 'create_orders'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'edit_drafts'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'submit_orders'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'view_order_history'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'view_prices'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'view_other_users_orders'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'amend_orders'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'approve_orders'), false);
      assert.equal(hasActionPermission(strippedCustomStaff, 'cancel_orders'), false);
    });

    it('enforces Custom with single action allows ONLY that action', () => {
      const historyOnlyStaff: User = {
        id: 'usr_history_only',
        username: 'history@example.com',
        displayName: 'History Only Staff',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        permissionMode: 'CUSTOM',
        customPermissions: ['view_order_history'],
      };

      assert.equal(hasActionPermission(historyOnlyStaff, 'view_order_history'), true);
      assert.equal(hasActionPermission(historyOnlyStaff, 'create_orders'), false);
      assert.equal(hasActionPermission(historyOnlyStaff, 'submit_orders'), false);
      assert.equal(hasActionPermission(historyOnlyStaff, 'view_prices'), false);
    });

    it('enforces Custom with no actions on the server authorization engine', () => {
      const serverStrippedUser: AuthenticatedUser = {
        id: 'usr_stripped_server',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'Stripped Server Staff',
        permissionMode: 'CUSTOM',
        customPermissions: [],
      };

      assert.equal(checkUserActionPermission(serverStrippedUser, 'create_orders'), false);
      assert.equal(checkUserActionPermission(serverStrippedUser, 'submit_orders'), false);
      assert.equal(checkUserActionPermission(serverStrippedUser, 'edit_drafts'), false);
      assert.equal(checkUserActionPermission(serverStrippedUser, 'cancel_orders'), false);
      assert.equal(checkUserActionPermission(serverStrippedUser, 'delete_drafts'), false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. ENFORCEMENT ON OPERATIONS & DIRECT REQUESTS
  // -------------------------------------------------------------------------
  describe('Enforcement on Operations & Direct Requests', () => {
    it('blocks order creation when create_orders is removed', () => {
      const userWithoutCreate: AuthenticatedUser = {
        id: 'usr_no_create',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'No Create User',
        permissionMode: 'CUSTOM',
        customPermissions: ['view_order_history'],
      };

      const newOrderAttempt: Partial<OrderRecord> = {
        id: 'ord_blocked_01',
        orderedByUserId: 'usr_no_create',
        branchId: 'branch_ealing',
        supplierId: 'sup_tazaki',
        createdAt: '2026-10-04T10:00:00.000Z',
        status: 'DRAFT',
      };

      assert.throws(
        () => validateOrderCreation(userWithoutCreate, newOrderAttempt),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403 && err.message.includes('create orders')
      );
    });

    it('blocks direct order submission when submit_orders is removed', () => {
      const userWithoutSubmit: AuthenticatedUser = {
        id: 'usr_no_submit',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'No Submit User',
        permissionMode: 'CUSTOM',
        customPermissions: ['create_orders', 'edit_drafts', 'view_order_history'], // lacks submit_orders
      };

      const placeAttempt: Partial<OrderRecord> = {
        id: 'ord_blocked_02',
        orderedByUserId: 'usr_no_submit',
        branchId: 'branch_ealing',
        supplierId: 'sup_tazaki',
        createdAt: '2026-10-04T10:00:00.000Z',
        status: 'PLACED',
      };

      // Direct create with status PLACED
      assert.throws(
        () => validateOrderCreation(userWithoutSubmit, placeAttempt),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403 && err.message.includes('submit orders')
      );

      // Transitioning draft -> placed
      const existingDraft: OrderRecord = {
        ...sampleOrder,
        id: 'ord_draft_01',
        orderedByUserId: 'usr_no_submit',
        status: 'DRAFT'
      };
      const submitDraftAttempt: OrderRecord = {
        ...existingDraft,
        status: 'PLACED'
      };

      assert.throws(
        () => validateOrderUpdate(userWithoutSubmit, existingDraft, submitDraftAttempt),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403 && err.message.includes('submit orders')
      );
    });

    it('blocks draft editing when edit_drafts is removed', () => {
      const userWithoutEditDrafts: AuthenticatedUser = {
        id: 'usr_no_edit_drafts',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'No Edit Draft User',
        permissionMode: 'CUSTOM',
        customPermissions: ['create_orders', 'view_order_history'], // lacks edit_drafts
      };

      const existingDraft: OrderRecord = {
        ...sampleOrder,
        id: 'ord_draft_02',
        orderedByUserId: 'usr_no_edit_drafts',
        status: 'DRAFT',
      };

      const modifyDraftAttempt: OrderRecord = {
        ...existingDraft,
        comments: 'Updated instructions',
      };

      assert.throws(
        () => validateOrderUpdate(userWithoutEditDrafts, existingDraft, modifyDraftAttempt),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403 && err.message.includes('edit draft')
      );
    });

    it('blocks order cancellation when cancel_orders is removed', () => {
      const staffWithoutCancel: AuthenticatedUser = {
        id: 'usr_no_cancel',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'Staff Without Cancel',
        permissionMode: 'CUSTOM',
        customPermissions: ['create_orders', 'submit_orders', 'view_order_history'],
      };

      const placedOrder: OrderRecord = {
        ...sampleOrder,
        orderedByUserId: 'usr_no_cancel',
        status: 'PLACED',
      };

      const cancelAttempt: OrderRecord = {
        ...placedOrder,
        status: 'CANCELLED',
      };

      assert.throws(
        () => validateOrderUpdate(staffWithoutCancel, placedOrder, cancelAttempt),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403 && err.message.includes('cancel')
      );
    });

    it('allows order cancellation when cancel_orders is granted', () => {
      const managerWithCancel: AuthenticatedUser = {
        id: 'usr_mgr_cancel',
        role: 'MANAGER',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'Manager with Cancel',
      };

      const placedOrder: OrderRecord = {
        ...sampleOrder,
        status: 'PLACED',
      };

      const cancelAttempt: OrderRecord = {
        ...placedOrder,
        status: 'CANCELLED',
      };

      const updated = validateOrderUpdate(managerWithCancel, placedOrder, cancelAttempt);
      assert.equal(updated.status, 'CANCELLED');
    });

    it('blocks draft deletion when delete_drafts is removed', () => {
      const userWithoutDeleteDraft: AuthenticatedUser = {
        id: 'usr_no_del_draft',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'User No Del Draft',
        permissionMode: 'CUSTOM',
        customPermissions: ['create_orders', 'edit_drafts'],
      };

      const draftOrder: OrderRecord = {
        ...sampleOrder,
        id: 'draft_to_delete',
        orderedByUserId: 'usr_no_del_draft',
        status: 'DRAFT',
      };

      assert.throws(
        () => validateOrderDeletion(userWithoutDeleteDraft, draftOrder),
        (err: any) => err instanceof OrderAuthorizationError && err.status === 403 && err.message.includes('delete draft')
      );
    });

    it('gates supplier eligibility in accessControl engine based on action permissions', () => {
      const userWithoutCreate: User = {
        id: 'usr_no_create_client',
        username: 'no_create@example.com',
        displayName: 'No Create Client',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
        permissionMode: 'CUSTOM',
        customPermissions: ['view_order_history'],
      };

      const hasActionPerm = hasActionPermission(userWithoutCreate, 'create_orders');
      assert.equal(hasActionPerm, false);

      const isEligible = isSupplierEligibleForOrder(
        userWithoutCreate,
        sampleSupplier,
        'branch_ealing',
        undefined,
        hasActionPerm
      );
      assert.equal(isEligible, false);

      const filtered = filterSuppliersForOrdering(
        userWithoutCreate,
        [sampleSupplier],
        'branch_ealing',
        undefined,
        hasActionPerm
      );
      assert.equal(filtered.length, 0);
    });

    it('preserves existing approval policy and enterprise access for GM and Creator', () => {
      const gmUser: AuthenticatedUser = {
        id: 'usr_gm_enterprise',
        role: 'GM',
        active: true,
        displayName: 'Enterprise GM',
      };

      assert.equal(checkUserActionPermission(gmUser, 'create_orders'), true);
      assert.equal(checkUserActionPermission(gmUser, 'submit_orders'), true);
      assert.equal(checkUserActionPermission(gmUser, 'amend_orders'), true);
      assert.equal(checkUserActionPermission(gmUser, 'approve_orders'), true);
      assert.equal(checkUserActionPermission(gmUser, 'cancel_orders'), true);
    });
  });
});
