import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderTotals } from '../utils/orderPricing.ts';
import type { OrderItem, ManualOrderItem, Product } from '../types.ts';

describe('Order Pricing Totals and Manual Item Pricing (Issue 10)', () => {
  const sampleProducts: Product[] = [
    {
      id: 'p_salmon',
      name: 'Fresh Atlantic Salmon Fillet',
      categoryId: 'cat_fish',
      supplierId: 's_jfc',
      active: true,
      casePrice: 85.50,
      packPrice: 15.00,
      caseUnitName: 'Case (10kg)',
      packUnitName: 'Fillet (1kg)',
      packSize: '10x1kg',
      displayOrder: 1,
      allowedBranchIds: [],
      vatRate: 0, // Zero-rated food
    },
    {
      id: 'p_sauce',
      name: 'Soy Sauce Dark',
      categoryId: 'cat_sauce',
      supplierId: 's_jfc',
      active: true,
      casePrice: 32.00,
      packPrice: 5.50,
      caseUnitName: 'Case (6x1L)',
      packUnitName: 'Bottle (1L)',
      displayOrder: 2,
      allowedBranchIds: [],
      vatRate: 0,
    },
    {
      id: 'p_cleaning',
      name: 'Kitchen Sanitizer Spray',
      categoryId: 'cat_chem',
      supplierId: 's_jfc',
      active: true,
      casePrice: 24.00,
      packPrice: 4.50,
      displayOrder: 3,
      allowedBranchIds: [],
      vatRate: 0.20, // Standard 20% VAT
    },
  ];

  // =========================================================================
  // 1. STANDARD CATALOG ITEMS WITH MIXED CASE & PACK QUANTITIES
  // =========================================================================
  it('correctly calculates mixed case and pack totals for standard catalog items', () => {
    const cartItems: OrderItem[] = [
      {
        productId: 'p_salmon',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        caseQty: 2, // 2 * 85.50 = 171.00
        packQty: 3, // 3 * 15.00 = 45.00 -> total line = 216.00
        casePriceSnapshot: 85.50,
        packPriceSnapshot: 15.00,
        vatRate: 0,
      },
      {
        productId: 'p_sauce',
        productNameSnapshot: 'Soy Sauce Dark',
        caseQty: 1, // 1 * 32.00 = 32.00
        packQty: 2, // 2 * 5.50 = 11.00 -> total line = 43.00
        casePriceSnapshot: 32.00,
        packPriceSnapshot: 5.50,
        vatRate: 0,
      },
    ];

    const totals = calculateOrderTotals(cartItems, [], sampleProducts);

    assert.equal(totals.catalogSubtotal, 259.00); // 216.00 + 43.00
    assert.equal(totals.manualConfirmedSubtotal, 0);
    assert.equal(totals.manualEstimatedSubtotal, 0);
    assert.equal(totals.vatTotal, 0);
    assert.equal(totals.grandTotal, 259.00);
    assert.equal(totals.isExact, true);
    assert.equal(totals.hasUnpricedItems, false);
    assert.equal(totals.hasEstimatedPrices, false);
    assert.equal(totals.totalPricedUnits, 8); // (2+3) + (1+2)
  });

  it('honors durable price snapshots on cart items even if product catalog changed', () => {
    const cartItems: OrderItem[] = [
      {
        productId: 'p_salmon',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        caseQty: 1,
        packQty: 0,
        casePriceSnapshot: 79.99, // Snapshot was locked at £79.99
        packPriceSnapshot: 15.00,
        vatRate: 0,
      },
    ];

    // Catalog has price 85.50, but snapshot has 79.99
    const totals = calculateOrderTotals(cartItems, [], sampleProducts);
    assert.equal(totals.catalogSubtotal, 79.99);
    assert.equal(totals.grandTotal, 79.99);
  });

  // =========================================================================
  // 2. MANUAL CUSTOM ITEMS WITH ESTIMATED PRICING
  // =========================================================================
  it('includes manual items with estimated prices in order subtotal and grand total', () => {
    const cartItems: OrderItem[] = [
      {
        productId: 'p_salmon',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        caseQty: 1, // 85.50
        packQty: 0,
        casePriceSnapshot: 85.50,
        vatRate: 0,
      },
    ];

    const manualItems: ManualOrderItem[] = [
      {
        id: 'man_1',
        description: 'Special Wasabi Root Fresh (Shizuoka)',
        caseQty: 2, // 2 boxes @ estimated £45.00 = £90.00
        packQty: 0,
        casePriceSnapshot: 45.00,
        pricingStatus: 'ESTIMATED',
        vatRate: 0,
      },
      {
        id: 'man_2',
        description: 'Bespoke Bento Chopstick Sleeves',
        caseQty: 0,
        packQty: 3, // 3 packs @ estimated £8.50 = £25.50
        packPriceSnapshot: 8.50,
        pricingStatus: 'ESTIMATED',
        vatRate: 0,
      },
    ];

    const totals = calculateOrderTotals(cartItems, manualItems, sampleProducts);

    assert.equal(totals.catalogSubtotal, 85.50);
    assert.equal(totals.manualEstimatedSubtotal, 115.50); // 90.00 + 25.50
    assert.equal(totals.pricedSubtotal, 201.00); // 85.50 + 115.50
    assert.equal(totals.grandTotal, 201.00);
    assert.equal(totals.hasEstimatedPrices, true);
    assert.equal(totals.isExact, false);
    assert.ok(totals.summaryText.includes('estimated manual items'));
  });

  // =========================================================================
  // 3. UNPRICED MANUAL ITEMS AWAITING SUPPLIER QUOTE
  // =========================================================================
  it('identifies unpriced manual items, tracks count, and flags unpriced state', () => {
    const cartItems: OrderItem[] = [
      {
        productId: 'p_sauce',
        productNameSnapshot: 'Soy Sauce Dark',
        caseQty: 2, // 64.00
        packQty: 0,
        casePriceSnapshot: 32.00,
        vatRate: 0,
      },
    ];

    const manualItems: ManualOrderItem[] = [
      {
        id: 'man_unpriced',
        description: 'Seasonal Japanese Matsutake Mushroom (Ask Supplier for Quote)',
        caseQty: 1,
        packQty: 0,
        // No price entered!
      },
    ];

    const totals = calculateOrderTotals(cartItems, manualItems, sampleProducts);

    assert.equal(totals.catalogSubtotal, 64.00);
    assert.equal(totals.manualEstimatedSubtotal, 0);
    assert.equal(totals.pricedSubtotal, 64.00);
    assert.equal(totals.grandTotal, 64.00);
    assert.equal(totals.hasUnpricedItems, true);
    assert.equal(totals.unpricedItemCount, 1);
    assert.equal(totals.isExact, false);
    assert.ok(totals.summaryText.includes('awaiting quote') || totals.summaryText.includes('unpriced'));

    const unpricedItem = totals.items.find((i) => i.id === 'man_unpriced');
    assert.equal(unpricedItem?.pricingStatus, 'UNPRICED');
    assert.equal(unpricedItem?.lineSubtotal, 0);
  });

  // =========================================================================
  // 4. VAT CALCULATIONS (STANDARD 20% vs ZERO-RATED)
  // =========================================================================
  it('accurately computes VAT for standard-rated items alongside zero-rated food items', () => {
    const cartItems: OrderItem[] = [
      {
        productId: 'p_salmon',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        caseQty: 1, // 85.50 @ 0% VAT
        packQty: 0,
        casePriceSnapshot: 85.50,
        vatRate: 0,
      },
      {
        productId: 'p_cleaning',
        productNameSnapshot: 'Kitchen Sanitizer Spray',
        caseQty: 2, // 2 * 24.00 = 48.00 @ 20% VAT = 9.60 VAT
        packQty: 0,
        casePriceSnapshot: 24.00,
        vatRate: 0.20,
      },
    ];

    const totals = calculateOrderTotals(cartItems, [], sampleProducts);

    assert.equal(totals.catalogSubtotal, 133.50); // 85.50 + 48.00
    assert.equal(totals.vatTotal, 9.60); // 48.00 * 0.20
    assert.equal(totals.grandTotal, 143.10); // 133.50 + 9.60
    assert.ok(totals.summaryText.includes('VAT: £9.60'));
  });

  // =========================================================================
  // 5. COMBINED MIXED ORDER WITH CATALOG, ESTIMATED, UNPRICED & VAT
  // =========================================================================
  it('handles a complex mixed order with catalog items, estimated custom items, unpriced items, and VAT', () => {
    const cartItems: OrderItem[] = [
      {
        productId: 'p_salmon',
        productNameSnapshot: 'Fresh Atlantic Salmon Fillet',
        caseQty: 1, // 85.50
        packQty: 2, // 30.00 -> 115.50, VAT 0
        casePriceSnapshot: 85.50,
        packPriceSnapshot: 15.00,
        vatRate: 0,
      },
      {
        productId: 'p_cleaning',
        productNameSnapshot: 'Kitchen Sanitizer Spray',
        caseQty: 1, // 24.00, VAT 4.80 -> 28.80
        packQty: 0,
        casePriceSnapshot: 24.00,
        vatRate: 0.20,
      },
    ];

    const manualItems: ManualOrderItem[] = [
      {
        id: 'man_est_vat',
        description: 'Branded Takeaway Carrier Bags',
        caseQty: 2, // 2 * 30.00 = 60.00, VAT 20% = 12.00 -> 72.00
        packQty: 0,
        casePriceSnapshot: 30.00,
        pricingStatus: 'ESTIMATED',
        vatRate: 0.20,
      },
      {
        id: 'man_unpriced',
        description: 'Sample Dessert Bowls',
        caseQty: 1,
        packQty: 0,
      },
    ];

    const totals = calculateOrderTotals(cartItems, manualItems, sampleProducts);

    // Subtotal = 115.50 + 24.00 + 60.00 = 199.50
    assert.equal(totals.pricedSubtotal, 199.50);
    // VAT = 0 + 4.80 + 12.00 = 16.80
    assert.equal(totals.vatTotal, 16.80);
    // Grand Total = 199.50 + 16.80 = 216.30
    assert.equal(totals.grandTotal, 216.30);
    assert.equal(totals.hasEstimatedPrices, true);
    assert.equal(totals.hasUnpricedItems, true);
    assert.equal(totals.unpricedItemCount, 1);
    assert.equal(totals.isExact, false);
  });
});
