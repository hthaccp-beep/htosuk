import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store';
import { 
  OrderRecord, 
  Product, 
  CreditNoteClaim, 
  CreditNoteClaimItem, 
  InvoiceVerification,
  InvoiceScanStatus,
  InvoiceReviewStatus,
  InvoiceReviewMethod,
  getCaseUnitLabel, 
  getPackUnitLabel 
} from '../types';
import { extractReceiptQuantities } from '../utils/geminiOCR';
import { generateCreditNoteEmailContent, generateCreditNotePDF } from '../utils/orderEmail';
import { sendEmail, readEmailError } from '../utils/sendEmail';
import { calculateOrderReconciliation, reconcileSingleLine } from '../utils/invoiceReconciliation';
import type { EmailAttachment } from '../shared/email';
import { addLog } from '../logger';
import { 
  X, Upload, Camera, Loader2, AlertTriangle, CheckCircle, 
  FileText, Send, DollarSign, PackageCheck, AlertCircle, RefreshCw,
  Save, CheckSquare
} from 'lucide-react';

interface ReconciledLine {
  lineId: string;
  productId?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  orderedCaseQty: number;
  orderedPackQty: number;
  deliveredCaseQty: number;
  deliveredPackQty: number;
  expectedCasePrice?: number;
  expectedPackPrice?: number;
  invoicedCasePrice: number;
  invoicedPackPrice: number;
  weightRate?: number;
  invoicedLineTotal: number;
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  grossAmount: number;
  isAmountOverridden?: boolean;
  manualAmountOverride?: number;
  issueType: 'NONE' | 'SHORTAGE' | 'PRICE_OVERCHARGE' | 'DAMAGED' | 'WRONG_ITEM';
  conversionDecision?: string;
  matchingDecision?: string;
  notes: string;
  isReviewed: boolean;
  isGenuineZeroPrice: boolean;
}

export const InvoiceCrossCheckModal: React.FC<{
  order: OrderRecord;
  onClose: () => void;
  onSaveAndClose: (updatedOrder?: Partial<OrderRecord>) => void;
}> = ({ order, onClose, onSaveAndClose }) => {
  const { suppliers, branches, products, markOrderAsProcessed, updateOrder, currentUser, showToast } = useAppStore();

  const supplier = suppliers.find(s => s.id === order.supplierId);
  const branch = branches.find(b => b.id === order.branchId);

  // Body scroll lock and Escape key handler for accessibility
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // States
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(order.scannedInvoiceUrl || null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [scanStatusMessage, setScanStatusMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(() => {
    // Flag incomplete legacy records upon open
    if (order.invoiceVerification && (!order.invoiceVerification.lines || order.invoiceVerification.lines.length === 0)) {
      return {
        type: 'warning',
        text: 'Legacy verification record lacks line details. Please review quantities and rates before verifying.'
      };
    }
    return null;
  });

  // Scan & Review Tracking States
  const [scanStatus, setScanStatus] = useState<InvoiceScanStatus>(() => {
    if (order.invoiceVerification?.scanStatus) return order.invoiceVerification.scanStatus;
    if (order.scannedInvoiceUrl) return 'SUCCEEDED';
    return 'NOT_STARTED';
  });
  const [reviewMethod, setReviewMethod] = useState<InvoiceReviewMethod>(() => {
    return order.invoiceVerification?.reviewMethod || 'MANUAL';
  });
  const [replacementScanFailed, setReplacementScanFailed] = useState(false);

  // Invoice Header Data
  const [invoiceNumber, setInvoiceNumber] = useState(order.invoiceNumber || order.invoiceVerification?.invoiceNumber || '');
  const [invoiceNumberNotProvided, setInvoiceNumberNotProvided] = useState<boolean>(
    order.invoiceVerification?.invoiceNumberNotProvided || false
  );
  const [invoiceDate, setInvoiceDate] = useState(order.invoiceDate || order.invoiceVerification?.invoiceDate || new Date().toISOString().split('T')[0]);

  // Supplier & Branch Emails
  const [supplierEmail, setSupplierEmail] = useState(supplier?.contactEmail || supplier?.email || '');
  const [branchCcEmail, setBranchCcEmail] = useState(branch?.contactEmail || branch?.email || '');

  // Claim Remarks & Notes
  const [claimRemarks, setClaimRemarks] = useState(order.creditNoteClaim?.notes || order.invoiceVerification?.notes || '');

  const hasPreviousVerification = Boolean(order.invoiceVerification && order.invoiceVerification.reviewStatus !== 'DRAFT');

  // Build Initial Reconciled Lines from Saved Version or Order Items
  const [lines, setLines] = useState<ReconciledLine[]>(() => {
    // 1. EXACT REOPEN: If order already has saved reviewed lines, restore them exactly!
    if (order.invoiceVerification?.lines && order.invoiceVerification.lines.length > 0) {
      return order.invoiceVerification.lines.map(savedLine => ({
        lineId: savedLine.lineId,
        productId: savedLine.productId,
        itemCode: savedLine.itemCode || '',
        description: savedLine.description,
        unit: savedLine.unit || (savedLine.orderedCaseQty > 0 ? 'CASE' : 'PACK'),
        orderedCaseQty: savedLine.orderedCaseQty,
        orderedPackQty: savedLine.orderedPackQty,
        deliveredCaseQty: savedLine.deliveredCaseQty,
        deliveredPackQty: savedLine.deliveredPackQty,
        expectedCasePrice: savedLine.expectedCasePrice,
        expectedPackPrice: savedLine.expectedPackPrice,
        invoicedCasePrice: savedLine.invoicedCasePrice ?? 0,
        invoicedPackPrice: savedLine.invoicedPackPrice ?? 0,
        weightRate: savedLine.weightRate,
        invoicedLineTotal: savedLine.grossAmount || savedLine.netAmount || 0,
        netAmount: savedLine.netAmount ?? 0,
        vatRate: savedLine.vatRate ?? 0,
        vatAmount: savedLine.vatAmount ?? 0,
        grossAmount: savedLine.grossAmount ?? (savedLine.netAmount ?? 0),
        isAmountOverridden: savedLine.isAmountOverridden || false,
        manualAmountOverride: savedLine.manualAmountOverride,
        issueType: savedLine.issueType,
        conversionDecision: savedLine.conversionDecision,
        matchingDecision: savedLine.matchingDecision,
        notes: savedLine.notes || '',
        isReviewed: savedLine.isReviewed,
        isGenuineZeroPrice: savedLine.isGenuineZeroPrice || false,
      }));
    }

    // 2. Legacy Incomplete record or Fresh order:
    // Incomplete legacy records must be flagged for review rather than silently completed with invented values
    const isLegacyIncomplete = Boolean(order.invoiceVerification && (!order.invoiceVerification.lines || order.invoiceVerification.lines.length === 0));
    const isInitiallyReviewed = false;

    const stdLines: ReconciledLine[] = order.items.map((item, idx) => {
      const prod = products.find(p => p.id === item.productId);
      const expectedCasePrice = item.casePriceSnapshot ?? prod?.casePrice;
      const expectedPackPrice = item.packPriceSnapshot ?? prod?.packPrice;
      
      const deliveredCaseQty = item.sentCaseQty !== undefined ? item.sentCaseQty : item.caseQty;
      const deliveredPackQty = item.sentPackQty !== undefined ? item.sentPackQty : item.packQty;
      const vatRate = prod?.vatRate ?? 0;
      
      // If legacy incomplete, do not invent invoiced prices matching catalogue defaults
      const invoicedCasePrice = isLegacyIncomplete ? 0 : (expectedCasePrice ?? 0);
      const invoicedPackPrice = isLegacyIncomplete ? 0 : (expectedPackPrice ?? 0);
      const initialNet = (deliveredCaseQty * invoicedCasePrice) + (deliveredPackQty * invoicedPackPrice);
      const vatAmount = initialNet * vatRate;

      return {
        lineId: `line_${item.productId || idx}`,
        productId: item.productId,
        itemCode: prod?.itemCode || '',
        description: item.productNameSnapshot,
        unit: item.caseQty > 0 ? 'CASE' : 'PACK',
        orderedCaseQty: item.caseQty,
        orderedPackQty: item.packQty,
        deliveredCaseQty,
        deliveredPackQty,
        expectedCasePrice,
        expectedPackPrice,
        invoicedCasePrice,
        invoicedPackPrice,
        invoicedLineTotal: initialNet,
        netAmount: initialNet,
        vatRate,
        vatAmount,
        grossAmount: initialNet + vatAmount,
        isAmountOverridden: false,
        issueType: (deliveredCaseQty < item.caseQty || deliveredPackQty < item.packQty) ? 'SHORTAGE' : 'NONE',
        notes: '',
        isReviewed: isInitiallyReviewed,
        isGenuineZeroPrice: false,
      };
    });

    const manualLines: ReconciledLine[] = order.manualItems.map((item, idx) => {
      const deliveredCaseQty = item.sentCaseQty !== undefined ? item.sentCaseQty : item.caseQty;
      const deliveredPackQty = item.sentPackQty !== undefined ? item.sentPackQty : item.packQty;
      const invoicedCasePrice = isLegacyIncomplete ? 0 : (item.casePriceSnapshot ?? 0);
      const invoicedPackPrice = isLegacyIncomplete ? 0 : (item.packPriceSnapshot ?? 0);
      const initialNet = (deliveredCaseQty * invoicedCasePrice) + (deliveredPackQty * invoicedPackPrice);

      return {
        lineId: `manual_line_${item.id || idx}`,
        description: item.description + ' (Manual)',
        unit: item.caseQty > 0 ? 'CASE' : 'PACK',
        orderedCaseQty: item.caseQty,
        orderedPackQty: item.packQty,
        deliveredCaseQty,
        deliveredPackQty,
        expectedCasePrice: item.casePriceSnapshot,
        expectedPackPrice: item.packPriceSnapshot,
        invoicedCasePrice,
        invoicedPackPrice,
        invoicedLineTotal: initialNet,
        netAmount: initialNet,
        vatRate: 0,
        vatAmount: 0,
        grossAmount: initialNet,
        isAmountOverridden: false,
        issueType: (deliveredCaseQty < item.caseQty || deliveredPackQty < item.packQty) ? 'SHORTAGE' : 'NONE',
        notes: '',
        isReviewed: isInitiallyReviewed,
        isGenuineZeroPrice: false,
      };
    });

    return [...stdLines, ...manualLines];
  });

  // Handle OCR Scan File
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const selectedFile = e.target.files[0];
    setFile(selectedFile);

    try {
      const objectUrl = URL.createObjectURL(selectedFile);
      setPreviewUrl(objectUrl);
    } catch (_) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }

    await runOCRScan(selectedFile);
  };

  const cleanStr = (s: string): string => {
    return (s || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const matchScannedToLine = (lineDesc: string, scanned: any): boolean => {
    const oClean = cleanStr(lineDesc);
    const mClean = cleanStr(scanned.matchedOrderName || '');
    const rClean = cleanStr(scanned.rawScannedName || scanned.description || '');

    if (mClean && (oClean === mClean || oClean.includes(mClean) || mClean.includes(oClean))) {
      return true;
    }
    if (rClean && (oClean === rClean || oClean.includes(rClean) || rClean.includes(oClean))) {
      return true;
    }

    const oWords = oClean.split(' ').filter(w => w.length > 2);
    const targetWords = `${mClean} ${rClean}`.split(' ').filter(w => w.length > 2);
    if (oWords.length > 0 && targetWords.length > 0) {
      const common = oWords.filter(w => targetWords.includes(w));
      if (common.length >= 2 || (oWords.length === 1 && common.length === 1)) {
        return true;
      }
    }
    return false;
  };

  const runOCRScan = async (targetFile: File) => {
    setIsScanning(true);
    setScanStatusMessage(null);
    setReplacementScanFailed(false);
    try {
      const allItemNames = lines.map(l => l.description).join(', ');
      const result = await extractReceiptQuantities(targetFile, allItemNames, order.manualItems, order.id, order.branchId);

      if (result) {
        if (result.invoiceNumber) {
          setInvoiceNumber(result.invoiceNumber);
          setInvoiceNumberNotProvided(false);
        }
        if (result.invoiceDate) setInvoiceDate(result.invoiceDate);

        const extractedList: any[] = Array.isArray(result.extractedItems) 
          ? result.extractedItems 
          : (Array.isArray(result.lineItems) ? result.lineItems : []);

        if (extractedList.length > 0) {
          // Calculate mapping deterministically outside of state updater
          let matchedCount = 0;
          const updatedLines = lines.map(line => {
            const matched = extractedList.find((m: any) => matchScannedToLine(line.description, m));

            if (matched) {
              matchedCount++;
              const delCase = matched.deliveredCaseQty !== undefined ? matched.deliveredCaseQty : line.deliveredCaseQty;
              const delPack = matched.deliveredPackQty !== undefined ? matched.deliveredPackQty : line.deliveredPackQty;
              
              const invCasePrice = matched.invoicedCasePrice ?? matched.invoicedPriceBox ?? line.expectedCasePrice;
              const invPackPrice = matched.invoicedPackPrice ?? matched.invoicedPriceUnit ?? line.expectedPackPrice;

              let issue: ReconciledLine['issueType'] = 'NONE';
              if (delCase < line.orderedCaseQty || delPack < line.orderedPackQty) {
                issue = 'SHORTAGE';
              }
              if ((invCasePrice !== undefined && line.expectedCasePrice !== undefined && invCasePrice > line.expectedCasePrice) ||
                  (invPackPrice !== undefined && line.expectedPackPrice !== undefined && invPackPrice > line.expectedPackPrice)) {
                issue = 'PRICE_OVERCHARGE';
              }

              const lineTotal = matched.totalLinePrice ?? matched.invoicedLineTotal ?? (((delCase ?? 0) * (invCasePrice ?? 0)) + ((delPack ?? 0) * (invPackPrice ?? 0)));
              const notes = matched.conditionNotes || matched.notes || line.notes;

              return {
                ...line,
                deliveredCaseQty: delCase,
                deliveredPackQty: delPack,
                invoicedCasePrice: invCasePrice,
                invoicedPackPrice: invPackPrice,
                invoicedLineTotal: lineTotal,
                issueType: issue,
                notes,
                isReviewed: true,
                isGenuineZeroPrice: (invCasePrice === 0 || invPackPrice === 0) && line.expectedCasePrice === 0 && line.expectedPackPrice === 0,
              };
            }
            return line;
          });

          setLines(updatedLines);
          setScanStatus('SUCCEEDED');
          setReviewMethod('OCR_ASSISTED');

          const unresolvedCount = Math.max(0, extractedList.length - matchedCount);
          const unreviewedOrderLines = updatedLines.filter(l => !l.isReviewed).length;

          if (unresolvedCount > 0 || unreviewedOrderLines > 0) {
            setScanStatusMessage({
              type: 'warning',
              text: `Extracted ${extractedList.length} items from "${targetFile.name}": ${matchedCount} matched, ${unresolvedCount} unresolved. ${unreviewedOrderLines} order items require manual review.`
            });
          } else {
            setScanStatusMessage({
              type: 'success',
              text: `Extracted ${matchedCount} items from "${targetFile.name}". Review quantities and prices below.`
            });
          }
          showToast('success', `OCR Complete: Matched ${matchedCount} items from ${targetFile.name}.`);
        } else {
          setScanStatus('SUCCEEDED');
          setScanStatusMessage({
            type: 'warning',
            text: `No invoice items were extracted. Review manually or try another document.`
          });
          showToast('info', 'No invoice items were extracted. Please enter quantities manually.');
        }
      }
    } catch (err: any) {
      console.error('Invoice cross check OCR error:', err);
      const errMsg = err?.message || 'Failed to run OCR.';
      setScanStatus('FAILED');
      if (hasPreviousVerification) {
        setReplacementScanFailed(true);
      }
      setScanStatusMessage({
        type: 'error',
        text: `Scan failed — this invoice has not been verified. (${errMsg}) You can enter delivered quantities manually below or try another document.`
      });
      showToast('error', `Scan failed: ${errMsg}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Line Field Handlers
  const handleLineUpdate = (idx: number, field: keyof ReconciledLine, val: any) => {
    setLines(prev => {
      const updated = [...prev];
      const isZeroPrice = (field === 'invoicedCasePrice' || field === 'invoicedPackPrice') && val === 0;
      const target = { 
        ...updated[idx], 
        [field]: val,
        isReviewed: true,
        isGenuineZeroPrice: isZeroPrice ? true : updated[idx].isGenuineZeroPrice,
      };

      // Support manual amount override
      if (field === 'manualAmountOverride') {
        if (val !== undefined && val !== null && val !== '') {
          target.isAmountOverridden = true;
          target.manualAmountOverride = parseFloat(val) || 0;
        } else {
          target.isAmountOverridden = false;
          target.manualAmountOverride = undefined;
        }
      } else if (field === 'isAmountOverridden' && !val) {
        target.isAmountOverridden = false;
        target.manualAmountOverride = undefined;
      }

      // If user edits quantities or rates and amount is not overridden, clear invoicedLineTotal to force dynamic recalculation
      if (!target.isAmountOverridden && ['deliveredCaseQty', 'deliveredPackQty', 'invoicedCasePrice', 'invoicedPackPrice'].includes(field as string)) {
        delete (target as any).invoicedLineTotal;
      }

      const reconciled = reconcileSingleLine({
        ...target,
        issueType: field === 'issueType' ? val : target.issueType
      });

      updated[idx] = {
        ...target,
        issueType: field === 'issueType' ? val : reconciled.issueType,
        invoicedLineTotal: reconciled.invoicedLineTotal,
        netAmount: reconciled.netAmount,
        vatAmount: reconciled.vatAmount,
        grossAmount: reconciled.grossAmount,
      };
      return updated;
    });

    // If scanning failed or not started, manual edits indicate manual review
    if (scanStatus === 'FAILED' || scanStatus === 'NOT_STARTED') {
      setReviewMethod('MANUAL');
    }
  };

  const handleMarkAllReviewed = () => {
    setLines(prev => prev.map(l => ({ ...l, isReviewed: true })));
    setReviewMethod('MANUAL');
    showToast('info', 'All items marked as manually reviewed.');
  };

  // Perform Complete Order Reconciliation
  const verifierName = currentUser?.displayName || order.orderedByNameSnapshot || 'Staff';
  const reconciliation = calculateOrderReconciliation(order, lines, {
    verifierName,
    invoiceNumber: invoiceNumberNotProvided ? '' : invoiceNumber,
    invoiceNumberNotProvided,
    invoiceDate,
    supplierEmail,
    branchCcEmail,
    remarks: claimRemarks,
    newScanUrl: file ? previewUrl : undefined,
    scanStatus,
    reviewMethod,
    evidenceReference: file ? file.name : (previewUrl ? 'Saved Document' : undefined)
  });

  const {
    totalOrderedValue,
    totalInvoicedValue,
    discrepancyTotal: totalClaimAmount,
    claimItems,
    creditNoteClaim: currentCreditNoteClaim,
    sanitizedUpdates,
    canFinalize,
    blockingReasons,
    priceComparisonAvailable,
    reviewStatus,
    hasUnreviewedLines
  } = reconciliation;

  const cnRef = currentCreditNoteClaim?.cnRef || `CN-${order.id.slice(0, 6).toUpperCase()}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;

  // Submit Verification & Send Email
  const handleSaveAndSendClaim = async () => {
    if (!canFinalize) {
      showToast('error', blockingReasons[0] || "Review is incomplete. Complete all required fields before sending claim.");
      return;
    }
    if (!supplierEmail) {
      showToast('error', "Please provide the Supplier Email address to send the Credit Note claim.");
      return;
    }
    if (!currentCreditNoteClaim) {
      showToast('error', "No discrepancies identified to claim.");
      return;
    }

    setIsSendingEmail(true);
    setSaveError(null);

    try {
      // 1. Generate Email & PDF Content
      const { subject, htmlBody } = generateCreditNoteEmailContent(order, branch!, supplier, currentCreditNoteClaim);
      const pdfBase64 = await generateCreditNotePDF(order, branch!, supplier, currentCreditNoteClaim);

      // Attachments: Credit Note PDF + Scanned Invoice preview if present
      const attachments: EmailAttachment[] = [{
        filename: `CreditNote_${currentCreditNoteClaim.cnRef}.pdf`,
        content: pdfBase64,
        encoding: 'base64'
      }];

      if (previewUrl && previewUrl.startsWith('data:')) {
        const dataUrl = /^data:(application\/pdf|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/=]+)$/i.exec(previewUrl);
        if (!dataUrl) throw new Error('Use a PDF, PNG, JPEG or WebP invoice scan before sending the claim.');
        const extension: Record<string, string> = {
          'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'
        };
        attachments.push({
          filename: `Invoice_Scan_${order.id.slice(0, 6)}.${extension[dataUrl[1].toLowerCase()]}`,
          content: dataUrl[2],
          encoding: 'base64'
        });
      }

      // 2. Call Send Email API
      const emailResp = await sendEmail({
        purpose: 'credit-claim',
        orderId: order.id,
        to: supplierEmail,
        cc: branchCcEmail,
        subject,
        html: htmlBody,
        replyTo: branch?.contactEmail || branch?.email || undefined,
        attachments
      });

      if (!emailResp.ok) {
        throw await readEmailError(emailResp);
      }

      addLog('info', `📧 Sent Credit Note Claim ${currentCreditNoteClaim.cnRef} to ${supplierEmail}`);

      // 3. Mark claim as SENT and persist sanitized updates
      const sentClaim: CreditNoteClaim = {
        ...currentCreditNoteClaim,
        emailStatus: 'SENT',
        sentAt: new Date().toISOString()
      };

      const finalUpdates: Partial<OrderRecord> = {
        ...sanitizedUpdates,
        creditNoteClaim: sentClaim
      };

      await markOrderAsProcessed(order.id, finalUpdates);
      showToast('success', `Credit Note Claim successfully emailed to ${supplierEmail}! Reference: ${currentCreditNoteClaim.cnRef} (Total: £${totalClaimAmount.toFixed(2)})`);
      onSaveAndClose(finalUpdates);

    } catch (err: any) {
      console.error(err);
      addLog('error', `Credit Note Email Failure: ${err.message}`);
      setSaveError(err.message || 'Failed to send claim email.');
      showToast('error', `Failed to send email: ${err.message}`);
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Save As Draft (persists work in progress without marking verified or setting receivedStatus: 'PROCESSED')
  const handleSaveDraft = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const draftRecon = calculateOrderReconciliation(order, lines, {
        verifierName,
        invoiceNumber: invoiceNumberNotProvided ? '' : invoiceNumber,
        invoiceNumberNotProvided,
        invoiceDate,
        supplierEmail,
        branchCcEmail,
        remarks: claimRemarks,
        newScanUrl: file ? previewUrl : undefined,
        scanStatus,
        reviewMethod,
        evidenceReference: file ? file.name : (previewUrl ? 'Saved Document' : undefined),
        isDraft: true
      });
      await updateOrder(order.id, draftRecon.sanitizedUpdates);
      showToast('info', "Invoice review draft saved.");
      onSaveAndClose(draftRecon.sanitizedUpdates);
    } catch (err: any) {
      console.error(err);
      setSaveError(err.message || 'Failed to save draft.');
      showToast('error', `Failed to save draft: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Save Without Emailing (Final Verification - requires canFinalize === true)
  const handleSaveOnly = async () => {
    if (!canFinalize) {
      showToast('error', blockingReasons[0] || "Review is incomplete. Complete all required fields before verifying.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await markOrderAsProcessed(order.id, sanitizedUpdates);
      showToast('success', "Invoice verification saved successfully!");
      onSaveAndClose(sanitizedUpdates);
    } catch (err: any) {
      console.error(err);
      setSaveError(err.message || 'Failed to save invoice verification.');
      showToast('error', `Failed to save invoice verification: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/75 z-[100] flex items-center justify-center p-2 sm:p-4 backdrop-blur-md">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col animate-fade-in overflow-hidden border border-gray-200">
        
        {/* Modal Header */}
        <div className="p-3 sm:p-5 border-b border-gray-200 bg-gradient-to-r from-gray-900 to-gray-800 text-white flex justify-between items-center rounded-t-2xl gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 bg-brand-500/20 text-brand-400 rounded-xl border border-brand-500/30 shrink-0">
              <PackageCheck size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-lg md:text-xl font-bold flex items-center gap-2 truncate sm:whitespace-normal">
                  Stage 2: Invoice Cross-Check & Verification
                </h2>
                {order.invoiceVerification?.version && order.invoiceVerification.version > 1 && (
                  <span className="px-2 py-0.5 text-[10px] font-black uppercase rounded-full bg-brand-500/30 text-brand-300 border border-brand-400/40">
                    Rev v{order.invoiceVerification.version}
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-gray-300 truncate">
                Order #{order.id.slice(0,8).toUpperCase()} • {order.supplierNameSnapshot} • {order.branchNameSnapshot}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white bg-white/10 p-2 rounded-full transition-colors shrink-0">
            <X size={18} className="sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6 bg-gray-50/50 custom-scrollbar">
          
          {/* Top Row: File Upload & Invoice Header Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* Upload & OCR Panel */}
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const droppedFile = e.dataTransfer.files?.[0];
                if (droppedFile) {
                  setFile(droppedFile);
                  try {
                    setPreviewUrl(URL.createObjectURL(droppedFile));
                  } catch (_) {}
                  runOCRScan(droppedFile);
                }
              }}
              className={`bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-between transition-all ${
                isDragOver ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/20' : 'border-gray-200'
              }`}
            >
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Camera size={14} className="text-brand-600" />
                  Scan / Upload Invoice or PDF
                </label>
                
                <div className="grid grid-cols-2 gap-2">
                  <label className="relative border-2 border-dashed border-gray-300 hover:border-brand-500 rounded-xl p-3 text-center cursor-pointer transition-colors bg-gray-50 hover:bg-brand-50/30 group flex flex-col items-center justify-center">
                    <input 
                      type="file" 
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Upload size={22} className="mx-auto text-gray-400 group-hover:text-brand-600 mb-1 transition-colors" />
                    <span className="text-xs font-bold text-gray-800">Upload File</span>
                    <span className="text-[10px] text-gray-400">PDF, JPG, PNG</span>
                  </label>

                  <label className="relative border-2 border-dashed border-gray-300 hover:border-brand-500 rounded-xl p-3 text-center cursor-pointer transition-colors bg-gray-50 hover:bg-brand-50/30 group flex flex-col items-center justify-center">
                    <input 
                      type="file" 
                      accept="image/*"
                      capture="environment"
                      onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Camera size={22} className="mx-auto text-gray-400 group-hover:text-brand-600 mb-1 transition-colors" />
                    <span className="text-xs font-bold text-gray-800">Take Photo</span>
                    <span className="text-[10px] text-gray-400">Camera OCR</span>
                  </label>
                </div>
              </div>

              {isScanning && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-brand-700 bg-brand-50 p-2.5 rounded-lg border border-brand-200 animate-pulse">
                  <Loader2 className="animate-spin text-brand-600 shrink-0" size={16} />
                  <span>Gemini AI extracting invoice items & prices...</span>
                </div>
              )}

              {scanStatusMessage && !isScanning && (
                <div className={`mt-3 p-2.5 rounded-lg border text-xs font-medium flex items-start gap-2 ${
                  scanStatusMessage.type === 'success' 
                    ? 'bg-green-50 border-green-200 text-green-800' 
                    : scanStatusMessage.type === 'warning'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {scanStatusMessage.type === 'success' && <CheckCircle size={15} className="text-green-600 shrink-0 mt-0.5" />}
                  {scanStatusMessage.type === 'warning' && <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />}
                  {scanStatusMessage.type === 'error' && <AlertCircle size={15} className="text-red-600 shrink-0 mt-0.5" />}
                  <div className="flex-1 leading-snug">{scanStatusMessage.text}</div>
                </div>
              )}

              {/* Document Loaded & Preview: Always accessible when previewUrl is present */}
              {previewUrl && (
                <div className="mt-3 flex items-center justify-between text-xs text-brand-800 bg-brand-50 p-2.5 rounded-lg border border-brand-200">
                  <span className="truncate font-bold flex items-center gap-1.5">
                    <FileText size={15} className="text-brand-600 shrink-0" />
                    <span>{file ? file.name : (order.scannedInvoiceUrl ? 'Attached Document' : 'Document Loaded')}</span>
                  </span>
                  <a 
                    href={previewUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1 rounded font-bold text-[11px] shrink-0 transition-colors flex items-center gap-1 shadow-2xs"
                    title="Open Document Preview in New Tab"
                  >
                    Preview
                  </a>
                </div>
              )}

              {replacementScanFailed && order.invoiceVerification && (
                <div className="mt-2.5 p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 font-medium flex items-start gap-2">
                  <CheckCircle size={15} className="text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Previous Saved Verification Preserved</span>
                    <span className="block text-[11px] text-blue-800">
                      Verified on {new Date(order.invoiceVerification.verifiedAt).toLocaleDateString()} by {order.invoiceVerification.verifiedBy || 'Staff'}. The failed replacement attempt has not overwritten saved facts.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Invoice Header Details */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5 border-b border-gray-100 pb-2">
                <FileText size={14} className="text-brand-600" />
                Invoice Metadata
              </h3>

              <div>
                <label className="block text-xs text-gray-500 font-bold mb-1">Supplier Invoice Number</label>
                <input 
                  type="text"
                  value={invoiceNumber}
                  disabled={invoiceNumberNotProvided}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder={invoiceNumberNotProvided ? 'Not printed on invoice' : 'e.g. INV-98432'}
                  className={`w-full border rounded-lg p-2 text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-brand-500 ${
                    invoiceNumberNotProvided ? 'bg-gray-100 text-gray-500 border-gray-200' : 'border-gray-300'
                  }`}
                />
                <label className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-600 font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={invoiceNumberNotProvided}
                    onChange={(e) => {
                      setInvoiceNumberNotProvided(e.target.checked);
                      if (e.target.checked) setInvoiceNumber('');
                    }}
                    className="rounded text-brand-600 focus:ring-brand-500"
                  />
                  <span>Invoice number not printed on document (Documented exception)</span>
                </label>
              </div>

              <div>
                <label className="block text-xs text-gray-500 font-bold mb-1">Invoice Date</label>
                <input 
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm font-bold outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Financial Summary Cards */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5 border-b border-gray-100 pb-2">
                <DollarSign size={14} className="text-brand-600" />
                Reconciliation Totals
              </h3>

              <div className="space-y-2 text-xs font-medium my-2">
                <div className="flex justify-between text-gray-600">
                  <span>Total Ordered Value:</span>
                  <span className="font-mono font-bold">£{totalOrderedValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Total Invoiced Value:</span>
                  <span className="font-mono font-bold">£{totalInvoicedValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-gray-100 font-bold">
                  <span>Credit Note Claim:</span>
                  <span className={`font-mono ${totalClaimAmount > 0 ? 'text-red-600 font-black' : 'text-green-600'}`}>
                    £{totalClaimAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Financial Status Banner */}
              {scanStatus === 'FAILED' && (reviewMethod !== 'MANUAL' || hasUnreviewedLines) ? (
                <div className="bg-red-50 text-red-800 text-[11px] font-bold p-2.5 rounded-lg border border-red-200 flex items-start gap-1.5">
                  <AlertCircle size={15} className="text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <span>Scan failed — this invoice has not been verified.</span>
                    <span className="block font-normal text-[10px] text-red-600">Review line items manually below to complete verification.</span>
                  </div>
                </div>
              ) : totalClaimAmount > 0 ? (
                <div className="bg-red-50 text-red-700 text-[11px] font-bold p-2.5 rounded-lg border border-red-200 flex items-center gap-1.5">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{claimItems.length} Discrepancy Line(s) Identified (£{totalClaimAmount.toFixed(2)})</span>
                </div>
              ) : !priceComparisonAvailable ? (
                <div className="bg-amber-50 text-amber-800 text-[11px] font-bold p-2.5 rounded-lg border border-amber-200 flex items-start gap-1.5">
                  <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span>Price comparison unavailable</span>
                    <span className="block font-normal text-[10px] text-amber-700">Catalogue prices not configured. Reviewed invoice amounts will be recorded.</span>
                  </div>
                </div>
              ) : !canFinalize ? (
                <div className="bg-amber-50 text-amber-800 text-[11px] font-bold p-2.5 rounded-lg border border-amber-200 flex items-start gap-1.5">
                  <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span>Verification Incomplete</span>
                    <span className="block font-normal text-[10px] text-amber-700">{blockingReasons[0] || 'Complete required invoice facts.'}</span>
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 text-green-700 text-[11px] font-bold p-2.5 rounded-lg border border-green-200 flex items-center gap-1.5">
                  <CheckCircle size={15} className="shrink-0" />
                  <span>Invoice matches order perfectly</span>
                </div>
              )}
            </div>

          </div>

          {/* Line Items Reconciliation Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-3 sm:p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-800 text-sm">Cross-Check Line Items</h3>
                <span className="text-xs text-gray-500 font-medium">({lines.length} Items)</span>
              </div>
              <button
                type="button"
                onClick={handleMarkAllReviewed}
                className="px-2.5 py-1 text-xs font-bold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 rounded-lg border border-brand-200 transition-colors flex items-center gap-1.5"
                title="Mark all items as reviewed manually"
              >
                <CheckSquare size={13} />
                <span>Mark All Lines Reviewed</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left min-w-[680px]">
                <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-[10px] tracking-wider border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-3">Product Description</th>
                    <th className="px-2 py-3 text-center">Ordered Box / Pack</th>
                    <th className="px-2 py-3 text-center">Invoiced / Deliv Qty</th>
                    <th className="px-2 py-3 text-right">Catalog Price (£)</th>
                    <th className="px-2 py-3 text-right">Invoiced Price (£)</th>
                    <th className="px-2 py-3 text-right">Line Total (£)</th>
                    <th className="px-2 py-3 text-center">Discrepancy Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium">
                  {lines.map((line, idx) => {
                    const isShort = line.deliveredCaseQty < line.orderedCaseQty || line.deliveredPackQty < line.orderedPackQty;
                    const isDual = (line.orderedCaseQty > 0 || line.deliveredCaseQty > 0) && (line.orderedPackQty > 0 || line.deliveredPackQty > 0);
                    const isPackActive = line.unit === 'PACK' || (line.orderedCaseQty === 0 && line.deliveredCaseQty === 0 && (line.orderedPackQty > 0 || line.deliveredPackQty > 0));
                    const isOvercharge = (line.expectedCasePrice && line.expectedCasePrice > 0 && line.invoicedCasePrice > line.expectedCasePrice && (line.orderedCaseQty > 0 || line.deliveredCaseQty > 0)) ||
                                         (line.expectedPackPrice && line.expectedPackPrice > 0 && line.invoicedPackPrice > line.expectedPackPrice && (line.orderedPackQty > 0 || line.deliveredPackQty > 0));

                    return (
                      <tr key={idx} className={`hover:bg-gray-50 transition-colors ${line.issueType !== 'NONE' ? 'bg-red-50/30' : ''}`}>
                        
                        {/* Description */}
                        <td className="px-3 py-3">
                          <div className="font-bold text-gray-900">{line.description}</div>
                          {line.itemCode && <div className="text-[10px] text-gray-400 font-mono">[{line.itemCode}]</div>}
                        </td>

                        {/* Ordered Qty */}
                        <td className="px-2 py-3 text-center font-mono text-gray-600">
                          {line.orderedCaseQty > 0 && `${line.orderedCaseQty} Box `}
                          {line.orderedPackQty > 0 && `${line.orderedPackQty} Pk`}
                        </td>

                        {/* Delivered Qty Inputs */}
                        <td className="px-2 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <input 
                              type="number" 
                              min="0"
                              value={line.deliveredCaseQty}
                              onChange={(e) => handleLineUpdate(idx, 'deliveredCaseQty', parseInt(e.target.value) || 0)}
                              className={`w-12 text-center border rounded py-1 font-bold outline-none focus:ring-1 focus:ring-brand-500 ${isShort ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300'}`}
                              title="Delivered Boxes"
                            />
                            <span className="text-[10px] text-gray-400">Bx</span>
                            
                            <input 
                              type="number" 
                              min="0"
                              value={line.deliveredPackQty}
                              onChange={(e) => handleLineUpdate(idx, 'deliveredPackQty', parseInt(e.target.value) || 0)}
                              className={`w-12 text-center border rounded py-1 font-bold outline-none focus:ring-1 focus:ring-brand-500 ${isShort ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300'}`}
                              title="Delivered Packs"
                            />
                            <span className="text-[10px] text-gray-400">Pk</span>
                          </div>
                        </td>

                        {/* Catalog Price */}
                        <td className="px-2 py-3 text-right font-mono text-gray-500">
                          {isDual ? (
                            <div className="flex flex-col text-[11px] leading-tight">
                              <span>Bx: £{(line.expectedCasePrice ?? 0).toFixed(2)}</span>
                              <span>Pk: £{(line.expectedPackPrice ?? 0).toFixed(2)}</span>
                            </div>
                          ) : (
                            <span>
                              £{(isPackActive ? (line.expectedPackPrice ?? 0) : (line.expectedCasePrice ?? 0)).toFixed(2)}
                            </span>
                          )}
                        </td>

                        {/* Invoiced Price Input */}
                        <td className="px-2 py-3 text-right">
                          {isDual ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-400">Bx</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={line.invoicedCasePrice}
                                  onChange={(e) => handleLineUpdate(idx, 'invoicedCasePrice', parseFloat(e.target.value) || 0)}
                                  className="w-16 text-right border rounded py-0.5 px-1 font-mono font-bold text-xs outline-none focus:ring-1 focus:ring-brand-500"
                                  title="Invoiced Box Price"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-400">Pk</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={line.invoicedPackPrice}
                                  onChange={(e) => handleLineUpdate(idx, 'invoicedPackPrice', parseFloat(e.target.value) || 0)}
                                  className="w-16 text-right border rounded py-0.5 px-1 font-mono font-bold text-xs outline-none focus:ring-1 focus:ring-brand-500"
                                  title="Invoiced Pack Price"
                                />
                              </div>
                            </div>
                          ) : (
                            <input 
                              type="number" 
                              step="0.01"
                              min="0"
                              value={isPackActive ? line.invoicedPackPrice : line.invoicedCasePrice}
                              onChange={(e) => {
                                const p = parseFloat(e.target.value) || 0;
                                if (isPackActive) handleLineUpdate(idx, 'invoicedPackPrice', p);
                                else handleLineUpdate(idx, 'invoicedCasePrice', p);
                              }}
                              className={`w-20 text-right border rounded py-1 font-mono font-bold outline-none focus:ring-1 focus:ring-brand-500 ${isOvercharge ? 'border-red-400 bg-red-100 text-red-800' : 'border-gray-300'}`}
                            />
                          )}
                        </td>

                        {/* Line Total with Amount Override */}
                        <td className="px-2 py-3 text-right font-mono">
                          <div className="flex items-center justify-end gap-1">
                            <input 
                              type="number" 
                              step="0.01"
                              min="0"
                              value={line.isAmountOverridden && line.manualAmountOverride !== undefined ? line.manualAmountOverride : line.invoicedLineTotal}
                              onChange={(e) => handleLineUpdate(idx, 'manualAmountOverride', e.target.value)}
                              title={line.isAmountOverridden ? "Manual Amount Override Active" : "Calculated Line Total"}
                              className={`w-20 text-right border rounded py-1 font-mono font-bold outline-none focus:ring-1 focus:ring-brand-500 ${
                                line.isAmountOverridden 
                                  ? 'border-amber-400 bg-amber-50 text-amber-900 ring-1 ring-amber-400' 
                                  : 'border-gray-300 bg-white'
                              }`}
                            />
                            {line.isAmountOverridden && (
                              <button
                                type="button"
                                onClick={() => handleLineUpdate(idx, 'isAmountOverridden', false)}
                                className="text-[9px] px-1 py-0.5 font-bold rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
                                title="Reset override to calculated amount"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          {line.isAmountOverridden && (
                            <div className="text-[9px] font-bold text-amber-700 mt-0.5">Override</div>
                          )}
                        </td>

                        {/* Issue Selector Badge */}
                        <td className="px-2 py-3 text-center">
                          <select 
                            value={line.issueType}
                            onChange={(e) => handleLineUpdate(idx, 'issueType', e.target.value)}
                            className={`text-[11px] font-bold rounded-lg px-2 py-1 border outline-none cursor-pointer ${
                              line.issueType === 'NONE' ? 'bg-green-50 text-green-700 border-green-200' :
                              line.issueType === 'PRICE_OVERCHARGE' ? 'bg-red-100 text-red-800 border-red-300' :
                              line.issueType === 'SHORTAGE' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                              'bg-orange-100 text-orange-800 border-orange-300'
                            }`}
                          >
                            <option value="NONE">✅ Matched</option>
                            <option value="SHORTAGE">🟡 Short Delivery</option>
                            <option value="PRICE_OVERCHARGE">🔴 Price Overcharge</option>
                            <option value="DAMAGED">🟠 Damaged / Rejected</option>
                            <option value="WRONG_ITEM">❌ Wrong Item</option>
                          </select>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Credit Note Claim Section (Rendered when discrepancies exist) */}
          {totalClaimAmount > 0 && (
            <div className="bg-red-50/60 rounded-xl border border-red-200 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-red-200 pb-3">
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-red-900 flex items-center gap-2">
                    <AlertCircle className="text-red-600 shrink-0" size={18} />
                    Credit Note Claim Request
                  </h3>
                  <p className="text-xs text-red-700 mt-0.5">
                    Automatically generated claim document to request £{totalClaimAmount.toFixed(2)} refund/credit from {order.supplierNameSnapshot}.
                  </p>
                </div>
                <div className="text-left sm:text-right bg-white p-2 sm:p-2.5 rounded-lg border border-red-300 shadow-sm shrink-0">
                  <span className="text-[10px] text-gray-500 font-bold uppercase block">Claim Reference</span>
                  <span className="text-xs sm:text-sm font-black font-mono text-red-800">{cnRef}</span>
                </div>
              </div>

              {order.creditNoteClaim?.emailStatus === 'SENT' && (
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 font-medium flex items-center gap-2">
                  <CheckCircle size={15} className="text-blue-600 shrink-0" />
                  <span>
                    Prior claim ({order.creditNoteClaim.cnRef}) was emailed on {new Date(order.creditNoteClaim.sentAt || '').toLocaleDateString()}. Re-verifying creates a new revision while preserving earlier sent claim records in history.
                  </span>
                </div>
              )}

              {/* Claim Email Routing */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-red-900 font-bold uppercase mb-1">
                    Supplier Recipient Email (TO)
                  </label>
                  <input 
                    type="email"
                    value={supplierEmail}
                    onChange={(e) => setSupplierEmail(e.target.value)}
                    placeholder="accounts@supplier.com"
                    className="w-full border border-red-300 bg-white rounded-lg p-2 font-bold text-gray-800 outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-red-900 font-bold uppercase mb-1">
                    Branch Copy Email (CC)
                  </label>
                  <input 
                    type="email"
                    value={branchCcEmail}
                    onChange={(e) => setBranchCcEmail(e.target.value)}
                    placeholder="branch@hareandtortoise.co.uk"
                    className="w-full border border-red-300 bg-white rounded-lg p-2 font-bold text-gray-800 outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Claim Remarks */}
              <p className="text-xs text-red-800">Use emails saved in this supplier's and branch's contact details. Ask an administrator to add new contacts before sending.</p>
              <div>
                <label className="block text-xs font-bold text-red-900 uppercase mb-1">
                  Driver / Delivery Notes for Supplier
                </label>
                <textarea 
                  rows={2}
                  value={claimRemarks}
                  onChange={(e) => setClaimRemarks(e.target.value)}
                  placeholder="e.g. Driver signed delivery note confirming short 4 boxes. Outer carton water damaged upon arrival."
                  className="w-full border border-red-300 bg-white rounded-lg p-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 border-t border-gray-200 bg-white rounded-b-2xl pb-[max(16px,env(safe-area-inset-bottom))] flex flex-col sm:flex-row justify-between items-center gap-3">
          <button 
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors text-xs"
          >
            Cancel
          </button>

          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto items-center">
            {saveError && (
              <span className="text-xs text-red-600 font-semibold">{saveError}</span>
            )}

            <button 
              type="button"
              onClick={handleSaveDraft}
              disabled={isSaving || isSendingEmail}
              className="w-full sm:w-auto px-4 py-2.5 bg-gray-50 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-100 transition-colors text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
              title="Save current progress as draft without marking order as verified"
            >
              {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              Save Draft
            </button>

            <button 
              type="button"
              onClick={handleSaveOnly}
              disabled={!canFinalize || isSaving || isSendingEmail}
              className={`w-full sm:w-auto px-5 py-2.5 font-bold rounded-xl transition-colors text-xs flex items-center justify-center gap-1.5 shadow-xs ${
                canFinalize 
                  ? 'bg-brand-600 hover:bg-brand-700 text-white' 
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-60'
              }`}
              title={!canFinalize ? blockingReasons[0] : "Save final invoice verification"}
            >
              {isSaving ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  Saving...
                </>
              ) : (
                'Save Verification Only'
              )}
            </button>

            {totalClaimAmount > 0 && (
              <button 
                type="button"
                onClick={handleSaveAndSendClaim}
                disabled={!canFinalize || isSendingEmail || isSaving}
                className="w-full sm:w-auto px-6 py-2.5 bg-red-600 text-white font-extrabold rounded-xl hover:bg-red-700 shadow-lg shadow-red-200 transition-all text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!canFinalize ? blockingReasons[0] : `Email credit claim to ${supplierEmail}`}
              >
                {isSendingEmail ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    Sending Email & PDF Claim...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Email Credit Note Claim (£{totalClaimAmount.toFixed(2)})
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
