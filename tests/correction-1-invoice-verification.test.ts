import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileSingleLine,
  calculateOrderReconciliation,
  sanitizeVerificationUpdates,
  type ReconciledLineInput,
} from '../utils/invoiceReconciliation.ts';

import {
  validateOrderUpdate,
  validateInvoiceVerificationIntegrity,
  OrderAuthorizationError,
  type AuthenticatedUser,
} from '../server/order-authorization.ts';

import type { OrderRecord, OrderItem, InvoiceVerification } from '../types.ts';

describe('Correction 1: Stop Failed or Incomplete Scans Becoming Verified', () => {
  const staffUser: AuthenticatedUser = {
    id: 'user_staff_baker',
    role: 'STAFF',
    branchId: 'branch_baker_st',
    active: true,
  };

  const sampleOrder: OrderRecord = {
    id: 'order_test_101',
    branchId: 'branch_baker_st',
    branchNameSnapshot: 'Baker Street',
    supplierId: 'sup_tazaki',
    supplierNameSnapshot: 'Tazaki Foods',
    orderedByUserId: 'user_staff_baker',
    orderedByNameSnapshot: 'Baker Staff',
    createdAt: '2026-10-01T10:00:00.000Z',
    items: [
      {
        productId: 'prod_salmon_1kg',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        caseQty: 5,
        packQty: 0,
        casePriceSnapshot: 40.00,
        packPriceSnapshot: 10.00,
      },
      {
        productId: 'prod_soy_sauce',
        productNameSnapshot: 'Kikkoman Soy Sauce 1L',
        caseQty: 2,
        packQty: 0,
        casePriceSnapshot: 30.00,
        packPriceSnapshot: 5.50,
      }
    ],
    manualItems: [],
    emailTo: 'orders@tazaki-co-uk.example',
    status: 'PLACED',
    receivedStatus: 'NEW',
  };

  // 1. New invoice; OCR rejects: no current-invoice green match and no final verification write.
  it('1. New invoice; OCR rejects: no current-invoice green match and final verification write is blocked', () => {
    const unreviewedLines: ReconciledLineInput[] = sampleOrder.items.map(item => ({
      productId: item.productId,
      description: item.productNameSnapshot,
      orderedCaseQty: item.caseQty,
      orderedPackQty: item.packQty,
      expectedCasePrice: item.casePriceSnapshot,
      expectedPackPrice: item.packPriceSnapshot,
      isReviewed: false,
    }));

    const result = calculateOrderReconciliation(sampleOrder, unreviewedLines, {
      scanStatus: 'FAILED',
      reviewMethod: 'OCR',
      invoiceNumber: 'INV-999',
      invoiceDate: '2026-10-04',
    });

    assert.equal(result.canFinalize, false, 'Finalization must be blocked when scan failed without manual review');
    assert.equal(result.reviewStatus, 'INCOMPLETE', 'Review status must be INCOMPLETE');
    assert.ok(result.blockingReasons.some(r => r.includes('Scan failed — this invoice has not been verified')));
    assert.equal(result.sanitizedUpdates.receivedStatus, 'NEW', 'Must not advance receivedStatus to PROCESSED');

    // Server-side boundary test
    const updatedOrder: OrderRecord = {
      ...sampleOrder,
      ...result.sanitizedUpdates,
      receivedStatus: 'PROCESSED', // Attempt to force processed status
    };

    assert.throws(() => {
      validateOrderUpdate(staffUser, sampleOrder, updatedOrder);
    }, (err: any) => {
      assert.ok(err instanceof OrderAuthorizationError);
      return true;
    });
  });

  // 2. Previously verified invoice; replacement scan fails: previous saved verification remains intact.
  it('2. Previously verified invoice; replacement scan fails: previous saved verification remains intact', () => {
    const savedVerification: InvoiceVerification = {
      verifiedAt: '2026-10-02T14:00:00.000Z',
      verifiedBy: 'Original Verifier',
      invoiceNumber: 'INV-ORIGINAL-001',
      invoiceDate: '2026-10-02',
      hasDiscrepancies: false,
      totalOrderedValue: 260.00,
      totalInvoicedValue: 260.00,
      discrepancyTotal: 0,
      reviewStatus: 'VERIFIED',
      reviewMethod: 'OCR_ASSISTED',
      scanStatus: 'SUCCEEDED',
      priceComparisonAvailable: true,
    };

    const verifiedOrder: OrderRecord = {
      ...sampleOrder,
      receivedStatus: 'PROCESSED',
      processedAt: '2026-10-02T14:00:00.000Z',
      invoiceVerification: savedVerification,
    };

    // User attempts replacement scan, which fails
    const replacementLines: ReconciledLineInput[] = sampleOrder.items.map(item => ({
      productId: item.productId,
      description: item.productNameSnapshot,
      orderedCaseQty: item.caseQty,
      orderedPackQty: item.packQty,
      expectedCasePrice: item.casePriceSnapshot,
      expectedPackPrice: item.packPriceSnapshot,
      isReviewed: false,
    }));

    const result = calculateOrderReconciliation(verifiedOrder, replacementLines, {
      scanStatus: 'FAILED',
      reviewMethod: 'OCR',
      newScanUrl: 'data:image/png;base64,failed_scan',
    });

    assert.equal(result.canFinalize, false);
    // Preserves the previously saved verification
    assert.deepEqual(result.sanitizedUpdates.invoiceVerification, savedVerification);
    assert.equal(result.sanitizedUpdates.invoiceVerification?.invoiceNumber, 'INV-ORIGINAL-001');
    assert.equal(result.sanitizedUpdates.invoiceVerification?.verifiedBy, 'Original Verifier');
  });

  // 3. OCR returns no rows: incomplete review.
  it('3. OCR returns no rows: results in incomplete review and blocks final verification', () => {
    const unreviewedLines: ReconciledLineInput[] = sampleOrder.items.map(item => ({
      productId: item.productId,
      description: item.productNameSnapshot,
      orderedCaseQty: item.caseQty,
      orderedPackQty: item.packQty,
      expectedCasePrice: item.casePriceSnapshot,
      expectedPackPrice: item.packPriceSnapshot,
      isReviewed: false,
    }));

    const result = calculateOrderReconciliation(sampleOrder, unreviewedLines, {
      scanStatus: 'SUCCEEDED',
      reviewMethod: 'OCR',
      // OCR extracted 0 items, so all lines remain isReviewed: false
    });

    assert.equal(result.canFinalize, false);
    assert.equal(result.reviewStatus, 'INCOMPLETE');
    assert.ok(result.blockingReasons.some(r => r.includes('All line items must be reviewed')));
  });

  // 4. OCR returns unmatched or partly matched rows: accurate warning and unresolved fields.
  it('4. OCR returns unmatched or partly matched rows: partial match flags unreviewed lines', () => {
    // Only 1 of 2 items matched
    const partlyReviewedLines: ReconciledLineInput[] = [
      {
        productId: 'prod_salmon_1kg',
        description: 'Fresh Atlantic Salmon Fillet',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 5,
        deliveredPackQty: 0,
        expectedCasePrice: 40.00,
        expectedPackPrice: 10.00,
        invoicedCasePrice: 40.00,
        invoicedPackPrice: 10.00,
        isReviewed: true,
        issueType: 'NONE',
      },
      {
        productId: 'prod_soy_sauce',
        description: 'Kikkoman Soy Sauce 1L',
        orderedCaseQty: 2,
        orderedPackQty: 0,
        expectedCasePrice: 30.00,
        expectedPackPrice: 5.50,
        isReviewed: false, // Unmatched by OCR
      }
    ];

    const result = calculateOrderReconciliation(sampleOrder, partlyReviewedLines, {
      scanStatus: 'SUCCEEDED',
      reviewMethod: 'OCR_ASSISTED',
      invoiceNumber: 'INV-PARTIAL',
      invoiceDate: '2026-10-04',
    });

    assert.equal(result.canFinalize, false);
    assert.equal(result.reviewStatus, 'INCOMPLETE');
    assert.equal(result.hasUnreviewedLines, true);
    assert.ok(result.blockingReasons.some(r => r.includes('All line items must be reviewed')));
  });

  // 5. Complete manual review after failure: authorized verification succeeds and records manual review.
  it('5. Complete manual review after failure: authorized verification succeeds and records manual review', () => {
    const manuallyReviewedLines: ReconciledLineInput[] = [
      {
        productId: 'prod_salmon_1kg',
        description: 'Fresh Atlantic Salmon Fillet',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 5,
        deliveredPackQty: 0,
        expectedCasePrice: 40.00,
        expectedPackPrice: 10.00,
        invoicedCasePrice: 40.00,
        invoicedPackPrice: 10.00,
        invoicedLineTotal: 200.00,
        isReviewed: true,
        issueType: 'NONE',
      },
      {
        productId: 'prod_soy_sauce',
        description: 'Kikkoman Soy Sauce 1L',
        orderedCaseQty: 2,
        orderedPackQty: 0,
        deliveredCaseQty: 2,
        deliveredPackQty: 0,
        expectedCasePrice: 30.00,
        expectedPackPrice: 5.50,
        invoicedCasePrice: 30.00,
        invoicedPackPrice: 5.50,
        invoicedLineTotal: 60.00,
        isReviewed: true,
        issueType: 'NONE',
      }
    ];

    const result = calculateOrderReconciliation(sampleOrder, manuallyReviewedLines, {
      verifierName: 'Baker Manager',
      scanStatus: 'FAILED',
      reviewMethod: 'MANUAL',
      invoiceNumber: 'INV-MANUAL-789',
      invoiceDate: '2026-10-04',
      evidenceReference: 'Physical invoice copy inspected on site',
    });

    assert.equal(result.canFinalize, true);
    assert.equal(result.reviewStatus, 'VERIFIED');
    assert.equal(result.verification.reviewMethod, 'MANUAL');
    assert.equal(result.verification.scanStatus, 'FAILED');
    assert.equal(result.verification.verifiedBy, 'Baker Manager');
    assert.equal(result.verification.evidenceReference, 'Physical invoice copy inspected on site');
    assert.equal(result.sanitizedUpdates.receivedStatus, 'PROCESSED');
  });

  // 6. Incomplete manual review: final verification remains blocked.
  it('6. Incomplete manual review: missing invoice metadata or line decisions keeps verification blocked', () => {
    const incompleteLines: ReconciledLineInput[] = [
      {
        productId: 'prod_salmon_1kg',
        description: 'Fresh Atlantic Salmon Fillet',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 5,
        deliveredPackQty: 0,
        expectedCasePrice: 40.00,
        expectedPackPrice: 10.00,
        isReviewed: true,
      },
      {
        productId: 'prod_soy_sauce',
        description: 'Kikkoman Soy Sauce 1L',
        orderedCaseQty: 2,
        orderedPackQty: 0,
        isReviewed: false, // Incomplete!
      }
    ];

    const result = calculateOrderReconciliation(sampleOrder, incompleteLines, {
      scanStatus: 'FAILED',
      reviewMethod: 'MANUAL',
      invoiceNumber: '', // Missing invoice number without exception!
      invoiceDate: '', // Missing invoice date!
    });

    assert.equal(result.canFinalize, false);
    assert.equal(result.reviewStatus, 'INCOMPLETE');
    assert.ok(result.blockingReasons.length >= 3);
  });

  // 7. Genuine reviewed zero values: handled correctly.
  it('7. Genuine reviewed zero values: zero delivered quantity and free promotional items handled properly', () => {
    const linesWithGenuineZeroes: ReconciledLineInput[] = [
      {
        productId: 'prod_salmon_1kg',
        description: 'Fresh Atlantic Salmon Fillet (Undelivered)',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 0, // Genuine 0 delivered
        deliveredPackQty: 0,
        expectedCasePrice: 40.00,
        expectedPackPrice: 10.00,
        invoicedCasePrice: 0,
        invoicedPackPrice: 0,
        invoicedLineTotal: 0,
        isReviewed: true,
        issueType: 'SHORTAGE',
      },
      {
        productId: 'prod_promo_sauce',
        description: 'Complimentary Chef Tasting Sauce 500ml',
        orderedCaseQty: 1,
        orderedPackQty: 0,
        deliveredCaseQty: 1,
        deliveredPackQty: 0,
        expectedCasePrice: 0,
        expectedPackPrice: 0,
        invoicedCasePrice: 0,
        invoicedPackPrice: 0,
        invoicedLineTotal: 0,
        isGenuineZeroPrice: true, // Genuinely free item
        isReviewed: true,
        issueType: 'NONE',
      }
    ];

    const result = calculateOrderReconciliation(sampleOrder, linesWithGenuineZeroes, {
      scanStatus: 'SUCCEEDED',
      reviewMethod: 'MANUAL',
      invoiceNumber: 'INV-ZERO-ITEMS',
      invoiceDate: '2026-10-04',
    });

    assert.equal(result.canFinalize, true);
    assert.equal(result.totalInvoicedValue, 0.00);
    // Salmon was undelivered and unbilled; chef sauce was free
    assert.equal(result.discrepancyTotal, 0.00);
    assert.equal(result.fulfillmentStatus, 'PARTIAL');
  });

  // 8. Missing values: never silently converted to financial zeroes.
  it('8. Missing values: missing catalog prices are flagged as unavailable, not treated as £0 match', () => {
    const unpricedOrder: OrderRecord = {
      ...sampleOrder,
      items: [
        {
          productId: 'prod_custom_mushroom',
          productNameSnapshot: 'Specialty Seasonal Enoki Mushrooms',
          caseQty: 3,
          packQty: 0,
          // Snapshot prices undefined!
          casePriceSnapshot: undefined,
          packPriceSnapshot: undefined,
        }
      ]
    };

    const lines: ReconciledLineInput[] = [
      {
        productId: 'prod_custom_mushroom',
        description: 'Specialty Seasonal Enoki Mushrooms',
        orderedCaseQty: 3,
        orderedPackQty: 0,
        deliveredCaseQty: 3,
        deliveredPackQty: 0,
        // No expected price in catalog
        expectedCasePrice: undefined,
        expectedPackPrice: undefined,
        invoicedCasePrice: 18.00,
        invoicedPackPrice: 0,
        invoicedLineTotal: 54.00,
        isReviewed: true,
        issueType: 'NONE',
      }
    ];

    const result = calculateOrderReconciliation(unpricedOrder, lines, {
      scanStatus: 'SUCCEEDED',
      reviewMethod: 'MANUAL',
      invoiceNumber: 'INV-NO-CATALOG',
      invoiceDate: '2026-10-04',
    });

    assert.equal(result.priceComparisonAvailable, false, 'Price comparison must be flagged as unavailable');
    assert.equal(result.verification.priceComparisonAvailable, false);
    assert.equal(result.totalOrderedValue, 0);
    assert.equal(result.totalInvoicedValue, 54.00);
  });

  // 9. Save fails: preserve the review and do not display a newly saved Verified state.
  it('9. Save fails: server reject preserves state and prevents advancing receivedStatus', () => {
    // Malformed/draft verification cannot advance receivedStatus to PROCESSED
    const invalidProcessedOrder: OrderRecord = {
      ...sampleOrder,
      receivedStatus: 'PROCESSED',
      invoiceVerification: {
        verifiedAt: new Date().toISOString(),
        verifiedBy: 'Staff',
        reviewStatus: 'INCOMPLETE', // Incomplete!
        hasDiscrepancies: false,
        totalOrderedValue: 100,
        totalInvoicedValue: 100,
        discrepancyTotal: 0,
      }
    };

    assert.throws(() => {
      validateInvoiceVerificationIntegrity(sampleOrder, invalidProcessedOrder);
    }, (err: any) => {
      assert.ok(err instanceof OrderAuthorizationError);
      assert.ok(err.message.includes('incomplete review status'));
      return true;
    });
  });

  // 10. Retry after an uncertain save: do not create duplicate verification versions.
  it('10. Retry after an uncertain save: updates in place by order ID without duplicating records', () => {
    const verifiedOrder: OrderRecord = {
      ...sampleOrder,
      receivedStatus: 'PROCESSED',
      invoiceVerification: {
        verifiedAt: '2026-10-04T12:00:00.000Z',
        verifiedBy: 'Manager',
        invoiceNumber: 'INV-12345',
        invoiceDate: '2026-10-04',
        hasDiscrepancies: false,
        totalOrderedValue: 260.00,
        totalInvoicedValue: 260.00,
        discrepancyTotal: 0,
        reviewStatus: 'VERIFIED',
      }
    };

    // Subsequent re-verification attempt updates in place
    const updated = validateOrderUpdate(staffUser, verifiedOrder, {
      ...verifiedOrder,
      invoiceDate: '2026-10-04',
    });

    assert.equal(updated.id, verifiedOrder.id);
  });

  // 11. Upload and drag/drop: follow the same validation and state rules.
  it('11. Upload and drag/drop: sanitizedUpdates removes undefined values from all input avenues', () => {
    const rawPayload = {
      id: 'order_101',
      invoiceVerification: {
        verifiedAt: '2026-10-04T10:00:00Z',
        verifiedBy: 'Staff',
        notes: undefined, // Must be stripped
        evidenceReference: undefined, // Must be stripped
        reviewStatus: 'VERIFIED',
      },
      extraField: undefined,
    };

    const sanitized = sanitizeVerificationUpdates(rawPayload);
    assert.equal('extraField' in sanitized, false);
    assert.equal('notes' in (sanitized.invoiceVerification as any), false);
    assert.equal('evidenceReference' in (sanitized.invoiceVerification as any), false);
  });

  // 12. Documented exception: invoice number not printed on document
  it('12. Documented exception allows verification when invoice number is explicitly not provided', () => {
    const reviewedLines: ReconciledLineInput[] = sampleOrder.items.map(item => ({
      productId: item.productId,
      description: item.productNameSnapshot,
      orderedCaseQty: item.caseQty,
      orderedPackQty: item.packQty,
      deliveredCaseQty: item.caseQty,
      deliveredPackQty: item.packQty,
      expectedCasePrice: item.casePriceSnapshot,
      expectedPackPrice: item.packPriceSnapshot,
      invoicedCasePrice: item.casePriceSnapshot,
      invoicedPackPrice: item.packPriceSnapshot,
      isReviewed: true,
      issueType: 'NONE',
    }));

    const result = calculateOrderReconciliation(sampleOrder, reviewedLines, {
      verifierName: 'Staff Member',
      scanStatus: 'SUCCEEDED',
      reviewMethod: 'MANUAL',
      invoiceNumber: '',
      invoiceNumberNotProvided: true, // Documented exception!
      invoiceDate: '2026-10-04',
    });

    assert.equal(result.canFinalize, true);
    assert.equal(result.verification.invoiceNumberNotProvided, true);
    assert.equal(result.verification.invoiceNumber, '[NOT_PROVIDED]');
  });
});
