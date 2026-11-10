/**
 * Issue 28, 29, 30, 31, 33: Custom items validation, search normalization,
 * role name alignment, and output consistency test suite.
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRoleName, APP_VERSION, APP_BUILD_ID } from '../constants.ts';
import { cleanPhoneNumber, generateWhatsAppLink } from '../utils/whatsapp.ts';
import type { OrderRecord, Branch, Product, ManualOrderItem, OrderItem } from '../types.ts';

// ---------------------------------------------------------------------------
// 1. Issue 29: Custom Item Validation Logic
// ---------------------------------------------------------------------------

export function validateManualItemsForOrder(
  manualItems: ManualOrderItem[],
  cartItemsCount: number
): { valid: boolean; error?: string; cleanManualItems: ManualOrderItem[] } {
  // Check for custom items with description but missing/zero quantities
  const hasMissingQty = manualItems.some(
    m => m.description.trim() !== '' && (m.caseQty || 0) <= 0 && (m.packQty || 0) <= 0
  );
  if (hasMissingQty) {
    return {
      valid: false,
      error: 'Please enter a quantity for all custom items, or remove empty rows.',
      cleanManualItems: [],
    };
  }

  // Check for custom items with positive quantity but empty/whitespace description
  const hasMissingDesc = manualItems.some(
    m => m.description.trim() === '' && ((m.caseQty || 0) > 0 || (m.packQty || 0) > 0)
  );
  if (hasMissingDesc) {
    return {
      valid: false,
      error: 'Please enter a product description for all custom items with quantities.',
      cleanManualItems: [],
    };
  }

  // Clean valid items
  const cleanManualItems = manualItems.filter(
    m => m.description.trim() !== '' && ((m.caseQty || 0) > 0 || (m.packQty || 0) > 0)
  );

  // Check if final order has at least one valid item
  if (cartItemsCount === 0 && cleanManualItems.length === 0) {
    return {
      valid: false,
      error: 'Cannot submit an empty order. Please select at least one item.',
      cleanManualItems: [],
    };
  }

  return { valid: true, cleanManualItems };
}

// ---------------------------------------------------------------------------
// 2. Issue 30: Search Term Normalization Logic
// ---------------------------------------------------------------------------

export function matchProductQuery(
  product: { name: string; itemCode?: string; chineseName?: string; id: string },
  searchQuery: string
): boolean {
  const term = searchQuery.trim().toLowerCase();
  if (!term) return true;

  return (
    product.name.toLowerCase().includes(term) ||
    product.id.toLowerCase().includes(term) ||
    (product.itemCode ? product.itemCode.toLowerCase().includes(term) : false) ||
    (product.chineseName ? product.chineseName.toLowerCase().includes(term) : false)
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Items, Search Normalization, and Role Alignment', () => {
  describe('Issue 29: Custom Item Validation & Empty Order Prevention', () => {
    it('rejects custom item with description but zero quantities', () => {
      const manualItems: ManualOrderItem[] = [
        { id: 'm1', description: 'Fresh Wasabi Root', caseQty: 0, packQty: 0 },
      ];
      const result = validateManualItemsForOrder(manualItems, 1);
      assert.strictEqual(result.valid, false);
      assert.match(result.error!, /enter a quantity for all custom items/);
    });

    it('rejects custom item with positive quantity but blank or whitespace-only description', () => {
      const manualItems: ManualOrderItem[] = [
        { id: 'm1', description: '   ', caseQty: 5, packQty: 0 },
      ];
      const result = validateManualItemsForOrder(manualItems, 1);
      assert.strictEqual(result.valid, false);
      assert.match(result.error!, /enter a product description/);
    });

    it('rejects submission when cart is empty and manual items are empty', () => {
      const result = validateManualItemsForOrder([], 0);
      assert.strictEqual(result.valid, false);
      assert.match(result.error!, /Cannot submit an empty order/);
    });

    it('accepts valid custom items and filters out untouched blank rows', () => {
      const manualItems: ManualOrderItem[] = [
        { id: 'm1', description: 'Fresh Wasabi', caseQty: 2, packQty: 0 },
        { id: 'm2', description: '', caseQty: 0, packQty: 0 }, // untouched blank row
      ];
      const result = validateManualItemsForOrder(manualItems, 0);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.cleanManualItems.length, 1);
      assert.strictEqual(result.cleanManualItems[0].description, 'Fresh Wasabi');
    });
  });

  describe('Issue 30: Product Search Normalization', () => {
    const sampleProduct = {
      id: 'p_avocado',
      name: 'Fresh Avocado Ready to Eat',
      itemCode: 'AVO-01',
      chineseName: '牛油果',
    };

    it('matches padded search term with leading and trailing spaces (" AVOCADO ")', () => {
      assert.strictEqual(matchProductQuery(sampleProduct, ' AVOCADO '), true);
      assert.strictEqual(matchProductQuery(sampleProduct, '  avocado  '), true);
    });

    it('matches Chinese name queries ("牛油果")', () => {
      assert.strictEqual(matchProductQuery(sampleProduct, '牛油果'), true);
      assert.strictEqual(matchProductQuery(sampleProduct, '  牛油果  '), true);
    });

    it('matches product code queries ("avo-01")', () => {
      assert.strictEqual(matchProductQuery(sampleProduct, 'avo-01'), true);
      assert.strictEqual(matchProductQuery(sampleProduct, ' AVO-01 '), true);
    });

    it('returns false for completely non-matching queries', () => {
      assert.strictEqual(matchProductQuery(sampleProduct, 'Salmon Fillet'), false);
    });
  });

  describe('Issue 28: Unit Consistency across WhatsApp & Output Text', () => {
    const sampleBranch: Branch = {
      id: 'b1',
      name: 'Bloomsbury',
      code: 'HT-BLM',
      active: true,
    };

    const sampleOrder: OrderRecord = {
      id: 'ord_12345678',
      branchId: 'b1',
      branchNameSnapshot: 'Bloomsbury',
      supplierId: 's_tazaki',
      supplierNameSnapshot: 'Tazaki Foods',
      orderedByUserId: 'u_1',
      orderedByNameSnapshot: 'Alice Manager',
      createdAt: '2026-09-30T10:00:00.000Z',
      deliveryDate: '2026-10-01',
      status: 'PLACED',
      emailTo: 'orders@tazaki-com.example',
      items: [
        {
          productId: 'p_salmon',
          productNameSnapshot: 'Fresh Salmon',
          caseQty: 3,
          packQty: 2,
          caseUnitSnapshot: 'Crate',
          packUnitSnapshot: 'Fillet',
        },
      ],
      manualItems: [
        {
          id: 'm1',
          description: 'Special Chili Sauce',
          caseQty: 1,
          packQty: 4,
          caseUnitSnapshot: 'Tray',
          packUnitSnapshot: 'Bottle',
        },
      ],
    };

    it('preserves custom unit snapshots in WhatsApp formatted message', () => {
      const link = generateWhatsAppLink(sampleOrder, sampleBranch, '07123456789');
      const decoded = decodeURIComponent(link);

      assert.match(decoded, /3 Crate \+ 2 Fillet x \*Fresh Salmon\*/);
      assert.match(decoded, /1 Tray \+ 4 Bottle x \*Special Chili Sauce\*/);
    });
  });

  describe('Issue 31: Role Name Alignment and Release Identifiers', () => {
    it('correctly maps CREATOR role to "Creator"', () => {
      assert.strictEqual(formatRoleName('CREATOR'), 'Creator');
    });

    it('correctly maps GM role to "General Manager"', () => {
      assert.strictEqual(formatRoleName('GM'), 'General Manager');
    });

    it('correctly maps MANAGER role to "Branch Manager"', () => {
      assert.strictEqual(formatRoleName('MANAGER'), 'Branch Manager');
    });

    it('correctly maps STAFF role to "Staff"', () => {
      assert.strictEqual(formatRoleName('STAFF'), 'Staff');
    });

    it('falls back cleanly for unknown roles', () => {
      assert.strictEqual(formatRoleName('AUDITOR'), 'AUDITOR');
      assert.strictEqual(formatRoleName(undefined), 'Unknown Role');
    });

    it('publishes consistent APP_VERSION and APP_BUILD_ID', () => {
      assert.strictEqual(APP_VERSION, '5.0');
      assert.ok(APP_BUILD_ID.includes('5.0'));
    });
  });
});
