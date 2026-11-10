import type { 
  OrderRecord, 
  CreditNoteClaim, 
  CreditNoteClaimItem, 
  CreditNoteClaimRevision,
  InvoiceVerification, 
  InvoiceVerificationRevision,
  ReviewedInvoiceLine,
  OrderItem, 
  ManualOrderItem,
  InvoiceScanStatus,
  InvoiceReviewStatus,
  InvoiceReviewMethod
} from '../types.ts';

export interface ReconciledLineInput {
  invoicedCaseQty?: number;
  invoicedPackQty?: number;
  damagedCaseQty?: number;
  damagedPackQty?: number;
  receiptConfirmed?: boolean;
  lineId?: string;
  productId?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  orderedCaseQty: number;
  orderedPackQty: number;
  deliveredCaseQty?: number;
  deliveredPackQty?: number;
  expectedCasePrice?: number;
  expectedPackPrice?: number;
  invoicedCasePrice?: number;
  invoicedPackPrice?: number;
  weightRate?: number;
  invoicedLineTotal?: number;
  netAmount?: number;
  vatRate?: number;
  vatAmount?: number;
  grossAmount?: number;
  isAmountOverridden?: boolean;
  manualAmountOverride?: number;
  issueType?: 'NONE' | 'SHORTAGE' | 'PRICE_OVERCHARGE' | 'DAMAGED' | 'WRONG_ITEM';
  conversionDecision?: string;
  matchingDecision?: string;
  notes?: string;
  isReviewed?: boolean;
  isGenuineZeroPrice?: boolean;
}

export interface LineReconciliationResult {
  invoicedCaseQty?: number;
  invoicedPackQty?: number;
  damagedCaseQty?: number;
  damagedPackQty?: number;
  receiptConfirmed?: boolean;
  lineId: string;
  productId?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  orderedCaseQty: number;
  orderedPackQty: number;
  deliveredCaseQty: number;
  deliveredPackQty: number;
  expectedCasePrice: number;
  expectedPackPrice: number;
  invoicedCasePrice: number;
  invoicedPackPrice: number;
  weightRate?: number;
  orderedLineValue: number;
  acceptedLineValue: number;
  invoicedLineTotal: number;
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  grossAmount: number;
  isAmountOverridden: boolean;
  manualAmountOverride?: number;
  claimAmount: number;
  issueType: 'NONE' | 'SHORTAGE' | 'PRICE_OVERCHARGE' | 'DAMAGED' | 'WRONG_ITEM';
  conversionDecision?: string;
  matchingDecision?: string;
  isUnbilledShortage: boolean;
  notes: string;
  isReviewed: boolean;
  isPriceAvailable: boolean;
  isGenuineZeroPrice?: boolean;
}

export interface ReconciliationOptions {
  comparisonOnly?: boolean;
  verifierName?: string;
  invoiceNumber?: string;
  invoiceNumberNotProvided?: boolean;
  invoiceDate?: string;
  supplierEmail?: string;
  branchCcEmail?: string;
  remarks?: string;
  newScanUrl?: string | null;
  scanStatus?: InvoiceScanStatus;
  reviewMethod?: InvoiceReviewMethod;
  evidenceReference?: string;
  isDraft?: boolean;
  allowIncomplete?: boolean;
}

export interface OrderReconciliationResult {
  totalOrderedValue: number;
  totalAcceptedValue: number;
  totalInvoicedValue: number;
  discrepancyTotal: number;
  hasDiscrepancies: boolean;
  fulfillmentStatus: 'FULFILLED' | 'PARTIAL' | 'UNFULFILLED';
  claimItems: CreditNoteClaimItem[];
  verification: InvoiceVerification;
  creditNoteClaim?: CreditNoteClaim;
  sanitizedUpdates: Partial<OrderRecord>;
  canFinalize: boolean;
  blockingReasons: string[];
  reviewStatus: InvoiceReviewStatus;
  priceComparisonAvailable: boolean;
  hasUnreviewedLines: boolean;
}

/**
 * Rounds a monetary number safely to 2 decimal places.
 */
export function roundCurrency(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Reconciles a single line item, separating unbilled shortages from billed shortages
 * and calculating price overcharges and damaged goods claims.
 * Preserves missing/unknown values without silently converting them to zero.
 */
export function reconcileSingleLine(line: ReconciledLineInput): LineReconciliationResult {
  const orderedCaseQty = Math.max(0, Number(line.orderedCaseQty) || 0);
  const orderedPackQty = Math.max(0, Number(line.orderedPackQty) || 0);
  const deliveredCaseQty = line.deliveredCaseQty !== undefined ? Math.max(0, Number(line.deliveredCaseQty) || 0) : 0;
  const deliveredPackQty = line.deliveredPackQty !== undefined ? Math.max(0, Number(line.deliveredPackQty) || 0) : 0;

  // Catalog prices: if undefined, keep as 0 only for math if unknown, but flag price availability
  const hasExpectedCase = line.expectedCasePrice !== undefined && line.expectedCasePrice !== null;
  const hasExpectedPack = line.expectedPackPrice !== undefined && line.expectedPackPrice !== null;
  const expectedCasePrice = hasExpectedCase ? Math.max(0, Number(line.expectedCasePrice) || 0) : 0;
  const expectedPackPrice = hasExpectedPack ? Math.max(0, Number(line.expectedPackPrice) || 0) : 0;

  // A price is considered available only if catalogue prices are explicitly specified (> 0) or genuinely reviewed zero
  const isPriceAvailable = (hasExpectedCase && expectedCasePrice > 0) || 
                           (hasExpectedPack && expectedPackPrice > 0) || 
                           line.isGenuineZeroPrice === true;

  const invoicedCasePrice = line.invoicedCasePrice !== undefined && line.invoicedCasePrice !== null
    ? Math.max(0, Number(line.invoicedCasePrice) || 0) 
    : (isPriceAvailable ? expectedCasePrice : 0);
  const invoicedPackPrice = line.invoicedPackPrice !== undefined && line.invoicedPackPrice !== null
    ? Math.max(0, Number(line.invoicedPackPrice) || 0) 
    : (isPriceAvailable ? expectedPackPrice : 0);

  const orderedLineValue = roundCurrency(
    (orderedCaseQty * expectedCasePrice) + (orderedPackQty * expectedPackPrice)
  );

  const acceptedLineValue = roundCurrency(
    (Math.max(0,deliveredCaseQty-(line.damagedCaseQty??0)) * expectedCasePrice) + (Math.max(0,deliveredPackQty-(line.damagedPackQty??0)) * expectedPackPrice)
  );

  // Line identifier: stable across sessions
  const lineId = line.lineId || (line.productId ? `line_${line.productId}` : `line_${line.description.replace(/\s+/g, '_').toLowerCase()}`);
  const unit = line.unit || (orderedCaseQty > 0 ? 'CASE' : 'PACK');

  // Invoiced line total / Net Amount:
  // If explicitly overridden by user, honor override;
  // otherwise if invoicedLineTotal is provided (e.g. from invoice document/test input), honor it;
  // otherwise compute from quantity * billed rate
  const isAmountOverridden = line.isAmountOverridden === true && line.manualAmountOverride !== undefined && Number.isFinite(line.manualAmountOverride);
  const invoicedLineTotal = isAmountOverridden
    ? roundCurrency(Number(line.manualAmountOverride))
    : (line.invoicedLineTotal !== undefined && Number.isFinite(line.invoicedLineTotal)
        ? roundCurrency(Number(line.invoicedLineTotal))
        : roundCurrency(((line.invoicedCaseQty??deliveredCaseQty) * invoicedCasePrice) + ((line.invoicedPackQty??deliveredPackQty) * invoicedPackPrice)));

  const netAmount = invoicedLineTotal;
  const vatRate = line.vatRate !== undefined && Number.isFinite(line.vatRate) ? Number(line.vatRate) : 0;
  const vatAmount = roundCurrency(netAmount * vatRate);
  const grossAmount = roundCurrency(netAmount + vatAmount);

  const physicalShortage = (deliveredCaseQty < orderedCaseQty) || (deliveredPackQty < orderedPackQty);
  
  // A billed discrepancy exists when the invoiced total exceeds the accepted delivered value
  const billedDiscrepancy = roundCurrency(Math.max(0, invoicedLineTotal - acceptedLineValue));

  // Determine issue type
  let issueType: 'NONE' | 'SHORTAGE' | 'PRICE_OVERCHARGE' | 'DAMAGED' | 'WRONG_ITEM' = 'NONE';
  let claimAmount = 0;
  let isUnbilledShortage = false;

  if (line.issueType === 'DAMAGED' || line.issueType === 'WRONG_ITEM') {
    issueType = line.issueType;
    claimAmount = line.damagedCaseQty!==undefined||line.damagedPackQty!==undefined ? billedDiscrepancy : invoicedLineTotal;
  } else if (billedDiscrepancy > 0 && isPriceAvailable) {
    claimAmount = billedDiscrepancy;
    const caseOvercharged = (orderedCaseQty > 0 || deliveredCaseQty > 0) &&
                            expectedCasePrice > 0 && invoicedCasePrice > expectedCasePrice;
    const packOvercharged = (orderedPackQty > 0 || deliveredPackQty > 0) &&
                            expectedPackPrice > 0 && invoicedPackPrice > expectedPackPrice;
    const isRateOvercharged = caseOvercharged || packOvercharged;
    issueType = isRateOvercharged ? 'PRICE_OVERCHARGE' : 'SHORTAGE';
  } else if (physicalShortage) {
    // Physical shortage occurred, but the supplier did NOT bill for the missing items
    isUnbilledShortage = true;
    issueType = 'SHORTAGE';
    claimAmount = 0;
  } else if (line.issueType && line.issueType !== 'NONE') {
    issueType = line.issueType;
  }

  // Review decision: respect explicit boolean if provided, else check if delivered quantities are present
  const isReviewed = line.isReviewed !== undefined 
    ? Boolean(line.isReviewed) 
    : (line.deliveredCaseQty !== undefined || line.deliveredPackQty !== undefined);

  return {
    lineId,
    invoicedCaseQty:line.invoicedCaseQty,invoicedPackQty:line.invoicedPackQty,damagedCaseQty:line.damagedCaseQty,damagedPackQty:line.damagedPackQty,receiptConfirmed:line.receiptConfirmed,
    productId: line.productId,
    itemCode: line.itemCode,
    description: line.description,
    unit,
    orderedCaseQty,
    orderedPackQty,
    deliveredCaseQty,
    deliveredPackQty,
    expectedCasePrice,
    expectedPackPrice,
    invoicedCasePrice,
    invoicedPackPrice,
    weightRate: line.weightRate,
    orderedLineValue,
    acceptedLineValue,
    invoicedLineTotal,
    netAmount,
    vatRate,
    vatAmount,
    grossAmount,
    isAmountOverridden,
    manualAmountOverride: line.manualAmountOverride,
    claimAmount,
    issueType,
    conversionDecision: line.conversionDecision,
    matchingDecision: line.matchingDecision,
    isUnbilledShortage,
    notes: line.notes || '',
    isReviewed,
    isPriceAvailable,
    isGenuineZeroPrice: line.isGenuineZeroPrice
  };
}

/**
 * Removes any undefined fields recursively to prevent Firestore and IndexedDB serialization errors.
 */
export function sanitizeVerificationUpdates<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeVerificationUpdates(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (item !== null && typeof item === 'object') {
          return sanitizeVerificationUpdates(item);
        }
        return item;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Reconciles the full order invoice and produces consistent verification and claim structures.
 * Strictly separates scan status, review completeness, and persistent verification.
 */
export function calculateOrderReconciliation(
  order: OrderRecord,
  lines: ReconciledLineInput[],
  options: ReconciliationOptions = {}
): OrderReconciliationResult {
  const reconciledLines = lines.map(reconcileSingleLine);

  const totalOrderedValue = roundCurrency(
    reconciledLines.reduce((sum, l) => sum + l.orderedLineValue, 0)
  );
  const totalAcceptedValue = roundCurrency(
    reconciledLines.reduce((sum, l) => sum + l.acceptedLineValue, 0)
  );
  const totalInvoicedValue = roundCurrency(
    reconciledLines.reduce((sum, l) => sum + l.invoicedLineTotal, 0)
  );

  // Price comparison is available only if catalog prices are present for all ordered lines
  const priceComparisonAvailable = reconciledLines.length > 0 && reconciledLines.every(l => l.isPriceAvailable);

  // Claim items are created for lines with a financial claim (> 0) or DAMAGED/WRONG_ITEM
  const claimItems: CreditNoteClaimItem[] = reconciledLines
    .filter(l => l.claimAmount > 0)
    .map((l, idx) => {
      const isPackOnly = (l.orderedCaseQty === 0 && l.deliveredCaseQty === 0) && (l.orderedPackQty > 0 || l.deliveredPackQty > 0);
      const isPackDiscrepancy = isPackOnly || (l.deliveredCaseQty === l.orderedCaseQty && l.deliveredPackQty !== l.orderedPackQty);
      const expectedPrice = isPackDiscrepancy
        ? (l.expectedPackPrice || l.expectedCasePrice)
        : (l.expectedCasePrice || l.expectedPackPrice);
      const invoicedPrice = isPackDiscrepancy
        ? (l.invoicedPackPrice || l.invoicedCasePrice)
        : (l.invoicedCasePrice || l.invoicedPackPrice);

      return {
        id: `cn-item-${idx}`,
        itemCode: l.itemCode || undefined,
        description: l.description,
        issueType: l.issueType as 'SHORTAGE' | 'PRICE_OVERCHARGE' | 'DAMAGED' | 'WRONG_ITEM',
        orderedQtyStr: `${l.orderedCaseQty > 0 ? l.orderedCaseQty + ' Box' : ''} ${l.orderedPackQty > 0 ? l.orderedPackQty + ' Pk' : ''}`.trim() || '0',
        deliveredQtyStr: `${l.deliveredCaseQty > 0 ? l.deliveredCaseQty + ' Box' : ''} ${l.deliveredPackQty > 0 ? l.deliveredPackQty + ' Pk' : ''}`.trim() || '0',
        expectedPrice,
        invoicedPrice,
        claimAmount: l.claimAmount,
        notes: l.notes || undefined
      };
    });

  const discrepancyTotal = roundCurrency(
    claimItems.reduce((sum, c) => sum + c.claimAmount, 0)
  );
  const hasDiscrepancies = claimItems.length > 0;

  // Physical fulfillment status
  const isAnyDelivered = reconciledLines.some(l => l.deliveredCaseQty > 0 || l.deliveredPackQty > 0);
  const isAnyShort = reconciledLines.some(l => l.deliveredCaseQty < l.orderedCaseQty || l.deliveredPackQty < l.orderedPackQty);
  
  let fulfillmentStatus: 'FULFILLED' | 'PARTIAL' | 'UNFULFILLED' = 'FULFILLED';
  if (!isAnyDelivered && (reconciledLines.some(l => l.orderedCaseQty > 0 || l.orderedPackQty > 0))) {
    fulfillmentStatus = 'UNFULFILLED';
  } else if (isAnyShort) {
    fulfillmentStatus = 'PARTIAL';
  }

  // Completeness & Verification Gate
  const blockingReasons: string[] = [];
  const hasInvoiceNumber = Boolean(options.invoiceNumber?.trim() || options.invoiceNumberNotProvided);
  const hasUnreviewedLines = reconciledLines.some(l => l.isReviewed === false);

  if (!options.isDraft) {
    if (!hasInvoiceNumber) {
      blockingReasons.push("Supplier Invoice Number is required, or check 'Not provided on document'.");
    }
    if (!options.invoiceDate?.trim()) {
      blockingReasons.push("Invoice Date is required.");
    }
    if (options.scanStatus === 'FAILED' && options.reviewMethod !== 'MANUAL') {
      blockingReasons.push("Scan failed — this invoice has not been verified. Complete manual review or try another document.");
    }
    if (options.scanStatus === 'SCANNING') {
      blockingReasons.push("Document scan is in progress.");
    }
    if (hasUnreviewedLines) {
      blockingReasons.push("All line items must be reviewed before final verification.");
    }
    if (lines.length === 0) {
      blockingReasons.push("No order line items exist to verify.");
    }
  }

  if(options.comparisonOnly&&!options.isDraft){
    if(lines.some(l=>l.receiptConfirmed!==true||l.deliveredCaseQty==null||l.deliveredPackQty==null))blockingReasons.push('Confirm actual received quantities for every line, including explicit zero for missing items.');
    if(lines.some(l=>l.invoicedCaseQty==null||l.invoicedPackQty==null))blockingReasons.push('Enter invoiced quantities for every line, including zero for items not billed.');
    if(lines.some(l=>['DAMAGED','WRONG_ITEM'].includes(l.issueType||'')&&(l.damagedCaseQty==null||l.damagedPackQty==null)))blockingReasons.push('Enter the damaged or rejected quantities, including zero for the unused unit.');
    if(lines.some(l=>(l.invoicedCaseQty??0)>0&&l.invoicedCasePrice==null||(l.invoicedPackQty??0)>0&&l.invoicedPackPrice==null))blockingReasons.push('Enter the invoice price for each billed quantity.');
    if(lines.some(l=>!l.isGenuineZeroPrice&&(((l.orderedCaseQty>0||(l.invoicedCaseQty??0)>0)&&!(l.expectedCasePrice!>0))||((l.orderedPackQty>0||(l.invoicedPackQty??0)>0)&&!(l.expectedPackPrice!>0)))))blockingReasons.push('A required historical unit price is missing.');
    if(!priceComparisonAvailable)blockingReasons.push('Expected prices are missing. Review price evidence or confirm genuine free items.');
    if(lines.some(l=>(l.damagedCaseQty??0)>(l.deliveredCaseQty??0)||(l.damagedPackQty??0)>(l.deliveredPackQty??0)))blockingReasons.push('Damaged quantities cannot exceed received quantities.');
  }
  const canFinalize = blockingReasons.length === 0;

  let reviewStatus: InvoiceReviewStatus;
  if (options.isDraft) {
    reviewStatus = 'DRAFT';
  } else if (!canFinalize) {
    reviewStatus = 'INCOMPLETE';
  } else if (hasDiscrepancies) {
    reviewStatus = 'REVIEWED_WITH_EXCEPTION';
  } else {
    reviewStatus = 'VERIFIED';
  }

  // Saved reviewed lines preserving complete facts
  const savedLines: ReviewedInvoiceLine[] = reconciledLines.map(l => ({
    invoicedCaseQty:l.invoicedCaseQty,invoicedPackQty:l.invoicedPackQty,damagedCaseQty:l.damagedCaseQty,damagedPackQty:l.damagedPackQty,receiptConfirmed:l.receiptConfirmed,
    lineId: l.lineId,
    productId: l.productId,
    itemCode: l.itemCode,
    description: l.description,
    unit: l.unit,
    orderedCaseQty: l.orderedCaseQty,
    orderedPackQty: l.orderedPackQty,
    deliveredCaseQty: l.deliveredCaseQty,
    deliveredPackQty: l.deliveredPackQty,
    expectedCasePrice: l.expectedCasePrice,
    expectedPackPrice: l.expectedPackPrice,
    invoicedCasePrice: l.invoicedCasePrice,
    invoicedPackPrice: l.invoicedPackPrice,
    weightRate: l.weightRate,
    netAmount: l.netAmount,
    vatRate: l.vatRate,
    vatAmount: l.vatAmount,
    grossAmount: l.grossAmount,
    isAmountOverridden: l.isAmountOverridden,
    manualAmountOverride: l.manualAmountOverride,
    issueType: l.issueType,
    conversionDecision: l.conversionDecision,
    matchingDecision: l.matchingDecision,
    notes: l.notes || undefined,
    isReviewed: l.isReviewed,
    isGenuineZeroPrice: l.isGenuineZeroPrice,
  }));

  const netTotal = roundCurrency(reconciledLines.reduce((sum, l) => sum + l.netAmount, 0));
  const vatTotal = roundCurrency(reconciledLines.reduce((sum, l) => sum + l.vatAmount, 0));
  const grossTotal = roundCurrency(reconciledLines.reduce((sum, l) => sum + l.grossAmount, 0));

  const verifier = options.verifierName || order.orderedByNameSnapshot || 'Staff';
  const existingVerification = order.invoiceVerification;
  let version = existingVerification?.version || 1;
  let revisionHistory: InvoiceVerificationRevision[] = existingVerification?.revisionHistory
    ? [...existingVerification.revisionHistory]
    : [];

  const isFinalVerification = canFinalize && !options.isDraft;

  // When updating an already verified invoice, archive revision
  if (isFinalVerification && existingVerification && (existingVerification.reviewStatus === 'VERIFIED' || existingVerification.reviewStatus === 'REVIEWED_WITH_EXCEPTION')) {
    const hasValuesChanged = existingVerification.totalInvoicedValue !== totalInvoicedValue ||
                            existingVerification.discrepancyTotal !== discrepancyTotal ||
                            existingVerification.invoiceNumber !== options.invoiceNumber;
    if (hasValuesChanged) {
      revisionHistory.push({
        version: existingVerification.version || 1,
        verifiedAt: existingVerification.verifiedAt,
        verifiedBy: existingVerification.verifiedBy || 'Staff',
        totalInvoicedValue: existingVerification.totalInvoicedValue,
        discrepancyTotal: existingVerification.discrepancyTotal,
        reason: options.remarks || 'Updated invoice review revision'
      });
      version = (existingVerification.version || 1) + 1;
    }
  }

  const isLegacyIncomplete = Boolean(existingVerification && (!existingVerification.lines || existingVerification.lines.length === 0));

  // Construct Verification object
  const verification: InvoiceVerification = {
    version,
    revisionHistory: revisionHistory.length > 0 ? revisionHistory : undefined,
    verifiedAt: new Date().toISOString(),
    verifiedBy: verifier,
    invoiceNumber: options.invoiceNumber?.trim() || (options.invoiceNumberNotProvided ? '[NOT_PROVIDED]' : (order.invoiceNumber || undefined)),
    invoiceNumberNotProvided: options.invoiceNumberNotProvided,
    invoiceDate: options.invoiceDate || order.invoiceDate || undefined,
    supplierId: order.supplierId,
    supplierName: order.supplierNameSnapshot,
    branchId: order.branchId,
    branchName: order.branchNameSnapshot,
    hasDiscrepancies,
    totalOrderedValue,
    totalInvoicedValue,
    netTotal,
    vatTotal,
    grossTotal,
    discrepancyTotal,
    notes: options.remarks || undefined,
    reviewStatus,
    reviewMethod: options.reviewMethod || (options.scanStatus === 'SUCCEEDED' ? 'OCR' : 'MANUAL'),
    scanStatus: options.scanStatus || 'NOT_STARTED',
    priceComparisonAvailable,
    evidenceReference: options.evidenceReference || (options.newScanUrl ? 'Scanned Document' : undefined),
    matchedLinesCount: reconciledLines.filter(l => l.issueType === 'NONE').length,
    unresolvedLinesCount: reconciledLines.filter(l => l.issueType !== 'NONE').length,
    lines: savedLines,
    isLegacyIncomplete: isLegacyIncomplete ? true : undefined,
  };

  // Construct CreditNoteClaim if discrepancies exist
  let creditNoteClaim: CreditNoteClaim | undefined = undefined;
  if (hasDiscrepancies) {
    const existingClaim = order.creditNoteClaim;
    const cnRef = existingClaim?.cnRef || `CN-${order.id.slice(0, 6).toUpperCase()}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;
    let claimHistory: CreditNoteClaimRevision[] = existingClaim?.claimHistory ? [...existingClaim.claimHistory] : [];
    let claimVersion = existingClaim?.version || 1;

    // If earlier claim was sent, editing creates a new revision while preserving earlier claim in history
    if (existingClaim?.emailStatus === 'SENT') {
      const alreadyArchived = claimHistory.some(h => h.sentAt === existingClaim.sentAt && h.totalClaimAmount === existingClaim.totalClaimAmount);
      if (!alreadyArchived) {
        claimHistory.push({
          revisionId: `rev_${claimHistory.length + 1}`,
          cnRef: existingClaim.cnRef,
          claimDate: existingClaim.claimDate,
          invoiceNumber: existingClaim.invoiceNumber,
          invoiceDate: existingClaim.invoiceDate,
          items: existingClaim.items,
          totalClaimAmount: existingClaim.totalClaimAmount,
          emailStatus: existingClaim.emailStatus,
          sentAt: existingClaim.sentAt,
          notes: existingClaim.notes,
        });
        claimVersion = (existingClaim.version || 1) + 1;
      }
    }

    creditNoteClaim = {
      cnRef,
      claimDate: existingClaim?.claimDate || new Date().toISOString(),
      invoiceNumber: verification.invoiceNumber,
      invoiceDate: options.invoiceDate || order.invoiceDate || undefined,
      items: claimItems,
      totalClaimAmount: discrepancyTotal,
      supplierEmail: options.supplierEmail || existingClaim?.supplierEmail || '',
      branchCcEmail: options.branchCcEmail || existingClaim?.branchCcEmail || '',
      notes: options.remarks || existingClaim?.notes || undefined,
      emailStatus: existingClaim?.emailStatus === 'SENT' ? 'PENDING' : (existingClaim?.emailStatus || 'PENDING'),
      sentAt: existingClaim?.emailStatus === 'SENT' ? undefined : existingClaim?.sentAt,
      version: claimVersion,
      claimHistory: claimHistory.length > 0 ? claimHistory : undefined,
    };
  } else if (order.creditNoteClaim?.emailStatus === 'SENT') {
    creditNoteClaim = order.creditNoteClaim;
  }

  // Update order items with sent quantities
  const updatedOrderItems: OrderItem[] = order.items.map(item => {
    const line = reconciledLines.find(l => l.productId === item.productId);
    return {
      ...item,
      sentCaseQty: line ? line.deliveredCaseQty : item.caseQty,
      sentPackQty: line ? line.deliveredPackQty : item.packQty
    };
  });

  const updatedManualItems: ManualOrderItem[] = order.manualItems.map(item => {
    const line = reconciledLines.find(l => l.description.includes(item.description));
    return {
      ...item,
      sentCaseQty: line ? line.deliveredCaseQty : item.caseQty,
      sentPackQty: line ? line.deliveredPackQty : item.packQty
    };
  });

  // Scanned invoice URL handling
  let finalScannedUrl: string | undefined = undefined;
  if (options.newScanUrl) {
    finalScannedUrl = options.newScanUrl;
  } else if (options.newScanUrl === null) {
    finalScannedUrl = undefined;
  } else {
    finalScannedUrl = order.scannedInvoiceUrl || undefined;
  }

  // When a replacement scan fails or is incomplete, PRESERVE previous valid saved verification
  const resultingVerification = isFinalVerification
    ? verification
    : (options.isDraft ? verification : (order.invoiceVerification || undefined));

  const rawUpdates: Partial<OrderRecord> = {
    items: updatedOrderItems,
    manualItems: updatedManualItems,
    fulfillmentStatus,
    receivedStatus: isFinalVerification ? 'PROCESSED' : (order.receivedStatus || 'NEW'),
    processedAt: isFinalVerification ? new Date().toISOString() : order.processedAt,
    invoiceNumber: verification.invoiceNumber,
    invoiceDate: options.invoiceDate || order.invoiceDate || undefined,
    scannedInvoiceUrl: finalScannedUrl,
    invoiceVerification: resultingVerification,
    creditNoteClaim: isFinalVerification ? (creditNoteClaim || undefined) : order.creditNoteClaim,
  };

  if(options.comparisonOnly){
    delete rawUpdates.items;delete rawUpdates.manualItems;delete rawUpdates.fulfillmentStatus;delete rawUpdates.receivedStatus;delete rawUpdates.processedAt;
  }
  const sanitizedUpdates = sanitizeVerificationUpdates(rawUpdates);

  return {
    totalOrderedValue,
    totalAcceptedValue,
    totalInvoicedValue,
    discrepancyTotal,
    hasDiscrepancies,
    fulfillmentStatus,
    claimItems,
    verification,
    creditNoteClaim,
    sanitizedUpdates,
    canFinalize,
    blockingReasons,
    reviewStatus,
    priceComparisonAvailable,
    hasUnreviewedLines
  };
}
