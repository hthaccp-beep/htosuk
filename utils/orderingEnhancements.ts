import type { Product, Supplier, PriceHistoryRecord, OrderRecord } from '../types.ts';

export interface ParOrderSuggestion {
  productId: string;
  currentCases: number;
  minParLevel: number;
  targetParLevel: number;
  suggestedCases: number;
  isBelowMin: boolean;
}

export interface SupplierAlternativeOption {
  alternativeProduct: Product;
  supplierName: string;
  priceDiff: number; // positive = cheaper, negative = more expensive
  percentSavings: number; // e.g. 5.2 for 5.2% cheaper
  isCheaper: boolean;
}

export interface InflationMetric {
  productId: string;
  productName: string;
  itemCode?: string;
  supplierName: string;
  earliestPrice: number;
  currentPrice: number;
  priceDelta: number;
  percentInflation: number;
  historyEntriesCount: number;
}

/**
 * Calculates suggested replenishment order quantities based on Current Stock on Hand (SOH)
 * and target Par Levels.
 */
export function calculateParOrderSuggestions(
  products: Product[],
  currentStockMap: Record<string, number>
): Record<string, ParOrderSuggestion> {
  const suggestions: Record<string, ParOrderSuggestion> = {};

  products.forEach((product) => {
    // Only calculate if target par level is configured
    if (product.targetParLevel && product.targetParLevel > 0) {
      const currentStock = currentStockMap[product.id] ?? 0;
      const minPar = product.minParLevel ?? 0;
      const targetPar = product.targetParLevel;

      let suggestedCases = 0;
      const isBelowMin = currentStock < minPar;

      if (currentStock < targetPar) {
        suggestedCases = Math.max(0, targetPar - currentStock);
      }

      suggestions[product.id] = {
        productId: product.id,
        currentCases: currentStock,
        minParLevel: minPar,
        targetParLevel: targetPar,
        suggestedCases,
        isBelowMin,
      };
    }
  });

  return suggestions;
}

/**
 * Finds alternative vendor offerings for a product across different suppliers.
 * Identifies potential savings based on matching itemCode or similar product title.
 */
export function findAlternativeSupplierOptions(
  product: Product,
  allProducts: Product[],
  allSuppliers: Supplier[]
): SupplierAlternativeOption[] {
  const alternatives: SupplierAlternativeOption[] = [];
  const currentCasePrice = product.casePrice || 0;
  if (currentCasePrice <= 0) return alternatives;

  const currentNameNormalized = product.name.trim().toLowerCase();
  const currentCode = product.itemCode?.trim().toLowerCase();

  for (const candidate of allProducts) {
    // Skip same product or same supplier
    if (candidate.id === product.id || candidate.supplierId === product.supplierId) {
      continue;
    }
    if (!candidate.active || !candidate.casePrice || candidate.casePrice <= 0) {
      continue;
    }

    const candidateCode = candidate.itemCode?.trim().toLowerCase();
    const candidateName = candidate.name.trim().toLowerCase();

    // Match criteria: exact item code match OR exact name match OR significant containment
    const isCodeMatch = currentCode && candidateCode && currentCode === candidateCode;
    const isNameMatch = currentNameNormalized === candidateName ||
      (currentNameNormalized.length > 5 && candidateName.includes(currentNameNormalized)) ||
      (candidateName.length > 5 && currentNameNormalized.includes(candidateName));

    if (isCodeMatch || isNameMatch) {
      const supplier = allSuppliers.find(s => s.id === candidate.supplierId);
      const supplierName = supplier?.name || 'Alternative Vendor';

      const diff = currentCasePrice - candidate.casePrice;
      const percentSavings = (diff / currentCasePrice) * 100;

      alternatives.push({
        alternativeProduct: candidate,
        supplierName,
        priceDiff: Number(diff.toFixed(2)),
        percentSavings: Number(percentSavings.toFixed(1)),
        isCheaper: diff > 0,
      });
    }
  }

  // Sort best savings first
  return alternatives.sort((a, b) => b.priceDiff - a.priceDiff);
}

/**
 * Analyzes historical price changes to compute inflation metrics and cost spikes.
 */
export function calculateIngredientInflation(
  priceHistory: PriceHistoryRecord[],
  products: Product[]
): InflationMetric[] {
  const historyByProduct = new Map<string, PriceHistoryRecord[]>();

  priceHistory.forEach((rec) => {
    const list = historyByProduct.get(rec.productId) || [];
    list.push(rec);
    historyByProduct.set(rec.productId, list);
  });

  const metrics: InflationMetric[] = [];

  historyByProduct.forEach((records, productId) => {
    if (records.length === 0) return;

    // Sort chronologically ascending
    const sorted = [...records].sort((a, b) => 
      new Date(a.effectiveDate || a.approvedAt || 0).getTime() - new Date(b.effectiveDate || b.approvedAt || 0).getTime()
    );

    const product = products.find(p => p.id === productId);
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];

    const prevPrice = earliest.previousCasePrice ?? earliest.oldCasePrice;
    const earliestPrice = (prevPrice !== undefined && prevPrice > 0) ? prevPrice : (earliest.newCasePrice ?? 0);
    const currentPrice = latest.newCasePrice ?? 0;

    if (earliestPrice > 0) {
      const priceDelta = currentPrice - earliestPrice;
      const percentInflation = (priceDelta / earliestPrice) * 100;

      metrics.push({
        productId,
        productName: latest.productName || product?.name || 'Product',
        itemCode: latest.itemCode || product?.itemCode,
        supplierName: latest.supplierName,
        earliestPrice: Number(earliestPrice.toFixed(2)),
        currentPrice: Number(currentPrice.toFixed(2)),
        priceDelta: Number(priceDelta.toFixed(2)),
        percentInflation: Number(percentInflation.toFixed(1)),
        historyEntriesCount: records.length,
      });
    }
  });

  return metrics.sort((a, b) => b.percentInflation - a.percentInflation);
}
