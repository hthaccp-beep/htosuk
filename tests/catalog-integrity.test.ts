import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSupplierIntegrity,
  checkCategoryIntegrity,
  reassignProductsSupplier,
  reassignProductsCategory
} from '../utils/catalogIntegrity.ts';
import type { Product, Category, Supplier } from '../types.ts';

describe('Issue 18: Consistent Supplier and Category Management', () => {
  const mockProducts: Product[] = [
    {
      id: 'prod-1',
      name: 'Salmon Fillet',
      itemCode: 'SAL-01',
      categoryId: 'cat-fish',
      supplierId: 'supp-tazaki',
      casePrice: 45,
      packPrice: 0,
      displayOrder: 1000,
      active: true,
      allowedBranchIds: []
    },
    {
      id: 'prod-2',
      name: 'Tuna Loin',
      itemCode: 'TUN-01',
      categoryId: 'cat-fish',
      supplierId: 'supp-tazaki',
      casePrice: 80,
      packPrice: 0,
      displayOrder: 2000,
      active: true,
      allowedBranchIds: []
    },
    {
      id: 'prod-3',
      name: 'Discontinued Crab Meat',
      itemCode: 'CRB-01',
      categoryId: 'cat-fish',
      supplierId: 'supp-tazaki',
      casePrice: 30,
      packPrice: 0,
      displayOrder: 3000,
      active: false, // Inactive / archived
      allowedBranchIds: []
    },
    {
      id: 'prod-4',
      name: 'Soy Sauce Premium',
      itemCode: 'SOY-01',
      categoryId: 'cat-sauces',
      supplierId: 'supp-yamasa',
      casePrice: 20,
      packPrice: 0,
      displayOrder: 1000,
      active: true,
      allowedBranchIds: []
    }
  ];

  const mockCategories: Category[] = [
    {
      id: 'cat-fish',
      name: 'Fresh Seafood',
      supplierId: 'supp-tazaki',
      displayOrder: 1000,
      active: true
    },
    {
      id: 'cat-dry',
      name: 'Dry Goods',
      supplierId: 'supp-tazaki',
      displayOrder: 2000,
      active: true
    },
    {
      id: 'cat-sauces',
      name: 'Sauces & Condiments',
      supplierId: 'supp-yamasa',
      displayOrder: 1000,
      active: true
    }
  ];

  test('blocks supplier deletion when active products are associated', () => {
    const report = checkSupplierIntegrity('supp-tazaki', mockProducts, mockCategories);

    assert.equal(report.canSafeDelete, false);
    assert.equal(report.activeProductsCount, 2);
    assert.equal(report.totalProductsCount, 3);
    assert.equal(report.categoriesCount, 2);
    assert.ok(report.blockingReason?.includes('Cannot directly delete supplier'));
  });

  test('permits safe deletion when supplier has 0 active products', () => {
    const emptyProducts = mockProducts.filter(p => p.supplierId !== 'supp-tazaki');
    const report = checkSupplierIntegrity('supp-tazaki', emptyProducts, []);

    assert.equal(report.canSafeDelete, true);
    assert.equal(report.activeProductsCount, 0);
    assert.equal(report.blockingReason, undefined);
  });

  test('blocks category deletion when active products are linked', () => {
    const report = checkCategoryIntegrity('cat-fish', mockProducts);

    assert.equal(report.canSafeDelete, false);
    assert.equal(report.activeProductsCount, 2);
    assert.ok(report.blockingReason?.includes('Cannot delete category'));
  });

  test('reassigns all products to target supplier cleanly', () => {
    const updated = reassignProductsSupplier(
      mockProducts,
      'supp-tazaki',
      'supp-jfc',
      'cat-general'
    );

    const reassignedTazaki = updated.filter(p => p.supplierId === 'supp-jfc');
    assert.equal(reassignedTazaki.length, 3);
    assert.equal(reassignedTazaki[0].categoryId, 'cat-general');

    // Products from other suppliers remain unchanged
    const yamasaProduct = updated.find(p => p.id === 'prod-4');
    assert.equal(yamasaProduct?.supplierId, 'supp-yamasa');
  });

  test('reassigns products to target category cleanly', () => {
    const updated = reassignProductsCategory(
      mockProducts,
      'cat-fish',
      'cat-dry'
    );

    const moved = updated.filter(p => p.categoryId === 'cat-dry');
    assert.equal(moved.length, 3);

    const remainingInFish = updated.filter(p => p.categoryId === 'cat-fish');
    assert.equal(remainingInFish.length, 0);
  });
});
