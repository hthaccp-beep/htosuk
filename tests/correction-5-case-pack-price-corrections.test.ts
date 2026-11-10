import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileSingleLine,
  calculateOrderReconciliation,
  type ReconciledLineInput,
} from '../utils/invoiceReconciliation.ts';
import { comparePrices } from '../utils/priceMatching.ts';
import {
  validatePriceNoticeCreation,
  validatePriceNoticeReview,
  PriceApprovalError,
  type AuthenticatedUser,
} from '../server/price-approval-service.ts';
import { activateDuePriceNotices } from '../utils/priceScheduler.ts';
import type { Product, PriceChangeNotice, OrderRecord } from '../types.ts';

describe('Correction 5: Case/pack price handling corrections', () => {

  describe('1. Reconciliation & Overcharge Classification Isolation', () => {
    it('does NOT misclassify case shortage as PRICE_OVERCHARGE when unused pack price exceeds expected', () => {
      // Ordered: 5 Boxes @ £20.00, 0 Packs (expected pack price is £4.00)
      // Delivered: 3 Boxes (2 boxes short = £40 discrepancy)
      // Invoiced: 5 Boxes @ £20.00, but invoicedPackPrice is populated as £8.00 (e.g. from an OCR artifact or test)
      // Total invoiced: 5 * £20 = £100. Accepted value: 3 * £20 = £60. Discrepancy: £40.
      const line: ReconciledLineInput = {
        productId: 'prod-salmon',
        description: 'Fresh Salmon Fillet Box',
        unit: 'CASE',
        orderedCaseQty: 5,
        orderedPackQty: 0,
        deliveredCaseQty: 3,
        deliveredPackQty: 0,
        expectedCasePrice: 20.00,
        expectedPackPrice: 4.00,
        invoicedCasePrice: 20.00, // Case rate is EXACT match (£20.00)
        invoicedPackPrice: 8.00,  // Pack rate is higher, BUT 0 packs were ordered or delivered!
        invoicedLineTotal: 100.00,
        isReviewed: true,
      };

      const result = reconcileSingleLine(line);

      assert.equal(result.claimAmount, 40.00, 'Claim amount must equal billed shortage (£40)');
      assert.equal(result.issueType, 'SHORTAGE', 'Issue type must be SHORTAGE, NOT PRICE_OVERCHARGE');
    });

    it('does NOT misclassify pack shortage as PRICE_OVERCHARGE when unused case price exceeds expected', () => {
      // Ordered: 0 Boxes, 10 Packs @ £5.00 (expected case price is £50.00)
      // Delivered: 6 Packs (4 packs short = £20 discrepancy)
      // Invoiced: 10 Packs @ £5.00, but invoicedCasePrice is £75.00 (higher than £50, but 0 boxes involved)
      const line: ReconciledLineInput = {
        productId: 'prod-wasabi',
        description: 'Fresh Wasabi Paste Pack',
        unit: 'PACK',
        orderedCaseQty: 0,
        orderedPackQty: 10,
        deliveredCaseQty: 0,
        deliveredPackQty: 6,
        expectedCasePrice: 50.00,
        expectedPackPrice: 5.00,
        invoicedCasePrice: 75.00, // Unused case rate
        invoicedPackPrice: 5.00,  // Exact pack rate
        invoicedLineTotal: 50.00,
        isReviewed: true,
      };

      const result = reconcileSingleLine(line);

      assert.equal(result.claimAmount, 20.00);
      assert.equal(result.issueType, 'SHORTAGE', 'Must be SHORTAGE when pack rate matches agreed price');
    });

    it('correctly classifies PRICE_OVERCHARGE when the active ordered unit rate is overcharged', () => {
      const line: ReconciledLineInput = {
        productId: 'prod-tuna',
        description: 'Bluefin Tuna Loin Box',
        unit: 'CASE',
        orderedCaseQty: 2,
        orderedPackQty: 0,
        deliveredCaseQty: 2,
        deliveredPackQty: 0,
        expectedCasePrice: 100.00,
        expectedPackPrice: 20.00,
        invoicedCasePrice: 120.00, // £20 overcharge per box = £40 total
        invoicedPackPrice: 20.00,
        invoicedLineTotal: 240.00,
        isReviewed: true,
      };

      const result = reconcileSingleLine(line);

      assert.equal(result.claimAmount, 40.00);
      assert.equal(result.issueType, 'PRICE_OVERCHARGE');
    });

    it('formats Credit Note Claim items with pack rates for pack-only items', () => {
      const baseOrder: OrderRecord = {
        id: 'ord-corr5-01',
        branchId: 'b1',
        branchNameSnapshot: 'Branch 1',
        supplierId: 's1',
        supplierNameSnapshot: 'Supplier 1',
        orderedByNameSnapshot: 'Chef',
        orderedByUserId: 'usr-1',
        emailTo: 'supplier@example.com',
        status: 'PLACED',
        createdAt: '2026-10-01T00:00:00Z',
        items: [],
        manualItems: [],
      };

      // Order with a pack-only item that has casePrice: £100 (catalogue) but packPrice: £10
      const packLine: ReconciledLineInput = {
        productId: 'prod-nori',
        description: 'Crispy Nori Seaweed Pack',
        unit: 'PACK',
        orderedCaseQty: 0,
        orderedPackQty: 10,
        deliveredCaseQty: 0,
        deliveredPackQty: 5, // 5 short @ £10 = £50 claim
        expectedCasePrice: 100.00,
        expectedPackPrice: 10.00,
        invoicedCasePrice: 100.00,
        invoicedPackPrice: 10.00,
        invoicedLineTotal: 100.00, // Billed full 10 packs
        isReviewed: true,
      };

      const reconciliation = calculateOrderReconciliation(baseOrder, [packLine], {
        invoiceNumber: 'INV-PACK-01',
        invoiceDate: '2026-10-01',
      });

      assert.ok(reconciliation.creditNoteClaim, 'Credit note claim must be created');
      assert.equal(reconciliation.creditNoteClaim.items.length, 1);
      const claimItem = reconciliation.creditNoteClaim.items[0];

      assert.equal(claimItem.expectedPrice, 10.00, 'Claim item must display pack price (£10.00), not case price (£100.00)');
      assert.equal(claimItem.invoicedPrice, 10.00, 'Claim item must display invoiced pack price (£10.00)');
      assert.equal(claimItem.claimAmount, 50.00);
    });
  });

  describe('2. UnitType Price Comparison in priceMatching.ts', () => {
    it('compares against packPrice when product is PACK_ONLY even if detectedCasePrice has residual value', () => {
      const packProduct: Product = {
        id: 'prod-sauce',
        name: 'Soy Sauce Bottle',
        unitType: 'PACK_ONLY',
        casePrice: 60.00, // residual legacy box price
        packPrice: 5.00,  // active pack price
        categoryId: 'cat-1',
        supplierId: 's1',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
      };

      // Invoice detected pack price changed from £5.00 to £5.50 (+10%)
      const comparison = comparePrices(0, 5.50, packProduct);

      assert.equal(comparison.priceType, 'PACK');
      assert.equal(comparison.oldPrice, 5.00);
      assert.equal(comparison.newPrice, 5.50);
      assert.equal(comparison.percentChange, 10);
      assert.equal(comparison.hasPriceChange, true);
    });

    it('compares against casePrice when product is CASE_ONLY', () => {
      const caseProduct: Product = {
        id: 'prod-beef',
        name: 'Wagyu Beef Crate',
        unitType: 'CASE_ONLY',
        casePrice: 200.00,
        packPrice: 20.00, // residual pack price
        categoryId: 'cat-1',
        supplierId: 's1',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
      };

      const comparison = comparePrices(220.00, 0, caseProduct);

      assert.equal(comparison.priceType, 'CASE');
      assert.equal(comparison.oldPrice, 200.00);
      assert.equal(comparison.newPrice, 220.00);
      assert.equal(comparison.percentChange, 10);
    });
  });

  describe('3. Price Approval Security for Pack Prices', () => {
    it('rejects self-approval when non-admin user approves notice with PACK price increase', () => {
      const uploaderStaff: AuthenticatedUser = {
        id: 'staff-uploader-1',
        role: 'STAFF',
        branchId: 'b1',
        active: true,
        displayName: 'Staff Chef',
        permissions: ['approve_price_changes'],
      };

      const packPriceIncreaseNotice: PriceChangeNotice = {
        id: 'notice-pack-1',
        productId: 'prod-sesame',
        productName: 'Roasted Sesame Seeds',
        supplierId: 's1',
        supplierName: 'Sesame Direct',
        oldCasePrice: 50.00,
        newCasePrice: 50.00, // Case price unchanged
        oldPackPrice: 4.00,
        newPackPrice: 6.00,  // Pack price increased (+50%)
        priceDiff: 2.00,
        percentChange: 50,
        invoiceNumber: 'INV-SESAME-01',
        invoiceDate: '2026-10-01',
        detectedDate: '2026-10-01T00:00:00Z',
        status: 'PENDING',
        uploadedByUserId: 'staff-uploader-1', // Same user!
        uploadedByUserName: 'Staff Chef',
      };

      assert.throws(
        () => {
          validatePriceNoticeReview(uploaderStaff, packPriceIncreaseNotice, {
            status: 'APPROVED',
            reviewedByUserId: 'staff-uploader-1',
          });
        },
        (err: any) => {
          assert.equal(err.status, 403);
          assert.ok(err.message.includes('Non-admin users cannot approve their own proposed price increases'));
          return true;
        }
      );
    });

    it('rejects negative pack prices during notice validation', () => {
      const user: AuthenticatedUser = {
        id: 'usr-1',
        role: 'STAFF',
        branchId: 'b1',
        active: true,
        displayName: 'Staff',
      };

      assert.throws(
        () => {
          validatePriceNoticeCreation(user, {
            id: 'n1',
            productId: 'p1',
            supplierId: 's1',
            invoiceNumber: 'INV-1',
            oldCasePrice: 10,
            newCasePrice: 10,
            oldPackPrice: -5.00, // Negative!
            newPackPrice: 10,
            uploadedByUserId: 'usr-1',
            status: 'PENDING',
          });
        },
        (err: any) => {
          assert.equal(err.status, 400);
          assert.ok(err.message.includes('Old pack price must be a non-negative number'));
          return true;
        }
      );
    });
  });

  describe('4. Scheduled Price Activation Preserves Unaffected Unit Price', () => {
    it('preserves existing case price when activating notice for pack price update only', () => {
      const initialProducts: Product[] = [
        {
          id: 'prod-sake',
          name: 'Cooking Sake',
          casePrice: 48.00, // Should NOT be overwritten with 0!
          packPrice: 4.00,
          categoryId: 'cat-drinks',
          supplierId: 's1',
          displayOrder: 1,
          allowedBranchIds: [],
          active: true,
        },
      ];

      const notice: PriceChangeNotice = {
        id: 'notice-sake-pack',
        productId: 'prod-sake',
        productName: 'Cooking Sake',
        supplierId: 's1',
        supplierName: 'Drinks Direct',
        oldCasePrice: 48.00,
        newCasePrice: 0,    // 0 because notice only concerns pack price!
        oldPackPrice: 4.00,
        newPackPrice: 5.50, // Updated pack price
        priceDiff: 1.50,
        percentChange: 37.5,
        invoiceNumber: 'INV-SAKE-01',
        invoiceDate: '2026-10-01',
        detectedDate: '2026-10-01T00:00:00Z',
        effectiveDate: '2026-10-05',
        status: 'APPROVED',
        uploadedByUserId: 'admin-1',
        uploadedByUserName: 'Admin',
      };

      const result = activateDuePriceNotices({
        notices: [notice],
        products: initialProducts,
        currentDateIso: '2026-10-05',
      });

      assert.equal(result.updatedProducts.length, 1);
      const updatedSake = result.updatedProducts[0];

      assert.equal(updatedSake.casePrice, 48.00, 'Case price must remain intact (£48.00)');
      assert.equal(updatedSake.packPrice, 5.50, 'Pack price must be updated to £5.50');
    });
  });

});
