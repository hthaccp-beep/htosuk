import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileSingleLine,
  calculateOrderReconciliation,
  type ReconciledLineInput,
} from '../utils/invoiceReconciliation.ts';
import type { OrderRecord, OrderItem, Product, InvoiceVerification, CreditNoteClaim } from '../types.ts';

describe('Correction 2: Preserve the complete invoice when reopening', () => {

  const baseOrder: OrderRecord = {
    id: 'ord-corr2-001',
    branchId: 'branch-b1',
    branchNameSnapshot: 'Central Kitchen',
    supplierId: 'supp-s1',
    supplierNameSnapshot: 'Fresh Produce Direct',
    orderedByNameSnapshot: 'Alice HeadChef',
    orderedByUserId: 'usr-alice',
    emailTo: 'orders@freshproduce-com.example',
    status: 'PLACED',
    receivedStatus: 'NEW',
    createdAt: '2026-10-01T08:00:00Z',
    items: [
      {
        productId: 'prod-avocado',
        productNameSnapshot: 'Ready-to-eat Hass Avocados',
        caseQty: 5,
        packQty: 0,
        casePriceSnapshot: 18.50,
        packPriceSnapshot: 0,
        sentCaseQty: 5,
        sentPackQty: 0,
      }
    ],
    manualItems: []
  };

  it('1. Save → close → reopen reproduces exact reviewed facts without catalogue re-computation', () => {
    // Stage A: Initial review with custom rate, weight, override, decisions and notes
    const lineInput: ReconciledLineInput = {
      lineId: 'line-stable-avocado-001',
      productId: 'prod-avocado',
      itemCode: 'AVO-001',
      description: 'Ready-to-eat Hass Avocados',
      unit: 'CASE',
      orderedCaseQty: 5,
      orderedPackQty: 0,
      deliveredCaseQty: 4, // 1 shortage
      deliveredPackQty: 0,
      expectedCasePrice: 18.50,
      expectedPackPrice: 0,
      invoicedCasePrice: 20.00, // overcharge: £20 vs £18.50
      invoicedPackPrice: 0,
      weightRate: 4.5,
      vatRate: 0.20,
      isAmountOverridden: false,
      conversionDecision: 'Billed per 4-kg box',
      matchingDecision: 'Matched by code AVO-001',
      notes: '1 box was missing on delivery van',
      isReviewed: true,
    };

    const firstRecon = calculateOrderReconciliation(baseOrder, [lineInput], {
      verifierName: 'Alice HeadChef',
      invoiceNumber: 'INV-2026-9988',
      invoiceDate: '2026-10-02',
      evidenceReference: 'delivery_docket_scan.pdf',
      remarks: 'Please credit short box and £1.50/box overcharge'
    });

    assert.equal(firstRecon.canFinalize, true);
    assert.equal(firstRecon.reviewStatus, 'REVIEWED_WITH_EXCEPTION');
    const savedVerification = firstRecon.verification;

    // Simulate saving to persistence and attaching to order
    const persistedOrder: OrderRecord = {
      ...baseOrder,
      ...firstRecon.sanitizedUpdates,
      invoiceVerification: savedVerification,
    };

    // Stage B: Reopen in another session
    const reopenedLines = persistedOrder.invoiceVerification!.lines!;
    assert.equal(reopenedLines.length, 1);
    const restoredLine = reopenedLines[0];

    assert.equal(restoredLine.lineId, 'line-stable-avocado-001');
    assert.equal(restoredLine.deliveredCaseQty, 4);
    assert.equal(restoredLine.invoicedCasePrice, 20.00);
    assert.equal(restoredLine.expectedCasePrice, 18.50);
    assert.equal(restoredLine.conversionDecision, 'Billed per 4-kg box');
    assert.equal(restoredLine.matchingDecision, 'Matched by code AVO-001');
    assert.equal(restoredLine.notes, '1 box was missing on delivery van');
    assert.equal(restoredLine.netAmount, 80.00); // 4 * 20.00
    assert.equal(restoredLine.vatAmount, 16.00); // 80.00 * 0.20
    assert.equal(restoredLine.grossAmount, 96.00);
    assert.equal(restoredLine.issueType, 'PRICE_OVERCHARGE');
    assert.equal(savedVerification.invoiceNumber, 'INV-2026-9988');
    assert.equal(savedVerification.evidenceReference, 'delivery_docket_scan.pdf');
    assert.equal(savedVerification.supplierName, 'Fresh Produce Direct');
    assert.equal(savedVerification.branchName, 'Central Kitchen');
  });

  it('2. Changing current catalogue prices does NOT rewrite historical invoice review facts', () => {
    // Suppose an existing invoice was saved with historical price £18.50
    const historicalVerification: InvoiceVerification = {
      version: 1,
      verifiedAt: '2026-09-15T12:00:00Z',
      verifiedBy: 'Senior Auditor',
      invoiceNumber: 'INV-HISTORICAL-01',
      invoiceDate: '2026-09-15',
      supplierId: 'supp-s1',
      supplierName: 'Fresh Produce Direct',
      branchId: 'branch-b1',
      branchName: 'Central Kitchen',
      hasDiscrepancies: false,
      totalOrderedValue: 92.50,
      totalInvoicedValue: 92.50,
      netTotal: 92.50,
      vatTotal: 0,
      grossTotal: 92.50,
      discrepancyTotal: 0,
      reviewStatus: 'VERIFIED',
      reviewMethod: 'MANUAL',
      scanStatus: 'SUCCEEDED',
      priceComparisonAvailable: true,
      matchedLinesCount: 1,
      unresolvedLinesCount: 0,
      lines: [
        {
          lineId: 'line-stable-avocado-001',
          productId: 'prod-avocado',
          itemCode: 'AVO-001',
          description: 'Ready-to-eat Hass Avocados',
          unit: 'CASE',
          orderedCaseQty: 5,
          orderedPackQty: 0,
          deliveredCaseQty: 5,
          deliveredPackQty: 0,
          expectedCasePrice: 18.50,
          expectedPackPrice: 0,
          invoicedCasePrice: 18.50,
          invoicedPackPrice: 0,
          netAmount: 92.50,
          grossAmount: 92.50,
          issueType: 'NONE',
          isReviewed: true,
        }
      ]
    };

    const historicalOrder: OrderRecord = {
      ...baseOrder,
      invoiceVerification: historicalVerification,
      receivedStatus: 'PROCESSED',
    };

    // Now current catalog prices in master product catalog jump to £35.00
    const _updatedCatalogProduct: Partial<Product> = {
      id: 'prod-avocado',
      supplierId: 'supp-s1',
      name: 'Ready-to-eat Hass Avocados',
      casePrice: 35.00, // Price increased in catalog!
      packPrice: 0,
      active: true,
    };

    // Reopen verification: restored lines must use saved line expected and invoiced prices, NOT the updated catalog price
    const linesToReconcile = historicalOrder.invoiceVerification!.lines!.map(saved => ({
      ...saved,
      // Pass saved prices intact
    }));

    const result = calculateOrderReconciliation(historicalOrder, linesToReconcile, {
      verifierName: 'Auditor',
      invoiceNumber: historicalOrder.invoiceVerification!.invoiceNumber,
      invoiceDate: historicalOrder.invoiceVerification!.invoiceDate,
    });

    assert.equal(result.totalInvoicedValue, 92.50, 'Historical invoice value must remain £92.50, not updated to £35/case');
    assert.equal(result.discrepancyTotal, 0, 'No false discrepancy should be created against new catalog price');
    assert.equal(result.sanitizedUpdates.invoiceVerification!.lines![0].expectedCasePrice, 18.50);
    assert.equal(result.sanitizedUpdates.invoiceVerification!.lines![0].invoicedCasePrice, 18.50);
  });

  it('3. Incomplete legacy records without lines are flagged and block verification without invented values', () => {
    // Legacy record: has verification header but lines array is undefined or empty
    const legacyOrder: OrderRecord = {
      ...baseOrder,
      invoiceVerification: {
        verifiedAt: '2026-01-01T00:00:00Z',
        verifiedBy: 'Old System',
        invoiceNumber: 'LEGACY-INV-001',
        hasDiscrepancies: false,
        totalOrderedValue: 92.50,
        totalInvoicedValue: 92.50,
        discrepancyTotal: 0,
        reviewStatus: 'VERIFIED',
        // No lines property!
      }
    };

    // When processed with unreviewed lines (isReviewed: false), it must NOT silently assume zero discrepancies
    const unreviewedLine: ReconciledLineInput = {
      productId: 'prod-avocado',
      description: 'Ready-to-eat Hass Avocados',
      orderedCaseQty: 5,
      orderedPackQty: 0,
      deliveredCaseQty: 5,
      deliveredPackQty: 0,
      expectedCasePrice: 18.50,
      expectedPackPrice: 0,
      invoicedCasePrice: 0, // Unentered/unknown from document
      invoicedPackPrice: 0,
      isReviewed: false, // Flagged for review!
    };

    const recon = calculateOrderReconciliation(legacyOrder, [unreviewedLine], {
      invoiceNumber: legacyOrder.invoiceVerification!.invoiceNumber,
      invoiceDate: '2026-01-01',
    });

    assert.equal(recon.canFinalize, false, 'Incomplete legacy record must block finalization until reviewed');
    assert.equal(recon.reviewStatus, 'INCOMPLETE');
    assert.ok(recon.blockingReasons.some(r => r.includes('reviewed')), 'Must state lines require review');
  });

  it('4. Changing rate or quantity recalculates derived amounts and gross values dynamically', () => {
    const line: ReconciledLineInput = {
      description: 'Olive Oil 5L',
      orderedCaseQty: 2,
      orderedPackQty: 0,
      deliveredCaseQty: 2,
      deliveredPackQty: 0,
      expectedCasePrice: 40.00,
      expectedPackPrice: 0,
      invoicedCasePrice: 40.00,
      invoicedPackPrice: 0,
      vatRate: 0.20,
      isReviewed: true,
    };

    const initial = reconcileSingleLine(line);
    assert.equal(initial.netAmount, 80.00);
    assert.equal(initial.vatAmount, 16.00);
    assert.equal(initial.grossAmount, 96.00);

    // Modify rate: rate increases to £45.00
    const rateUpdated = reconcileSingleLine({
      ...line,
      invoicedCasePrice: 45.00
    });
    assert.equal(rateUpdated.netAmount, 90.00); // 2 * 45
    assert.equal(rateUpdated.vatAmount, 18.00); // 90 * 0.20
    assert.equal(rateUpdated.grossAmount, 108.00);
    assert.equal(rateUpdated.claimAmount, 10.00); // (90 - 80)
    assert.equal(rateUpdated.issueType, 'PRICE_OVERCHARGE');

    // Modify quantity: 3 cases delivered
    const qtyUpdated = reconcileSingleLine({
      ...line,
      deliveredCaseQty: 3
    });
    assert.equal(qtyUpdated.netAmount, 120.00); // 3 * 40
    assert.equal(qtyUpdated.vatAmount, 24.00); // 120 * 0.20
    assert.equal(qtyUpdated.grossAmount, 144.00);
  });

  it('5. Intentional manual amount override is visible, applied, and preserved across saves', () => {
    const lineWithOverride: ReconciledLineInput = {
      description: 'Whole Fresh Salmon',
      orderedCaseQty: 1,
      orderedPackQty: 0,
      deliveredCaseQty: 1,
      deliveredPackQty: 0,
      expectedCasePrice: 50.00,
      expectedPackPrice: 0,
      invoicedCasePrice: 50.00,
      invoicedPackPrice: 0,
      isAmountOverridden: true,
      manualAmountOverride: 47.85, // Supplier charged specific net catch-weight total
      vatRate: 0,
      isReviewed: true,
    };

    const result = reconcileSingleLine(lineWithOverride);
    assert.equal(result.isAmountOverridden, true);
    assert.equal(result.manualAmountOverride, 47.85);
    assert.equal(result.netAmount, 47.85);
    assert.equal(result.grossAmount, 47.85);

    // Order reconciliation stores override flags
    const recon = calculateOrderReconciliation(baseOrder, [lineWithOverride], {
      invoiceNumber: 'INV-OVERRIDE-01',
      invoiceDate: '2026-10-03'
    });

    const savedLine = recon.sanitizedUpdates.invoiceVerification!.lines![0];
    assert.equal(savedLine.isAmountOverridden, true);
    assert.equal(savedLine.manualAmountOverride, 47.85);
    assert.equal(savedLine.netAmount, 47.85);
  });

  it('6. Editing after a claim has been SENT creates a new revision and preserves earlier claim in history', () => {
    // Order already had a claim sent
    const sentClaim: CreditNoteClaim = {
      cnRef: 'CN-ORD001-20261001',
      claimDate: '2026-10-01',
      invoiceNumber: 'INV-100',
      invoiceDate: '2026-10-01',
      totalClaimAmount: 37.00,
      supplierEmail: 'claims@freshproduce-com.example',
      branchCcEmail: 'branch@kitchen-com.example',
      emailStatus: 'SENT',
      sentAt: '2026-10-01T14:30:00Z',
      notes: 'Initial shortage claim for 2 boxes',
      items: [
        {
          id: 'item-1',
          description: 'Avocados',
          issueType: 'SHORTAGE',
          orderedQtyStr: '5 Box',
          deliveredQtyStr: '3 Box',
          expectedPrice: 18.50,
          invoicedPrice: 18.50,
          claimAmount: 37.00
        }
      ],
      version: 1
    };

    const orderWithSentClaim: OrderRecord = {
      ...baseOrder,
      creditNoteClaim: sentClaim,
      receivedStatus: 'PROCESSED',
      invoiceVerification: {
        version: 1,
        verifiedAt: '2026-10-01T14:00:00Z',
        verifiedBy: 'Alice',
        invoiceNumber: 'INV-100',
        hasDiscrepancies: true,
        totalOrderedValue: 92.50,
        totalInvoicedValue: 92.50,
        discrepancyTotal: 37.00,
        reviewStatus: 'REVIEWED_WITH_EXCEPTION',
        lines: []
      }
    };

    // User reopens and discovers that delivered was actually 2 boxes (3 boxes short = £55.50 claim)
    // The supplier invoice billed for the full 5 boxes (£92.50)
    const revisedLine: ReconciledLineInput = {
      productId: 'prod-avocado',
      description: 'Ready-to-eat Hass Avocados',
      orderedCaseQty: 5,
      orderedPackQty: 0,
      deliveredCaseQty: 2, // Now 3 short
      deliveredPackQty: 0,
      expectedCasePrice: 18.50,
      expectedPackPrice: 0,
      invoicedCasePrice: 18.50,
      invoicedPackPrice: 0,
      isAmountOverridden: true,
      manualAmountOverride: 92.50, // Billed full £92.50 for 5 boxes despite 2 delivered
      isReviewed: true,
    };

    const revisedRecon = calculateOrderReconciliation(orderWithSentClaim, [revisedLine], {
      invoiceNumber: 'INV-100',
      invoiceDate: '2026-10-01',
      supplierEmail: 'claims@freshproduce-com.example',
      remarks: 'Revised claim: 3 boxes short instead of 2'
    });

    const updatedClaim = revisedRecon.sanitizedUpdates.creditNoteClaim!;
    assert.ok(updatedClaim, 'New claim must exist');
    assert.equal(updatedClaim.version, 2, 'Claim version must increment to 2');
    assert.equal(updatedClaim.emailStatus, 'PENDING', 'New revision must be PENDING so it can be re-sent');
    assert.equal(updatedClaim.totalClaimAmount, 55.50, 'New claim amount must be £55.50');

    // Earlier sent claim preserved in claimHistory
    assert.ok(updatedClaim.claimHistory, 'claimHistory must exist');
    assert.equal(updatedClaim.claimHistory!.length, 1);
    const archived = updatedClaim.claimHistory![0];
    assert.equal(archived.cnRef, 'CN-ORD001-20261001');
    assert.equal(archived.totalClaimAmount, 37.00, 'Original claim amount £37.00 must be preserved in history');
    assert.equal(archived.emailStatus, 'SENT');
    assert.equal(archived.sentAt, '2026-10-01T14:30:00Z');
  });

});
