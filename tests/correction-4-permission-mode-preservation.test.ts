import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hasActionPermission } from '../utils/accessControl.ts';
import { checkUserActionPermission, type AuthenticatedUser } from '../server/order-authorization.ts';
import { can, useAppStore } from '../store.ts';
import type { User, Permission } from '../types.ts';
import { createUserAdminHandler } from '../server/user-admin-service.ts';

describe('Correction 4: Preserve permission mode during account saving & fix legacy user permission inheritance', () => {

  describe('1. Legacy User Permission Inheritance (Store & Access Control)', () => {
    it('grants role permissions to legacy user with permissionMode: undefined and customPermissions: []', () => {
      const legacyStaff: User = {
        id: 'usr_legacy_staff_1',
        username: 'legacy.staff@example.com',
        displayName: 'Legacy Staff Chef',
        role: 'STAFF',
        branchId: 'branch_central',
        active: true,
        // Legacy: permissionMode not present in database document
        permissionMode: undefined,
        customPermissions: [], // older system stored empty array by default
      };

      // In utils/accessControl
      assert.equal(hasActionPermission(legacyStaff, 'create_orders'), true, 'Legacy staff should have create_orders');
      assert.equal(hasActionPermission(legacyStaff, 'submit_orders'), true, 'Legacy staff should have submit_orders');
      assert.equal(hasActionPermission(legacyStaff, 'view_prices'), true, 'Legacy staff should have view_prices');
      assert.equal(hasActionPermission(legacyStaff, 'view_order_history'), true, 'Legacy staff should have view_order_history');
      assert.equal(hasActionPermission(legacyStaff, 'manage_users'), false, 'Legacy staff should not have manager permissions');

      // In store.ts can() helper
      assert.equal(can(legacyStaff, 'create_orders'), true, 'can() helper must grant create_orders to legacy staff');
      assert.equal(can(legacyStaff, 'view_prices'), true, 'can() helper must grant view_prices to legacy staff');
    });

    it('grants role permissions to legacy user with permissionMode: undefined and customPermissions: undefined', () => {
      const legacyManager: User = {
        id: 'usr_legacy_mgr_1',
        username: 'legacy.mgr@example.com',
        displayName: 'Legacy Manager',
        role: 'MANAGER',
        branchId: 'branch_central',
        active: true,
        permissionMode: undefined,
        customPermissions: undefined,
      };

      assert.equal(hasActionPermission(legacyManager, 'create_orders'), true);
      assert.equal(hasActionPermission(legacyManager, 'approve_orders'), true);
      assert.equal(hasActionPermission(legacyManager, 'manage_users'), true);
      assert.equal(hasActionPermission(legacyManager, 'scan_invoices'), true);
      assert.equal(can(legacyManager, 'approve_orders'), true);
    });

    it('preserves legacy user custom overrides if customPermissions has non-empty list without explicit permissionMode', () => {
      const legacyCustomUser: User = {
        id: 'usr_legacy_custom',
        username: 'legacy.custom@example.com',
        displayName: 'Legacy Custom User',
        role: 'STAFF',
        branchId: 'branch_central',
        active: true,
        permissionMode: undefined,
        customPermissions: ['view_order_history', 'view_prices'],
      };

      assert.equal(hasActionPermission(legacyCustomUser, 'view_order_history'), true);
      assert.equal(hasActionPermission(legacyCustomUser, 'view_prices'), true);
      assert.equal(hasActionPermission(legacyCustomUser, 'create_orders'), false, 'Custom list without create_orders should restrict action');
    });
  });

  describe('2. Modern User Custom Zero-Permissions Enforcement', () => {
    it('strictly enforces 0 actions when permissionMode: "CUSTOM" with customPermissions: []', () => {
      const strippedStaff: User = {
        id: 'usr_stripped_staff',
        username: 'stripped@example.com',
        displayName: 'Stripped Staff',
        role: 'STAFF',
        branchId: 'branch_central',
        active: true,
        permissionMode: 'CUSTOM', // Explicitly custom!
        customPermissions: [],    // Explicitly 0 actions!
      };

      assert.equal(hasActionPermission(strippedStaff, 'create_orders'), false);
      assert.equal(hasActionPermission(strippedStaff, 'submit_orders'), false);
      assert.equal(hasActionPermission(strippedStaff, 'view_prices'), false);
      assert.equal(hasActionPermission(strippedStaff, 'view_order_history'), false);
      assert.equal(can(strippedStaff, 'create_orders'), false);
    });

    it('strictly enforces 0 actions on server authorization engine when permissionMode: "CUSTOM"', () => {
      const serverStripped: AuthenticatedUser = {
        id: 'usr_stripped_server',
        role: 'STAFF',
        branchId: 'branch_central',
        active: true,
        displayName: 'Stripped Server User',
        permissionMode: 'CUSTOM',
        customPermissions: [],
      };

      assert.equal(checkUserActionPermission(serverStripped, 'create_orders'), false);
      assert.equal(checkUserActionPermission(serverStripped, 'submit_orders'), false);
      assert.equal(checkUserActionPermission(serverStripped, 'edit_drafts'), false);
    });

    it('grants role actions on server authorization engine to legacy staff with customPermissions: []', () => {
      const legacyServerStaff: AuthenticatedUser = {
        id: 'usr_legacy_server_staff',
        role: 'STAFF',
        branchId: 'branch_central',
        active: true,
        displayName: 'Legacy Server Staff',
        permissionMode: undefined,
        customPermissions: [],
      };

      assert.equal(checkUserActionPermission(legacyServerStaff, 'create_orders'), true);
      assert.equal(checkUserActionPermission(legacyServerStaff, 'submit_orders'), true);
      assert.equal(checkUserActionPermission(legacyServerStaff, 'edit_drafts'), true);
      assert.equal(checkUserActionPermission(legacyServerStaff, 'manage_users'), false);
    });
  });

  describe('3. Admin UI Modal State Detection for Legacy and Custom Accounts', () => {
    it('detects legacy user with empty customPermissions as INHERITED mode (inheritRolePerms: true)', () => {
      const legacyUser: User = {
        id: 'usr_leg_1',
        username: 'leg1@example.com',
        displayName: 'Chef Mario',
        role: 'STAFF',
        branchId: 'b1',
        active: true,
        permissionMode: undefined,
        customPermissions: [],
      };

      const defaultStaffPerms = ['place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_received_orders', 'delete_drafts', 'scan_invoices'];
      
      // Mirror AdminUsers handleOpenEdit detection logic
      const isCustom = legacyUser.permissionMode === 'CUSTOM' || (
        !legacyUser.permissionMode &&
        Array.isArray(legacyUser.customPermissions) &&
        legacyUser.customPermissions.length > 0 &&
        (legacyUser.customPermissions.length !== defaultStaffPerms.length || !legacyUser.customPermissions.every(p => defaultStaffPerms.includes(p as Permission)))
      );
      const inheritRolePerms = !isCustom;

      assert.equal(isCustom, false, 'Legacy user must NOT be treated as custom');
      assert.equal(inheritRolePerms, true, 'Inherit toggle must be TRUE for legacy user');
    });

    it('detects explicitly custom user with 0 actions as CUSTOM mode (inheritRolePerms: false)', () => {
      const customZeroUser: User = {
        id: 'usr_cust_0',
        username: 'cust0@example.com',
        displayName: 'Restricted Staff',
        role: 'STAFF',
        branchId: 'b1',
        active: true,
        permissionMode: 'CUSTOM',
        customPermissions: [],
      };

      const defaultStaffPerms = ['place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_received_orders', 'delete_drafts', 'scan_invoices'];
      
      const isCustom = customZeroUser.permissionMode === 'CUSTOM' || (
        !customZeroUser.permissionMode &&
        Array.isArray(customZeroUser.customPermissions) &&
        customZeroUser.customPermissions.length > 0 &&
        (customZeroUser.customPermissions.length !== defaultStaffPerms.length || !customZeroUser.customPermissions.every(p => defaultStaffPerms.includes(p as Permission)))
      );
      const inheritRolePerms = !isCustom;

      assert.equal(isCustom, true, 'Explicitly custom user must be treated as custom');
      assert.equal(inheritRolePerms, false, 'Inherit toggle must be FALSE for custom zero user');
    });
  });

  describe('4. Server User Admin API - permissionMode Persistence and Normalization', () => {
    it('creates user with permissionMode: "INHERITED" when customPermissions is empty and permissionMode not specified', async () => {
      let createdProfile: any = null;
      const deps: any = {
        verifyToken: async (token: string) => ({ uid: token }),
        createUserAuth: async (authData: any) => ({ uid: 'new-uid-123' }),
        createUserProfile: async (uid: string, profile: any) => { createdProfile = profile; },
        getUser: async (id: string) => {
          if (id === 'test-token') return { id: 'test-token', role: 'GM', active: true, allBranches: true };
          return null;
        },
      };

      const handler = createUserAdminHandler(deps);
      const req: any = {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: {
          action: 'create',
          data: {
            email: 'newchef@example.com',
            password: 'ValidPassword123!',
            displayName: 'New Chef',
            role: 'STAFF',
            branchId: 'branch_1',
            customPermissions: [], // empty array passed
          },
        },
      };

      let statusCode = 0;
      let jsonRes: any = null;
      const headers: Record<string, string> = {};
      const res: any = {
        setHeader: (k: string, v: string) => { headers[k] = v; },
        status: (code: number) => { statusCode = code; return res; },
        json: (val: any) => { jsonRes = val; return res; },
      };

      await handler(req, res);

      assert.equal(statusCode, 200);
      assert.ok(createdProfile);
      assert.equal(createdProfile.permissionMode, 'INHERITED', 'Default permissionMode should be INHERITED when customPermissions is empty');
    });

    it('updates user profile preserving explicit permissionMode: "CUSTOM" with empty customPermissions', async () => {
      let patchedProfile: any = null;
      const targetUser = {
        id: 'usr_to_update',
        role: 'STAFF',
        branchId: 'branch_1',
        active: true,
        displayName: 'Target Staff',
        permissionMode: 'INHERITED',
      };

      const deps: any = {
        verifyToken: async (token: string) => ({ uid: token }),
        updateUserAuth: async () => {},
        getUser: async (id: string) => {
          if (id === 'test-token') return { id: 'test-token', role: 'GM', active: true, allBranches: true };
          if (id === 'usr_to_update') return targetUser;
          return null;
        },
        updateUserProfile: async (id: string, patch: any) => {
          patchedProfile = patch;
        },
      };

      const handler = createUserAdminHandler(deps);
      const req: any = {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: {
          action: 'update',
          data: {
            id: 'usr_to_update',
            displayName: 'Target Staff Updated',
            permissionMode: 'CUSTOM',
            customPermissions: [],
          },
        },
      };

      let statusCode = 0;
      const headers: Record<string, string> = {};
      const res: any = {
        setHeader: (k: string, v: string) => { headers[k] = v; },
        status: (code: number) => { statusCode = code; return res; },
        json: () => res,
      };

      await handler(req, res);

      assert.equal(statusCode, 200);
      assert.ok(patchedProfile);
      assert.equal(patchedProfile.permissionMode, 'CUSTOM', 'Explicit CUSTOM permissionMode must be saved in profilePatch');
      assert.deepEqual(patchedProfile.customPermissions, []);
    });
  });

});
