export type PriceRecordKind = 'notices' | 'history';
export const PRICE_DELETE_LIMIT = 200;

// Stable across Firestore snapshots, JSON transport and object key order.
export function priceRecordFingerprint(record: unknown): string {
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
      .filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;
  return JSON.stringify(stable(record));
}

export function historyProvesActivation(notice: any, history: any): boolean {
  return notice.status === 'APPROVED' && notice.productId === history.productId
    && notice.supplierId === history.supplierId && notice.effectiveDate === history.effectiveDate
    && (history.source === 'PRICE_NOTICE' || history.invoiceRef === notice.invoiceNumber)
    && history.invoiceRef === (notice.invoiceNumber || 'Approved Notice')
    && history.newCasePrice === notice.newCasePrice && history.newPackPrice === notice.newPackPrice;
}
