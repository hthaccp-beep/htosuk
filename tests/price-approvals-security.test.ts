import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePriceNoticeCreation,
  validatePriceNoticeReview,
  validateNewItemNoticeCreation,
  validateNewItemNoticeResolution,
  validateGlobalSettingsUpdate,
  validatePriceHistoryCreation,
  PriceApprovalError,
  type AuthenticatedUser,
} from '../server/price-approval-service.ts';
import type { PriceChangeNotice, NewItemNotice, PriceHistoryRecord } from '../types.ts';

function createSamplePriceNotice(overrides: Partial<PriceChangeNotice> = {}): PriceChangeNotice {
  return {
    id: 'pcn_1001',
    productId: 'prod_salmon',
    productName: 'Fresh Salmon Fillet',
    itemCode: 'SALM-01',
    supplierId: 'sup_tazaki',
    supplierName: 'Tazaki Foods',
    oldCasePrice: 40.0,
    newCasePrice: 48.0,
    oldPackPrice: 0,
    newPackPrice: 0,
    priceDiff: 8.0,
    percentChange: 20.0,
    invoiceNumber: 'INV-2026-999',
    invoiceDate: '2026-09-28',
    detectedDate: '2026-09-29T08:00:00.000Z',
    status: 'PENDING',
    uploadedByUserId: 'usr_staff_ealing',
    uploadedByUserName: 'Alice Staff',
    ...overrides,
  };
}

function createSampleNewItemNotice(overrides: Partial<NewItemNotice> = {}): NewItemNotice {
  return {
    id: 'nin_2001',
    supplierId: 'sup_tazaki',
    supplierName: 'Tazaki Foods',
    rawDescription: 'Wagyu Beef Striploin A5',
    rawItemCode: 'WAGYU-A5',
    detectedCasePrice: 220.0,
    detectedPackPrice: 0,
    invoiceNumber: 'INV-2026-999',
    invoiceDate: '2026-09-28',
    detectedDate: '2026-09-29T08:00:00.000Z',
    status: 'PENDING',
    uploadedByUserId: 'usr_staff_ealing',
    uploadedByUserName: 'Alice Staff',
    ...overrides,
  };
}

describe('Price Approvals and Global Settings Permissions (Issue 6)', () => {
  // Actors
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
    permissions: [
      'approve_price_changes',
      'reject_price_changes',
      'manage_new_items',
      'manage_price_monitoring',
      'manage_roles',
    ],
  };

  const managerUser: AuthenticatedUser = {
    id: 'usr_manager',
    role: 'MANAGER',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Ealing Manager',
    permissions: [
      'approve_price_changes',
      'reject_price_changes',
      'manage_new_items',
    ],
  };

  const staffUser: AuthenticatedUser = {
    id: 'usr_staff_ealing',
    role: 'STAFF',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Alice Staff',
    permissions: ['scan_invoices'],
  };

  const supplierUser: AuthenticatedUser = {
    id: 'usr_supplier',
    role: 'STAFF',
    active: true,
    displayName: 'Supplier Rep',
    permissions: [],
  };

  const inactiveUser: AuthenticatedUser = {
    id: 'usr_inactive_gm',
    role: 'GM',
    active: false,
    displayName: 'Deactivated GM',
  };

  // =========================================================================
  // 1. PRICE CHANGE NOTICE PROPOSAL (CREATION)
  // =========================================================================
  describe('Price Change Notice Proposal', () => {
    it('allows active Staff to propose a price change notice from an invoice scan', () => {
      const notice = createSamplePriceNotice();
      const result = validatePriceNoticeCreation(staffUser, notice);
      assert.equal(result.id, 'pcn_1001');
      assert.equal(result.status, 'PENDING');
      assert.equal(result.uploadedByUserId, staffUser.id);
    });

    it('rejects proposing a notice with pre-approved status (403)', () => {
      const preApproved = createSamplePriceNotice({ status: 'APPROVED' });
      assert.throws(
        () => validatePriceNoticeCreation(staffUser, preApproved),
        (err: any) => err instanceof PriceApprovalError && err.status === 403
      );
    });

    it('rejects uploader identity mismatch (403)', () => {
      const spoofed = createSamplePriceNotice({ uploadedByUserId: 'usr_different_user' });
      assert.throws(
        () => validatePriceNoticeCreation(staffUser, spoofed),
        (err: any) => err instanceof PriceApprovalError && err.status === 403
      );
    });

    it('rejects proposal by inactive users (403)', () => {
      const notice = createSamplePriceNotice({ uploadedByUserId: inactiveUser.id });
      assert.throws(
        () => validatePriceNoticeCreation(inactiveUser, notice),
        (err: any) => err instanceof PriceApprovalError && err.status === 403
      );
    });

    it('rejects invalid or missing price data (400)', () => {
      // Negative new price
      assert.throws(
        () => validatePriceNoticeCreation(staffUser, createSamplePriceNotice({ newCasePrice: -10 })),
        (err: any) => err.status === 400
      );
      // Missing productId
      assert.throws(
        () => validatePriceNoticeCreation(staffUser, createSamplePriceNotice({ productId: '' })),
        (err: any) => err.status === 400
      );
      // Missing invoiceNumber
      assert.throws(
        () => validatePriceNoticeCreation(staffUser, createSamplePriceNotice({ invoiceNumber: '' })),
        (err: any) => err.status === 400
      );
    });
  });

  // =========================================================================
  // 2. PRICE CHANGE NOTICE REVIEW (APPROVE & REJECT)
  // =========================================================================
  describe('Price Change Review Authorization', () => {
    const pendingNotice = createSamplePriceNotice();

    it('allows GM and Creator to approve pending price changes', () => {
      const updatePayload: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: gmUser.id,
        reviewedByUserName: gmUser.displayName,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
        notes: 'Verified against contract increase.',
      };

      const result = validatePriceNoticeReview(gmUser, pendingNotice, updatePayload);
      assert.equal(result.status, 'APPROVED');
      assert.equal(result.reviewedByUserId, gmUser.id);
      assert.equal(result.effectiveDate, '2026-10-01');
    });

    it('allows Manager to approve pending price changes', () => {
      const updatePayload: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: managerUser.id,
        reviewedByUserName: managerUser.displayName,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
      };

      const result = validatePriceNoticeReview(managerUser, pendingNotice, updatePayload);
      assert.equal(result.status, 'APPROVED');
    });

    it('denies Staff from approving price changes (403)', () => {
      const updatePayload: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: staffUser.id,
        reviewedByUserName: staffUser.displayName,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
      };

      assert.throws(
        () => validatePriceNoticeReview(staffUser, pendingNotice, updatePayload),
        (err: any) => err.status === 403 && err.message.includes('permission to approve')
      );
    });

    it('denies linked supplier from approving or reviewing price changes (403)', () => {
      const updatePayload: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: supplierUser.id,
        reviewedByUserName: supplierUser.displayName,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
      };

      assert.throws(
        () => validatePriceNoticeReview(supplierUser, pendingNotice, updatePayload),
        (err: any) => err.status === 403
      );
    });

    it('prevents non-admin self-approval of proposed price increases (403)', () => {
      // Notice uploaded by Manager themselves
      const managerNotice = createSamplePriceNotice({
        uploadedByUserId: managerUser.id,
        oldCasePrice: 40.0,
        newCasePrice: 50.0, // Increase!
      });

      const approveAttempt: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: managerUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
      };

      assert.throws(
        () => validatePriceNoticeReview(managerUser, managerNotice, approveAttempt),
        (err: any) => err.status === 403 && err.message.includes('Non-admin users cannot approve their own proposed price increases')
      );
    });

    it('enforces reviewer identity match (403)', () => {
      const spoofedReviewer: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: 'usr_different_actor', // Caller is gmUser, but payload claims another ID
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
      };

      assert.throws(
        () => validatePriceNoticeReview(gmUser, pendingNotice, spoofedReviewer),
        (err: any) => err.status === 403 && err.message.includes('Reviewer identity mismatch')
      );
    });

    it('requires effectiveDate on approval (400)', () => {
      const missingDate: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: gmUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '',
      };

      assert.throws(
        () => validatePriceNoticeReview(gmUser, pendingNotice, missingDate),
        (err: any) => err.status === 400 && err.message.includes('Effective date is required')
      );
    });

    it('requires rejectionReason on rejection (400)', () => {
      const missingReason: Partial<PriceChangeNotice> = {
        status: 'REJECTED',
        reviewedByUserId: gmUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        rejectionReason: '',
      };

      assert.throws(
        () => validatePriceNoticeReview(gmUser, pendingNotice, missingReason),
        (err: any) => err.status === 400 && err.message.includes('Rejection reason is required')
      );
    });

    it('protects core detection facts against mutation during review (403)', () => {
      const tamperedPrice: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: gmUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
        newCasePrice: 999.0, // Tampering with detected invoice price!
      };

      assert.throws(
        () => validatePriceNoticeReview(gmUser, pendingNotice, tamperedPrice),
        (err: any) => err.status === 403 && err.message.includes('Detected new price cannot be altered')
      );
    });
  });

  // =========================================================================
  // 3. DECISION IMMUTABILITY & CONCURRENT REVIEW CONFLICT PROTECTION
  // =========================================================================
  describe('Decision Immutability & Conflict Guards', () => {
    it('prevents modifying or re-reviewing an already APPROVED notice (409 Conflict)', () => {
      const approvedNotice = createSamplePriceNotice({
        status: 'APPROVED',
        reviewedByUserId: gmUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        effectiveDate: '2026-10-01',
      });

      const secondAttempt: Partial<PriceChangeNotice> = {
        status: 'REJECTED',
        reviewedByUserId: managerUser.id,
        reviewedAt: '2026-09-29T11:00:00.000Z',
        rejectionReason: 'Changed my mind.',
      };

      assert.throws(
        () => validatePriceNoticeReview(managerUser, approvedNotice, secondAttempt),
        (err: any) => err.status === 409 && err.message.includes('already finalized as "APPROVED"')
      );
    });

    it('prevents modifying or re-reviewing an already REJECTED notice (409 Conflict)', () => {
      const rejectedNotice = createSamplePriceNotice({
        status: 'REJECTED',
        reviewedByUserId: gmUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
        rejectionReason: 'Wrong supplier code.',
      });

      const secondAttempt: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: creatorUser.id,
        reviewedAt: '2026-09-29T11:00:00.000Z',
        effectiveDate: '2026-10-01',
      };

      assert.throws(
        () => validatePriceNoticeReview(creatorUser, rejectedNotice, secondAttempt),
        (err: any) => err.status === 409 && err.message.includes('already finalized as "REJECTED"')
      );
    });
  });

  // =========================================================================
  // 4. NEW ITEM NOTICES AUTHORIZATION
  // =========================================================================
  describe('New Item Notices Resolution', () => {
    const pendingNewItem = createSampleNewItemNotice();

    it('allows Manager/Admin to resolve new item notice to ADDED with product data', () => {
      const update: Partial<NewItemNotice> = {
        status: 'ADDED',
        createdProductId: 'prod_wagyu_new',
        reviewedByUserId: managerUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
      };

      const result = validateNewItemNoticeResolution(managerUser, pendingNewItem, update);
      assert.equal(result.status, 'ADDED');
      assert.equal(result.createdProductId, 'prod_wagyu_new');
    });

    it('allows Manager/Admin to resolve new item notice to LINKED with existing productId', () => {
      const update: Partial<NewItemNotice> = {
        status: 'LINKED',
        linkedProductId: 'prod_existing_beef',
        reviewedByUserId: gmUser.id,
        reviewedAt: '2026-09-29T10:00:00.000Z',
      };

      const result = validateNewItemNoticeResolution(gmUser, pendingNewItem, update);
      assert.equal(result.status, 'LINKED');
      assert.equal(result.linkedProductId, 'prod_existing_beef');
    });

    it('denies Staff from resolving new item notices (403)', () => {
      const update: Partial<NewItemNotice> = {
        status: 'ADDED',
        createdProductId: 'prod_test',
        reviewedByUserId: staffUser.id,
      };

      assert.throws(
        () => validateNewItemNoticeResolution(staffUser, pendingNewItem, update),
        (err: any) => err.status === 403
      );
    });

    it('prevents re-resolving an already processed new item notice (409 Conflict)', () => {
      const resolved = createSampleNewItemNotice({
        status: 'ADDED',
        createdProductId: 'prod_wagyu_new',
      });

      const update: Partial<NewItemNotice> = {
        status: 'REJECTED',
        reviewedByUserId: gmUser.id,
        rejectionReason: 'Duplicate entry.',
      };

      assert.throws(
        () => validateNewItemNoticeResolution(gmUser, resolved, update),
        (err: any) => err.status === 409
      );
    });
  });

  // =========================================================================
  // 5. GLOBAL SETTINGS PERMISSIONS VS BRANCH CONFIGURATION
  // =========================================================================
  describe('Global Settings Permissions', () => {
    it('allows General Manager and Creator to update global settings', () => {
      const payload = { enabled: true, alertOnPercentageThreshold: 10 };
      const resGM = validateGlobalSettingsUpdate(gmUser, 'price_monitoring', payload);
      assert.equal(resGM.alertOnPercentageThreshold, 10);

      const resCreator = validateGlobalSettingsUpdate(creatorUser, 'role_permissions', { map: {} });
      assert.ok(resCreator);
    });

    it('denies Branch Manager from modifying global system settings (403)', () => {
      const payload = { enabled: false };
      // Manager cannot modify global price monitoring
      assert.throws(
        () => validateGlobalSettingsUpdate(managerUser, 'price_monitoring', payload),
        (err: any) => err.status === 403 && err.message.includes('Only General Managers and Creators')
      );

      // Manager cannot modify role permissions
      assert.throws(
        () => validateGlobalSettingsUpdate(managerUser, 'role_permissions', { map: {} }),
        (err: any) => err.status === 403
      );

      // Manager cannot modify global email configuration
      assert.throws(
        () => validateGlobalSettingsUpdate(managerUser, 'email_config', {}),
        (err: any) => err.status === 403
      );
    });

    it('denies Staff from modifying any global settings (403)', () => {
      assert.throws(
        () => validateGlobalSettingsUpdate(staffUser, 'price_monitoring', {}),
        (err: any) => err.status === 403
      );
    });
  });

  // =========================================================================
  // 6. PRICE HISTORY AUDIT TRAIL IMMUTABILITY
  // =========================================================================
  describe('Price History Audit Trail', () => {
    it('creates tamper-proof price history entry on approval', () => {
      const record: Partial<PriceHistoryRecord> = {
        id: 'hist_101',
        productId: 'prod_salmon',
        productName: 'Fresh Salmon',
        supplierId: 'sup_tazaki',
        supplierName: 'Tazaki Foods',
        previousCasePrice: 40.0,
        newCasePrice: 48.0,
        previousPackPrice: 0,
        newPackPrice: 0,
        effectiveDate: '2026-10-01',
        invoiceRef: 'INV-2026-999',
        approvedByUserId: gmUser.id,
        approvedByUserName: gmUser.displayName,
        approvedAt: '2026-09-29T10:00:00.000Z',
      };

      const res = validatePriceHistoryCreation(gmUser, record);
      assert.equal(res.id, 'hist_101');
      assert.equal(res.approvedByUserId, gmUser.id);
    });

    it('rejects price history record if approvedByUserId does not match caller (403)', () => {
      const spoofed: Partial<PriceHistoryRecord> = {
        id: 'hist_102',
        productId: 'prod_salmon',
        approvedByUserId: 'usr_different_user',
        effectiveDate: '2026-10-01',
      };

      assert.throws(
        () => validatePriceHistoryCreation(gmUser, spoofed),
        (err: any) => err.status === 403 && err.message.includes('Audit record author must match')
      );
    });

    it('denies Staff from creating price history records (403)', () => {
      const record: Partial<PriceHistoryRecord> = {
        id: 'hist_103',
        productId: 'prod_salmon',
        approvedByUserId: staffUser.id,
        effectiveDate: '2026-10-01',
      };

      assert.throws(
        () => validatePriceHistoryCreation(staffUser, record),
        (err: any) => err.status === 403
      );
    });
  });
});
