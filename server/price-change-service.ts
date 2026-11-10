/**
 * Authoritative Server Price Change Service (R06, R09, R11, R12)
 *
 * Single authoritative server-side price operation for:
 * - AdminProducts CSV updates (prices only / detailed)
 * - Invoice scan direct apply and proposal submissions
 * - Quick product editing with optimistic concurrency
 * - Notice approval and effective-date activation
 * - Append-only immutable price history audit records
 */

import type { Product, PriceChangeNotice, PriceHistoryRecord, User } from '../types.ts';

export interface PriceChangeItem {
  productId: string;
  itemCode?: string;
  productName?: string;
  newCasePrice?: number;
  newPackPrice?: number;
  expectedVersion?: number;
}

export interface PriceChangeRequest {
  action: 'APPLY_PRICE_UPDATE' | 'PROPOSE_NOTICE' | 'APPROVE_NOTICE' | 'BATCH_CSV_UPDATE' | 'ACTIVATE_SCHEDULED';
  supplierId: string;
  items?: PriceChangeItem[];
  noticeId?: string;
  effectiveDate?: string;
  reason?: string;
  source?: 'CSV_IMPORT' | 'INVOICE_SCAN' | 'QUICK_EDIT' | 'MANUAL_APPROVAL' | 'SCHEDULED_ACTIVATION';
  mode?: 'PRICES_ONLY' | 'FULL';
}

export interface PriceChangeResultItem {
  productId: string;
  status: 'UPDATED' | 'FIRST_PRICE' | 'UNCHANGED' | 'CONFLICT' | 'REJECTED';
  oldCasePrice?: number;
  newCasePrice?: number;
  oldPackPrice?: number;
  newPackPrice?: number;
  error?: string;
}

export interface PriceChangeOperationResult {
  success: boolean;
  action: string;
  processedCount: number;
  updatedCount: number;
  firstPriceCount: number;
  unchangedCount: number;
  conflictCount: number;
  errorCount: number;
  results: PriceChangeResultItem[];
  historyRecordsCreated: number;
  message?: string;
}

export interface AuthContext {
  id: string;
  displayName?: string;
  role: string;
  branchId?: string;
  active: boolean;
  permissions?: string[];
}

export class PriceOperationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PriceOperationError';
    this.status = status;
  }
}

export interface PriceChangeServiceDependencies {
  getProduct: (productId: string) => Promise<Product | null>;
  saveProduct: (product: Product) => Promise<void>;
  createPriceHistory: (record: PriceHistoryRecord) => Promise<void>;
  getNotice?: (noticeId: string) => Promise<PriceChangeNotice | null>;
  updateNotice?: (noticeId: string, updates: Partial<PriceChangeNotice>) => Promise<void>;
  createNotice?: (notice: PriceChangeNotice) => Promise<void>;
}

/**
 * Pure reusable strict price parser with explicit semantics:
 * - undefined / null / empty / whitespace-only string => returns undefined (omitted; keeps existing price)
 * - numeric 0 or string '0' / '0.0' / '0.00' => returns 0 (explicit zero)
 * - finite non-negative numbers and decimal strings => returns exact parsed number (preserving precision)
 * - currency symbols (£, $, €) and valid thousands groupings ("1,234.50") => normalized strictly
 * - reject booleans, arrays, objects, NaN, Infinity, negatives, exponential notation ("1e5"),
 *   partial alphanumeric strings ("12abc"), and ambiguous/invalid separators ("1,23", "1.234.50").
 */
export function parseStrictPrice(val: unknown, fieldName: string = 'price'): number | undefined {
  if (val === undefined || val === null) {
    return undefined;
  }

  if (typeof val === 'boolean' || typeof val === 'symbol' || typeof val === 'function') {
    throw new PriceOperationError(400, `Invalid value for ${fieldName}: boolean or function values are not allowed.`);
  }

  if (typeof val === 'object') {
    throw new PriceOperationError(400, `Invalid value for ${fieldName}: objects and arrays are not allowed.`);
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      throw new PriceOperationError(400, `Invalid numeric value for ${fieldName}: must be a finite number.`);
    }
    if (val < 0) {
      throw new PriceOperationError(400, `${fieldName} cannot be negative.`);
    }
    return Object.is(val, -0) ? 0 : val;
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') {
      return undefined;
    }

    if (/[eE]/.test(trimmed)) {
      throw new PriceOperationError(400, `Invalid ${fieldName}: exponential notation "${val}" is not supported.`);
    }

    if (trimmed.startsWith('-')) {
      throw new PriceOperationError(400, `${fieldName} cannot be negative.`);
    }

    // Default must reject foreign currency symbols ($ or €) in a GBP catalogue
    if (/[$€¥]/.test(trimmed)) {
      throw new PriceOperationError(
        400,
        `Foreign currency symbols (such as $ or €) are not supported in GBP catalog for ${fieldName}.`
      );
    }

    let cleaned = trimmed;
    if (cleaned.startsWith('£')) {
      cleaned = cleaned.replace(/^£\s*/, '');
    }

    if (cleaned === '') {
      throw new PriceOperationError(400, `Invalid ${fieldName}: empty price after currency symbol.`);
    }

    if (cleaned.includes('£')) {
      throw new PriceOperationError(400, `Invalid numeric format for ${fieldName}: multiple currency symbols.`);
    }

    if (cleaned.startsWith('-')) {
      throw new PriceOperationError(400, `${fieldName} cannot be negative.`);
    }

    const isPlainDecimal = /^\d+(\.\d+)?$/.test(cleaned);
    const isThousandsGrouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned);

    if (!isPlainDecimal && !isThousandsGrouped) {
      throw new PriceOperationError(
        400,
        `Invalid numeric format for ${fieldName}: "${val}". Must be a valid non-negative decimal number or formatted currency.`
      );
    }

    const normalizedStr = isThousandsGrouped ? cleaned.replace(/,/g, '') : cleaned;
    const num = Number(normalizedStr);

    if (!Number.isFinite(num) || Number.isNaN(num)) {
      throw new PriceOperationError(400, `Invalid numeric value for ${fieldName}: "${val}".`);
    }

    if (num < 0) {
      throw new PriceOperationError(400, `${fieldName} cannot be negative.`);
    }

    return Object.is(num, -0) ? 0 : num;
  }

  throw new PriceOperationError(400, `Invalid value type for ${fieldName}.`);
}

export const validateNumericPrice = parseStrictPrice;

export async function executePriceChangeOperation(
  user: AuthContext,
  req: PriceChangeRequest,
  deps: PriceChangeServiceDependencies
): Promise<PriceChangeOperationResult> {
  // 1. Authenticate identity
  if (!user || user.active !== true) {
    throw new PriceOperationError(403, 'Active user session required for price change operations.');
  }

  const role = String(user.role || '').toUpperCase();
  const isAdmin = role === 'CREATOR' || role === 'GM';
  const isManager = role === 'MANAGER';
  const canApprove = isAdmin || isManager || (Array.isArray(user.permissions) && user.permissions.includes('approve_price_changes'));

  if (!req.supplierId) {
    throw new PriceOperationError(400, 'Supplier ID is required for all price change operations.');
  }

  const todayIso = new Date().toISOString().split('T')[0];
  const effectiveDate = req.effectiveDate || todayIso;
  const source = req.source || 'CSV_IMPORT';
  const reason = req.reason || `Price update via ${source}`;

  const results: PriceChangeResultItem[] = [];
  let updatedCount = 0;
  let firstPriceCount = 0;
  let unchangedCount = 0;
  let conflictCount = 0;
  let errorCount = 0;
  let historyRecordsCreated = 0;

  // --------------------------------------------------------------------------
  // ACTION: BATCH_CSV_UPDATE or APPLY_PRICE_UPDATE (Direct price updates)
  // --------------------------------------------------------------------------
  if (req.action === 'BATCH_CSV_UPDATE' || req.action === 'APPLY_PRICE_UPDATE') {
    if (!canApprove) {
      throw new PriceOperationError(403, 'Staff accounts cannot directly overwrite catalog prices. Price increases require approval notice.');
    }

    const items = req.items || [];
    if (items.length === 0) {
      return {
        success: true,
        action: req.action,
        processedCount: 0,
        updatedCount: 0,
        firstPriceCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        errorCount: 0,
        results: [],
        historyRecordsCreated: 0,
        message: 'No items provided for update.'
      };
    }

    // Limit batch to bounded size (450 max per operation for atomic safety)
    if (items.length > 450) {
      throw new PriceOperationError(400, 'Batch exceeds maximum limit of 450 items per operation.');
    }

    // PRE-VALIDATION PASS:
    // Validate ALL item prices strictly before ANY persistence dependency is called.
    // A malformed item anywhere in the batch causes zero persistence calls!
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || typeof it !== 'object') {
        throw new PriceOperationError(400, `Item at index ${i} must be a valid object.`);
      }
      if (!it.productId || typeof it.productId !== 'string' || !it.productId.trim()) {
        throw new PriceOperationError(400, `Item at index ${i} is missing a valid productId.`);
      }
      parseStrictPrice(it.newCasePrice, `items[${i}].newCasePrice`);
      parseStrictPrice(it.newPackPrice, `items[${i}].newPackPrice`);
    }

    for (const item of items) {
      try {
        const product = await deps.getProduct(item.productId);
        if (!product) {
          results.push({
            productId: item.productId,
            status: 'REJECTED',
            error: `Product ID "${item.productId}" not found in catalog.`
          });
          errorCount++;
          continue;
        }

        // Validate supplier ownership: MUST match the request's supplier
        if (product.supplierId !== req.supplierId) {
          results.push({
            productId: item.productId,
            status: 'REJECTED',
            error: `Security violation: Product "${product.name}" belongs to supplier "${product.supplierId}", not "${req.supplierId}".`
          });
          errorCount++;
          continue;
        }

        // Optimistic concurrency check
        if (item.expectedVersion !== undefined && (product as any).version !== undefined) {
          if ((product as any).version !== item.expectedVersion) {
            results.push({
              productId: item.productId,
              status: 'CONFLICT',
              error: `Version conflict: Product was updated by another user. Expected v${item.expectedVersion}, got v${(product as any).version}.`
            });
            conflictCount++;
            continue;
          }
        }

        const oldCase = product.casePrice;
        const oldPack = product.packPrice;

        const newCase = parseStrictPrice(item.newCasePrice, 'casePrice');
        const newPack = parseStrictPrice(item.newPackPrice, 'packPrice');

        // Preserves omitted fields: if new price is undefined, keep existing!
        // If existing is absent (undefined) and new price is omitted (undefined), it remains absent!
        const finalCase = newCase !== undefined ? newCase : oldCase;
        const finalPack = newPack !== undefined ? newPack : oldPack;

        const caseChanged = newCase !== undefined && (oldCase === undefined || Math.abs(newCase - oldCase) >= 0.000001);
        const packChanged = newPack !== undefined && (oldPack === undefined || Math.abs(newPack - oldPack) >= 0.000001);
        const isChanged = caseChanged || packChanged;

        if (!isChanged) {
          const unchangedItem: PriceChangeResultItem = {
            productId: item.productId,
            status: 'UNCHANGED',
          };
          if (oldCase !== undefined) unchangedItem.oldCasePrice = oldCase;
          if (finalCase !== undefined) unchangedItem.newCasePrice = finalCase;
          if (oldPack !== undefined) unchangedItem.oldPackPrice = oldPack;
          if (finalPack !== undefined) unchangedItem.newPackPrice = finalPack;

          results.push(unchangedItem);
          unchangedCount++;
          continue;
        }

        // Existing known 0 -> positive is a regular price change, not FIRST_PRICE.
        // Absent (undefined) -> explicit value (including 0) is FIRST_PRICE.
        const isFirstPrice =
          (newCase !== undefined && oldCase === undefined) ||
          (newPack !== undefined && oldPack === undefined);

        const nextVersion = ((product as any).version || 1) + 1;

        const updatedProduct: Product = {
          ...product,
          ...( { version: nextVersion } as any)
        };

        if (finalCase !== undefined) {
          updatedProduct.casePrice = finalCase;
        } else {
          delete updatedProduct.casePrice;
        }

        if (finalPack !== undefined) {
          updatedProduct.packPrice = finalPack;
        } else {
          delete updatedProduct.packPrice;
        }

        await deps.saveProduct(updatedProduct);

        // Immutable price history entry: do not materialize false zeros or undefined properties
        const historyRecord: Record<string, any> = {
          id: `ph_${crypto.randomUUID()}`,
          productId: product.id,
          productName: product.name,
          supplierId: product.supplierId,
          supplierName: (product as any).supplierName || req.supplierId,
          effectiveDate,
          detectedDate: new Date().toISOString(),
          invoiceRef: reason,
          status: 'ACTIVE',
          approvedByUserId: user.id,
          approvedByUserName: user.displayName || user.id,
          approvedAt: new Date().toISOString(),
          reason,
          source,
        };

        if (oldCase !== undefined) {
          historyRecord.previousCasePrice = oldCase;
          historyRecord.oldCasePrice = oldCase;
        }
        if (finalCase !== undefined) {
          historyRecord.newCasePrice = finalCase;
        }
        if (oldPack !== undefined) {
          historyRecord.previousPackPrice = oldPack;
          historyRecord.oldPackPrice = oldPack;
        }
        if (finalPack !== undefined) {
          historyRecord.newPackPrice = finalPack;
        }

        let changeType = isFirstPrice ? 'FIRST_PRICE' : 'PRICE_UPDATE';
        if (newCase !== undefined && oldCase !== undefined) {
          const diff = Math.round((newCase - oldCase) * 100) / 100;
          historyRecord.priceDiff = diff;
          historyRecord.percentChange = oldCase > 0 ? Math.round(((newCase - oldCase) / oldCase) * 1000) / 10 : 0;
          changeType = isFirstPrice ? 'FIRST_PRICE' : (diff > 0 ? 'PRICE_INCREASE' : (diff < 0 ? 'PRICE_DECREASE' : 'NO_CHANGE'));
        } else if (newPack !== undefined && oldPack !== undefined) {
          const diff = Math.round((newPack - oldPack) * 100) / 100;
          historyRecord.priceDiff = diff;
          historyRecord.percentChange = oldPack > 0 ? Math.round(((newPack - oldPack) / oldPack) * 1000) / 10 : 0;
          changeType = isFirstPrice ? 'FIRST_PRICE' : (diff > 0 ? 'PRICE_INCREASE' : (diff < 0 ? 'PRICE_DECREASE' : 'NO_CHANGE'));
        }
        historyRecord.changeType = changeType;

        await deps.createPriceHistory(historyRecord as PriceHistoryRecord);
        historyRecordsCreated++;

        const resItem: PriceChangeResultItem = {
          productId: item.productId,
          status: isFirstPrice ? 'FIRST_PRICE' : 'UPDATED',
        };
        if (oldCase !== undefined) resItem.oldCasePrice = oldCase;
        if (finalCase !== undefined) resItem.newCasePrice = finalCase;
        if (oldPack !== undefined) resItem.oldPackPrice = oldPack;
        if (finalPack !== undefined) resItem.newPackPrice = finalPack;

        if (isFirstPrice) {
          firstPriceCount++;
        } else {
          updatedCount++;
        }
        results.push(resItem);
      } catch (err: any) {
        results.push({
          productId: item.productId,
          status: 'REJECTED',
          error: err.message
        });
        errorCount++;
      }
    }

    return {
      success: errorCount === 0 && conflictCount === 0,
      action: req.action,
      processedCount: items.length,
      updatedCount,
      firstPriceCount,
      unchangedCount,
      conflictCount,
      errorCount,
      results,
      historyRecordsCreated,
      message: `Processed ${items.length} items: ${updatedCount + firstPriceCount} updated, ${unchangedCount} unchanged, ${errorCount + conflictCount} errors/conflicts.`
    };
  }

  // --------------------------------------------------------------------------
  // ACTION: PROPOSE_NOTICE (Creates a validated pending notice)
  // --------------------------------------------------------------------------
  if (req.action === 'PROPOSE_NOTICE') {
    if (!deps.createNotice) throw new PriceOperationError(500, 'Notice creation dependency missing.');
    const item = req.items?.[0];
    if (!item) throw new PriceOperationError(400, 'Item details required to propose price notice.');

    // Pre-validate proposed prices before getProduct or createNotice
    const proposedCase = parseStrictPrice(item.newCasePrice, 'newCasePrice');
    const proposedPack = parseStrictPrice(item.newPackPrice, 'newPackPrice');

    const product = await deps.getProduct(item.productId);
    if (!product) throw new PriceOperationError(404, `Product "${item.productId}" not found.`);
    if (product.supplierId !== req.supplierId) {
      throw new PriceOperationError(403, 'Cannot propose notice for product belonging to another supplier.');
    }

    const oldCase = product.casePrice;
    const oldPack = product.packPrice;

    const notice: PriceChangeNotice = {
      id: req.noticeId || `pcn_${crypto.randomUUID()}`,
      productId: product.id,
      productName: product.name,
      itemCode: product.itemCode || item.itemCode || '',
      supplierId: req.supplierId,
      supplierName: (product as any).supplierName || req.supplierId,
      invoiceNumber: req.reason || 'MANUAL',
      invoiceDate: effectiveDate,
      detectedDate: new Date().toISOString(),
      effectiveDate,
      status: 'PENDING',
      uploadedByUserId: user.id,
      uploadedByUserName: user.displayName || user.id,
    };

    if (oldCase !== undefined) notice.oldCasePrice = oldCase;
    if (proposedCase !== undefined) {
      notice.newCasePrice = proposedCase;
    } else if (oldCase !== undefined) {
      notice.newCasePrice = oldCase;
    }

    if (oldPack !== undefined) notice.oldPackPrice = oldPack;
    if (proposedPack !== undefined) {
      notice.newPackPrice = proposedPack;
    } else if (oldPack !== undefined) {
      notice.newPackPrice = oldPack;
    }

    if (notice.newCasePrice !== undefined && notice.oldCasePrice !== undefined) {
      notice.priceDiff = Math.round((notice.newCasePrice - notice.oldCasePrice) * 100) / 100;
      notice.percentChange = notice.oldCasePrice > 0 ? Math.round(((notice.newCasePrice - notice.oldCasePrice) / notice.oldCasePrice) * 1000) / 10 : 0;
    } else if (notice.newPackPrice !== undefined && notice.oldPackPrice !== undefined) {
      notice.priceDiff = Math.round((notice.newPackPrice - notice.oldPackPrice) * 100) / 100;
      notice.percentChange = notice.oldPackPrice > 0 ? Math.round(((notice.newPackPrice - notice.oldPackPrice) / notice.oldPackPrice) * 1000) / 10 : 0;
    } else {
      notice.priceDiff = 0;
      notice.percentChange = 0;
    }

    await deps.createNotice(notice);
    return {
      success: true,
      action: 'PROPOSE_NOTICE',
      processedCount: 1,
      updatedCount: 0,
      firstPriceCount: 0,
      unchangedCount: 0,
      conflictCount: 0,
      errorCount: 0,
      results: [{ productId: product.id, status: 'UPDATED' }],
      historyRecordsCreated: 0,
      message: `Price notice created for "${product.name}".`
    };
  }

  // --------------------------------------------------------------------------
  // ACTION: APPROVE_NOTICE / ACTIVATE_SCHEDULED
  // --------------------------------------------------------------------------
  if (req.action === 'APPROVE_NOTICE' || req.action === 'ACTIVATE_SCHEDULED') {
    if (!canApprove) throw new PriceOperationError(403, 'Permission denied: Cannot approve price changes.');
    if (!deps.getNotice || !deps.updateNotice) throw new PriceOperationError(500, 'Notice dependencies missing.');

    const notice = await deps.getNotice(req.noticeId || '');
    if (!notice) throw new PriceOperationError(404, 'Price notice not found.');

    // Staff cannot self-approve their own proposed notices
    if (notice.uploadedByUserId === user.id && !isAdmin) {
      throw new PriceOperationError(403, 'Non-admin users cannot approve their own proposed price increases.');
    }

    // Validate stored notice prices BEFORE any writes!
    // A malformed persisted notice (e.g. legacy "12abc") causes zero writes.
    const validatedNewCase = parseStrictPrice(notice.newCasePrice, 'notice.newCasePrice');
    const validatedNewPack = parseStrictPrice(notice.newPackPrice, 'notice.newPackPrice');
    parseStrictPrice(notice.oldCasePrice, 'notice.oldCasePrice');
    parseStrictPrice(notice.oldPackPrice, 'notice.oldPackPrice');

    const isDue = !effectiveDate || effectiveDate <= todayIso;

    if (isDue) {
      // Activate immediately in catalog
      const product = await deps.getProduct(notice.productId);
      if (product) {
        const actualBeforeCase = product.casePrice;
        const actualBeforePack = product.packPrice;

        // Absent notice price means leave product current value unchanged!
        const actualAfterCase = validatedNewCase !== undefined ? validatedNewCase : actualBeforeCase;
        const actualAfterPack = validatedNewPack !== undefined ? validatedNewPack : actualBeforePack;

        const updatedProduct: Product = {
          ...product,
        };
        if (actualAfterCase !== undefined) {
          updatedProduct.casePrice = actualAfterCase;
        } else {
          delete updatedProduct.casePrice;
        }
        if (actualAfterPack !== undefined) {
          updatedProduct.packPrice = actualAfterPack;
        } else {
          delete updatedProduct.packPrice;
        }

        await deps.saveProduct(updatedProduct);

        const hist: Record<string, any> = {
          id: `ph_${crypto.randomUUID()}`,
          productId: notice.productId,
          productName: notice.productName,
          supplierId: notice.supplierId,
          supplierName: notice.supplierName,
          effectiveDate,
          detectedDate: notice.detectedDate,
          invoiceRef: notice.invoiceNumber || 'Approved Notice',
          status: 'ACTIVE',
          approvedByUserId: user.id,
          approvedByUserName: user.displayName || user.id,
          approvedAt: new Date().toISOString(),
          reason: notice.invoiceNumber || 'Approved Notice',
          source: 'PRICE_NOTICE',
          changeType: (notice.priceDiff ?? 0) > 0 ? 'PRICE_INCREASE' : ((notice.priceDiff ?? 0) < 0 ? 'PRICE_DECREASE' : 'PRICE_UPDATE'),
        };

        if (actualBeforeCase !== undefined) {
          hist.previousCasePrice = actualBeforeCase;
          hist.oldCasePrice = actualBeforeCase;
        }
        if (actualAfterCase !== undefined) {
          hist.newCasePrice = actualAfterCase;
        }
        if (actualBeforePack !== undefined) {
          hist.previousPackPrice = actualBeforePack;
          hist.oldPackPrice = actualBeforePack;
        }
        if (actualAfterPack !== undefined) {
          hist.newPackPrice = actualAfterPack;
        }
        if (notice.priceDiff !== undefined) {
          hist.priceDiff = notice.priceDiff;
        }
        if (notice.percentChange !== undefined) {
          hist.percentChange = notice.percentChange;
        }

        await deps.createPriceHistory(hist as PriceHistoryRecord);
        historyRecordsCreated++;
      }
      await deps.updateNotice(notice.id, {
        status: 'APPROVED',
        effectiveDate,
        approvedByUserId: user.id,
        approvedByUserName: user.displayName || user.id,
        approvedAt: new Date().toISOString(),
      });
    } else {
      // Future date: keep scheduled
      await deps.updateNotice(notice.id, {
        status: 'APPROVED',
        effectiveDate,
        approvedByUserId: user.id,
        approvedByUserName: user.displayName || user.id,
        approvedAt: new Date().toISOString(),
      });
    }

    return {
      success: true,
      action: req.action,
      processedCount: 1,
      updatedCount: isDue ? 1 : 0,
      firstPriceCount: 0,
      unchangedCount: isDue ? 0 : 1,
      conflictCount: 0,
      errorCount: 0,
      results: [{ productId: notice.productId, status: 'UPDATED' }],
      historyRecordsCreated,
      message: isDue ? `Price change activated for "${notice.productName}".` : `Price change scheduled for effective date ${effectiveDate}.`
    };
  }

  throw new PriceOperationError(400, `Unknown action: "${(req as any).action}".`);
}
