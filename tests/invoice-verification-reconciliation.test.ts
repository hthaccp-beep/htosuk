import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { 
  reconcileSingleLine, 
  calculateOrderReconciliation, 
  sanitizeVerificationUpdates,
  roundCurrency
} from '../utils/invoiceReconciliation.ts';
import type { ReconciledLineInput } from '../utils/invoiceReconciliation.ts';
import type { OrderRecord, OrderItem, ManualOrderItem } from '../types.ts';

describe('Issue 12: Reliable Invoice Verification Saves', () => {
  const sampleOrder: OrderRecord = {
    id: 'ord-test-123456',
    branchId: 'branch-baker-st',
    branchNameSnapshot: 'Baker Street',
    supplierId: 'supp-harro',
    supplierNameSnapshot: 'Harro Foods',
    orderedByUserId: 'user-staff-1',
    orderedByNameSnapshot: 'Alice Staff',
    createdAt: '2026-09-29T10:00:00.000Z',
    items: [
      {
        productId: 'prod-1',
        productNameSnapshot: 'Soy Sauce 1L',
        caseQty: 5,
        packQty: 0,
        casePriceSnapshot: 15.00,
        packPriceSnapshot: 0
      }
    ],
    manualItems: [],
    emailTo: 'orders@supplier-co-uk.example',
    status: 'PLACED'
  };

  test('clean invoice without image or discrepancies serializes cleanly without undefined fields', () => {
    const lines: ReconciledLineInput[] = [
      {
        productId: 'prod-1',
        description: 'Soy Sauce 1L',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 5,
        deliveredPackQty: 0,
        expectedCasePrice: 15.00,
        expectedPackPrice: 0,
        invoicedCasePrice: 15.00,
        invoicedPackPrice: 0,
        invoicedLineTotal: 75.00,
        issueType: 'NONE'
      }
    ];

    const result = calculateOrderReconciliation(sampleOrder, lines, {
      verifierName: 'Bob Manager',
      invoiceNumber: 'INV-9901',
      invoiceDate: '2026-09-29'
    });

    assert.equal(result.hasDiscrepancies, false);
    assert.equal(result.discrepancyTotal, 0);
    assert.equal(result.totalOrderedValue, 75.00);
    assert.equal(result.totalInvoicedValue, 75.00);
    assert.equal(result.claimItems.length, 0);
    assert.equal(result.fulfillmentStatus, 'FULFILLED');
    assert.equal(result.verification.verifiedBy, 'Bob Manager');
    assert.equal(result.verification.invoiceNumber, 'INV-9901');

    // Test sanitization: no key must be undefined
    const sanitized = result.sanitizedUpdates;
    const jsonString = JSON.stringify(sanitized);
    assert.ok(!jsonString.includes('undefined'));
    assert.equal(Object.values(sanitized).every(v => v !== undefined), true);
  });

  test('preserves existing scan evidence when user does not replace the scan', () => {
    const orderWithScan: OrderRecord = {
      ...sampleOrder,
      scannedInvoiceUrl: 'https://storage.googleapis.com/test-bucket/invoice-123.jpg'
    };

    const lines: ReconciledLineInput[] = [
      {
        productId: 'prod-1',
        description: 'Soy Sauce 1L',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 5,
        deliveredPackQty: 0,
        expectedCasePrice: 15.00,
        expectedPackPrice: 0,
        invoicedCasePrice: 15.00,
        invoicedPackPrice: 0
      }
    ];

    // Options without newScanUrl
    const result = calculateOrderReconciliation(orderWithScan, lines, {
      verifierName: 'Bob Manager'
    });

    assert.equal(result.sanitizedUpdates.scannedInvoiceUrl, 'https://storage.googleapis.com/test-bucket/invoice-123.jpg');
  });

  test('preserves previously sent credit note claim history when reopening order', () => {
    const orderWithSentClaim: OrderRecord = {
      ...sampleOrder,
      creditNoteClaim: {
        cnRef: 'CN-ORD-TEST-001',
        claimDate: '2026-09-28T12:00:00.000Z',
        items: [],
        totalClaimAmount: 30.00,
        supplierEmail: 'orders@supplier-co-uk.example',
        branchCcEmail: 'branch@hareandtortoise-co-uk.example',
        emailStatus: 'SENT',
        sentAt: '2026-09-28T12:05:00.000Z'
      }
    };

    const cleanLines: ReconciledLineInput[] = [
      {
        productId: 'prod-1',
        description: 'Soy Sauce 1L',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 5,
        deliveredPackQty: 0,
        expectedCasePrice: 15.00,
        expectedPackPrice: 0,
        invoicedCasePrice: 15.00,
        invoicedPackPrice: 0
      }
    ];

    const result = calculateOrderReconciliation(orderWithSentClaim, cleanLines);
    
    // Even though current review has no discrepancies, the sent record is preserved for audit trail
    assert.ok(result.creditNoteClaim);
    assert.equal(result.creditNoteClaim?.emailStatus, 'SENT');
    assert.equal(result.creditNoteClaim?.cnRef, 'CN-ORD-TEST-001');
    assert.equal(result.creditNoteClaim?.sentAt, '2026-09-28T12:05:00.000Z');
  });

  test('recursive schema sanitizer strips nested undefined fields from complex payloads', () => {
    const rawPayload = {
      orderId: '123',
      invoiceNumber: 'INV-1',
      emptyField: undefined,
      nested: {
        valid: 42,
        missing: undefined,
        deep: {
          present: 'ok',
          unset: undefined
        }
      },
      items: [
        { id: 1, note: undefined, desc: 'Soy' },
        { id: 2, note: 'damaged', desc: 'Rice' }
      ]
    };

    const clean = sanitizeVerificationUpdates(rawPayload);
    assert.equal('emptyField' in clean, false);
    assert.equal('missing' in clean.nested, false);
    assert.equal('unset' in clean.nested.deep, false);
    assert.equal(clean.nested.valid, 42);
    assert.equal(clean.nested.deep.present, 'ok');
    assert.equal('note' in clean.items[0], false);
    assert.equal(clean.items[1].note, 'damaged');
  });
});

describe('Issue 13: Accurate Invoice Reconciliation and Credit Claims', () => {
  test('Synthetic Example 1: 10 ordered, 8 received at agreed £10 and actual invoice £80 must not create a billed-shortage claim', () => {
    const line: ReconciledLineInput = {
      description: 'Salmon Fillets 1kg',
      orderedCaseQty: 10,
      orderedPackQty: 0,
      deliveredCaseQty: 8,
      deliveredPackQty: 0,
      expectedCasePrice: 10.00,
      expectedPackPrice: 0,
      invoicedCasePrice: 10.00,
      invoicedPackPrice: 0,
      invoicedLineTotal: 80.00 // Supplier only billed for delivered 8 units
    };

    const res = reconcileSingleLine(line);

    assert.equal(res.orderedLineValue, 100.00);
    assert.equal(res.acceptedLineValue, 80.00);
    assert.equal(res.invoicedLineTotal, 80.00);
    assert.equal(res.claimAmount, 0.00, 'Claim amount must be 0 because supplier did not overcharge');
    assert.equal(res.isUnbilledShortage, true, 'Must flag as unbilled shortage for operational tracking');
  });

  test('Synthetic Example 2: £120 invoice against 8 accepted units at agreed £10 has £40 excess overcharge claim', () => {
    const line: ReconciledLineInput = {
      description: 'Salmon Fillets 1kg',
      orderedCaseQty: 10,
      orderedPackQty: 0,
      deliveredCaseQty: 8,
      deliveredPackQty: 0,
      expectedCasePrice: 10.00,
      expectedPackPrice: 0,
      invoicedCasePrice: 15.00, // 8 * 15 = 120 billed
      invoicedPackPrice: 0,
      invoicedLineTotal: 120.00
    };

    const res = reconcileSingleLine(line);

    assert.equal(res.acceptedLineValue, 80.00);
    assert.equal(res.invoicedLineTotal, 120.00);
    assert.equal(res.claimAmount, 40.00, 'Claim must be exactly £40 excess');
    assert.equal(res.issueType, 'PRICE_OVERCHARGE');
  });

  test('Synthetic Example 3: Billed shortage: 10 ordered, 8 received, but supplier invoiced £100 for all 10', () => {
    const line: ReconciledLineInput = {
      description: 'Sushi Rice 20kg',
      orderedCaseQty: 10,
      orderedPackQty: 0,
      deliveredCaseQty: 8,
      deliveredPackQty: 0,
      expectedCasePrice: 10.00,
      expectedPackPrice: 0,
      invoicedCasePrice: 10.00,
      invoicedPackPrice: 0,
      invoicedLineTotal: 100.00 // Supplier billed for 10 units instead of 8
    };

    const res = reconcileSingleLine(line);

    assert.equal(res.acceptedLineValue, 80.00);
    assert.equal(res.invoicedLineTotal, 100.00);
    assert.equal(res.claimAmount, 20.00, 'Billed shortage claim must be exactly £20');
    assert.equal(res.issueType, 'SHORTAGE');
    assert.equal(res.isUnbilledShortage, false);
  });

  test('Mixed case and pack quantities with price overcharge and shortage combined', () => {
    const line: ReconciledLineInput = {
      description: 'Mirin Sweet Cooking Wine',
      orderedCaseQty: 2, // 2 cases @ £30 = £60
      orderedPackQty: 5, // 5 bottles @ £5 = £25
      deliveredCaseQty: 1, // 1 case short
      deliveredPackQty: 5, // fully delivered
      expectedCasePrice: 30.00,
      expectedPackPrice: 5.00,
      invoicedCasePrice: 30.00,
      invoicedPackPrice: 6.00, // overcharged by £1 per pack
      invoicedLineTotal: 60.00 // 1 case @ 30 + 5 packs @ 6 = 60
    };

    const res = reconcileSingleLine(line);

    // Accepted value: 1 case * 30 + 5 packs * 5 = £55
    assert.equal(res.acceptedLineValue, 55.00);
    assert.equal(res.invoicedLineTotal, 60.00);
    assert.equal(res.claimAmount, 5.00, 'Claim must equal £5.00 overcharge');
    assert.equal(res.issueType, 'PRICE_OVERCHARGE');
  });

  test('Damaged goods claim claims the entire billed value for the rejected item', () => {
    const line: ReconciledLineInput = {
      description: 'Fresh Tofu 500g',
      orderedCaseQty: 4,
      orderedPackQty: 0,
      deliveredCaseQty: 4, // 4 delivered but all damaged
      deliveredPackQty: 0,
      expectedCasePrice: 12.50,
      expectedPackPrice: 0,
      invoicedCasePrice: 12.50,
      invoicedPackPrice: 0,
      invoicedLineTotal: 50.00,
      issueType: 'DAMAGED'
    };

    const res = reconcileSingleLine(line);

    assert.equal(res.issueType, 'DAMAGED');
    assert.equal(res.claimAmount, 50.00);
  });

  test('Manual items with custom descriptions and unpriced lines reconcile properly', () => {
    const sampleOrderWithManual: OrderRecord = {
      id: 'ord-manual-1',
      branchId: 'b-1',
      branchNameSnapshot: 'Branch 1',
      supplierId: 's-1',
      supplierNameSnapshot: 'Supplier 1',
      orderedByUserId: 'u-1',
      orderedByNameSnapshot: 'Alice',
      createdAt: '2026-09-29T10:00:00Z',
      items: [],
      manualItems: [
        {
          id: 'manual-1',
          description: 'Special Edamame Puree (Manual)',
          caseQty: 2,
          packQty: 0,
          casePriceSnapshot: 25.00,
          packPriceSnapshot: 0
        }
      ],
      emailTo: 'orders@test-co-uk.example',
      status: 'PLACED'
    };

    const lines: ReconciledLineInput[] = [
      {
        description: 'Special Edamame Puree (Manual)',
        orderedCaseQty: 2,
        orderedPackQty: 0,
        deliveredCaseQty: 1, // 1 missing
        deliveredPackQty: 0,
        expectedCasePrice: 25.00,
        expectedPackPrice: 0,
        invoicedCasePrice: 25.00,
        invoicedPackPrice: 0,
        invoicedLineTotal: 50.00 // billed for 2
      }
    ];

    const result = calculateOrderReconciliation(sampleOrderWithManual, lines);

    assert.equal(result.claimItems.length, 1);
    assert.equal(result.claimItems[0].claimAmount, 25.00);
    assert.equal(result.claimItems[0].description, 'Special Edamame Puree (Manual)');
    assert.equal(result.fulfillmentStatus, 'PARTIAL');
  });

  test('Round currency safely handles IEEE 754 floating point inaccuracies', () => {
    assert.equal(roundCurrency(19.999999999999996), 20.00);
    assert.equal(roundCurrency(0.1 + 0.2), 0.30);
    assert.equal(roundCurrency(NaN), 0.00);
    assert.equal(roundCurrency(Infinity), 0.00);
  });
});
