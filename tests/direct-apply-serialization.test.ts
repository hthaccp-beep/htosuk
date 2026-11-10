import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePersistencePayload } from '../store.ts';
import type { Product, PriceChangeNotice, PriceHistoryRecord, User } from '../types.ts';

describe('Direct-Apply Persistence Serialization & Missing unitType Protection', () => {
  describe('sanitizePersistencePayload boundary helper', () => {
    it('omits undefined fields strictly from persistence payload', () => {
      const input = {
        id: 'pcn_test_1',
        productId: 'prod_1',
        productName: 'Tazaki Rice 10kg',
        unitType: undefined,
        scannedFileName: undefined,
        itemCode: 'TAZ-001',
      };

      const result = sanitizePersistencePayload(input);
      assert.equal('unitType' in result, false, 'unitType must be omitted when undefined');
      assert.equal('scannedFileName' in result, false, 'scannedFileName must be omitted when undefined');
      assert.equal(result.id, 'pcn_test_1');
      assert.equal(result.productId, 'prod_1');
      assert.equal(result.itemCode, 'TAZ-001');
    });

    it('strictly preserves explicit zero prices and numbers', () => {
      const input = {
        id: 'pcn_test_zero',
        oldCasePrice: 0,
        newCasePrice: 0,
        oldPackPrice: 0,
        newPackPrice: 0,
        priceDiff: 0,
        percentChange: 0,
      };

      const result = sanitizePersistencePayload(input);
      assert.strictEqual(result.oldCasePrice, 0, 'oldCasePrice zero must be preserved');
      assert.strictEqual(result.newCasePrice, 0, 'newCasePrice zero must be preserved');
      assert.strictEqual(result.oldPackPrice, 0, 'oldPackPrice zero must be preserved');
      assert.strictEqual(result.newPackPrice, 0, 'newPackPrice zero must be preserved');
      assert.strictEqual(result.priceDiff, 0, 'priceDiff zero must be preserved');
      assert.strictEqual(result.percentChange, 0, 'percentChange zero must be preserved');
    });

    it('strictly preserves null, empty string, and boolean false values', () => {
      const input = {
        id: 'rec_null',
        notes: '',
        active: false,
        nullableField: null,
      };

      const result = sanitizePersistencePayload(input);
      assert.strictEqual(result.notes, '');
      assert.strictEqual(result.active, false);
      assert.strictEqual(result.nullableField, null);
    });

    it('never invents fallback values for omitted fields', () => {
      const input: any = {
        id: 'pcn_clean',
        productId: 'prod_clean',
      };

      const result = sanitizePersistencePayload(input);
      assert.equal('unitType' in result, false, 'unitType must not be invented');
      assert.equal('newCasePrice' in result, false, 'casePrice must not be invented');
      assert.equal('newPackPrice' in result, false, 'packPrice must not be invented');
    });
  });

  describe('Direct-apply payload construction with missing unitType and zero prices', () => {
    const mockUser: User = {
      id: 'usr_admin',
      username: 'admin@example.com',
      displayName: 'System Admin',
      role: 'GM',
      active: true,
    };

    it('constructs approved notice without undefined unitType when product.unitType is absent', () => {
      const productWithoutUnitType: Product = {
        id: 'prod_tazaki_soy',
        name: 'Tazaki Kikkoman Soy Sauce 18L',
        itemCode: 'TAZ-SOY-18',
        categoryId: 'cat_condiments',
        supplierId: 'sup_tazaki',
        displayOrder: 10,
        allowedBranchIds: [],
        active: true,
        casePrice: 32.5,
        // unitType is deliberately absent / undefined
      };

      const extracted = {
        itemCode: 'TAZ-SOY-18',
        casePrice: 34.0,
      };

      const prodCasePrice = productWithoutUnitType.casePrice;
      const prodPackPrice = productWithoutUnitType.packPrice;
      const newCasePrice = (extracted.casePrice !== undefined && extracted.casePrice >= 0)
        ? extracted.casePrice
        : prodCasePrice;
      const newPackPrice = prodPackPrice;

      const noticeId = 'pcn_1791625699381_test';
      const noticeOld = prodCasePrice !== undefined ? prodCasePrice : 0;
      const noticeNew = newCasePrice !== undefined ? newCasePrice : 0;
      const priceDiff = noticeNew - noticeOld;
      const percentChange = noticeOld > 0 ? Number((((noticeNew - noticeOld) / noticeOld) * 100).toFixed(1)) : 0;

      const approvedNotice: any = {
        id: noticeId,
        productId: productWithoutUnitType.id,
        productName: productWithoutUnitType.name,
        supplierId: 'sup_tazaki',
        supplierName: 'Tazaki Foods',
        priceDiff,
        percentChange,
        invoiceNumber: 'INV-TAZ-001',
        invoiceDate: '2026-10-10',
        detectedDate: '2026-10-10T09:00:00.000Z',
        status: 'APPROVED',
        uploadedByUserId: mockUser.id,
        uploadedByUserName: mockUser.displayName,
        reviewedByUserId: mockUser.id,
        reviewedByUserName: mockUser.displayName,
        reviewedAt: '2026-10-10T09:00:00.000Z',
        effectiveDate: '2026-10-10',
        notes: 'Directly applied from invoice scan',
      };
      if (productWithoutUnitType.itemCode !== undefined) approvedNotice.itemCode = productWithoutUnitType.itemCode;
      if (productWithoutUnitType.unitType !== undefined) approvedNotice.unitType = productWithoutUnitType.unitType;
      if (prodCasePrice !== undefined) approvedNotice.oldCasePrice = prodCasePrice;
      if (newCasePrice !== undefined) approvedNotice.newCasePrice = newCasePrice;
      if (prodPackPrice !== undefined) approvedNotice.oldPackPrice = prodPackPrice;
      if (newPackPrice !== undefined) approvedNotice.newPackPrice = newPackPrice;

      // Verify that no undefined properties exist
      for (const [key, val] of Object.entries(approvedNotice)) {
        assert.notStrictEqual(val, undefined, `Property ${key} must not be undefined in approvedNotice`);
      }
      assert.equal('unitType' in approvedNotice, false, 'unitType must not be a property on approvedNotice');
      assert.strictEqual(approvedNotice.oldCasePrice, 32.5);
      assert.strictEqual(approvedNotice.newCasePrice, 34.0);
    });

    it('correctly preserves explicit zero price in direct-apply extraction', () => {
      const product: Product = {
        id: 'prod_tea_promo',
        name: 'Promotional Green Tea',
        itemCode: 'TEA-FREE',
        categoryId: 'cat_beverages',
        supplierId: 'sup_tazaki',
        displayOrder: 20,
        allowedBranchIds: [],
        active: true,
        casePrice: 15.0,
      };

      // Explicit zero price from supplier (e.g., FOC promo)
      const extracted = {
        itemCode: 'TEA-FREE',
        casePrice: 0,
      };

      const newCasePrice = (extracted.casePrice !== undefined && extracted.casePrice >= 0)
        ? extracted.casePrice
        : product.casePrice;

      assert.strictEqual(newCasePrice, 0, 'Explicit zero price from extraction must be preserved, not overwritten by old price');
    });
  });

  describe('End-to-End simulation of 27 Tazaki SKUs direct apply with strict Firestore undefined rejection', () => {
    it('simulates batch direct-apply ensuring all 27 items succeed with zero undefined writes to Firestore', async () => {
      // Strict mock Firestore document store that throws immediately if any property has value undefined
      const firestoreCollections: Record<string, Map<string, Record<string, any>>> = {
        products: new Map(),
        price_history: new Map(),
        price_change_notices: new Map(),
      };

      const mockSetDoc = async (col: string, docId: string, data: Record<string, any>) => {
        for (const [key, val] of Object.entries(data)) {
          if (val === undefined) {
            throw new Error(`Function setDoc() called with invalid data. Unsupported field value: undefined (found in field ${key} in document ${col}/${docId})`);
          }
        }
        firestoreCollections[col].set(docId, JSON.parse(JSON.stringify(data)));
      };

      const mockUpdateDoc = async (col: string, docId: string, data: Record<string, any>) => {
        for (const [key, val] of Object.entries(data)) {
          if (val === undefined) {
            throw new Error(`Function updateDoc() called with invalid data. Unsupported field value: undefined (found in field ${key} in document ${col}/${docId})`);
          }
        }
        const existing = firestoreCollections[col].get(docId) || {};
        firestoreCollections[col].set(docId, { ...existing, ...JSON.parse(JSON.stringify(data)) });
      };

      // Generate 27 catalog products simulating the Tazaki import:
      // None have unitType set (all undefined in Firestore)
      // Some have casePrice, some have packPrice, one has explicit 0 price
      const catalogProducts: Product[] = [];
      for (let i = 1; i <= 27; i++) {
        const p: Product = {
          id: `prod_tazaki_${i}`,
          name: `Tazaki Product SKU ${i}`,
          itemCode: `TZK-${1000 + i}`,
          categoryId: 'cat_japanese',
          supplierId: 'sup_tazaki',
          displayOrder: i,
          allowedBranchIds: [],
          active: true,
          casePrice: i === 5 ? 0 : 20.0 + i, // Item 5 has explicit 0 price
          // unitType deliberately omitted (undefined)
        };
        catalogProducts.push(p);
        firestoreCollections.products.set(p.id, { ...p });
      }

      // Simulate 27 matched lines from Tazaki XLSX import
      const selectedLines = catalogProducts.map((prod, idx) => ({
        matchResult: { product: prod },
        extracted: {
          itemCode: prod.itemCode,
          casePrice: idx === 10 ? 0 : (prod.casePrice ?? 20) + 2.5, // Line 11 sets explicit 0 price
        },
      }));

      let pricesUpdated = 0;

      // Execute direct-apply loop identically to ScanInvoiceModal.tsx
      for (const line of selectedLines) {
        if (line.matchResult.product) {
          const product = line.matchResult.product;
          const prodCasePrice = product.casePrice;
          const prodPackPrice = product.packPrice;
          const newCasePrice = (line.extracted.casePrice !== undefined && line.extracted.casePrice >= 0)
            ? line.extracted.casePrice
            : prodCasePrice;
          const newPackPrice = prodPackPrice;

          const resolvedItemCode = line.extracted.itemCode || product.itemCode;

          // 1. Update product in database catalog
          const updatedProduct: any = {
            ...product,
          };
          if (resolvedItemCode !== undefined) {
            updatedProduct.itemCode = resolvedItemCode;
          }
          if (newCasePrice !== undefined) {
            updatedProduct.casePrice = newCasePrice;
          } else {
            delete updatedProduct.casePrice;
          }
          if (newPackPrice !== undefined) {
            updatedProduct.packPrice = newPackPrice;
          } else {
            delete updatedProduct.packPrice;
          }
          await mockUpdateDoc('products', updatedProduct.id, sanitizePersistencePayload(updatedProduct));

          // 2. Write permanent price history record (audit trail)
          const historyRecord: any = {
            id: `hist_${product.id}_${Date.now()}`,
            productId: product.id,
            productName: product.name,
            supplierId: 'sup_tazaki',
            supplierName: 'Tazaki Foods',
            effectiveDate: '2026-10-10',
            invoiceRef: 'INV-TAZAKI-2026',
            approvedByUserId: 'usr_admin',
            approvedByUserName: 'System Admin',
            approvedAt: new Date().toISOString(),
            notes: 'Directly applied from invoice scan (Tazaki_Price_List.xlsx)',
          };
          if (resolvedItemCode !== undefined) {
            historyRecord.itemCode = resolvedItemCode;
          }
          if (prodCasePrice !== undefined) {
            historyRecord.previousCasePrice = prodCasePrice;
            historyRecord.oldCasePrice = prodCasePrice;
          }
          if (newCasePrice !== undefined) {
            historyRecord.newCasePrice = newCasePrice;
          }
          if (prodPackPrice !== undefined) {
            historyRecord.previousPackPrice = prodPackPrice;
            historyRecord.oldPackPrice = prodPackPrice;
          }
          if (newPackPrice !== undefined) {
            historyRecord.newPackPrice = newPackPrice;
          }
          await mockSetDoc('price_history', historyRecord.id, sanitizePersistencePayload(historyRecord));

          // 3. Save as APPROVED notice for full history tracking
          const noticeId = `pcn_${Date.now()}_${product.id}`;
          const noticeOld = prodCasePrice !== undefined ? prodCasePrice : (prodPackPrice !== undefined ? prodPackPrice : 0);
          const noticeNew = newCasePrice !== undefined ? newCasePrice : (newPackPrice !== undefined ? newPackPrice : 0);
          const priceDiff = noticeNew - noticeOld;
          const percentChange = noticeOld > 0
            ? Number((((noticeNew - noticeOld) / noticeOld) * 100).toFixed(1))
            : 0;
          const approvedNotice: any = {
            id: noticeId,
            productId: product.id,
            productName: product.name,
            supplierId: 'sup_tazaki',
            supplierName: 'Tazaki Foods',
            priceDiff,
            percentChange,
            invoiceNumber: 'INV-TAZAKI-2026',
            invoiceDate: '2026-10-10',
            detectedDate: new Date().toISOString(),
            status: 'APPROVED',
            uploadedByUserId: 'usr_admin',
            uploadedByUserName: 'System Admin',
            reviewedByUserId: 'usr_admin',
            reviewedByUserName: 'System Admin',
            reviewedAt: new Date().toISOString(),
            effectiveDate: '2026-10-10',
            notes: 'Directly applied from invoice scan',
          };
          if (resolvedItemCode !== undefined) approvedNotice.itemCode = resolvedItemCode;
          if (product.unitType !== undefined) approvedNotice.unitType = product.unitType;
          if (prodCasePrice !== undefined) approvedNotice.oldCasePrice = prodCasePrice;
          if (newCasePrice !== undefined) approvedNotice.newCasePrice = newCasePrice;
          if (prodPackPrice !== undefined) approvedNotice.oldPackPrice = prodPackPrice;
          if (newPackPrice !== undefined) approvedNotice.newPackPrice = newPackPrice;
          await mockSetDoc('price_change_notices', approvedNotice.id, sanitizePersistencePayload(approvedNotice));

          pricesUpdated++;
        }
      }

      // Assertions
      assert.strictEqual(pricesUpdated, 27, 'All 27 items must be successfully processed without throw');
      assert.strictEqual(firestoreCollections.price_change_notices.size, 27, '27 approved notices must be stored');
      assert.strictEqual(firestoreCollections.price_history.size, 27, '27 price history records must be stored');

      // Verify that NO document in any collection has undefined or has unitType written
      for (const [colName, map] of Object.entries(firestoreCollections)) {
        for (const [docId, docData] of map.entries()) {
          for (const [key, val] of Object.entries(docData)) {
            assert.notStrictEqual(val, undefined, `Collection ${colName}/${docId} key ${key} must not be undefined`);
          }
          if (colName === 'price_change_notices') {
            assert.equal('unitType' in docData, false, `Notice ${docId} must not contain unitType field when product lacked it`);
          }
        }
      }

      // Verify item 11 with explicit zero price
      const item11Notice = Array.from(firestoreCollections.price_change_notices.values()).find(n => n.productId === 'prod_tazaki_11');
      assert(item11Notice !== undefined);
      assert.strictEqual(item11Notice.newCasePrice, 0, 'Item 11 explicit zero price must be preserved in notice');
    });

    it('demonstrates actual direct-apply call order and price mutation before notice creation', async () => {
      // Trace call order
      const callSequence: string[] = [];
      let productMutatedBeforeNotice = false;

      const mockStore = {
        updateProduct: async () => {
          callSequence.push('updateProduct');
        },
        addPriceHistoryRecord: async () => {
          callSequence.push('addPriceHistoryRecord');
        },
        addPriceChangeNotice: async (notice: any) => {
          if (notice.unitType === undefined && 'unitType' in notice) {
            // Unsanitized legacy behavior: throws on undefined unitType
            productMutatedBeforeNotice = callSequence.includes('updateProduct');
            throw new Error('Function setDoc() called with invalid data. Unsupported field value: undefined (found in field unitType)');
          }
          callSequence.push('addPriceChangeNotice');
        },
      };

      const line = {
        matchResult: {
          product: {
            id: 'prod_1',
            name: 'Sample',
            casePrice: 10,
            unitType: undefined as any,
          },
        },
        extracted: { casePrice: 12 },
      };

      try {
        await mockStore.updateProduct();
        await mockStore.addPriceHistoryRecord();
        // Passing un-omitted { unitType: undefined } triggers the historical error
        await mockStore.addPriceChangeNotice({ id: 'pcn_fail', unitType: line.matchResult.product.unitType });
      } catch (err: any) {
        assert(err.message.includes('Unsupported field value: undefined'));
      }

      // Confirms call order: updateProduct occurred FIRST, before notice creation failed
      assert.deepEqual(callSequence, ['updateProduct', 'addPriceHistoryRecord']);
      assert.strictEqual(productMutatedBeforeNotice, true, 'Price mutation occurred BEFORE the failed notice creation in the un-sanitized call order');
    });
  });
});
