
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../../store';
import { Product } from '../../../types';

interface UseProductFiltersParams {
  selectedSupplierId: string;
  selectedBranchId: string;
}

export const useProductFilters = ({
  selectedSupplierId,
  selectedBranchId,
}: UseProductFiltersParams) => {
  const { products, categories } = useAppStore();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const clearSearch = useCallback(() => setSearchTerm(''), []);

  // Sort helper
  const getSortValue = (val: any): number => {
    if (val === null || val === undefined || val === '') return 999;
    const num = Number(val);
    return isNaN(num) ? 999 : num;
  };

  // Helper to sort products deterministically within category (matching checklist order exactly)
  const sortProductsDeterministically = (prods: Product[]) => {
    prods.sort((a, b) => {
      const orderDiff = getSortValue(a.displayOrder) - getSortValue(b.displayOrder);
      if (orderDiff !== 0) return orderDiff;
      if (a.itemCode && b.itemCode) return a.itemCode.localeCompare(b.itemCode, undefined, { numeric: true });
      return a.name.localeCompare(b.name);
    });
  };

  // All eligible products for this supplier and branch (unfiltered by search term)
  const allEligibleProducts = useMemo(() => {
    return products.filter(p => {
      if (!p.active) return false;
      if (p.supplierId !== selectedSupplierId) return false;
      if (p.allowedBranchIds.length > 0 && !p.allowedBranchIds.includes(selectedBranchId)) {
        return false;
      }
      return true;
    });
  }, [products, selectedSupplierId, selectedBranchId]);

  // Sorted categories for this supplier (includes Other Items if any products lack active category)
  const sortedCategories = useMemo(() => {
    const list = categories
      .filter(c => c.active && (c.supplierId === selectedSupplierId || !c.supplierId))
      .sort((a, b) => getSortValue(a.displayOrder) - getSortValue(b.displayOrder));

    const knownCatIds = new Set(list.map(c => c.id));
    const hasUncategorized = allEligibleProducts.some(p => !p.categoryId || !knownCatIds.has(p.categoryId));
    if (hasUncategorized) {
      list.push({
        id: '__uncategorized__',
        name: 'Other Items',
        supplierId: selectedSupplierId,
        displayOrder: 99999,
        active: true,
      });
    }
    return list;
  }, [categories, selectedSupplierId, allEligibleProducts]);

  // Filtered products based on supplier, branch, and search term
  const filteredProducts = useMemo(() => {
    const cleanTerm = searchTerm.trim().toLowerCase();
    if (!cleanTerm) return allEligibleProducts;

    return allEligibleProducts.filter(p => {
      return (
        p.name.toLowerCase().includes(cleanTerm) ||
        p.id.toLowerCase().includes(cleanTerm) ||
        (p.itemCode && p.itemCode.toLowerCase().includes(cleanTerm)) ||
        (p.chineseName && p.chineseName.toLowerCase().includes(cleanTerm))
      );
    });
  }, [allEligibleProducts, searchTerm]);

  // Pre-calculate full checklist groups and 1-based index map (so items retain their checklist index)
  const { allGroupedProducts, checklistIndexMap } = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    const knownCatIds = new Set(sortedCategories.map(c => c.id));

    allEligibleProducts.forEach(p => {
      const catId = p.categoryId && knownCatIds.has(p.categoryId) ? p.categoryId : '__uncategorized__';
      if (!groups[catId]) groups[catId] = [];
      groups[catId].push(p);
    });

    Object.keys(groups).forEach(catId => {
      sortProductsDeterministically(groups[catId]);
    });

    const indexMap: Record<string, number> = {};
    let globalIdx = 1;
    sortedCategories.forEach(cat => {
      const catProds = groups[cat.id];
      if (catProds && catProds.length > 0) {
        catProds.forEach(p => {
          indexMap[p.id] = globalIdx++;
        });
      }
    });

    return { allGroupedProducts: groups, checklistIndexMap: indexMap };
  }, [allEligibleProducts, sortedCategories]);

  // Group filtered products by category for current display
  const groupedProducts = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    const knownCatIds = new Set(sortedCategories.map(c => c.id));

    filteredProducts.forEach(p => {
      const catId = p.categoryId && knownCatIds.has(p.categoryId) ? p.categoryId : '__uncategorized__';
      if (!groups[catId]) groups[catId] = [];
      groups[catId].push(p);
    });

    Object.keys(groups).forEach(catId => {
      sortProductsDeterministically(groups[catId]);
    });

    return groups;
  }, [filteredProducts, sortedCategories]);

  return {
    searchTerm,
    viewMode,
    sortedCategories,
    filteredProducts,
    groupedProducts,
    allGroupedProducts,
    checklistIndexMap,
    setSearchTerm,
    setViewMode,
    clearSearch,
  };
};

