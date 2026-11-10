/**
 * Order Pricing & Totals Engine (Issue 10)
 *
 * Accurately computes:
 * - Line item totals for both standard catalog items and manual custom items.
 * - Mixed case and pack price computations: (caseQty * casePrice) + (packQty * packPrice).
 * - Distinguishes CONFIRMED prices from ESTIMATED and UNPRICED custom items.
 * - Line-level and aggregate VAT calculations (standard 20% vs zero-rated food).
 * - Explicit subtotal, VAT, and grand totals with complete breakdown and warnings.
 */

import type { OrderItem, ManualOrderItem, Product } from '../types.ts';

export interface LineItemPricingBreakdown {
  id: string;
  name: string;
  isManual: boolean;
  caseQty: number;
  packQty: number;
  casePrice: number;
  packPrice: number;
  lineSubtotal: number;
  vatRate: number;
  vatAmount: number;
  lineTotal: number;
  pricingStatus: 'CONFIRMED' | 'ESTIMATED' | 'UNPRICED';
}

export interface OrderTotalsBreakdown {
  catalogSubtotal: number;
  manualConfirmedSubtotal: number;
  manualEstimatedSubtotal: number;
  pricedSubtotal: number; // Subtotal of all priced items (net before VAT)
  vatTotal: number; // Total VAT
  grandTotal: number; // pricedSubtotal + vatTotal
  hasUnpricedItems: boolean;
  unpricedItemCount: number;
  hasEstimatedPrices: boolean;
  isExact: boolean;
  totalPricedUnits: number;
  summaryText: string;
  items: LineItemPricingBreakdown[];
}

export function calculateOrderTotals(
  cartItems: OrderItem[] = [],
  manualItems: ManualOrderItem[] = [],
  products: Product[] = []
): OrderTotalsBreakdown {
  let catalogSubtotal = 0;
  let manualConfirmedSubtotal = 0;
  let manualEstimatedSubtotal = 0;
  let vatTotal = 0;
  let unpricedItemCount = 0;
  let totalPricedUnits = 0;

  const items: LineItemPricingBreakdown[] = [];

  // 1. Process Standard Catalog Items
  for (const item of cartItems) {
    if (item.caseQty <= 0 && item.packQty <= 0) continue;

    const product = products.find((p) => p.id === item.productId);

    // Prefer durable snapshot on the item, fallback to current product catalog price
    const casePrice = item.casePriceSnapshot ?? product?.casePrice ?? 0;
    const packPrice = item.packPriceSnapshot ?? product?.packPrice ?? 0;
    const vatRate = item.vatRate ?? 0; // Default 0 for grocery/food

    const caseCost = (item.caseQty || 0) * casePrice;
    const packCost = (item.packQty || 0) * packPrice;
    const lineSubtotal = Math.round((caseCost + packCost) * 100) / 100;
    const vatAmount = Math.round(lineSubtotal * vatRate * 100) / 100;
    const lineTotal = Math.round((lineSubtotal + vatAmount) * 100) / 100;

    catalogSubtotal += lineSubtotal;
    vatTotal += vatAmount;
    totalPricedUnits += (item.caseQty || 0) + (item.packQty || 0);

    items.push({
      id: item.productId,
      name: item.productNameSnapshot || product?.name || 'Unnamed Product',
      isManual: false,
      caseQty: item.caseQty || 0,
      packQty: item.packQty || 0,
      casePrice,
      packPrice,
      lineSubtotal,
      vatRate,
      vatAmount,
      lineTotal,
      pricingStatus: 'CONFIRMED',
    });
  }

  // 2. Process Manual / Custom Items
  for (const m of manualItems) {
    if (!m.description?.trim() || ((m.caseQty || 0) <= 0 && (m.packQty || 0) <= 0)) {
      continue;
    }

    const casePrice = m.casePriceSnapshot ?? 0;
    const packPrice = m.packPriceSnapshot ?? 0;
    const vatRate = m.vatRate ?? 0;

    const caseCost = (m.caseQty || 0) * casePrice;
    const packCost = (m.packQty || 0) * packPrice;
    const lineSubtotal = Math.round((caseCost + packCost) * 100) / 100;

    const isPriced = lineSubtotal > 0;
    const pricingStatus: 'CONFIRMED' | 'ESTIMATED' | 'UNPRICED' = isPriced
      ? m.pricingStatus || 'ESTIMATED'
      : 'UNPRICED';

    let vatAmount = 0;
    let lineTotal = 0;

    if (isPriced) {
      vatAmount = Math.round(lineSubtotal * vatRate * 100) / 100;
      lineTotal = Math.round((lineSubtotal + vatAmount) * 100) / 100;

      if (pricingStatus === 'CONFIRMED') {
        manualConfirmedSubtotal += lineSubtotal;
      } else {
        manualEstimatedSubtotal += lineSubtotal;
      }

      vatTotal += vatAmount;
      totalPricedUnits += (m.caseQty || 0) + (m.packQty || 0);
    } else {
      unpricedItemCount += 1;
    }

    items.push({
      id: m.id,
      name: m.description,
      isManual: true,
      caseQty: m.caseQty || 0,
      packQty: m.packQty || 0,
      casePrice,
      packPrice,
      lineSubtotal,
      vatRate,
      vatAmount,
      lineTotal,
      pricingStatus,
    });
  }

  // Round summary figures to 2 decimal places
  catalogSubtotal = Math.round(catalogSubtotal * 100) / 100;
  manualConfirmedSubtotal = Math.round(manualConfirmedSubtotal * 100) / 100;
  manualEstimatedSubtotal = Math.round(manualEstimatedSubtotal * 100) / 100;
  vatTotal = Math.round(vatTotal * 100) / 100;

  const pricedSubtotal = Math.round(
    (catalogSubtotal + manualConfirmedSubtotal + manualEstimatedSubtotal) * 100
  ) / 100;
  const grandTotal = Math.round((pricedSubtotal + vatTotal) * 100) / 100;

  const hasUnpricedItems = unpricedItemCount > 0;
  const hasEstimatedPrices = manualEstimatedSubtotal > 0;
  const isExact = !hasUnpricedItems && !hasEstimatedPrices;

  let summaryText = `£${grandTotal.toFixed(2)}`;
  if (vatTotal > 0) {
    summaryText += ` (Net: £${pricedSubtotal.toFixed(2)} + VAT: £${vatTotal.toFixed(2)})`;
  }
  if (hasUnpricedItems && hasEstimatedPrices) {
    summaryText += ` (Est. total + ${unpricedItemCount} unpriced item(s) awaiting quote)`;
  } else if (hasUnpricedItems) {
    summaryText += ` (+ ${unpricedItemCount} unpriced custom item(s) awaiting quote)`;
  } else if (hasEstimatedPrices) {
    summaryText += ` (Includes £${manualEstimatedSubtotal.toFixed(2)} estimated manual items)`;
  }

  return {
    catalogSubtotal,
    manualConfirmedSubtotal,
    manualEstimatedSubtotal,
    pricedSubtotal,
    vatTotal,
    grandTotal,
    hasUnpricedItems,
    unpricedItemCount,
    hasEstimatedPrices,
    isExact,
    totalPricedUnits,
    summaryText,
    items,
  };
}
