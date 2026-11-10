import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  matchExtractedItem,
  comparePrices,
  stringSimilarity,
  tokenOverlapScore,
  type MatchedResult,
  type PriceComparisonResult,
} from '../utils/priceMatching.ts';

import {
  validatePriceNoticeCreation,
  validatePriceNoticeReview,
  validateNewItemNoticeCreation,
  validateNewItemNoticeResolution,
  PriceApprovalError,
  type AuthenticatedUser,
} from '../server/price-approval-service.ts';

import {
  findDuePriceNotices,
  activateDuePriceNotices,
} from '../utils/priceScheduler.ts';

import {
  calculateOrderTotals,
} from '../utils/orderPricing.ts';

import {
  reconcileSingleLine,
  calculateOrderReconciliation,
  sanitizeVerificationUpdates,
  roundCurrency,
  type ReconciledLineInput,
} from '../utils/invoiceReconciliation.ts';

import type {
  Product,
  PriceChangeNotice,
  NewItemNotice,
  PriceMonitoringSettings,
  OrderRecord,
  OrderItem,
  ManualOrderItem,
} from '../types.ts';

describe('Phase B: Invoice and Price Accuracy Verification', () => {

  const sampleProducts: Product[] = [
    {
      id: 'prod_salmon_1kg',
      name: 'Fresh Atlantic Salmon Fillet',
      itemCode: 'SALM-01',
      categoryId: 'cat_seafood',
      supplierId: 'sup_tazaki',
      active: true,
      casePrice: 40.00,
      packPrice: 10.00,
      caseUnitName: 'Case (4x1kg)',
      packUnitName: 'Fillet (1kg)',
      unitType: 'DUAL',
      displayOrder: 1,
      allowedBranchIds: [],
      vatRate: 0,
    },
    {
      id: 'prod_soy_sauce',
      name: 'Kikkoman Soy Sauce 1L',
      itemCode: 'SOY-101',
      categoryId: 'cat_condiments',
      supplierId: 'sup_tazaki',
      active: true,
      casePrice: 30.00,
      packPrice: 5.50,
      caseUnitName: 'Case (6x1L)',
      packUnitName: 'Bottle (1L)',
      unitType: 'DUAL',
      displayOrder: 2,
      allowedBranchIds: [],
      vatRate: 0,
    },
    {
      id: 'prod_bleach',
      name: 'Commercial Disinfectant Cleaner 5L',
      itemCode: 'CHEM-50',
      categoryId: 'cat_cleaning',
      supplierId: 'sup_tazaki',
      active: true,
      casePrice: 20.00,
      packPrice: 0,
      unitType: 'CASE_ONLY',
      displayOrder: 3,
      allowedBranchIds: [],
      vatRate: 0.20, // 20% VAT
    },
  ];

  const defaultMonitoringSettings: PriceMonitoringSettings = {
    enabled: true,
    autoDetectPriceChanges: true,
    autoDetectNewItems: true,
    requireManagerApproval: true,
    alertOnPercentageThreshold: 5.0, // Alert on >5% change
    enableEmailAlerts: false,
  };

  const creatorUser: AuthenticatedUser = {
    id: 'usr_creator',
    role: 'CREATOR',
    active: true,
    displayName: 'Head Creator',
  };

  const managerUser: AuthenticatedUser = {
    id: 'usr_manager',
    role: 'MANAGER',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Branch Manager',
    permissions: ['approve_price_changes', 'reject_price_changes', 'manage_new_items'],
  };

  const staffUser: AuthenticatedUser = {
    id: 'usr_staff',
    role: 'STAFF',
    branchId: 'branch_ealing',
    active: true,
    displayName: 'Alice Staff',
    permissions: ['scan_invoices'],
  };

  // ---------------------------------------------------------------------------
  // 1. INVOICE OCR MATCHING & PRICE COMPARISON ACCURACY
  // ---------------------------------------------------------------------------
  describe('1. Invoice OCR Extraction Matching & Comparison', () => {
    it('accurately matches exact itemCode directly to catalog product', () => {
      const match = matchExtractedItem('Fresh Salmon Pack', 'SALM-01', 'sup_tazaki', sampleProducts);
      assert.ok(match.product);
      assert.equal(match.product.id, 'prod_salmon_1kg');
      assert.equal(match.matchReason, 'EXACT_CODE');
      assert.equal(match.confidence, 99);
    });

    it('matches product by high similarity description when itemCode is missing or different', () => {
      const match = matchExtractedItem('Fresh Atlantic Salmon Fillets', undefined, 'sup_tazaki', sampleProducts);
      assert.ok(match.product);
      assert.equal(match.product.id, 'prod_salmon_1kg');
      assert.ok(match.confidence >= 70);
    });

    it('detects price increases exceeding threshold and flags them correctly', () => {
      const product = sampleProducts[0]; // case: 40.00
      const comparison = comparePrices(48.00, 0, product, defaultMonitoringSettings);

      assert.equal(comparison.hasPriceChange, true);
      assert.equal(comparison.priceDiff, 8.00);
      assert.equal(comparison.percentChange, 20.0);
      assert.equal(comparison.significantAlert, true);
    });

    it('flags unrecognised items as NEW_ITEM and identifies possible duplicate candidates', () => {
      const match = matchExtractedItem('Organic Wild Atlantic Salmon Fillet A-Grade', 'NEW-SALM', 'sup_tazaki', sampleProducts);
      // New item, but has similarity to existing salmon
      assert.ok(match.possibleDuplicates.length > 0);
      assert.equal(match.possibleDuplicates[0].product.id, 'prod_salmon_1kg');
      assert.ok(match.possibleDuplicates[0].score >= 40);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. PRICE APPROVAL LIFECYCLE & EFFECTIVE DATE SCHEDULING
  // ---------------------------------------------------------------------------
  describe('2. Price Approval Lifecycle & Effective Date Scheduling', () => {
    it('creates a validated pending price change notice', () => {
      const notice: PriceChangeNotice = {
        id: 'pcn_test_01',
        productId: 'prod_salmon_1kg',
        productName: 'Fresh Atlantic Salmon Fillet',
        itemCode: 'SALM-01',
        supplierId: 'sup_tazaki',
        supplierName: 'Tazaki Foods',
        oldCasePrice: 40.00,
        newCasePrice: 48.00,
        oldPackPrice: 10.00,
        newPackPrice: 12.00,
        priceDiff: 8.00,
        percentChange: 20.0,
        invoiceNumber: 'INV-2026-001',
        invoiceDate: '2026-10-01',
        detectedDate: '2026-10-01T10:00:00Z',
        status: 'PENDING',
        uploadedByUserId: staffUser.id,
        uploadedByUserName: staffUser.displayName || 'Alice Staff',
      };

      const result = validatePriceNoticeCreation(staffUser, notice);
      assert.equal(result.status, 'PENDING');
      assert.equal(result.uploadedByUserId, staffUser.id);
    });

    it('prohibits non-admin staff from approving their own proposed price increases', () => {
      const notice: PriceChangeNotice = {
        id: 'pcn_test_02',
        productId: 'prod_salmon_1kg',
        productName: 'Fresh Atlantic Salmon Fillet',
        supplierId: 'sup_tazaki',
        supplierName: 'Tazaki Foods',
        oldCasePrice: 40.00,
        newCasePrice: 48.00, // Price increase
        oldPackPrice: 10.00,
        newPackPrice: 12.00,
        priceDiff: 8.00,
        percentChange: 20.0,
        invoiceNumber: 'INV-2026-002',
        invoiceDate: '2026-10-01',
        detectedDate: '2026-10-01T10:00:00Z',
        status: 'PENDING',
        uploadedByUserId: managerUser.id, // Manager proposed it
        uploadedByUserName: managerUser.displayName || 'Branch Manager',
      };

      const reviewPayload: Partial<PriceChangeNotice> = {
        status: 'APPROVED',
        reviewedByUserId: managerUser.id,
        reviewedAt: '2026-10-01T11:00:00Z',
      };

      assert.throws(
        () => validatePriceNoticeReview(managerUser, notice, reviewPayload),
        (err: any) => err instanceof PriceApprovalError && err.status === 403
      );
    });

    it('allows Manager to approve notices with future effectiveDate without mutating current catalog prematurely', () => {
      const notice: PriceChangeNotice = {
        id: 'pcn_future_01',
        productId: 'prod_salmon_1kg',
        productName: 'Fresh Atlantic Salmon Fillet',
        supplierId: 'sup_tazaki',
        supplierName: 'Tazaki Foods',
        oldCasePrice: 40.00,
        newCasePrice: 45.00,
        oldPackPrice: 10.00,
        newPackPrice: 11.25,
        priceDiff: 5.00,
        percentChange: 12.5,
        invoiceNumber: 'INV-2026-900',
        invoiceDate: '2026-10-01',
        detectedDate: '2026-10-01T10:00:00Z',
        status: 'PENDING',
        uploadedByUserId: staffUser.id,
        uploadedByUserName: staffUser.displayName || 'Alice Staff',
      };

      const approvedNotice = validatePriceNoticeReview(managerUser, notice, {
        status: 'APPROVED',
        reviewedByUserId: managerUser.id,
        reviewedByUserName: managerUser.displayName || 'Branch Manager',
        reviewedAt: '2026-10-01T10:00:00Z',
        effectiveDate: '2026-11-01', // Future effective date
      });

      assert.equal(approvedNotice.status, 'APPROVED');
      assert.equal(approvedNotice.effectiveDate, '2026-11-01');

      // The catalog products remain at their current price before the effective date
      const scheduledCheck = activateDuePriceNotices({
        notices: [approvedNotice],
        products: sampleProducts,
        currentDateIso: '2026-10-04', // Today is before Nov 1
      });

      assert.equal(scheduledCheck.appliedNoticeIds.length, 0);
      assert.equal(scheduledCheck.updatedProducts.find(p => p.id === 'prod_salmon_1kg')?.casePrice, 40.00);

      // On or after effective date, the scheduler activates the price
      const effectiveCheck = activateDuePriceNotices({
        notices: [approvedNotice],
        products: sampleProducts,
        currentDateIso: '2026-11-01',
      });

      assert.equal(effectiveCheck.appliedNoticeIds.length, 1);
      assert.equal(effectiveCheck.updatedProducts.find(p => p.id === 'prod_salmon_1kg')?.casePrice, 45.00);
      assert.equal(effectiveCheck.generatedHistoryRecords.length, 1);
      assert.equal(effectiveCheck.generatedHistoryRecords[0].previousCasePrice, 40.00);
      assert.equal(effectiveCheck.generatedHistoryRecords[0].newCasePrice, 45.00);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. NEW ITEM NOTICES RESOLUTION (ADD / LINK / REJECT)
  // ---------------------------------------------------------------------------
  describe('3. New Item Notices Resolution', () => {
    const pendingItemNotice: NewItemNotice = {
      id: 'nin_sample_01',
      supplierId: 'sup_tazaki',
      supplierName: 'Tazaki Foods',
      rawDescription: 'Wagyu Beef Striploin A5',
      rawItemCode: 'WAGYU-A5',
      detectedCasePrice: 240.00,
      detectedPackPrice: 0,
      invoiceNumber: 'INV-2026-777',
      invoiceDate: '2026-10-01',
      detectedDate: '2026-10-01T10:00:00Z',
      status: 'PENDING',
      uploadedByUserId: staffUser.id,
      uploadedByUserName: staffUser.displayName || 'Alice Staff',
    };

    it('resolves unrecognised item to ADDED with new product reference', () => {
      const updatePayload: Partial<NewItemNotice> = {
        status: 'ADDED',
        createdProductId: 'prod_wagyu_striploin',
        reviewedByUserId: managerUser.id,
        reviewedByUserName: managerUser.displayName,
        reviewedAt: '2026-10-01T12:00:00Z',
        notes: 'Approved as new premium menu item.',
      };

      const resolved = validateNewItemNoticeResolution(managerUser, pendingItemNotice, updatePayload);
      assert.equal(resolved.status, 'ADDED');
      assert.equal(resolved.createdProductId, 'prod_wagyu_striploin');
    });

    it('resolves unrecognised item to LINKED with existing productId', () => {
      const updatePayload: Partial<NewItemNotice> = {
        status: 'LINKED',
        linkedProductId: 'prod_salmon_1kg',
        reviewedByUserId: managerUser.id,
        reviewedByUserName: managerUser.displayName,
        reviewedAt: '2026-10-01T12:00:00Z',
        notes: 'Linked to existing salmon catalog line.',
      };

      const resolved = validateNewItemNoticeResolution(managerUser, pendingItemNotice, updatePayload);
      assert.equal(resolved.status, 'LINKED');
      assert.equal(resolved.linkedProductId, 'prod_salmon_1kg');
    });

    it('resolves unrecognised item to REJECTED with mandatory reason', () => {
      const updatePayload: Partial<NewItemNotice> = {
        status: 'REJECTED',
        rejectionReason: 'Supplier error: item belongs to another customer order.',
        reviewedByUserId: managerUser.id,
        reviewedByUserName: managerUser.displayName,
        reviewedAt: '2026-10-01T12:00:00Z',
      };

      const resolved = validateNewItemNoticeResolution(managerUser, pendingItemNotice, updatePayload);
      assert.equal(resolved.status, 'REJECTED');
      assert.equal(resolved.rejectionReason, 'Supplier error: item belongs to another customer order.');
    });

    it('prevents duplicate resolution of an already processed new item notice (409 Conflict)', () => {
      const alreadyProcessed: NewItemNotice = {
        ...pendingItemNotice,
        status: 'ADDED',
        createdProductId: 'prod_wagyu_striploin',
      };

      const updatePayload: Partial<NewItemNotice> = {
        status: 'REJECTED',
        rejectionReason: 'Trying to reject after adding',
      };

      assert.throws(
        () => validateNewItemNoticeResolution(managerUser, alreadyProcessed, updatePayload),
        (err: any) => err.status === 409
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ORDER PRICING TOTALS & HISTORICAL SNAPSHOT IMMUTABILITY
  // ---------------------------------------------------------------------------
  describe('4. Order Pricing Totals & Snapshot Immutability', () => {
    it('accurately computes mixed catalog, manual, and VAT totals', () => {
      const orderItems: OrderItem[] = [
        {
          productId: 'prod_salmon_1kg',
          productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
          caseQty: 2, // 2 * 40 = 80
          packQty: 1, // 1 * 10 = 10
          casePriceSnapshot: 40.00,
          packPriceSnapshot: 10.00,
          vatRate: 0,
        },
        {
          productId: 'prod_bleach',
          productNameSnapshot: 'Commercial Disinfectant Cleaner 5L',
          caseQty: 1, // 1 * 20 = 20 + 20% VAT = 24
          packQty: 0,
          casePriceSnapshot: 20.00,
          packPriceSnapshot: 0,
          vatRate: 0.20,
        },
      ];

      const manualItems: ManualOrderItem[] = [
        {
          id: 'man_1',
          description: 'Special Wasabi Root 200g',
          caseQty: 1,
          packQty: 0,
          casePriceSnapshot: 15.00,
          packPriceSnapshot: 0,
          pricingStatus: 'CONFIRMED',
          vatRate: 0,
        },
      ];

      const totals = calculateOrderTotals(orderItems, manualItems, sampleProducts);

      assert.equal(totals.catalogSubtotal, 110.00); // 80 + 10 + 20
      assert.equal(totals.manualConfirmedSubtotal, 15.00);
      assert.equal(totals.vatTotal, 4.00); // 20.00 * 0.20
      assert.equal(totals.grandTotal, 129.00); // 110 + 15 + 4
      assert.equal(totals.isExact, true);
      assert.equal(totals.hasUnpricedItems, false);
    });

    it('preserves historical order price snapshot when catalog product price changes', () => {
      // Historical order was placed at £40
      const placedOrderItem: OrderItem = {
        productId: 'prod_salmon_1kg',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        caseQty: 3,
        packQty: 0,
        casePriceSnapshot: 40.00, // Locked snapshot
        packPriceSnapshot: 10.00,
        vatRate: 0,
      };

      // Catalog price is now increased to £55
      const mutatedProducts: Product[] = sampleProducts.map(p => {
        if (p.id === 'prod_salmon_1kg') return { ...p, casePrice: 55.00 };
        return p;
      });

      // Calculate totals using historical snapshot
      const totals = calculateOrderTotals([placedOrderItem], [], mutatedProducts);
      assert.equal(totals.grandTotal, 120.00, 'Order total must honor the locked snapshot (£40 * 3), not mutated catalog (£55)');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. INVOICE RECONCILIATION & DISCREPANCY CLAIMS ACCURACY
  // ---------------------------------------------------------------------------
  describe('5. Invoice Reconciliation & Credit Claims Accuracy', () => {
    const order: OrderRecord = {
      id: 'ord_rec_test_01',
      branchId: 'branch_ealing',
      branchNameSnapshot: 'Hare & Tortoise Ealing',
      supplierId: 'sup_tazaki',
      supplierNameSnapshot: 'Tazaki Foods',
      orderedByUserId: staffUser.id,
      orderedByNameSnapshot: staffUser.displayName || 'Alice Staff',
      createdAt: '2026-10-01T10:00:00Z',
      deliveryDate: '2026-10-02',
      emailTo: 'orders@tazaki-com.example',
      status: 'PLACED',
      items: [
        {
          productId: 'prod_salmon_1kg',
          productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
          caseQty: 5,
          packQty: 0,
          casePriceSnapshot: 40.00,
          packPriceSnapshot: 0,
        },
      ],
      manualItems: [],
    };

    it('correctly identifies price overcharge claim', () => {
      const line: ReconciledLineInput = {
        productId: 'prod_salmon_1kg',
        description: 'Fresh Atlantic Salmon Fillet',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 5, // All 5 delivered
        deliveredPackQty: 0,
        expectedCasePrice: 40.00,
        expectedPackPrice: 0,
        invoicedCasePrice: 46.00, // Billed at £46 instead of £40
        invoicedPackPrice: 0,
        invoicedLineTotal: 230.00,
      };

      const result = reconcileSingleLine(line);
      assert.equal(result.acceptedLineValue, 200.00);
      assert.equal(result.invoicedLineTotal, 230.00);
      assert.equal(result.claimAmount, 30.00);
      assert.equal(result.issueType, 'PRICE_OVERCHARGE');
    });

    it('distinguishes billed shortage from unbilled shortage', () => {
      // Case A: Supplier billed for all 5 cases even though only 3 delivered
      const billedShortageLine: ReconciledLineInput = {
        description: 'Salmon Fillet',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 3, // 2 missing
        deliveredPackQty: 0,
        expectedCasePrice: 40.00,
        expectedPackPrice: 0,
        invoicedCasePrice: 40.00,
        invoicedPackPrice: 0,
        invoicedLineTotal: 200.00, // Billed for 5 * 40 = 200
      };

      const billedResult = reconcileSingleLine(billedShortageLine);
      assert.equal(billedResult.acceptedLineValue, 120.00);
      assert.equal(billedResult.claimAmount, 80.00);
      assert.equal(billedResult.issueType, 'SHORTAGE');
      assert.equal(billedResult.isUnbilledShortage, false);

      // Case B: Supplier only billed for delivered 3 cases (£120)
      const unbilledShortageLine: ReconciledLineInput = {
        description: 'Salmon Fillet',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 3,
        deliveredPackQty: 0,
        expectedCasePrice: 40.00,
        expectedPackPrice: 0,
        invoicedCasePrice: 40.00,
        invoicedPackPrice: 0,
        invoicedLineTotal: 120.00, // Billed for 3 * 40 = 120
      };

      const unbilledResult = reconcileSingleLine(unbilledShortageLine);
      assert.equal(unbilledResult.acceptedLineValue, 120.00);
      assert.equal(unbilledResult.claimAmount, 0.00, 'Unbilled shortage must NOT generate monetary claim');
      assert.equal(unbilledResult.isUnbilledShortage, true);
    });

    it('sanitizes reconciliation record so no undefined fields are persisted to Firestore', () => {
      const reconciliation = calculateOrderReconciliation(order, [
        {
          productId: 'prod_salmon_1kg',
          description: 'Fresh Atlantic Salmon Fillet',
          orderedCaseQty: 5,
          orderedPackQty: 0,
          deliveredCaseQty: 5,
          deliveredPackQty: 0,
          expectedCasePrice: 40.00,
          expectedPackPrice: 0,
          invoicedCasePrice: 40.00,
          invoicedPackPrice: 0,
          invoicedLineTotal: 200.00,
          issueType: 'NONE',
        },
      ], {
        verifierName: 'Alice Staff',
        invoiceNumber: 'INV-2026-999',
        invoiceDate: '2026-10-02',
      });

      const serialized = JSON.stringify(reconciliation.sanitizedUpdates);
      const parsed = JSON.parse(serialized);

      // Firestore fails if keys with value undefined are passed
      assert.ok(!serialized.includes(':undefined'));
      assert.equal(parsed.invoiceVerification.invoiceNumber, 'INV-2026-999');
      assert.equal(parsed.invoiceVerification.hasDiscrepancies, false);
      assert.equal(parsed.invoiceVerification.discrepancyTotal, 0);
    });
  });

});
