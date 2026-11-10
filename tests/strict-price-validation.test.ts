import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStrictPrice,
  validateNumericPrice,
  executePriceChangeOperation,
  PriceOperationError,
  type AuthContext,
  type PriceChangeRequest,
  type PriceChangeServiceDependencies,
} from '../server/price-change-service.ts';
import type { Product, PriceChangeNotice, PriceHistoryRecord } from '../types.ts';

describe('Strict Price Validation and Missing vs Zero Preservation (Issue 1)', () => {
  const adminUser: AuthContext = {
    id: 'usr_admin_1',
    displayName: 'Admin User',
    role: 'GM',
    active: true,
  };

  describe('Pure Parser Semantics (parseStrictPrice / validateNumericPrice)', () => {
    it('treats undefined, null, empty string, and whitespace-only as omitted (undefined)', () => {
      assert.equal(parseStrictPrice(undefined), undefined);
      assert.equal(parseStrictPrice(null), undefined);
      assert.equal(parseStrictPrice(''), undefined);
      assert.equal(parseStrictPrice('   '), undefined);
      assert.equal(parseStrictPrice('\t\n  '), undefined);

      // Alias check
      assert.equal(validateNumericPrice(undefined, 'price'), undefined);
      assert.equal(validateNumericPrice('  ', 'price'), undefined);
    });

    it('treats numeric 0 and string 0 / 0.00 as explicit zero', () => {
      assert.strictEqual(parseStrictPrice(0), 0);
      assert.strictEqual(parseStrictPrice('0'), 0);
      assert.strictEqual(parseStrictPrice('0.0'), 0);
      assert.strictEqual(parseStrictPrice('0.00'), 0);
      assert.strictEqual(parseStrictPrice('   0.00   '), 0);
      assert.strictEqual(parseStrictPrice(-0), 0);
    });

    it('accepts finite nonnegative numeric values and complete decimal strings', () => {
      assert.strictEqual(parseStrictPrice(42), 42);
      assert.strictEqual(parseStrictPrice('42'), 42);
      assert.strictEqual(parseStrictPrice(19.99), 19.99);
      assert.strictEqual(parseStrictPrice('19.99'), 19.99);
    });

    it('preserves precision supported by the product model without undocumented rounding', () => {
      // 3-decimal and 4-decimal values must remain exact
      assert.strictEqual(parseStrictPrice(12.3456), 12.3456);
      assert.strictEqual(parseStrictPrice('12.3456'), 12.3456);
      assert.strictEqual(parseStrictPrice('0.0025'), 0.0025);
    });

    it('normalizes GBP (£) prefix and valid UK thousands groupings strictly', () => {
      assert.strictEqual(parseStrictPrice('£12.50'), 12.5);
      assert.strictEqual(parseStrictPrice('£ 12.50'), 12.5);
      assert.strictEqual(parseStrictPrice('£1,234.50'), 1234.5);
      assert.strictEqual(parseStrictPrice('1,234.50'), 1234.5);
      assert.strictEqual(parseStrictPrice('1,234,567.89'), 1234567.89);
      assert.strictEqual(parseStrictPrice('2,000'), 2000);
    });

    it('rejects foreign currency symbols ($ or € or ¥) in a GBP catalogue', () => {
      assert.throws(() => parseStrictPrice('$10.00'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400 && err.message.includes('Foreign currency');
      });
      assert.throws(() => parseStrictPrice('$1,234.50'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400 && err.message.includes('Foreign currency');
      });
      assert.throws(() => parseStrictPrice('€500'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400 && err.message.includes('Foreign currency');
      });
      assert.throws(() => parseStrictPrice('¥2000'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400 && err.message.includes('Foreign currency');
      });
    });

    it('rejects partial parses such as 12abc or abc12', () => {
      assert.throws(() => parseStrictPrice('12abc'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400 && err.message.includes('12abc');
      });
      assert.throws(() => parseStrictPrice('abc12'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400;
      });
      assert.throws(() => parseStrictPrice('12.34xyz'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400;
      });
    });

    it('rejects ambiguous or invalid separators', () => {
      // "1,23" is not a valid 3-digit thousands group
      assert.throws(() => parseStrictPrice('1,23'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400;
      });
      // Multiple decimal points
      assert.throws(() => parseStrictPrice('1.234.50'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400;
      });
      // Trailing comma
      assert.throws(() => parseStrictPrice('1,234,'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400;
      });
    });

    it('rejects booleans, arrays, objects, NaN, Infinity, and negatives', () => {
      assert.throws(() => parseStrictPrice(true), PriceOperationError);
      assert.throws(() => parseStrictPrice(false), PriceOperationError);
      assert.throws(() => parseStrictPrice([]), PriceOperationError);
      assert.throws(() => parseStrictPrice([12]), PriceOperationError);
      assert.throws(() => parseStrictPrice({}), PriceOperationError);
      assert.throws(() => parseStrictPrice({ price: 10 }), PriceOperationError);
      assert.throws(() => parseStrictPrice(NaN), PriceOperationError);
      assert.throws(() => parseStrictPrice(Infinity), PriceOperationError);
      assert.throws(() => parseStrictPrice(-Infinity), PriceOperationError);
      assert.throws(() => parseStrictPrice(-5), PriceOperationError);
      assert.throws(() => parseStrictPrice('-5'), PriceOperationError);
      assert.throws(() => parseStrictPrice('-0.01'), PriceOperationError);
    });

    it('rejects unsupported exponential strings', () => {
      assert.throws(() => parseStrictPrice('1e5'), (err: any) => {
        return err instanceof PriceOperationError && err.status === 400 && err.message.includes('exponential');
      });
      assert.throws(() => parseStrictPrice('2E-3'), PriceOperationError);
    });

    it('rejects empty string after currency symbol', () => {
      assert.throws(() => parseStrictPrice('£'), PriceOperationError);
      assert.throws(() => parseStrictPrice('£   '), PriceOperationError);
    });
  });

  describe('Pre-validation: Zero Writes on Later Malformed Row', () => {
    it('aborts batch and executes ZERO persistence calls if a later row is malformed', async () => {
      let getProductCalls = 0;
      let saveProductCalls = 0;
      let createHistoryCalls = 0;

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => {
          getProductCalls++;
          return null;
        },
        saveProduct: async () => {
          saveProductCalls++;
        },
        createPriceHistory: async () => {
          createHistoryCalls++;
        },
      };

      const req: PriceChangeRequest = {
        action: 'BATCH_CSV_UPDATE',
        supplierId: 'sup_tazaki',
        items: [
          { productId: 'prod_1', newCasePrice: 15.5 },
          { productId: 'prod_2', newCasePrice: 20.0 },
          { productId: 'prod_3', newCasePrice: '12abc' as any }, // Malformed final row!
        ],
      };

      await assert.rejects(
        async () => {
          await executePriceChangeOperation(adminUser, req, deps);
        },
        (err: any) => {
          assert(err instanceof PriceOperationError);
          assert.equal(err.status, 400);
          assert(err.message.includes('12abc'));
          return true;
        }
      );

      // Verify ZERO calls were made to any database persistence dependencies
      assert.equal(getProductCalls, 0, 'deps.getProduct must not be called when batch fails pre-validation');
      assert.equal(saveProductCalls, 0, 'deps.saveProduct must not be called when batch fails pre-validation');
      assert.equal(createHistoryCalls, 0, 'deps.createPriceHistory must not be called when batch fails pre-validation');
    });
  });

  describe('Preservation of Absent Prices vs. Explicit Zero', () => {
    it('preserves absent casePrice/packPrice when omitted in update, without materializing 0 or undefined', async () => {
      // Product initially has NO packPrice (absent/undefined)
      const existingProduct: Product = {
        id: 'prod_salmon',
        name: 'Salmon Fillet',
        categoryId: 'cat_fish',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        casePrice: 45.0,
        // packPrice is absent
      };

      let savedProduct: Product | null = null;
      let historyRecord: PriceHistoryRecord | null = null;

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...existingProduct }),
        saveProduct: async (p) => {
          savedProduct = p;
        },
        createPriceHistory: async (h) => {
          historyRecord = h;
        },
      };

      const req: PriceChangeRequest = {
        action: 'APPLY_PRICE_UPDATE',
        supplierId: 'sup_tazaki',
        items: [
          {
            productId: 'prod_salmon',
            newCasePrice: 50.0,
            // newPackPrice is omitted / undefined
          },
        ],
      };

      const result = await executePriceChangeOperation(adminUser, req, deps);
      assert.equal(result.success, true);
      assert.equal(result.updatedCount, 1);

      const sp = savedProduct as Product | null;
      assert(sp !== null);
      assert.equal(sp.casePrice, 50.0);
      // packPrice must NOT have been materialized as 0, NaN, or present as undefined
      assert.equal('packPrice' in (sp as object), false, 'packPrice property must remain absent on updated product');
      assert.equal(sp.packPrice, undefined);

      const hr = historyRecord as PriceHistoryRecord | null;
      assert(hr !== null);
      assert.equal(hr.newCasePrice, 50.0);
      assert.equal(hr.previousCasePrice, 45.0);
      // Audit record must NOT materialize packPrice as 0
      assert.equal('previousPackPrice' in (hr as object), false);
      assert.equal('newPackPrice' in (hr as object), false);
    });

    it('preserves legitimate existing zero prices (0)', async () => {
      const existingProduct: Product = {
        id: 'prod_sample',
        name: 'Free Promo Sample',
        categoryId: 'cat_promo',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        casePrice: 0,
        packPrice: 0,
      };

      let savedProduct: Product | null = null;
      let historyRecord: PriceHistoryRecord | null = null;

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...existingProduct }),
        saveProduct: async (p) => {
          savedProduct = p;
        },
        createPriceHistory: async (h) => {
          historyRecord = h;
        },
      };

      // Updating casePrice from 0 to 10.0, while packPrice is omitted (keep existing 0)
      const req: PriceChangeRequest = {
        action: 'APPLY_PRICE_UPDATE',
        supplierId: 'sup_tazaki',
        items: [
          {
            productId: 'prod_sample',
            newCasePrice: 10.0,
            newPackPrice: undefined, // omitted => keep existing 0
          },
        ],
      };

      const result = await executePriceChangeOperation(adminUser, req, deps);
      assert.equal(result.success, true);
      const sp = savedProduct as Product | null;
      assert(sp !== null);
      assert.equal(sp.casePrice, 10.0);
      assert.strictEqual(sp.packPrice, 0, 'Existing legitimate zero packPrice must be preserved');

      const hr = historyRecord as PriceHistoryRecord | null;
      assert(hr !== null);
      assert.strictEqual(hr.previousCasePrice, 0);
      assert.strictEqual(hr.newCasePrice, 10.0);
      assert.strictEqual(hr.previousPackPrice, 0);
      assert.strictEqual(hr.newPackPrice, 0);
    });

    it('allows explicitly setting a price to 0', async () => {
      const existingProduct: Product = {
        id: 'prod_tea',
        name: 'Green Tea Bags',
        categoryId: 'cat_tea',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        casePrice: 15.0,
      };

      let savedProduct: Product | null = null;

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...existingProduct }),
        saveProduct: async (p) => {
          savedProduct = p;
        },
        createPriceHistory: async () => {},
      };

      const req: PriceChangeRequest = {
        action: 'APPLY_PRICE_UPDATE',
        supplierId: 'sup_tazaki',
        items: [
          {
            productId: 'prod_tea',
            newCasePrice: 0, // Explicitly set to zero
          },
        ],
      };

      const result = await executePriceChangeOperation(adminUser, req, deps);
      assert.equal(result.success, true);
      assert.strictEqual(savedProduct!.casePrice, 0, 'Price must be updated to explicit 0');
    });
  });

  describe('No-Op Updates and Unchanged Status', () => {
    it('detects identical prices as UNCHANGED with no persistence write', async () => {
      const existingProduct: Product = {
        id: 'prod_rice',
        name: 'Sushi Rice 20kg',
        categoryId: 'cat_rice',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        casePrice: 38.5,
      };

      let saveProductCalls = 0;
      let createHistoryCalls = 0;

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...existingProduct }),
        saveProduct: async () => {
          saveProductCalls++;
        },
        createPriceHistory: async () => {
          createHistoryCalls++;
        },
      };

      const req: PriceChangeRequest = {
        action: 'BATCH_CSV_UPDATE',
        supplierId: 'sup_tazaki',
        items: [
          {
            productId: 'prod_rice',
            newCasePrice: 38.5, // Identical to existing price
            newPackPrice: '   ' as any, // Whitespace string from raw CSV input => omitted
          },
        ],
      };

      const result = await executePriceChangeOperation(adminUser, req, deps);
      assert.equal(result.success, true);
      assert.equal(result.unchangedCount, 1);
      assert.equal(result.updatedCount, 0);
      assert.equal(result.results[0].status, 'UNCHANGED');
      assert.equal(saveProductCalls, 0, 'saveProduct must not be called for no-op identical price');
      assert.equal(createHistoryCalls, 0, 'createPriceHistory must not be called for no-op identical price');
    });
  });

  describe('isFirstPrice Semantics (Known Zero vs. Absent)', () => {
    it('treats existing known 0 -> positive as a price increase (UPDATED), NOT FIRST_PRICE', async () => {
      const existingProduct: Product = {
        id: 'prod_promo',
        name: 'Promo Sauce',
        categoryId: 'cat_sauce',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        casePrice: 0, // Known 0
      };

      let historyRecord: PriceHistoryRecord | null = null;
      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...existingProduct }),
        saveProduct: async () => {},
        createPriceHistory: async (h) => {
          historyRecord = h;
        },
      };

      const req: PriceChangeRequest = {
        action: 'APPLY_PRICE_UPDATE',
        supplierId: 'sup_tazaki',
        items: [{ productId: 'prod_promo', newCasePrice: 15.0 }],
      };

      const result = await executePriceChangeOperation(adminUser, req, deps);
      assert.equal(result.success, true);
      assert.equal(result.firstPriceCount, 0, '0 -> 15.0 is an update, NOT FIRST_PRICE');
      assert.equal(result.updatedCount, 1);
      assert.equal(result.results[0].status, 'UPDATED');

      const hr = historyRecord as PriceHistoryRecord | null;
      assert(hr !== null);
      assert.equal(hr.changeType, 'PRICE_INCREASE', 'changeType must be PRICE_INCREASE');
      assert.strictEqual(hr.previousCasePrice, 0);
      assert.strictEqual(hr.newCasePrice, 15.0);
    });

    it('treats absent price -> explicit 0 as FIRST_PRICE', async () => {
      const existingProduct: Product = {
        id: 'prod_water',
        name: 'Complimentary Water',
        categoryId: 'cat_bev',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        // casePrice is absent (undefined)
      };

      let historyRecord: PriceHistoryRecord | null = null;
      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...existingProduct }),
        saveProduct: async () => {},
        createPriceHistory: async (h) => {
          historyRecord = h;
        },
      };

      const req: PriceChangeRequest = {
        action: 'APPLY_PRICE_UPDATE',
        supplierId: 'sup_tazaki',
        items: [{ productId: 'prod_water', newCasePrice: 0 }],
      };

      const result = await executePriceChangeOperation(adminUser, req, deps);
      assert.equal(result.success, true);
      assert.equal(result.firstPriceCount, 1, 'absent -> 0 is FIRST_PRICE');
      assert.equal(result.updatedCount, 0);
      assert.equal(result.results[0].status, 'FIRST_PRICE');

      const hr = historyRecord as PriceHistoryRecord | null;
      assert(hr !== null);
      assert.equal(hr.changeType, 'FIRST_PRICE');
      assert.strictEqual(hr.newCasePrice, 0);
      assert.equal('previousCasePrice' in (hr as object), false, 'previousCasePrice must be omitted when absent');
    });

    it('treats absent price -> positive price as FIRST_PRICE', async () => {
      const existingProduct: Product = {
        id: 'prod_snack',
        name: 'Rice Crackers',
        categoryId: 'cat_snack',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        // casePrice is absent
      };

      let historyRecord: PriceHistoryRecord | null = null;
      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...existingProduct }),
        saveProduct: async () => {},
        createPriceHistory: async (h) => {
          historyRecord = h;
        },
      };

      const req: PriceChangeRequest = {
        action: 'APPLY_PRICE_UPDATE',
        supplierId: 'sup_tazaki',
        items: [{ productId: 'prod_snack', newCasePrice: 22.5 }],
      };

      const result = await executePriceChangeOperation(adminUser, req, deps);
      assert.equal(result.success, true);
      assert.equal(result.firstPriceCount, 1);
      assert.equal(result.results[0].status, 'FIRST_PRICE');

      const hr = historyRecord as PriceHistoryRecord | null;
      assert(hr !== null);
      assert.equal(hr.changeType, 'FIRST_PRICE');
      assert.strictEqual(hr.newCasePrice, 22.5);
    });
  });

  describe('End-to-End Propose -> Approve Regressions', () => {
    it('preserves missing case price throughout propose -> approve for a pack-only product', async () => {
      // Pack-only product: NO casePrice
      let productDb: Product = {
        id: 'prod_wasabi_pack',
        name: 'Fresh Wasabi Individual Tube',
        categoryId: 'cat_condiments',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        packPrice: 4.5,
        // casePrice is absent!
      };

      let savedNotice: PriceChangeNotice | null = null;
      let historyRecord: PriceHistoryRecord | null = null;

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...productDb }),
        saveProduct: async (p) => {
          productDb = p;
        },
        createPriceHistory: async (h) => {
          historyRecord = h;
        },
        createNotice: async (n) => {
          savedNotice = n;
        },
        getNotice: async () => savedNotice ? { ...savedNotice } : null,
        updateNotice: async (_id, updates) => {
          if (savedNotice) savedNotice = { ...savedNotice, ...updates };
        },
      };

      // 1. Propose notice for pack price change
      const proposeReq: PriceChangeRequest = {
        action: 'PROPOSE_NOTICE',
        supplierId: 'sup_tazaki',
        items: [
          {
            productId: 'prod_wasabi_pack',
            newPackPrice: 5.5,
            // newCasePrice is omitted
          },
        ],
      };

      const proposeResult = await executePriceChangeOperation(adminUser, proposeReq, deps);
      assert.equal(proposeResult.success, true);

      // Verify notice does NOT fabricate case price as 0
      const sn = savedNotice as PriceChangeNotice | null;
      assert(sn !== null);
      assert.equal('oldCasePrice' in (sn as object), false, 'Notice must NOT fabricate oldCasePrice');
      assert.equal('newCasePrice' in (sn as object), false, 'Notice must NOT fabricate newCasePrice');
      assert.strictEqual(sn.oldPackPrice, 4.5);
      assert.strictEqual(sn.newPackPrice, 5.5);
      assert.strictEqual(sn.priceDiff, 1.0);

      // 2. Approve notice
      const approveReq: PriceChangeRequest = {
        action: 'APPROVE_NOTICE',
        supplierId: 'sup_tazaki',
        noticeId: sn.id,
      };

      const approveResult = await executePriceChangeOperation(adminUser, approveReq, deps);
      assert.equal(approveResult.success, true);
      assert.equal(approveResult.updatedCount, 1);

      // Verify product retains absent casePrice and does NOT delete it or set 0
      assert.equal('casePrice' in productDb, false, 'Product casePrice must remain absent');
      assert.strictEqual(productDb.packPrice, 5.5);

      // Verify audit trail recorded actual values without case price
      const hr = historyRecord as PriceHistoryRecord | null;
      assert(hr !== null);
      assert.equal('previousCasePrice' in (hr as object), false);
      assert.equal('newCasePrice' in (hr as object), false);
      assert.strictEqual(hr.previousPackPrice, 4.5);
      assert.strictEqual(hr.newPackPrice, 5.5);
    });

    it('preserves missing pack price throughout propose -> approve for a case-only product', async () => {
      // Case-only product: NO packPrice
      let productDb: Product = {
        id: 'prod_tuna_case',
        name: 'Whole Bigeye Tuna (Box)',
        categoryId: 'cat_fish',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        casePrice: 120.0,
        // packPrice is absent!
      };

      let savedNotice: PriceChangeNotice | null = null;
      let historyRecord: PriceHistoryRecord | null = null;

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...productDb }),
        saveProduct: async (p) => {
          productDb = p;
        },
        createPriceHistory: async (h) => {
          historyRecord = h;
        },
        createNotice: async (n) => {
          savedNotice = n;
        },
        getNotice: async () => savedNotice ? { ...savedNotice } : null,
        updateNotice: async (_id, updates) => {
          if (savedNotice) savedNotice = { ...savedNotice, ...updates };
        },
      };

      const proposeReq: PriceChangeRequest = {
        action: 'PROPOSE_NOTICE',
        supplierId: 'sup_tazaki',
        items: [
          {
            productId: 'prod_tuna_case',
            newCasePrice: 135.0,
          },
        ],
      };

      await executePriceChangeOperation(adminUser, proposeReq, deps);
      const sn = savedNotice as PriceChangeNotice | null;
      assert(sn !== null);
      assert.equal('oldPackPrice' in (sn as object), false, 'Notice must NOT fabricate oldPackPrice');
      assert.equal('newPackPrice' in (sn as object), false, 'Notice must NOT fabricate newPackPrice');
      assert.strictEqual(sn.oldCasePrice, 120.0);
      assert.strictEqual(sn.newCasePrice, 135.0);

      const approveReq: PriceChangeRequest = {
        action: 'APPROVE_NOTICE',
        supplierId: 'sup_tazaki',
        noticeId: sn.id,
      };

      await executePriceChangeOperation(adminUser, approveReq, deps);
      assert.equal('packPrice' in productDb, false, 'Product packPrice must remain absent');
      assert.strictEqual(productDb.casePrice, 135.0);

      const hr = historyRecord as PriceHistoryRecord | null;
      assert(hr !== null);
      assert.equal('previousPackPrice' in (hr as object), false);
      assert.equal('newPackPrice' in (hr as object), false);
      assert.strictEqual(hr.previousCasePrice, 120.0);
      assert.strictEqual(hr.newCasePrice, 135.0);
    });

    it('handles explicit zero in propose -> approve workflow', async () => {
      let productDb: Product = {
        id: 'prod_tasting_tea',
        name: 'Tasting Tea Sample',
        categoryId: 'cat_tea',
        supplierId: 'sup_tazaki',
        displayOrder: 1,
        allowedBranchIds: [],
        active: true,
        casePrice: 10.0,
      };

      let savedNotice: PriceChangeNotice | null = null;
      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({ ...productDb }),
        saveProduct: async (p) => {
          productDb = p;
        },
        createPriceHistory: async () => {},
        createNotice: async (n) => {
          savedNotice = n;
        },
        getNotice: async () => savedNotice ? { ...savedNotice } : null,
        updateNotice: async (_id, updates) => {
          if (savedNotice) savedNotice = { ...savedNotice, ...updates };
        },
      };

      // Propose reducing price to explicit 0
      await executePriceChangeOperation(adminUser, {
        action: 'PROPOSE_NOTICE',
        supplierId: 'sup_tazaki',
        items: [{ productId: 'prod_tasting_tea', newCasePrice: 0 }],
      }, deps);

      const sn = savedNotice as PriceChangeNotice | null;
      assert(sn !== null);
      assert.strictEqual(sn.newCasePrice, 0);

      // Approve notice
      await executePriceChangeOperation(adminUser, {
        action: 'APPROVE_NOTICE',
        supplierId: 'sup_tazaki',
        noticeId: sn.id,
      }, deps);

      assert.strictEqual(productDb.casePrice, 0, 'Approved price must be explicit 0');
    });

    it('rejects legacy notice containing 12abc with zero writes', async () => {
      let saveProductCalls = 0;
      let createHistoryCalls = 0;
      let updateNoticeCalls = 0;

      const legacyNotice: any = {
        id: 'pcn_legacy_bad',
        productId: 'prod_salmon',
        productName: 'Salmon Fillet',
        supplierId: 'sup_tazaki',
        supplierName: 'Tazaki Foods',
        newCasePrice: '12abc', // Malformed persisted price!
        status: 'PENDING',
        uploadedByUserId: 'usr_other',
        uploadedByUserName: 'Other',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-10-01',
        detectedDate: '2026-10-01T00:00:00.000Z',
      };

      const deps: PriceChangeServiceDependencies = {
        getProduct: async () => ({
          id: 'prod_salmon',
          name: 'Salmon Fillet',
          categoryId: 'cat_fish',
          supplierId: 'sup_tazaki',
          displayOrder: 1,
          allowedBranchIds: [],
          active: true,
          casePrice: 40.0,
        }),
        saveProduct: async () => {
          saveProductCalls++;
        },
        createPriceHistory: async () => {
          createHistoryCalls++;
        },
        getNotice: async () => legacyNotice,
        updateNotice: async () => {
          updateNoticeCalls++;
        },
      };

      await assert.rejects(
        async () => {
          await executePriceChangeOperation(adminUser, {
            action: 'APPROVE_NOTICE',
            supplierId: 'sup_tazaki',
            noticeId: 'pcn_legacy_bad',
          }, deps);
        },
        (err: any) => {
          assert(err instanceof PriceOperationError);
          assert.equal(err.status, 400);
          assert(err.message.includes('12abc'));
          return true;
        }
      );

      // Assert ZERO database writes occurred
      assert.equal(saveProductCalls, 0, 'saveProduct must not be called when notice price is malformed');
      assert.equal(createHistoryCalls, 0, 'createPriceHistory must not be called when notice price is malformed');
      assert.equal(updateNoticeCalls, 0, 'updateNotice must not be called when notice price is malformed');
    });
  });
});
