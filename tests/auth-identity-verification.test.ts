import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateOcrAuthorization, OcrSecurityError, type AuthenticatedUser } from '../server/ocr-security.ts';
import { checkUserAdminPermission, type UserDoc } from '../server/user-admin-service.ts';

describe('Phase A - Correction 1: Authentication & Administrator Identity Verification', () => {

  // -------------------------------------------------------------------------
  // 1. Inactive & Unauthorized Identity Rejection
  // -------------------------------------------------------------------------
  describe('Account Status & Role Enforcement', () => {
    it('strictly rejects inactive users in OCR authorization (403 INACTIVE_USER)', () => {
      const inactiveUser: AuthenticatedUser = {
        id: 'user_inactive_1',
        role: 'STAFF',
        active: false,
        displayName: 'Inactive User',
      };
      assert.throws(
        () => validateOcrAuthorization(inactiveUser),
        (err: any) => err instanceof OcrSecurityError && err.status === 403 && err.code === 'INACTIVE_USER'
      );
    });

    it('strictly rejects inactive users in User Administration (403)', () => {
      const inactiveAdmin: UserDoc = {
        id: 'admin_inactive_1',
        username: 'inactive_admin@example.com',
        displayName: 'Inactive Admin',
        role: 'GM',
        branchId: '',
        active: false,
      };
      assert.throws(
        () => checkUserAdminPermission(inactiveAdmin, 'target_1', { role: 'STAFF' }, { role: 'STAFF' }, 'update'),
        (err: any) => err.status === 403 && err.message.includes('Inactive users cannot administer user accounts')
      );
    });

    it('rejects unauthorized roles (e.g. GUEST or unrecognized roles) (403 UNAUTHORIZED_ROLE)', () => {
      const guestUser: AuthenticatedUser = {
        id: 'user_guest',
        role: 'SUPPLIER_GUEST',
        active: true,
        displayName: 'Supplier Guest',
      };
      assert.throws(
        () => validateOcrAuthorization(guestUser),
        (err: any) => err instanceof OcrSecurityError && err.status === 403 && err.code === 'UNAUTHORIZED_ROLE'
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. Removal of Hardcoded Privilege Recovery
  // -------------------------------------------------------------------------
  describe('Hardcoded Privilege Recovery Removal', () => {
    it('does NOT elevate an unauthorized staff user even if display name matches an admin', () => {
      const staffUser: AuthenticatedUser = {
        id: 'arbitrary_uid_123',
        role: 'STAFF',
        active: true,
        displayName: 'HT Admin',
      };
      // Staff cannot perform admin operations regardless of their display name or email text
      const staffDoc: UserDoc = {
        id: 'arbitrary_uid_123',
        username: 'owner@gmail-com.example',
        displayName: 'HT Admin',
        role: 'STAFF',
        branchId: 'branch_ealing',
        active: true,
      };

      assert.throws(
        () => checkUserAdminPermission(staffDoc, 'target_2', { role: 'STAFF' }, { role: 'STAFF' }, 'update'),
        (err: any) => err.status === 403 && err.message.includes('do not have permission to administer')
      );
    });

    it('denies branch mismatch for non-enterprise roles even with similar naming', () => {
      const managerUser: AuthenticatedUser = {
        id: 'mgr_ealing',
        role: 'MANAGER',
        branchId: 'branch_ealing',
        active: true,
        displayName: 'Ealing Manager',
      };
      assert.throws(
        () => validateOcrAuthorization(managerUser, { branchId: 'branch_covent_garden' }),
        (err: any) => err instanceof OcrSecurityError && err.status === 403 && err.code === 'BRANCH_MISMATCH'
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Authorized Access Preservation
  // -------------------------------------------------------------------------
  describe('Preservation of Authorized Administrator Identities', () => {
    it('allows valid active CREATOR to administer accounts and scan documents', () => {
      const validCreator: AuthenticatedUser = {
        id: 'creator_valid',
        role: 'CREATOR',
        active: true,
        displayName: 'HT Creator',
      };
      assert.doesNotThrow(() => validateOcrAuthorization(validCreator, { branchId: 'branch_any' }));

      const creatorDoc: UserDoc = {
        id: 'creator_valid',
        username: 'creator@hareandtortoise-co-uk.example',
        displayName: 'HT Creator',
        role: 'CREATOR',
        branchId: '',
        active: true,
      };
      assert.doesNotThrow(() =>
        checkUserAdminPermission(creatorDoc, 'staff_1', { role: 'STAFF' }, { role: 'STAFF' }, 'update')
      );
    });

    it('allows valid active GM to administer accounts across branches', () => {
      const validGmDoc: UserDoc = {
        id: 'gm_valid',
        username: 'gm@hareandtortoise-co-uk.example',
        displayName: 'General Manager',
        role: 'GM',
        branchId: '',
        active: true,
      };
      assert.doesNotThrow(() =>
        checkUserAdminPermission(validGmDoc, 'staff_1', { role: 'STAFF', branchId: 'branch_soho' }, { role: 'STAFF' }, 'update')
      );
    });
  });
});
