import type { PriceChangeNotice, Product, PriceHistoryRecord } from '../types.ts';

export interface PriceSchedulerResult {
  updatedProducts: Product[];
  appliedNoticeIds: string[];
  generatedHistoryRecords: PriceHistoryRecord[];
}

/**
 * Identifies approved price notices that have reached or passed their effectiveDate
 * and are awaiting catalog activation.
 */
export function findDuePriceNotices(
  notices: PriceChangeNotice[],
  currentDateIso?: string
): PriceChangeNotice[] {
  const checkDate = currentDateIso ? new Date(currentDateIso) : new Date();
  const todayStr = checkDate.toISOString().split('T')[0];

  return notices.filter((notice) => {
    if (notice.status !== 'APPROVED') return false;
    // If effectiveDate is empty, it was effective immediately
    if (!notice.effectiveDate) return true;
    return notice.effectiveDate <= todayStr;
  });
}

/**
 * Activates due price change notices, updating the official products catalog
 * and producing immutable price history records.
 */
export function activateDuePriceNotices(params: {
  notices: PriceChangeNotice[];
  products: Product[];
  systemUserId?: string;
  systemUserName?: string;
  currentDateIso?: string;
}): PriceSchedulerResult {
  const { notices, products, systemUserId = 'system_scheduler', systemUserName = 'Automated Price Scheduler' } = params;
  const dueNotices = findDuePriceNotices(notices, params.currentDateIso);

  const updatedProducts = [...products];
  const appliedNoticeIds: string[] = [];
  const generatedHistoryRecords: PriceHistoryRecord[] = [];
  const nowIso = new Date().toISOString();

  for (const notice of dueNotices) {
    const productIndex = updatedProducts.findIndex(p => p.id === notice.productId);
    if (productIndex === -1) continue;

    const currentProduct = updatedProducts[productIndex];

    // Only update case or pack price if provided in notice, avoiding wiping out unaffected unit price.
    // If notice only updates pack price (and legacy newCasePrice was 0 while pack price > 0), preserve existing case price.
    let targetCasePrice = currentProduct.casePrice;
    if (notice.newCasePrice !== undefined) {
      if (notice.newCasePrice === 0 && (currentProduct.casePrice ?? 0) > 0 && (notice.newPackPrice !== undefined && notice.newPackPrice > 0)) {
        targetCasePrice = currentProduct.casePrice;
      } else {
        targetCasePrice = notice.newCasePrice;
      }
    }

    let targetPackPrice = currentProduct.packPrice;
    if (notice.newPackPrice !== undefined) {
      if (notice.newPackPrice === 0 && (currentProduct.packPrice ?? 0) > 0 && (notice.newCasePrice !== undefined && notice.newCasePrice > 0)) {
        targetPackPrice = currentProduct.packPrice;
      } else {
        targetPackPrice = notice.newPackPrice;
      }
    }

    const isDifferent = 
      currentProduct.casePrice !== targetCasePrice ||
      currentProduct.packPrice !== targetPackPrice;

    if (isDifferent) {
      updatedProducts[productIndex] = {
        ...currentProduct,
        casePrice: targetCasePrice,
        packPrice: targetPackPrice,
      };

      generatedHistoryRecords.push({
        id: `ph_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        productId: notice.productId,
        productName: notice.productName,
        itemCode: notice.itemCode,
        supplierId: notice.supplierId,
        supplierName: notice.supplierName,
        previousCasePrice: notice.oldCasePrice,
        newCasePrice: notice.newCasePrice,
        previousPackPrice: notice.oldPackPrice,
        newPackPrice: notice.newPackPrice,
        effectiveDate: notice.effectiveDate || nowIso.split('T')[0],
        invoiceRef: notice.invoiceNumber,
        approvedByUserId: notice.reviewedByUserId || systemUserId,
        approvedByUserName: notice.reviewedByUserName || systemUserName,
        approvedAt: nowIso,
        notes: `Activated automatically via Scheduled Price Activation Engine (Invoice ${notice.invoiceNumber})`,
      });
    }

    appliedNoticeIds.push(notice.id);
  }

  return {
    updatedProducts,
    appliedNoticeIds,
    generatedHistoryRecords,
  };
}
