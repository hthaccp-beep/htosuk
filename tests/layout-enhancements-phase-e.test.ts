import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasActionPermission,
  getUserSupplierBranches,
} from '../utils/accessControl.ts';

import {
  formatRoleName,
  APP_TITLE,
  SEED_ROLES,
} from '../constants.ts';

import {
  calculateParOrderSuggestions,
  findAlternativeSupplierOptions,
  calculateIngredientInflation,
} from '../utils/orderingEnhancements.ts';

import {
  renderAuthoritativeOrderEmailHtml,
  renderCreditClaimEmailHtml,
  createOutboxItemRecord,
  calculateNextRetryDelaySeconds,
} from '../server/email-outbox-service.ts';

import { generateCreditClaimPdf } from '../utils/creditClaimPdf.ts';

import {
  findDuePriceNotices,
  activateDuePriceNotices,
} from '../utils/priceScheduler.ts';

import {
  createAuditLogEntry,
  sanitizeAuditDetails,
} from '../server/audit-log-service.ts';

import type {
  User,
  Branch,
  Supplier,
  Product,
  OrderRecord,
  CreditNoteClaim,
  PriceChangeNotice,
  PriceHistoryRecord,
  RoleDefinition,
} from '../types.ts';

describe('Phase E: Layout Architecture, User Experience & System Enhancements', () => {

  const centralKitchenBranch: Branch = {
    id: 'branch_kitchen',
    name: 'Central Prep Kitchen & Bakery',
    code: 'CKB',
    contactEmail: 'prep@restaurant-co-uk.example',
    active: true,
    actsAsSupplier: true,
  };

  const highStreetBranch: Branch = {
    id: 'branch_highstreet',
    name: 'High Street Branch',
    code: 'HSB',
    contactEmail: 'highst@restaurant-co-uk.example',
    active: true,
    actsAsSupplier: false,
  };

  const branches = [centralKitchenBranch, highStreetBranch];

  const creatorUser: User = {
    id: 'user_creator',
    username: 'creator',
    displayName: 'Master Admin',
    role: 'CREATOR',
    branchId: 'ALL',
    active: true,
  };

  const managerUser: User = {
    id: 'user_mgr',
    username: 'mgr_hs',
    displayName: 'Branch Manager Dave',
    role: 'MANAGER',
    branchId: 'branch_highstreet',
    active: true,
  };

  const kitchenManagerUser: User = {
    id: 'user_kitchen_mgr',
    username: 'kmgr',
    displayName: 'Kitchen Lead Chef',
    role: 'MANAGER',
    branchId: 'branch_kitchen',
    active: true,
  };

  const staffUser: User = {
    id: 'user_staff',
    username: 'staff_alice',
    displayName: 'Alice Staff',
    role: 'STAFF',
    branchId: 'branch_highstreet',
    active: true,
  };

  // ---------------------------------------------------------------------------
  // 1. Navigation & Layout Role-Based Access Controls
  // ---------------------------------------------------------------------------
  describe('1. Layout Navigation & Access Filtering', () => {
    it('determines incoming orders tab visibility based on supplier branch assignment', () => {
      // Creator can view all supplier branches
      const creatorSupplierBranches = getUserSupplierBranches(creatorUser, branches);
      assert.equal(creatorSupplierBranches.length, 1);
      assert.equal(creatorSupplierBranches[0].id, 'branch_kitchen');
      assert.ok(hasActionPermission(creatorUser, 'view_received_orders'));

      // Manager at highstreet has no supplier branch
      const hsManagerBranches = getUserSupplierBranches(managerUser, branches);
      assert.equal(hsManagerBranches.length, 0);

      // Kitchen Manager assigned to a supplier branch has access if granted permission
      const kitchenManagerBranches = getUserSupplierBranches(kitchenManagerUser, branches);
      assert.equal(kitchenManagerBranches.length, 1);
      assert.equal(kitchenManagerBranches[0].id, 'branch_kitchen');
    });

    it('correctly calculates pending notices badge count across price & new item notices', () => {
      const priceNotices: PriceChangeNotice[] = [
        {
          id: 'pn_1',
          productId: 'p_1',
          productName: 'Kikkoman Soy Sauce',
          supplierId: 's_1',
          supplierName: 'Harro Foods',
          oldCasePrice: 10,
          newCasePrice: 12,
          oldPackPrice: 0,
          newPackPrice: 0,
          priceDiff: 2,
          percentChange: 20,
          invoiceNumber: 'INV-101',
          invoiceDate: '2026-10-01',
          effectiveDate: '2026-10-10',
          detectedDate: '2026-10-01',
          status: 'PENDING',
          uploadedByUserId: 'u_1',
          uploadedByUserName: 'Staff',
        },
        {
          id: 'pn_2',
          productId: 'p_2',
          productName: 'Nishiki Rice',
          supplierId: 's_1',
          supplierName: 'Harro Foods',
          oldCasePrice: 20,
          newCasePrice: 22,
          oldPackPrice: 0,
          newPackPrice: 0,
          priceDiff: 2,
          percentChange: 10,
          invoiceNumber: 'INV-102',
          invoiceDate: '2026-10-01',
          effectiveDate: '2026-10-10',
          detectedDate: '2026-10-01',
          status: 'APPROVED',
          uploadedByUserId: 'u_1',
          uploadedByUserName: 'Staff',
        },
      ];

      const newItemNotices = [
        {
          id: 'nin_1',
          supplierId: 's_1',
          detectedItemCode: 'NEW-001',
          detectedDescription: 'New Wasabi Paste',
          detectedCasePrice: 15.0,
          detectedDate: '2026-10-01',
          status: 'PENDING' as const,
          uploadedByUserId: 'u_1',
          uploadedByUserName: 'Staff',
        },
      ];

      const pendingBadgeCount =
        priceNotices.filter((n) => n.status === 'PENDING').length +
        newItemNotices.filter((n) => n.status === 'PENDING').length;

      assert.equal(pendingBadgeCount, 2);
    });

    it('formats role names and application titles appropriately', () => {
      assert.equal(formatRoleName('CREATOR', SEED_ROLES), 'Admin');
      assert.equal(formatRoleName('GM', SEED_ROLES), 'General Manager');
      assert.equal(formatRoleName('MANAGER', SEED_ROLES), 'Branch Manager');
      assert.equal(formatRoleName('STAFF', SEED_ROLES), 'Staff');
      assert.ok(APP_TITLE.length > 0);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Par Replenishment & Ordering Enhancements
  // ---------------------------------------------------------------------------
  describe('2. Ordering Enhancements & Replenishment Logic', () => {
    it('calculates replenishment shortfall respecting par levels and stock on hand', () => {
      const products: Product[] = [
        {
          id: 'prod_rice',
          name: 'Sushi Rice 20kg',
          itemCode: 'RICE-01',
          categoryId: 'cat_dry',
          supplierId: 'sup_harro',
          casePrice: 32.50,
          packPrice: 0,
          caseUnitName: 'Bag (20kg)',
          unitType: 'CASE_ONLY',
          displayOrder: 1,
          allowedBranchIds: [],
          active: true,
          minParLevel: 3,
          targetParLevel: 10,
        },
        {
          id: 'prod_nori',
          name: 'Nori Sheets 100pk',
          itemCode: 'NORI-01',
          categoryId: 'cat_dry',
          supplierId: 'sup_harro',
          casePrice: 18.00,
          packPrice: 0,
          caseUnitName: 'Pack (100)',
          unitType: 'CASE_ONLY',
          displayOrder: 2,
          allowedBranchIds: [],
          active: true,
          minParLevel: 2,
          targetParLevel: 5,
        },
      ];

      const currentStockOnHand: Record<string, number> = {
        prod_rice: 2, // Below min (3), needs 8 to reach target (10)
        prod_nori: 6, // Above target (5), no replenishment
      };

      const suggestions = calculateParOrderSuggestions(products, currentStockOnHand);

      assert.ok(suggestions['prod_rice']);
      assert.equal(suggestions['prod_rice'].suggestedCases, 8);
      assert.equal(suggestions['prod_rice'].isBelowMin, true);
      assert.equal(suggestions['prod_nori'].suggestedCases, 0);
      assert.equal(suggestions['prod_nori'].isBelowMin, false);
    });

    it('identifies cheaper alternative vendors across catalogs for identical product code', () => {
      const currentSupplier: Supplier = {
        id: 'sup_current',
        name: 'Current Vendor Ltd',
        email: 'orders@current-co-uk.example',
        active: true,
        deliveryRules: {},
        deliverySchedules: {},
      };

      const altSupplier: Supplier = {
        id: 'sup_alt',
        name: 'Direct Wholesale Ltd',
        email: 'orders@direct-co-uk.example',
        active: true,
        deliveryRules: {},
        deliverySchedules: {},
      };

      const allSuppliers = [currentSupplier, altSupplier];

      const catalog: Product[] = [
        {
          id: 'p_curr',
          name: 'Kikkoman Soy Sauce 18L',
          itemCode: 'KIKKO-18L',
          categoryId: 'cat_sauce',
          supplierId: 'sup_current',
          casePrice: 48.00,
          packPrice: 0,
          caseUnitName: 'Can (18L)',
          unitType: 'CASE_ONLY',
          displayOrder: 1,
          allowedBranchIds: [],
          active: true,
        },
        {
          id: 'p_cheaper',
          name: 'Kikkoman Soy Sauce 18L',
          itemCode: 'KIKKO-18L',
          categoryId: 'cat_sauce',
          supplierId: 'sup_alt',
          casePrice: 42.00, // £6 cheaper
          packPrice: 0,
          caseUnitName: 'Can (18L)',
          unitType: 'CASE_ONLY',
          displayOrder: 1,
          allowedBranchIds: [],
          active: true,
        },
      ];

      const currentProduct = catalog[0];
      const alternatives = findAlternativeSupplierOptions(currentProduct, catalog, allSuppliers);

      assert.equal(alternatives.length, 1);
      assert.equal(alternatives[0].supplierName, 'Direct Wholesale Ltd');
      assert.equal(alternatives[0].isCheaper, true);
      assert.equal(alternatives[0].priceDiff, 6.00);
      assert.equal(alternatives[0].percentSavings, 12.5);
    });

    it('tracks historical price inflation across ingredient revisions accurately', () => {
      const history: PriceHistoryRecord[] = [
        {
          id: 'ph_1',
          productId: 'prod_salmon',
          productName: 'Fresh Scottish Salmon 5kg',
          supplierId: 'sup_fish',
          supplierName: 'Seafood Express',
          previousCasePrice: 100.00,
          newCasePrice: 110.00,
          previousPackPrice: 0,
          newPackPrice: 0,
          effectiveDate: '2026-01-01',
          invoiceRef: 'INV-1',
          approvedByUserId: 'admin_1',
          approvedByUserName: 'Admin',
          approvedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'ph_2',
          productId: 'prod_salmon',
          productName: 'Fresh Scottish Salmon 5kg',
          supplierId: 'sup_fish',
          supplierName: 'Seafood Express',
          previousCasePrice: 110.00,
          newCasePrice: 125.00,
          previousPackPrice: 0,
          newPackPrice: 0,
          effectiveDate: '2026-06-01',
          invoiceRef: 'INV-2',
          approvedByUserId: 'admin_1',
          approvedByUserName: 'Admin',
          approvedAt: '2026-06-01T00:00:00Z',
        },
      ];

      const products: Product[] = [
        {
          id: 'prod_salmon',
          name: 'Fresh Scottish Salmon 5kg',
          casePrice: 125.00,
          categoryId: 'cat_fish',
          supplierId: 'sup_fish',
          displayOrder: 1,
          allowedBranchIds: [],
          active: true,
        },
      ];

      const inflation = calculateIngredientInflation(history, products);
      assert.equal(inflation.length, 1);
      assert.equal(inflation[0].earliestPrice, 100.00);
      assert.equal(inflation[0].currentPrice, 125.00);
      assert.equal(inflation[0].priceDelta, 25.00);
      assert.equal(inflation[0].percentInflation, 25.0);
      assert.equal(inflation[0].historyEntriesCount, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Email Outbox, PDF Claims & Audit Logging
  // ---------------------------------------------------------------------------
  describe('3. Transactional Outbox, PDF Claims & Server Auditing', () => {
    it('creates transactional outbox records and computes exponential retry backoffs', () => {
      const outboxItem = createOutboxItemRecord({
        orderId: 'ord_sample_1',
        type: 'ORDER_CONFIRMATION',
        recipientEmail: 'supplier@example-co-uk.example',
        ccEmails: ['branch@hareandtortoise-co-uk.example'],
        subject: 'Purchase Order #123',
        idempotencyKey: 'idem_ord_sample_1_attempt_1',
      });

      assert.equal(outboxItem.status, 'PENDING');
      assert.equal(outboxItem.retryCount, 0);
      assert.equal(outboxItem.idempotencyKey, 'idem_ord_sample_1_attempt_1');

      // Exponential backoff check
      const delay1 = calculateNextRetryDelaySeconds(0);
      const delay2 = calculateNextRetryDelaySeconds(1);
      const delay3 = calculateNextRetryDelaySeconds(2);

      assert.equal(delay1, 60);
      assert.equal(delay2, 300);
      assert.equal(delay3, 900);
    });

    it('generates compliant official credit claim PDF representation', () => {
      const sampleClaim: CreditNoteClaim = {
        cnRef: 'CN-BLM-2026-101',
        claimDate: '2026-10-01',
        invoiceNumber: 'INV-887766',
        invoiceDate: '2026-09-30',
        totalClaimAmount: 39.00,
        supplierEmail: 'disputes@tazaki-com.example',
        branchCcEmail: 'bloomsbury@hareandtortoise-co-uk.example',
        notes: 'Damaged soy sauce tub leaking upon pallet drop.',
        items: [
          {
            id: 'c1',
            itemCode: 'B0036',
            description: 'Kikkoman Soy Sauce 20L',
            issueType: 'DAMAGED',
            orderedQtyStr: '2 Tubs',
            deliveredQtyStr: '1 Tub (Damaged)',
            expectedPrice: 39.00,
            invoicedPrice: 39.00,
            claimAmount: 39.00,
          },
        ],
      };

      const result = generateCreditClaimPdf(sampleClaim);
      assert.ok(result.doc);
      assert.ok(result.base64.length > 500);
      assert.equal(result.fileName, 'Credit_Claim_CN-BLM-2026-101_HT.pdf');
    });

    it('creates immutable server audit logs and sanitizes credentials and sensitive tokens', () => {
      const auditLog = createAuditLogEntry({
        userId: 'user_creator',
        userEmail: 'admin@hareandtortoise-co-uk.example',
        userName: 'Executive Chef',
        action: 'APPROVE_PRICE_INCREASE',
        entityType: 'PRICE',
        entityId: 'p_salmon',
        branchId: 'b_bloomsbury',
        details: {
          oldPrice: 100.00,
          newPrice: 120.00,
          supplier: 'Fish Ltd',
          smtpPass: 'supersecretpass123',
          passwordHash: 'secret_hash_value',
        },
      });

      assert.ok(auditLog.id.startsWith('audit_'));
      assert.equal(auditLog.action, 'APPROVE_PRICE_INCREASE');
      assert.equal(auditLog.entityType, 'PRICE');
      assert.equal(auditLog.details.oldPrice, 100.00);
      assert.equal(auditLog.details.newPrice, 120.00);
      assert.equal(auditLog.details.smtpPass, '[REDACTED]');
      assert.equal(auditLog.details.passwordHash, '[REDACTED]');
    });
  });
});
