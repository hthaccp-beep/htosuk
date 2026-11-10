/**
 * Comprehensive Automated Test Suite for Architectural Enhancements:
 * - Server-Side Authoritative Email Templates & Transactional Outbox
 * - Official Credit Claim PDF Generation
 * - Effective-Dated Price Scheduler & Activation
 * - Par-Level Stock Replenishment Suggestions
 * - Multi-Supplier Cross-Catalog Comparison & Best-Vendor Routing
 * - Food Cost Inflation & Historical Price Analytics
 * - Immutable Server Audit Log Stream & Credential Sanitization
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
  calculateParOrderSuggestions,
  findAlternativeSupplierOptions,
  calculateIngredientInflation,
} from '../utils/orderingEnhancements.ts';

import {
  createAuditLogEntry,
  sanitizeAuditDetails,
} from '../server/audit-log-service.ts';

import type {
  OrderRecord,
  Branch,
  Supplier,
  CreditNoteClaim,
  Product,
  PriceChangeNotice,
  PriceHistoryRecord,
} from '../types.ts';

// ---------------------------------------------------------------------------
// 1. Server-Side Email Rendering & Transactional Outbox
// ---------------------------------------------------------------------------
describe('Enhancement 1: Server-Side Email & Transactional Outbox', () => {
  const sampleBranch: Branch = {
    id: 'b_bloomsbury',
    name: 'Hare & Tortoise Bloomsbury',
    code: 'HT-BLM',
    address: '11-13 The Brunswick, London WC1N 1AF',
    email: 'bloomsbury@hareandtortoise-co-uk.example',
    active: true,
  };

  const sampleSupplier: Supplier = {
    id: 's_harro',
    name: 'Harro Foods',
    email: 'orders@harro-co-uk.example',
    active: true,
    deliveryRules: {},
    deliverySchedules: {},
  };

  const sampleOrder: OrderRecord = {
    id: 'ord_HT_BLM_20261001',
    branchId: 'b_bloomsbury',
    branchNameSnapshot: 'Hare & Tortoise Bloomsbury',
    supplierId: 's_harro',
    supplierNameSnapshot: 'Harro Foods',
    orderedByUserId: 'u_101',
    orderedByNameSnapshot: 'Master Chef Ken',
    createdAt: '2026-10-01T09:30:00.000Z',
    deliveryDate: '2026-10-02',
    status: 'PLACED',
    emailTo: 'orders@harro-co-uk.example',
    comments: 'Deliver via back alley loading bay before 10am please.',
    items: [
      {
        productId: 'p_tamani',
        productNameSnapshot: 'Tamanishiki Short Grain Rice',
        itemCodeSnapshot: 'A0006',
        caseQty: 4,
        packQty: 0,
        caseUnitSnapshot: 'Bag',
        packUnitSnapshot: 'Kg',
      },
    ],
    manualItems: [
      {
        id: 'm_wasabi',
        description: 'Fresh Shizuoka Wasabi Stems',
        caseQty: 1,
        packQty: 2,
        caseUnitSnapshot: 'Tub',
        packUnitSnapshot: 'Pcs',
      },
    ],
  };

  it('renders brand-standard HTML email using authoritative snapshots', () => {
    const html = renderAuthoritativeOrderEmailHtml(sampleOrder, sampleBranch, sampleSupplier);
    assert.ok(html.includes('Hare &amp; Tortoise'));
    assert.ok(html.includes('ORD_HT_B'));
    assert.ok(html.includes('Hare &amp; Tortoise Bloomsbury'));
    assert.ok(html.includes('Tamanishiki Short Grain Rice'));
    assert.ok(html.includes('A0006'));
    assert.ok(html.includes('Fresh Shizuoka Wasabi Stems'));
    assert.ok(html.includes('Deliver via back alley loading bay'));
  });

  it('renders credit claim email HTML with dispute schedule and total value', () => {
    const sampleClaim: CreditNoteClaim = {
      cnRef: 'CN-2026-0042',
      claimDate: '2026-10-01',
      invoiceNumber: 'INV-HARRO-99881',
      totalClaimAmount: 118.80,
      supplierEmail: 'claims@harro-co-uk.example',
      branchCcEmail: 'bloomsbury@hareandtortoise-co-uk.example',
      notes: 'Driver was 2 bags short on delivery.',
      items: [
        {
          id: 'ci_1',
          itemCode: 'A0006',
          description: 'Tamanishiki Short Grain Rice',
          issueType: 'SHORTAGE',
          orderedQtyStr: '4 Bags',
          deliveredQtyStr: '2 Bags',
          expectedPrice: 59.40,
          invoicedPrice: 59.40,
          claimAmount: 118.80,
        },
      ],
    };

    const claimHtml = renderCreditClaimEmailHtml(sampleClaim, sampleBranch, sampleSupplier);
    assert.ok(claimHtml.includes('CN-2026-0042'));
    assert.ok(claimHtml.includes('INV-HARRO-99881'));
    assert.ok(claimHtml.includes('SHORTAGE'));
    assert.ok(claimHtml.includes('£118.80'));
  });

  it('creates an outbox item with initial pending state and idempotency key', () => {
    const outbox = createOutboxItemRecord({
      orderId: sampleOrder.id,
      type: 'ORDER_CONFIRMATION',
      recipientEmail: 'orders@harro-co-uk.example',
      ccEmails: ['info@hareandtortoise.co.uk'],
      subject: 'Purchase Order ord_HT_BLM_20261001',
      idempotencyKey: 'idem_ord_HT_BLM_20261001_attempt_1',
    });

    assert.strictEqual(outbox.status, 'PENDING');
    assert.strictEqual(outbox.retryCount, 0);
    assert.strictEqual(outbox.maxRetries, 3);
    assert.strictEqual(outbox.idempotencyKey, 'idem_ord_HT_BLM_20261001_attempt_1');
    assert.ok(outbox.id.startsWith('outbox_'));
  });

  it('calculates exponential backoff intervals for retries', () => {
    assert.strictEqual(calculateNextRetryDelaySeconds(0), 60);  // 1 min
    assert.strictEqual(calculateNextRetryDelaySeconds(1), 300); // 5 min
    assert.strictEqual(calculateNextRetryDelaySeconds(2), 900); // 15 min
  });
});

// ---------------------------------------------------------------------------
// 2. Official Credit Claim PDF Generation
// ---------------------------------------------------------------------------
describe('Enhancement 2: Official Credit Claim PDF Generator', () => {
  const claim: CreditNoteClaim = {
    cnRef: 'CN-BLM-2026-101',
    claimDate: '2026-10-01',
    invoiceNumber: 'INV-887766',
    invoiceDate: '2026-09-30',
    totalClaimAmount: 85.50,
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
      {
        id: 'c2',
        itemCode: 'B1028',
        description: 'Hanamaruki Miso White 20kg',
        issueType: 'PRICE_OVERCHARGE',
        orderedQtyStr: '1 Tub',
        deliveredQtyStr: '1 Tub',
        expectedPrice: 25.00,
        invoicedPrice: 71.50,
        claimAmount: 46.50,
      },
    ],
  };

  it('generates a valid PDF with base64 data and standard filename', () => {
    const { doc, base64, fileName } = generateCreditClaimPdf(claim);
    assert.ok(doc);
    assert.ok(base64.length > 500); // Non-empty PDF payload
    assert.strictEqual(fileName, 'Credit_Claim_CN-BLM-2026-101_HT.pdf');
  });
});

// ---------------------------------------------------------------------------
// 3. Effective-Dated Price Scheduler
// ---------------------------------------------------------------------------
describe('Enhancement 3: Automated Price Activation Scheduler', () => {
  const sampleProducts: Product[] = [
    {
      id: 'p_rice',
      name: 'Nishiki Rice 20KG',
      casePrice: 39.00,
      packPrice: 0,
      categoryId: 'cat_dry',
      supplierId: 's_harro',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true,
    },
    {
      id: 'p_soy',
      name: 'Kikkoman Soy Sauce 20L',
      casePrice: 39.00,
      packPrice: 0,
      categoryId: 'cat_dry',
      supplierId: 's_harro',
      displayOrder: 2,
      allowedBranchIds: [],
      active: true,
    },
  ];

  const sampleNotices: PriceChangeNotice[] = [
    {
      id: 'ntc_due_today',
      productId: 'p_rice',
      productName: 'Nishiki Rice 20KG',
      supplierId: 's_harro',
      supplierName: 'Harro Foods',
      oldCasePrice: 39.00,
      newCasePrice: 42.50,
      oldPackPrice: 0,
      newPackPrice: 0,
      priceDiff: 3.50,
      percentChange: 8.97,
      invoiceNumber: 'INV-1001',
      invoiceDate: '2026-10-01',
      detectedDate: '2026-10-01T08:00:00Z',
      status: 'APPROVED',
      effectiveDate: '2026-10-01', // Due today
      uploadedByUserId: 'u_1',
      uploadedByUserName: 'Ken',
    },
    {
      id: 'ntc_future',
      productId: 'p_soy',
      productName: 'Kikkoman Soy Sauce 20L',
      supplierId: 's_harro',
      supplierName: 'Harro Foods',
      oldCasePrice: 39.00,
      newCasePrice: 45.00,
      oldPackPrice: 0,
      newPackPrice: 0,
      priceDiff: 6.00,
      percentChange: 15.38,
      invoiceNumber: 'INV-1002',
      invoiceDate: '2026-10-01',
      detectedDate: '2026-10-01T08:00:00Z',
      status: 'APPROVED',
      effectiveDate: '2026-11-01', // Future date
      uploadedByUserId: 'u_1',
      uploadedByUserName: 'Ken',
    },
    {
      id: 'ntc_pending',
      productId: 'p_rice',
      productName: 'Nishiki Rice 20KG',
      supplierId: 's_harro',
      supplierName: 'Harro Foods',
      oldCasePrice: 39.00,
      newCasePrice: 50.00,
      oldPackPrice: 0,
      newPackPrice: 0,
      priceDiff: 11.00,
      percentChange: 28.2,
      invoiceNumber: 'INV-1003',
      invoiceDate: '2026-10-01',
      detectedDate: '2026-10-01T08:00:00Z',
      status: 'PENDING', // Not approved yet
      effectiveDate: '2026-10-01',
      uploadedByUserId: 'u_1',
      uploadedByUserName: 'Ken',
    },
  ];

  it('filters only approved notices that are due on or before target date', () => {
    const due = findDuePriceNotices(sampleNotices, '2026-10-01');
    assert.strictEqual(due.length, 1);
    assert.strictEqual(due[0].id, 'ntc_due_today');
  });

  it('activates due notices, updates product prices, and generates price history', () => {
    const result = activateDuePriceNotices({
      notices: sampleNotices,
      products: sampleProducts,
      currentDateIso: '2026-10-01',
    });

    assert.strictEqual(result.appliedNoticeIds.length, 1);
    assert.strictEqual(result.appliedNoticeIds[0], 'ntc_due_today');

    const updatedRice = result.updatedProducts.find(p => p.id === 'p_rice')!;
    assert.strictEqual(updatedRice.casePrice, 42.50);

    const updatedSoy = result.updatedProducts.find(p => p.id === 'p_soy')!;
    assert.strictEqual(updatedSoy.casePrice, 39.00); // Unchanged

    assert.strictEqual(result.generatedHistoryRecords.length, 1);
    assert.strictEqual(result.generatedHistoryRecords[0].previousCasePrice, 39.00);
    assert.strictEqual(result.generatedHistoryRecords[0].newCasePrice, 42.50);
  });
});

// ---------------------------------------------------------------------------
// 4. Par-Level Stock Replenishment Suggestions
// ---------------------------------------------------------------------------
describe('Enhancement 4: Par-Level Stock Replenishment Engine', () => {
  const products: Product[] = [
    {
      id: 'p_salmon',
      name: 'Fresh Scottish Salmon',
      casePrice: 120.00,
      minParLevel: 2,
      targetParLevel: 6,
      categoryId: 'cat_fish',
      supplierId: 's_fish',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true,
    },
    {
      id: 'p_rice',
      name: 'Nishiki Rice',
      casePrice: 39.00,
      minParLevel: 3,
      targetParLevel: 8,
      categoryId: 'cat_dry',
      supplierId: 's_harro',
      displayOrder: 2,
      allowedBranchIds: [],
      active: true,
    },
    {
      id: 'p_untracked',
      name: 'Special Tea',
      casePrice: 15.00,
      // No par level configured
      categoryId: 'cat_dry',
      supplierId: 's_harro',
      displayOrder: 3,
      allowedBranchIds: [],
      active: true,
    },
  ];

  it('calculates replenishment quantity based on target par level and stock on hand', () => {
    const stockMap: Record<string, number> = {
      p_salmon: 1, // Below min (min 2, target 6) -> needs 5
      p_rice: 5,   // Above min (min 3), below target (8) -> needs 3
    };

    const suggestions = calculateParOrderSuggestions(products, stockMap);

    assert.strictEqual(suggestions['p_salmon'].suggestedCases, 5);
    assert.strictEqual(suggestions['p_salmon'].isBelowMin, true);

    assert.strictEqual(suggestions['p_rice'].suggestedCases, 3);
    assert.strictEqual(suggestions['p_rice'].isBelowMin, false);

    assert.strictEqual(suggestions['p_untracked'], undefined);
  });
});

// ---------------------------------------------------------------------------
// 5. Multi-Supplier Cross-Catalog Comparison & Best-Vendor Routing
// ---------------------------------------------------------------------------
describe('Enhancement 5: Cross-Catalog Vendor Comparison', () => {
  const suppliers: Supplier[] = [
    { id: 's_harro', name: 'Harro Foods', email: 'orders@harro-co-uk.example', active: true, deliveryRules: {}, deliverySchedules: {} },
    { id: 's_tazaki', name: 'Tazaki Foods', email: 'orders@tazaki-co-uk.example', active: true, deliveryRules: {}, deliverySchedules: {} },
  ];

  const allProducts: Product[] = [
    {
      id: 'p_soy_harro',
      name: 'Kikkoman Soy Sauce 20L',
      itemCode: 'B0036',
      casePrice: 39.00,
      categoryId: 'cat_dry',
      supplierId: 's_harro',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true,
    },
    {
      id: 'p_soy_tazaki',
      name: 'Kikkoman Soy Sauce 20L',
      itemCode: 'B0036',
      casePrice: 36.50, // Cheaper!
      categoryId: 'cat_dry',
      supplierId: 's_tazaki',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true,
    },
  ];

  it('recommends cheaper alternative supplier for identical product code', () => {
    const currentProduct = allProducts[0]; // Harro at 39.00
    const alternatives = findAlternativeSupplierOptions(currentProduct, allProducts, suppliers);

    assert.strictEqual(alternatives.length, 1);
    assert.strictEqual(alternatives[0].supplierName, 'Tazaki Foods');
    assert.strictEqual(alternatives[0].isCheaper, true);
    assert.strictEqual(alternatives[0].priceDiff, 2.50);
    assert.strictEqual(alternatives[0].percentSavings, 6.4);
  });
});

// ---------------------------------------------------------------------------
// 6. Food Cost Inflation & Historical Price Analytics
// ---------------------------------------------------------------------------
describe('Enhancement 6: Food Cost Inflation Analytics', () => {
  const history: PriceHistoryRecord[] = [
    {
      id: 'ph_1',
      productId: 'p_rice',
      productName: 'Nishiki Rice 20KG',
      supplierId: 's_harro',
      supplierName: 'Harro Foods',
      previousCasePrice: 30.00,
      newCasePrice: 35.00,
      previousPackPrice: 0,
      newPackPrice: 0,
      effectiveDate: '2026-01-01',
      invoiceRef: 'INV-1',
      approvedByUserId: 'u_1',
      approvedByUserName: 'Ken',
      approvedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ph_2',
      productId: 'p_rice',
      productName: 'Nishiki Rice 20KG',
      supplierId: 's_harro',
      supplierName: 'Harro Foods',
      previousCasePrice: 35.00,
      newCasePrice: 39.00,
      previousPackPrice: 0,
      newPackPrice: 0,
      effectiveDate: '2026-06-01',
      invoiceRef: 'INV-2',
      approvedByUserId: 'u_1',
      approvedByUserName: 'Ken',
      approvedAt: '2026-06-01T00:00:00Z',
    },
  ];

  const products: Product[] = [
    {
      id: 'p_rice',
      name: 'Nishiki Rice 20KG',
      casePrice: 39.00,
      categoryId: 'cat_dry',
      supplierId: 's_harro',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true,
    },
  ];

  it('accurately computes ingredient inflation trajectory over multiple revisions', () => {
    const inflation = calculateIngredientInflation(history, products);
    assert.strictEqual(inflation.length, 1);
    assert.strictEqual(inflation[0].earliestPrice, 30.00);
    assert.strictEqual(inflation[0].currentPrice, 39.00);
    assert.strictEqual(inflation[0].priceDelta, 9.00);
    assert.strictEqual(inflation[0].percentInflation, 30.0);
    assert.strictEqual(inflation[0].historyEntriesCount, 2);
  });
});

// ---------------------------------------------------------------------------
// 7. Server Audit Log Engine & Credential Sanitization
// ---------------------------------------------------------------------------
describe('Enhancement 7: Server Audit Log Stream & Sanitization', () => {
  it('creates valid immutable audit entry with sanitized payload', () => {
    const entry = createAuditLogEntry({
      userId: 'u_creator',
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
        smtpPass: 'supersecretpass123', // Must be sanitized!
        passwordHash: 'secret_hash_value', // Must be sanitized!
      },
    });

    assert.ok(entry.id.startsWith('audit_'));
    assert.strictEqual(entry.action, 'APPROVE_PRICE_INCREASE');
    assert.strictEqual(entry.entityType, 'PRICE');
    assert.strictEqual(entry.details.oldPrice, 100.00);
    assert.strictEqual(entry.details.newPrice, 120.00);
    assert.strictEqual(entry.details.smtpPass, '[REDACTED]');
    assert.strictEqual(entry.details.passwordHash, '[REDACTED]');
  });

  it('rejects audit entry without mandatory operator or action', () => {
    assert.throws(() => {
      createAuditLogEntry({
        userId: '',
        userEmail: 'test@example.com',
        userName: 'Test',
        action: 'TEST',
        entityType: 'SYSTEM',
        entityId: 'sys_1',
        details: {},
      });
    }, /Audit log requires a valid userId/);
  });
});
