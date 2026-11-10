import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkSupplierIntegrity,
  checkCategoryIntegrity,
  reassignProductsSupplier,
  reassignProductsCategory,
} from '../utils/catalogIntegrity.ts';

import {
  formatRoleName,
  APP_VERSION,
  APP_BUILD_ID,
} from '../constants.ts';

import {
  cleanPhoneNumber,
  generateWhatsAppLink,
} from '../utils/whatsapp.ts';

import {
  generateOrderPDF,
  generateOrderEmailContent,
  formatItemLine,
} from '../utils/orderEmail.ts';

import {
  sanitizeEmailConfigForSave,
  createSanitizedConfigExport,
  validateAndSanitizeConfigImport,
} from './configuration-security.test.ts';

import {
  validateManualItemsForOrder,
} from './custom-items-search-resilience.test.ts';

import type {
  Product,
  Category,
  Supplier,
  Branch,
  OrderRecord,
  ManualOrderItem,
  OrderItem,
  User,
  EmailConfig,
} from '../types.ts';

describe('Phase D: Catalog Integrity, Multi-Channel Resilience & Configuration Security', () => {

  const sampleSupplierA: Supplier = {
    id: 'sup_alpha',
    name: 'Alpha Fresh Produce',
    email: 'orders@alphafresh-co-uk.example',
    active: true,
    deliveryRules: {},
    deliverySchedules: {},
  };

  const sampleSupplierB: Supplier = {
    id: 'sup_beta',
    name: 'Beta Global Foods',
    email: 'orders@betaglobal-co-uk.example',
    active: true,
    deliveryRules: {},
    deliverySchedules: {},
  };

  const sampleCategory1: Category = {
    id: 'cat_vegetables',
    name: 'Fresh Vegetables',
    displayOrder: 1,
    active: true,
    supplierId: 'sup_alpha',
  };

  const sampleCategory2: Category = {
    id: 'cat_dry_goods',
    name: 'Dry & Ambient Goods',
    displayOrder: 2,
    active: true,
    supplierId: 'sup_beta',
  };

  const sampleProducts: Product[] = [
    {
      id: 'prod_carrots',
      name: 'Organic Carrots 10kg',
      itemCode: 'VEG-001',
      categoryId: 'cat_vegetables',
      supplierId: 'sup_alpha',
      casePrice: 12.00,
      packPrice: 0,
      caseUnitName: 'Bag (10kg)',
      unitType: 'CASE_ONLY',
      displayOrder: 1,
      allowedBranchIds: [],
      active: true,
    },
    {
      id: 'prod_onions',
      name: 'Brown Onions 20kg',
      itemCode: 'VEG-002',
      categoryId: 'cat_vegetables',
      supplierId: 'sup_alpha',
      casePrice: 16.00,
      packPrice: 0,
      caseUnitName: 'Sack (20kg)',
      unitType: 'CASE_ONLY',
      displayOrder: 2,
      allowedBranchIds: [],
      active: true,
    },
    {
      id: 'prod_discontinued_leeks',
      name: 'Heritage Leeks (Seasonal)',
      itemCode: 'VEG-003',
      categoryId: 'cat_vegetables',
      supplierId: 'sup_alpha',
      casePrice: 14.00,
      packPrice: 0,
      displayOrder: 3,
      allowedBranchIds: [],
      active: false, // Inactive
    },
  ];

  // ---------------------------------------------------------------------------
  // 1. CATALOG RELATIONAL INTEGRITY & BATCH REASSIGNMENT
  // ---------------------------------------------------------------------------
  describe('1. Catalog Relational Integrity & Safe Deletion Guards', () => {
    it('detects active vs inactive product dependencies before supplier deletion', () => {
      const integrity = checkSupplierIntegrity('sup_alpha', sampleProducts, [sampleCategory1]);
      assert.equal(integrity.totalProductsCount, 3);
      assert.equal(integrity.activeProductsCount, 2);
      assert.equal(integrity.canSafeDelete, false);
      assert.ok(integrity.blockingReason?.includes('Cannot directly delete supplier'));
    });

    it('safely reassigns all dependent products to new supplier in single batch operation', () => {
      const updated = reassignProductsSupplier(sampleProducts, 'sup_alpha', 'sup_beta');
      assert.equal(updated.filter(p => p.supplierId === 'sup_beta').length, 3);
      assert.equal(updated.filter(p => p.supplierId === 'sup_alpha').length, 0);
    });

    it('detects category dependencies and supports category reassignments', () => {
      const catCheck = checkCategoryIntegrity('cat_vegetables', sampleProducts);
      assert.equal(catCheck.activeProductsCount, 2);
      assert.equal(catCheck.canSafeDelete, false);

      const reassigned = reassignProductsCategory(sampleProducts, 'cat_vegetables', 'cat_dry_goods');
      assert.equal(reassigned.filter(p => p.categoryId === 'cat_dry_goods').length, 3);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. CUSTOM ITEMS VALIDATION & PREVENTING EMPTY SUBMISSIONS
  // ---------------------------------------------------------------------------
  describe('2. Custom Item Validation & Order Submission Resilience', () => {
    it('rejects custom item with description but missing/zero quantity', () => {
      const invalidCustom: ManualOrderItem[] = [
        {
          id: 'man_1',
          description: 'Special Truffle Oil',
          caseQty: 0,
          packQty: 0,
        },
      ];

      const check = validateManualItemsForOrder(invalidCustom, 0);
      assert.equal(check.valid, false);
      assert.ok(check.error?.includes('quantity'));
    });

    it('rejects custom item with quantity but missing product description', () => {
      const invalidCustom: ManualOrderItem[] = [
        {
          id: 'man_2',
          description: '   ', // Empty whitespace
          caseQty: 2,
          packQty: 0,
        },
      ];

      const check = validateManualItemsForOrder(invalidCustom, 0);
      assert.equal(check.valid, false);
      assert.ok(check.error?.includes('description'));
    });

    it('prevents completely empty order submissions (no catalog items, no manual items)', () => {
      const emptyOrder = validateManualItemsForOrder([], 0);
      assert.equal(emptyOrder.valid, false);
      assert.ok(emptyOrder.error?.includes('empty order'));
    });

    it('permits valid custom items and filters out empty placeholder rows cleanly', () => {
      const mixedRows: ManualOrderItem[] = [
        {
          id: 'man_3',
          description: 'Valid Yuzu Juice 500ml',
          caseQty: 1,
          packQty: 0,
        },
        {
          id: 'man_placeholder',
          description: '', // Unused extra row in UI
          caseQty: 0,
          packQty: 0,
        },
      ];

      const check = validateManualItemsForOrder(mixedRows, 0);
      assert.equal(check.valid, true);
      assert.equal(check.cleanManualItems.length, 1);
      assert.equal(check.cleanManualItems[0].description, 'Valid Yuzu Juice 500ml');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. MULTI-CHANNEL & WHATSAPP UNIT CONSISTENCY
  // ---------------------------------------------------------------------------
  describe('3. Multi-Channel WhatsApp Communications & Role Alignment', () => {
    it('sanitizes international phone numbers and generates valid WhatsApp web/app URLs', () => {
      const phoneInput = '07911 123456';
      const cleaned = cleanPhoneNumber(phoneInput);
      assert.equal(cleaned, '447911123456');

      const sampleOrder: OrderRecord = {
        id: 'ord_wa_01',
        branchId: 'br_covent',
        branchNameSnapshot: 'Covent Garden',
        supplierId: 'sup_beta',
        supplierNameSnapshot: 'Beta Global Foods',
        orderedByUserId: 'usr_1',
        orderedByNameSnapshot: 'Chef Ken',
        createdAt: '2026-10-04T10:00:00Z',
        deliveryDate: '2026-10-05',
        emailTo: 'orders@betaglobal-co-uk.example',
        status: 'PLACED',
        items: [
          {
            productId: 'prod_carrots',
            productNameSnapshot: 'Organic Carrots 10kg',
            caseQty: 3,
            packQty: 0,
            caseUnitSnapshot: 'Bag (10kg)',
          },
        ],
        manualItems: [],
      };

      const link = generateWhatsAppLink(
        sampleOrder,
        {
          id: 'br_covent',
          name: 'Covent Garden',
          code: 'CG',
          contactEmail: 'covent@ht-com.example',
          active: true,
        },
        phoneInput,
        sampleProducts
      );
      assert.ok(link.startsWith('https://wa.me/447911123456?text='));
      assert.ok(link.includes('Organic%20Carrots%2010kg'));
      assert.ok(link.includes('3%20Bag%20(10kg)'));
    });

    it('aligns system role display names consistently', () => {
      assert.equal(formatRoleName('CREATOR'), 'Creator');
      assert.equal(formatRoleName('GM'), 'General Manager');
      assert.equal(formatRoleName('MANAGER'), 'Branch Manager');
      assert.equal(formatRoleName('STAFF'), 'Staff');
    });

    it('exposes defined release version and build identifier', () => {
      assert.ok(APP_VERSION);
      assert.ok(APP_BUILD_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. OFFLINE / STANDALONE PDF EXPORT FROM DURABLE SNAPSHOTS
  // ---------------------------------------------------------------------------
  describe('4. Offline Standalone PDF Export & Snapshot Reliability', () => {
    it('renders accurate line items from snapshots even if master catalog and supplier are disconnected', () => {
      const offlineOrder: OrderRecord = {
        id: 'ord_offline_saved_99',
        branchId: 'unknown_branch',
        branchNameSnapshot: 'Hare & Tortoise Kensington',
        supplierId: 'unknown_supplier',
        supplierNameSnapshot: 'Direct Japanese Importers',
        orderedByUserId: 'usr_offline',
        orderedByNameSnapshot: 'Sous Chef David',
        createdAt: '2026-10-04T10:00:00Z',
        deliveryDate: '2026-10-06',
        emailTo: 'dispatch@importers-co-jp.example',
        status: 'PLACED',
        items: [
          {
            productId: 'prod_deleted_from_catalog',
            productNameSnapshot: 'Fresh Yellowtail Hamachi Loin',
            itemCodeSnapshot: 'HAM-88',
            caseQty: 2,
            packQty: 1,
            casePriceSnapshot: 75.00,
            packPriceSnapshot: 20.00,
            caseUnitSnapshot: 'Loin Box',
            packUnitSnapshot: 'Single Loin',
          },
        ],
        manualItems: [
          {
            id: 'man_custom_99',
            description: 'Fresh Shiso Leaves (50 leaves/box)',
            caseQty: 2,
            packQty: 0,
            casePriceSnapshot: 8.50,
            packPriceSnapshot: 0,
            caseUnitSnapshot: 'Box',
          },
        ],
      };

      // Format line without product entity (offline scenario)
      const lineText = formatItemLine(
        1,
        offlineOrder.items[0].itemCodeSnapshot || '',
        offlineOrder.items[0].productNameSnapshot,
        offlineOrder.items[0].caseQty,
        offlineOrder.items[0].packQty,
        'ORDER',
        undefined,
        undefined,
        undefined, // Product entity missing!
        undefined,
        offlineOrder.items[0].caseUnitSnapshot,
        offlineOrder.items[0].packUnitSnapshot
      );

      assert.ok(lineText.includes('Fresh Yellowtail Hamachi Loin'));
      assert.ok(lineText.includes('HAM-88'));
      assert.ok(lineText.includes('2 Loin Box'));
      assert.ok(lineText.includes('1 Single Loin'));

      // Generate email content without active branch/supplier objects
      const emailContent = generateOrderEmailContent(offlineOrder, undefined, undefined, [], 'ORDER');
      assert.ok(emailContent.subject.includes('Hare & Tortoise Kensington'));
      assert.ok(emailContent.htmlBody.includes('Fresh Yellowtail Hamachi Loin'));
      assert.ok(emailContent.htmlBody.includes('Fresh Shiso Leaves'));
    });
  });

  // ---------------------------------------------------------------------------
  // 5. CONFIGURATION SECURITY & SANITIZED BACKUP EXPORT/IMPORT
  // ---------------------------------------------------------------------------
  describe('5. Configuration Security & Backup Sanitization', () => {
    it('strips plaintext SMTP password when preparing email configuration for save', () => {
      const emailConfigWithSecret: EmailConfig = {
        fromEmail: 'orders@hareandtortoise-co-uk.example',
        fromName: 'HT Orders',
        smtpHost: 'smtp.sendgrid.net',
        smtpPort: 587,
        smtpUser: 'apikey',
        smtpPass: 'SG.super_secret_password_token',
        enabled: true,
      };

      const sanitized = sanitizeEmailConfigForSave(emailConfigWithSecret);
      assert.equal('smtpPass' in sanitized, false);
      assert.equal((sanitized as any).smtpPass, undefined);
    });

    it('produces sanitized configuration export without user passwords or credentials', () => {
      const dummyUser: User = {
        id: 'usr_staff_1',
        username: 'staff@ht-com.example',
        displayName: 'Alice',
        role: 'STAFF',
        active: true,
      };

      const backup = createSanitizedConfigExport({
        products: sampleProducts,
        categories: [sampleCategory1, sampleCategory2],
        suppliers: [sampleSupplierA, sampleSupplierB],
        branches: [],
        roles: [],
        rolePermissions: {},
        emailConfig: {
          senderEmail: 'test@ht-com.example',
          smtpPass: 'secret_123',
        } as any,
        users: [dummyUser],
      });

      const serialized = JSON.stringify(backup);
      assert.equal(serialized.includes('secret_123'), false);
      assert.equal(backup.type, 'configuration');
      assert.equal(backup.data.products.length, 3);
    });

    it('validates configuration backup file and rejects corrupted payloads', () => {
      const corruptPayload = {
        type: 'invalid_type',
        data: null,
      };

      assert.throws(
        () => validateAndSanitizeConfigImport(corruptPayload),
        /Invalid File Format: Missing configuration data payload/
      );
    });
  });

});
