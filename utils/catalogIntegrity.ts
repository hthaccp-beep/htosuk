import type { Product, Category, Supplier } from '../types.ts';

export interface SupplierIntegrityReport {
  supplierId: string;
  totalProductsCount: number;
  activeProductsCount: number;
  inactiveProductsCount: number;
  categoriesCount: number;
  canSafeDelete: boolean;
  warningMessage?: string;
  blockingReason?: string;
}

export interface CategoryIntegrityReport {
  categoryId: string;
  totalProductsCount: number;
  activeProductsCount: number;
  inactiveProductsCount: number;
  canSafeDelete: boolean;
  warningMessage?: string;
  blockingReason?: string;
}

/**
 * Evaluates referential integrity for a supplier before deletion.
 * Active products require either reassignment or deactivation to prevent orphaned records.
 */
export function checkSupplierIntegrity(
  supplierId: string,
  products: Product[],
  categories: Category[]
): SupplierIntegrityReport {
  const linkedProducts = products.filter(p => p.supplierId === supplierId);
  const activeProducts = linkedProducts.filter(p => p.active);
  const inactiveProducts = linkedProducts.filter(p => !p.active);
  const linkedCategories = categories.filter(c => c.supplierId === supplierId);

  const canSafeDelete = activeProducts.length === 0;

  let blockingReason: string | undefined;
  let warningMessage: string | undefined;

  if (activeProducts.length > 0) {
    blockingReason = `Cannot directly delete supplier with ${activeProducts.length} active product(s). Please reassign products to another supplier or deactivate the supplier.`;
  } else if (linkedProducts.length > 0 || linkedCategories.length > 0) {
    warningMessage = `Supplier has ${linkedProducts.length} archived product(s) and ${linkedCategories.length} category/categories.`;
  }

  return {
    supplierId,
    totalProductsCount: linkedProducts.length,
    activeProductsCount: activeProducts.length,
    inactiveProductsCount: inactiveProducts.length,
    categoriesCount: linkedCategories.length,
    canSafeDelete,
    warningMessage,
    blockingReason
  };
}

/**
 * Evaluates referential integrity for a category before deletion.
 * Active products must be reassigned to another category to prevent catalog corruption.
 */
export function checkCategoryIntegrity(
  categoryId: string,
  products: Product[]
): CategoryIntegrityReport {
  const linkedProducts = products.filter(p => p.categoryId === categoryId);
  const activeProducts = linkedProducts.filter(p => p.active);
  const inactiveProducts = linkedProducts.filter(p => !p.active);

  const canSafeDelete = activeProducts.length === 0;

  let blockingReason: string | undefined;
  let warningMessage: string | undefined;

  if (activeProducts.length > 0) {
    blockingReason = `Cannot delete category with ${activeProducts.length} active product(s). Reassign products to another category first.`;
  } else if (linkedProducts.length > 0) {
    warningMessage = `Category has ${linkedProducts.length} archived product(s).`;
  }

  return {
    categoryId,
    totalProductsCount: linkedProducts.length,
    activeProductsCount: activeProducts.length,
    inactiveProductsCount: inactiveProducts.length,
    canSafeDelete,
    warningMessage,
    blockingReason
  };
}

/**
 * Reassigns products from a source supplier to a target supplier.
 */
export function reassignProductsSupplier(
  products: Product[],
  sourceSupplierId: string,
  targetSupplierId: string,
  targetCategoryId?: string
): Product[] {
  return products.map(product => {
    if (product.supplierId === sourceSupplierId) {
      return {
        ...product,
        supplierId: targetSupplierId,
        categoryId: targetCategoryId || product.categoryId
      };
    }
    return product;
  });
}

/**
 * Reassigns products from a source category to a target category.
 */
export function reassignProductsCategory(
  products: Product[],
  sourceCategoryId: string,
  targetCategoryId: string
): Product[] {
  return products.map(product => {
    if (product.categoryId === sourceCategoryId) {
      return {
        ...product,
        categoryId: targetCategoryId
      };
    }
    return product;
  });
}
