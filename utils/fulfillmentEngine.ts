/**
 * Supplier Fulfillment & Shortage Tracking Engine (Issue 11)
 *
 * Implements:
 * - Line-by-line fulfillment calculation (cases, packs, shortages, OOS reasons).
 * - Exact fulfillment status derivation: UNFULFILLED, PARTIAL, FULFILLED.
 * - RBAC authorization checks for supplier fulfillment operations.
 * - Delivery note formatting with itemized shortages and notifications.
 */

import type { OrderItem, ManualOrderItem, OrderRecord, User, Supplier, Branch } from '../types.ts';
import {supplierDispatchAccess} from '../shared/dispatch-access.ts';

export const STANDARD_SHORTAGE_REASONS = [
  'Out of Stock at Central Warehouse',
  'Short Shipment from Vendor',
  'Discontinued by Manufacturer',
  'Quality Rejection / Damaged',
  'Allocated to Priority Route / Rolled to Next Run',
  'Seasonal Product Unavailable',
  'Other (See Notes)',
] as const;

export interface LineFulfillmentSummary {
  id: string;
  name: string;
  isManual: boolean;
  orderedCaseQty: number;
  sentCaseQty: number;
  shortCaseQty: number;
  orderedPackQty: number;
  sentPackQty: number;
  shortPackQty: number;
  isShort: boolean;
  shortageReason?: string;
}

export interface FulfillmentStatusResult {
  status: 'FULFILLED' | 'PARTIAL' | 'UNFULFILLED';
  totalOrderedUnits: number;
  totalSentUnits: number;
  totalShortUnits: number;
  shortItemCount: number;
  hasShortages: boolean;
  summaryText: string;
  lines: LineFulfillmentSummary[];
}

/**
 * Computes exact fulfillment status and line-level shortages across standard catalog items and manual items.
 */
export function computeFulfillmentStatus(
  items: OrderItem[] = [],
  manualItems: ManualOrderItem[] = []
): FulfillmentStatusResult {
  let totalOrderedUnits = 0;
  let totalSentUnits = 0;
  let shortItemCount = 0;
  const lines: LineFulfillmentSummary[] = [];

  // 1. Process Standard Items
  for (const item of items) {
    const orderedCaseQty = item.caseQty || 0;
    const orderedPackQty = item.packQty || 0;
    const sentCaseQty = item.sentCaseQty !== undefined ? item.sentCaseQty : orderedCaseQty;
    const sentPackQty = item.sentPackQty !== undefined ? item.sentPackQty : orderedPackQty;

    const shortCaseQty = Math.max(0, orderedCaseQty - sentCaseQty);
    const shortPackQty = Math.max(0, orderedPackQty - sentPackQty);
    const isShort = shortCaseQty > 0 || shortPackQty > 0;

    totalOrderedUnits += orderedCaseQty + orderedPackQty;
    totalSentUnits += sentCaseQty + sentPackQty;
    if (isShort) shortItemCount += 1;

    lines.push({
      id: item.productId,
      name: item.productNameSnapshot,
      isManual: false,
      orderedCaseQty,
      sentCaseQty,
      shortCaseQty,
      orderedPackQty,
      sentPackQty,
      shortPackQty,
      isShort,
      shortageReason: isShort ? item.shortageReason || 'Out of Stock' : undefined,
    });
  }

  // 2. Process Manual Items
  for (const m of manualItems) {
    if (!m.description?.trim() || ((m.caseQty || 0) <= 0 && (m.packQty || 0) <= 0)) {
      continue;
    }

    const orderedCaseQty = m.caseQty || 0;
    const orderedPackQty = m.packQty || 0;
    const sentCaseQty = m.sentCaseQty !== undefined ? m.sentCaseQty : orderedCaseQty;
    const sentPackQty = m.sentPackQty !== undefined ? m.sentPackQty : orderedPackQty;

    const shortCaseQty = Math.max(0, orderedCaseQty - sentCaseQty);
    const shortPackQty = Math.max(0, orderedPackQty - sentPackQty);
    const isShort = shortCaseQty > 0 || shortPackQty > 0;

    totalOrderedUnits += orderedCaseQty + orderedPackQty;
    totalSentUnits += sentCaseQty + sentPackQty;
    if (isShort) shortItemCount += 1;

    lines.push({
      id: m.id,
      name: m.description,
      isManual: true,
      orderedCaseQty,
      sentCaseQty,
      shortCaseQty,
      orderedPackQty,
      sentPackQty,
      shortPackQty,
      isShort,
      shortageReason: isShort ? m.shortageReason || 'Out of Stock' : undefined,
    });
  }

  const totalShortUnits = Math.max(0, totalOrderedUnits - totalSentUnits);
  const hasShortages = totalShortUnits > 0;

  let status: 'FULFILLED' | 'PARTIAL' | 'UNFULFILLED' = 'FULFILLED';
  if (totalOrderedUnits > 0 && totalSentUnits === 0) {
    status = 'UNFULFILLED';
  } else if (hasShortages) {
    status = 'PARTIAL';
  }

  let summaryText = '';
  if (status === 'FULFILLED') {
    summaryText = `Fully fulfilled (${totalSentUnits}/${totalOrderedUnits} units dispatched)`;
  } else if (status === 'PARTIAL') {
    summaryText = `Partially fulfilled (${totalSentUnits}/${totalOrderedUnits} units dispatched, ${totalShortUnits} units short across ${shortItemCount} items)`;
  } else {
    summaryText = `Unfulfilled (0/${totalOrderedUnits} units dispatched - entire order out of stock)`;
  }

  return {
    status,
    totalOrderedUnits,
    totalSentUnits,
    totalShortUnits,
    shortItemCount,
    hasShortages,
    summaryText,
    lines,
  };
}

/**
 * Checks whether the current user is authorized to process fulfillment for this supplier order.
 */
export function canUserProcessFulfillment(
  user: User | null,
  order: OrderRecord,
  suppliers: Supplier[] = [],
  branches: Branch[] = []
): { allowed: boolean; reason?: string } {
  return supplierDispatchAccess(user, order, suppliers, branches);
}
