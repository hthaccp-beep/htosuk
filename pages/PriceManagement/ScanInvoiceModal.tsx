import React, { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useAppStore, can } from '../../store';
import { Product, Supplier, PriceChangeNotice, NewItemNotice, PriceHistoryRecord } from '../../types';
import { matchExtractedItem, comparePrices, MatchedResult, PriceComparisonResult } from '../../utils/priceMatching';
import { 
  ColumnMappingProfile, 
  getSavedImportProfiles, 
  findProfileForSupplier, 
  downloadStandardTemplate 
} from '../../utils/supplierImportProfiles';
import { ColumnMappingModal } from '../../components/ColumnMappingModal';
import { Modal } from '../../components/Modal';
import { sendEmail, readEmailError } from '../../utils/sendEmail';
import { auth } from '../../firebase-config';
import { 
  Camera, UploadCloud, FileText, Image as ImageIcon, CheckCircle2, 
  AlertTriangle, AlertCircle, PlusCircle, ArrowRight, Loader2, Sparkles, X, 
  Trash2, RefreshCw, ZoomIn, Eye, FileSpreadsheet, Search, Link as LinkIcon,
  Unlink, Zap, Check, Package, Layers, Building, ShieldCheck, Download, Sliders,
  HelpCircle, Calendar, Hash, Tag
} from 'lucide-react';

interface ExtractedLineItem {
  rawDescription: string;
  itemCode?: string;
  packSize?: string;
  quantity: number;
  unitTypeDetected?: string;
  casePrice?: number;
  packPrice?: number;
  vatRate?: number;
  totalPrice?: number;
  notes?: string;
}

interface AnalyzedLine {
  id: string;
  extracted: ExtractedLineItem;
  matchResult: MatchedResult;
  priceComparison: PriceComparisonResult | null;
  selected: boolean;
  status: 'PRICE_CHANGE' | 'FIRST_PRICE' | 'UNCHANGED' | 'NEEDS_MATCHING' | 'CONFIRMED_NEW' | 'INVALID_DATA' | 'NEW_ITEM';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const cleanStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findMatchingSupplier = (
  rawName: string, 
  matchedKnown: string, 
  suppliersList: Supplier[]
): { supplier: Supplier | null; confidence: 'HIGH' | 'MEDIUM' | 'NONE' } => {
  if (!suppliersList || suppliersList.length === 0) return { supplier: null, confidence: 'NONE' };

  // 1. Direct match with matchedKnownSupplier returned by Gemini
  if (matchedKnown && matchedKnown.trim()) {
    const knownClean = cleanStr(matchedKnown);
    const found = suppliersList.find(s => 
      cleanStr(s.name) === knownClean || 
      s.id.toLowerCase() === matchedKnown.toLowerCase() ||
      s.name.toLowerCase() === matchedKnown.toLowerCase()
    );
    if (found) return { supplier: found, confidence: 'HIGH' };
  }

  // 2. Direct exact or normalized name match
  const rawClean = cleanStr(rawName);
  if (!rawClean) return { supplier: null, confidence: 'NONE' };

  // Check exact cleaned match
  for (const s of suppliersList) {
    const sClean = cleanStr(s.name);
    if (sClean === rawClean) return { supplier: s, confidence: 'HIGH' };
  }

  // Common legal noise stripping: "ltd", "limited", "uk", "international", "group", "foods", "company", "co"
  const stripLegal = (str: string) => (str || '').toLowerCase()
    .replace(/\b(limited|ltd|co|company|corp|corporation|inc|incorporated|plc|uk|gb|group|international|intl|wholesale|foods|food|trading|services|holdings)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  const strippedRaw = stripLegal(rawName);
  if (strippedRaw.length >= 3) {
    for (const s of suppliersList) {
      const strippedSup = stripLegal(s.name);
      if (strippedSup.length >= 3) {
        if (strippedRaw === strippedSup || strippedRaw.includes(strippedSup) || strippedSup.includes(strippedRaw)) {
          return { supplier: s, confidence: 'HIGH' };
        }
      }
    }
  }

  // Substring matching (only if token length >= 3 to prevent accidental empty/single-char hits)
  for (const s of suppliersList) {
    const sClean = cleanStr(s.name);
    if (sClean.length >= 3 && (rawClean.includes(sClean) || sClean.includes(rawClean))) {
      return { supplier: s, confidence: 'MEDIUM' };
    }
  }

  // Token-level overlap (e.g. "JFC UK Limited" vs "JFC")
  const rawTokens = (rawName || '').toLowerCase().split(/[\s,.-]+/).filter(t => t.length >= 3 && !['ltd', 'the', 'and', 'for'].includes(t));
  for (const s of suppliersList) {
    const supTokens = s.name.toLowerCase().split(/[\s,.-]+/).filter(t => t.length >= 3 && !['ltd', 'the', 'and', 'for'].includes(t));
    const hasShared = rawTokens.some(rt => supTokens.some(st => rt === st));
    if (hasShared) {
      return { supplier: s, confidence: 'MEDIUM' };
    }
  }

  return { supplier: null, confidence: 'NONE' };
};

export const ScanInvoiceModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const { 
    suppliers, products, currentUser, priceMonitoringSettings,
    addPriceChangeNotice, addNewItemNotice, showToast 
  } = useAppStore();

  const [step, setStep] = useState<'UPLOAD' | 'EXTRACTING' | 'REVIEW'>('UPLOAD');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileBase64, setFileBase64] = useState<string>('');
  const [fileMime, setFileMime] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  
  // Supplier selection and auto-detection
  const [preSelectedSupplierId, setPreSelectedSupplierId] = useState<string>('auto');
  const [detectedSupplierRaw, setDetectedSupplierRaw] = useState<string>('');
  const [supplierDetectionConfidence, setSupplierDetectionConfidence] = useState<'AUTO_MATCHED' | 'PRE_SELECTED' | 'MANUAL_REQUIRED'>('AUTO_MATCHED');

  // Document Type & Metadata
  const [documentType, setDocumentType] = useState<'PRICE_LIST' | 'INVOICE'>('PRICE_LIST');
  const [documentRef, setDocumentRef] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>('');
  const [uploadDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Option B & C: Saved Import Profile & Interactive Mapping Modal
  const [activeProfile, setActiveProfile] = useState<ColumnMappingProfile>(() => findProfileForSupplier('s_tazaki'));
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [detectedSheetHeaders, setDetectedSheetHeaders] = useState<string[]>([]);
  const [rawSampleRows, setRawSampleRows] = useState<Record<string, any>[]>([]);
  const [cachedRawWorkbookData, setCachedRawWorkbookData] = useState<Record<string, any>[] | null>(null);

  // OCR Header data
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>('');
  const [analyzedLines, setAnalyzedLines] = useState<AnalyzedLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // File Handler for PDF, Images, and Excel/CSV
  const handleFileProcess = (file: File) => {
    if (!file) return;
    setErrorMessage(null);

    const lowerName = file.name.toLowerCase();
    const isExcelOrCsv = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.xlt') || lowerName.endsWith('.xltx') || lowerName.endsWith('.xlsm') || lowerName.endsWith('.csv') || 
      file.type.includes('spreadsheet') || file.type.includes('excel') || file.type.includes('csv');

    if (file.size > 25 * 1024 * 1024) {
      const msg = `File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds the 25MB limit. Please upload a smaller file.`;
      setErrorMessage(msg);
      showToast('error', msg);
      return;
    }

    if (isExcelOrCsv) {
      startExcelExtraction(file);
      return;
    }

    let detectedMime = file.type || '';
    if (lowerName.endsWith('.pdf') || detectedMime === 'application/pdf') {
      detectedMime = 'application/pdf';
    } else if (lowerName.endsWith('.png') || detectedMime === 'image/png') {
      detectedMime = 'image/png';
    } else if (lowerName.endsWith('.webp') || detectedMime === 'image/webp') {
      detectedMime = 'image/webp';
    } else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || detectedMime === 'image/jpeg') {
      detectedMime = 'image/jpeg';
    } else if (file.type?.startsWith('image/')) {
      detectedMime = 'image/jpeg'; // normalize mobile/tablet captures
    }

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimes.includes(detectedMime)) {
      const msg = 'Unsupported file type. Please upload a PDF, image (JPG, PNG, WebP), or Excel spreadsheet (XLSX, XLS, XLT, CSV).';
      setErrorMessage(msg);
      showToast('error', msg);
      return;
    }

    setFileName(file.name);
    setFileMime(detectedMime);
    setStep('EXTRACTING');

    const reader = new FileReader();
    reader.onload = async () => {
      const resultStr = reader.result as string;
      const base64Data = resultStr ? resultStr.split(',')[1] : '';
      if (!base64Data) {
        const msg = 'Could not read document contents. Please check the file and try again.';
        setErrorMessage(msg);
        showToast('error', msg);
        setStep('UPLOAD');
        return;
      }
      setFileBase64(base64Data);
      startOcrExtraction(base64Data, detectedMime, file.name);
    };
    reader.onerror = () => {
      const msg = 'Failed to read document from disk.';
      setErrorMessage(msg);
      showToast('error', msg);
      setStep('UPLOAD');
    };
    reader.readAsDataURL(file);
  };

  // Process rows with selected Column Mapping Profile
  const processSpreadsheetRows = (
    rawJson: Record<string, any>[],
    activeSupplierId: string,
    profile: ColumnMappingProfile
  ) => {
    const extracted: ExtractedLineItem[] = [];

    for (const row of rawJson) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;

      const findVal = (patterns: string[]): any => {
        for (const key of keys) {
          const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
          for (const pat of patterns) {
            const cleanPat = pat.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === cleanPat || cleanKey.includes(cleanPat)) {
              const val = row[key];
              if (val !== undefined && val !== null && String(val).trim() !== '') {
                return val;
              }
            }
          }
        }
        return undefined;
      };

      // 1. Supplier Product Code / Item No.
      // Explicit patterns include 'item no', 'itemno', 'item number', 'item #', etc.
      const codeVal = findVal(profile.columns.itemCode && profile.columns.itemCode.length > 0 ? profile.columns.itemCode : [
        'item no.', 'item no', 'itemno', 'item number', 'item #', 'art no', 'part no',
        'supplier product code', 'supplier code', 'product code', 'item code', 'sku', 'code', 'ref'
      ]);

      // 2. Product Description
      const descVal = findVal(profile.columns.description && profile.columns.description.length > 0 ? profile.columns.description : [
        'item description', 'description', 'product description',
        'item name', 'product name', 'product', 'name', 'title'
      ]);

      // 3. Units per Case (e.g. Unit Qty in Tazaki = 10, 20)
      const unitsPerCaseVal = findVal(profile.columns.unitsPerCase && profile.columns.unitsPerCase.length > 0 ? profile.columns.unitsPerCase : [
        'unit qty', 'unit quantity', 'units per case', 'units/case', 'inner qty', 'pack qty'
      ]);

      // 4. Case Qty (NUMBER of cases - e.g. 1 in Tazaki - NEVER A PRICE!)
      const caseQtyVal = findVal(profile.columns.caseQty && profile.columns.caseQty.length > 0 ? profile.columns.caseQty : [
        'case qty', 'case quantity', 'cases', 'no of cases'
      ]);

      // 5. Pack / Unit Price (Price per single pack/unit, e.g. 1.47 in Tazaki)
      // Exclude order columns like 'ORDER BY PIECE' or 'ORDER QTY'
      const packPriceVal = (() => {
        for (const key of keys) {
          const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanKey.includes('order') || cleanKey.includes('qty') || cleanKey.includes('quantity') || cleanKey.includes('count')) {
            continue; // Exclude order-entry columns!
          }
          const pats = profile.columns.packPrice && profile.columns.packPrice.length > 0 
            ? profile.columns.packPrice 
            : ['unitprice', 'packprice', 'unitcost', 'packcost', 'singleprice'];
          for (const pat of pats) {
            const cleanPat = pat.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === cleanPat || cleanKey.includes(cleanPat)) {
              const val = row[key];
              if (val !== undefined && val !== null && String(val).trim() !== '') return val;
            }
          }
        }
        return undefined;
      })();

      // 6. Explicit Case Price (Only if key is truly a case price and NOT case qty or order by case!)
      const casePriceVal = (() => {
        for (const key of keys) {
          const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanKey.includes('order') || cleanKey.includes('qty') || cleanKey.includes('quantity') || cleanKey.includes('count')) {
            continue; // Exclude Case Qty and ORDER BY CASE!
          }
          const pats = profile.columns.casePrice && profile.columns.casePrice.length > 0 
            ? profile.columns.casePrice 
            : ['caseprice', 'boxprice', 'cartonprice', 'outerprice', 'casecost'];
          for (const pat of pats) {
            const cleanPat = pat.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanKey === cleanPat || (cleanKey.includes('case') && cleanKey.includes('price')) || (cleanKey.includes('box') && cleanKey.includes('price'))) {
              const val = row[key];
              if (val !== undefined && val !== null && String(val).trim() !== '') return val;
            }
          }
        }
        return undefined;
      })();

      // 7. Total (LC)
      const totalVal = findVal(profile.columns.total && profile.columns.total.length > 0 ? profile.columns.total : [
        'total (lc)', 'total lc', 'total amount', 'line total', 'total'
      ]);

      // 8. Packaging / UoM
      const packSizeVal = findVal(profile.columns.packaging && profile.columns.packaging.length > 0 ? profile.columns.packaging : [
        'case uom', 'uom', 'pack size', 'pack', 'size', 'spec', 'packaging'
      ]);

      const parsePrice = (v: any): number => {
        if (typeof v === 'number') return isNaN(v) ? 0 : v;
        if (!v) return 0;
        const cleaned = String(v).replace(/[^0-9.-]/g, '');
        return parseFloat(cleaned) || 0;
      };

      const parsedCode = codeVal ? String(codeVal).trim() : '';
      const parsedDesc = descVal ? String(descVal).trim() : (parsedCode ? `Product ${parsedCode}` : '');
      if (!parsedDesc && !parsedCode) continue; // Skip blank rows

      const parsedUnitsPerCase = parseInt(String(unitsPerCaseVal)) || 0;
      const parsedCaseQty = parseInt(String(caseQtyVal)) || 1;
      const parsedPackPrice = parsePrice(packPriceVal);
      const parsedExplicitCasePrice = parsePrice(casePriceVal);
      const parsedTotal = parsePrice(totalVal);

      // Derive case price reliably
      let derivedCasePrice = parsedExplicitCasePrice;
      if (profile.deriveCasePrice) {
        derivedCasePrice = profile.deriveCasePrice(row, {
          unitsPerCase: parsedUnitsPerCase,
          caseQty: parsedCaseQty,
          packPrice: parsedPackPrice,
          casePrice: parsedExplicitCasePrice,
          total: parsedTotal
        });
      } else if (derivedCasePrice <= 0) {
        if (parsedTotal > 0 && parsedCaseQty > 0) {
          derivedCasePrice = Math.round((parsedTotal / parsedCaseQty) * 100) / 100;
        } else if (parsedUnitsPerCase > 0 && parsedPackPrice > 0) {
          derivedCasePrice = Math.round((parsedUnitsPerCase * parsedPackPrice) * 100) / 100;
        }
      }

      // Skip Category Headings or Section Headers appearing between products (e.g. AMBIENT FOOD, FROZEN FOOD, PACKAGING)
      const isKnownCategoryHeading = /^(ambient|frozen|chilled|fresh|produce|dry|beverage|beverages|packaging|ramen|sushi|sauce|oil|cleaning|meat|poultry|fish|seafood|dairy|disposables|alcohol)(\s+(food|goods|bar|soup|oil|items|supplies|department|category))?$/i.test(parsedDesc.trim());
      const hasNoValidPrices = derivedCasePrice <= 0 && parsedPackPrice <= 0 && parsedTotal <= 0 && parsedExplicitCasePrice <= 0;
      if (!parsedCode && (hasNoValidPrices || isKnownCategoryHeading)) {
        continue; // Skip category header rows between products
      }

      extracted.push({
        rawDescription: parsedDesc,
        itemCode: parsedCode,
        packSize: packSizeVal ? String(packSizeVal).trim() : (parsedUnitsPerCase > 0 ? `${parsedUnitsPerCase} units/case` : ''),
        quantity: parsedCaseQty,
        unitTypeDetected: parsedPackPrice > 0 && derivedCasePrice > 0 ? 'CASE' : (parsedPackPrice > 0 ? 'PACK' : 'CASE'),
        casePrice: derivedCasePrice,
        packPrice: parsedPackPrice,
        totalPrice: parsedTotal || (parsedCaseQty * derivedCasePrice),
        notes: `Imported via ${profile.name}`
      });
    }

    if (extracted.length === 0) {
      throw new Error('Could not identify product descriptions or prices. Please verify the column mappings.');
    }

    // Run comparison against catalog
    const analyzed: AnalyzedLine[] = extracted.map((item, idx) => {
      const matchResult = matchExtractedItem(
        item.rawDescription, 
        item.itemCode, 
        activeSupplierId, 
        products
      );

      let priceComp: PriceComparisonResult | null = null;
      let lineStatus: AnalyzedLine['status'] = 'NEEDS_MATCHING';

      if (matchResult.product) {
        priceComp = comparePrices(
          item.casePrice,
          item.packPrice,
          matchResult.product,
          priceMonitoringSettings
        );
        lineStatus = priceComp.hasPriceChange 
          ? (priceComp.isFirstPrice ? 'FIRST_PRICE' : 'PRICE_CHANGE') 
          : 'UNCHANGED';
      } else {
        // Missing or invalid prices?
        if ((!item.casePrice || item.casePrice <= 0) && (!item.packPrice || item.packPrice <= 0)) {
          lineStatus = 'INVALID_DATA';
        } else {
          lineStatus = 'NEEDS_MATCHING';
        }
      }

      return {
        id: `excel_line_${idx}_${Date.now()}`,
        extracted: item,
        matchResult,
        priceComparison: priceComp,
        // R11: Only select items that have confirmed price change or first price by default; never invalid or unresolved
        selected: lineStatus === 'PRICE_CHANGE' || lineStatus === 'FIRST_PRICE',
        status: lineStatus
      };
    });

    setAnalyzedLines(analyzed);
    setStep('REVIEW');

    const priceChanges = analyzed.filter(l => l.status === 'PRICE_CHANGE').length;
    const unchanged = analyzed.filter(l => l.status === 'UNCHANGED').length;
    const needsMatch = analyzed.filter(l => l.status === 'NEEDS_MATCHING').length;
    showToast(
      'success',
      `Spreadsheet parsed (${analyzed.length} items): ${priceChanges} price changes, ${unchanged} unchanged, ${needsMatch} needs matching.`
    );
  };

  // Instant In-Browser Excel / CSV Price List Extraction
  const startExcelExtraction = async (file: File) => {
    setFileName(file.name);
    setFileMime(file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    setStep('EXTRACTING');
    setErrorMessage(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('Spreadsheet has no sheets.');
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const rawJson = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

      if (!rawJson || rawJson.length === 0) {
        throw new Error('No data rows found in spreadsheet.');
      }

      setCachedRawWorkbookData(rawJson);
      const allHeaders = Array.from(new Set(rawJson.slice(0, 10).flatMap(r => Object.keys(r))));
      setDetectedSheetHeaders(allHeaders);
      setRawSampleRows(rawJson.slice(0, 3));

      // Determine Supplier match for spreadsheet
      let activeSupplierId = '';
      if (preSelectedSupplierId !== 'auto') {
        activeSupplierId = preSelectedSupplierId;
        setSupplierDetectionConfidence('PRE_SELECTED');
        setDetectedSupplierRaw(suppliers.find(s => s.id === preSelectedSupplierId)?.name || '');
      } else {
        // 1. Try matching against workbook sheet names
        const allSheetNames = workbook.SheetNames.join(' ');
        let match = findMatchingSupplier(allSheetNames, '', suppliers);
        
        // 2. Try matching against early spreadsheet rows
        if (!match.supplier) {
          const earlyText = rawJson.slice(0, 15).map(r => Object.values(r).join(' ')).join(' ');
          match = findMatchingSupplier(earlyText, '', suppliers);
        }

        // 3. Try matching against filename
        if (!match.supplier) {
          match = findMatchingSupplier(file.name, '', suppliers);
        }

        if (match.supplier) {
          activeSupplierId = match.supplier.id;
          setSupplierDetectionConfidence('AUTO_MATCHED');
          setDetectedSupplierRaw(match.supplier.name);
        } else {
          // Check if Tazaki is in suppliers and filename mentions Tazaki
          const tazakiSup = suppliers.find(s => cleanStr(s.name).includes('tazaki') || s.id === 's_tazaki');
          if (tazakiSup && file.name.toLowerCase().includes('tazaki')) {
            activeSupplierId = tazakiSup.id;
            setSupplierDetectionConfidence('AUTO_MATCHED');
            setDetectedSupplierRaw(tazakiSup.name);
          } else {
            activeSupplierId = suppliers.length > 0 ? suppliers[0].id : '';
            setSupplierDetectionConfidence('MANUAL_REQUIRED');
            setDetectedSupplierRaw(file.name);
          }
        }
      }

      setSelectedSupplierId(activeSupplierId);
      
      // Determine Profile
      const matchedProfile = findProfileForSupplier(activeSupplierId);
      setActiveProfile(matchedProfile);

      // Document Type: Default to Supplier Price List for spreadsheets
      setDocumentType('PRICE_LIST');
      const baseNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setDocumentRef(baseNameWithoutExt);
      setInvoiceNumber(baseNameWithoutExt);

      // Parse Effective Date from filename (e.g. "Tazaki - 2026.01.26 Update.xlsx")
      let parsedDate = '';
      const dateMatch = file.name.match(/(20\d\d)[.\-_/](0[1-9]|1[0-2])[.\-_/](0[1-9]|[12]\d|3[01])/);
      if (dateMatch) {
        parsedDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      } else {
        parsedDate = new Date().toISOString().split('T')[0];
      }
      setEffectiveDate(parsedDate);
      setInvoiceDate(parsedDate);

      // Process spreadsheet rows with Profile & derive prices
      processSpreadsheetRows(rawJson, activeSupplierId, matchedProfile);
    } catch (err: any) {
      console.error('Excel parse error', err);
      const msg = err.message || 'Failed to process Excel spreadsheet.';
      setErrorMessage(msg);
      showToast('error', msg);
      setStep('UPLOAD');
    }
  };

  const startOcrExtraction = async (base64str: string, mimeType: string, name: string) => {
    setStep('EXTRACTING');
    setErrorMessage(null);
    try {
      if (auth && !auth.currentUser) {
        try {
          if (typeof (auth as any).authStateReady === 'function') {
            await (auth as any).authStateReady();
          } else {
            await new Promise<void>((resolve) => {
              const unsub = auth.onAuthStateChanged(() => {
                unsub();
                resolve();
              });
              setTimeout(resolve, 2000);
            });
          }
        } catch (_) {}
      }

      let token: string | undefined;
      try {
        token = await auth?.currentUser?.getIdToken(true);
      } catch (_) {
        token = await auth?.currentUser?.getIdToken();
      }

      if (!token) {
        throw new Error('You must be signed in to scan documents. Please refresh or re-login.');
      }

      const scanPayload = {
        base64str, 
        mimeType, 
        fileName: name,
        knownSuppliers: suppliers.map(s => ({ id: s.id, name: s.name }))
      };

      let response = await fetch('/api/scan-invoice', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(scanPayload)
      });

      if (response.status === 401 && auth?.currentUser) {
        try {
          token = await auth.currentUser.getIdToken(true);
          response = await fetch('/api/scan-invoice', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(scanPayload)
          });
        } catch (_) {}
      }

      if (!response.ok) {
        let errorMsg = `Server error (${response.status})`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch (_) {
          if (response.status === 413) {
            errorMsg = 'Document is too large for server processing (Max 25MB).';
          } else if (response.status === 504) {
            errorMsg = 'OCR request timed out. Please try a smaller or higher-contrast PDF/image.';
          }
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      
      // Determine Supplier match with intelligent fuzzy & alias recognition
      let activeSupplierId = '';
      const rawExtractedName = data.supplierName || '';
      const matchedKnown = data.matchedKnownSupplier || '';

      if (preSelectedSupplierId !== 'auto') {
        activeSupplierId = preSelectedSupplierId;
        setSupplierDetectionConfidence('PRE_SELECTED');
        setDetectedSupplierRaw(rawExtractedName || suppliers.find(s => s.id === preSelectedSupplierId)?.name || '');
      } else {
        const match = findMatchingSupplier(rawExtractedName, matchedKnown, suppliers);
        if (match.supplier) {
          activeSupplierId = match.supplier.id;
          setSupplierDetectionConfidence('AUTO_MATCHED');
          setDetectedSupplierRaw(rawExtractedName || match.supplier.name);
        } else {
          activeSupplierId = suppliers.length > 0 ? suppliers[0].id : '';
          setSupplierDetectionConfidence('MANUAL_REQUIRED');
          setDetectedSupplierRaw(rawExtractedName);
        }
      }

      setSelectedSupplierId(activeSupplierId);
      setInvoiceNumber(data.invoiceNumber || '');
      setInvoiceDate(data.invoiceDate || new Date().toISOString().split('T')[0]);

      // Run comparison engine on extracted items (support extractedItems, lineItems, items, etc.)
      const rawItems: ExtractedLineItem[] = Array.isArray(data.extractedItems) 
        ? data.extractedItems 
        : (Array.isArray(data.lineItems)
          ? data.lineItems
          : (Array.isArray(data.items)
            ? data.items
            : (Array.isArray(data.products)
              ? data.products
              : (Array.isArray(data.lines)
                ? data.lines
                : (Array.isArray(data.invoiceItems) ? data.invoiceItems : [])))));

      const analyzed: AnalyzedLine[] = rawItems.map((item, idx) => {
        const matchResult = matchExtractedItem(
          item.rawDescription, 
          item.itemCode, 
          activeSupplierId, 
          products
        );

        let priceComp: PriceComparisonResult | null = null;
        let lineStatus: AnalyzedLine['status'] = 'NEEDS_MATCHING';

        if (matchResult.product) {
          priceComp = comparePrices(
            item.casePrice || 0,
            item.packPrice || 0,
            matchResult.product,
            priceMonitoringSettings
          );

          if (priceComp.hasPriceChange) {
            lineStatus = 'PRICE_CHANGE';
          } else {
            lineStatus = 'UNCHANGED';
          }
        } else {
          if ((!item.casePrice || item.casePrice <= 0) && (!item.packPrice || item.packPrice <= 0)) {
            lineStatus = 'INVALID_DATA';
          } else {
            lineStatus = 'NEEDS_MATCHING';
          }
        }

        return {
          id: `line_${idx}_${Date.now()}`,
          extracted: item,
          matchResult,
          priceComparison: priceComp,
          // Only select items that have a confirmed price change by default
          selected: lineStatus === 'PRICE_CHANGE',
          status: lineStatus
        };
      });

      setAnalyzedLines(analyzed);
      setStep('REVIEW');

      if (analyzed.length > 0) {
        showToast('success', `OCR Extracted ${analyzed.length} items from document! Review changes below.`);
      } else {
        showToast('info', 'OCR finished: document metadata extracted. Please review header information.');
      }
    } catch (err: any) {
      console.error('Scan invoice error', err);
      const msg = err.message || 'Failed to process document OCR.';
      setErrorMessage(msg);
      showToast('error', `OCR Scan failed: ${msg}`);
      setStep('UPLOAD');
    }
  };

  // Re-run matching if user switches supplier
  const handleSupplierChange = (newSupId: string) => {
    setSelectedSupplierId(newSupId);
    setSupplierDetectionConfidence('PRE_SELECTED');
    const newSup = suppliers.find(s => s.id === newSupId);
    if (newSup) {
      showToast('info', `Switched supplier to "${newSup.name}". Catalog items re-matched!`);
    }
    setAnalyzedLines(prev => prev.map(line => {
      const matchResult = matchExtractedItem(
        line.extracted.rawDescription, 
        line.extracted.itemCode, 
        newSupId, 
        products
      );

      let priceComp: PriceComparisonResult | null = null;
      let lineStatus: AnalyzedLine['status'] = 'NEEDS_MATCHING';

      if (matchResult.product) {
        priceComp = comparePrices(
          line.extracted.casePrice || 0,
          line.extracted.packPrice || 0,
          matchResult.product,
          priceMonitoringSettings
        );
        lineStatus = priceComp.hasPriceChange 
          ? (priceComp.isFirstPrice ? 'FIRST_PRICE' : 'PRICE_CHANGE') 
          : 'UNCHANGED';
      } else {
        if ((!line.extracted.casePrice || line.extracted.casePrice <= 0) && (!line.extracted.packPrice || line.extracted.packPrice <= 0)) {
          lineStatus = 'INVALID_DATA';
        } else if (line.status === 'CONFIRMED_NEW') {
          lineStatus = 'CONFIRMED_NEW';
        } else {
          lineStatus = 'NEEDS_MATCHING';
        }
      }

      return {
        ...line,
        matchResult,
        priceComparison: priceComp,
        status: lineStatus,
        selected: lineStatus === 'PRICE_CHANGE' || lineStatus === 'CONFIRMED_NEW'
      };
    }));
  };

  // Update line details in review screen
  const updateLinePrice = (lineId: string, field: 'casePrice' | 'packPrice', val: number) => {
    setAnalyzedLines(prev => prev.map(line => {
      if (line.id !== lineId) return line;
      const updatedExtracted = { ...line.extracted, [field]: val };
      
      let priceComp = line.priceComparison;
      let status = line.status;
      if (line.matchResult.product) {
        priceComp = comparePrices(
          updatedExtracted.casePrice || 0,
          updatedExtracted.packPrice || 0,
          line.matchResult.product,
          priceMonitoringSettings
        );
        status = priceComp.hasPriceChange ? 'PRICE_CHANGE' : 'UNCHANGED';
      }

      return {
        ...line,
        extracted: updatedExtracted,
        priceComparison: priceComp,
        status,
        selected: status !== 'UNCHANGED' ? true : line.selected
      };
    }));
  };

  // Add manual line item for receipt lines that were physically faint or torn
  const handleAddManualLine = () => {
    const newItem: ExtractedLineItem = {
      rawDescription: 'Manual Item ' + (analyzedLines.length + 1),
      itemCode: '',
      packSize: '1',
      quantity: 1,
      unitTypeDetected: 'CASE',
      casePrice: 0,
      packPrice: 0,
      vatRate: 0,
      totalPrice: 0,
      notes: 'Manually added',
    };

    const matchResult = matchExtractedItem(
      newItem.rawDescription,
      newItem.itemCode,
      selectedSupplierId,
      products
    );

    const newLine: AnalyzedLine = {
      id: `manual_line_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      extracted: newItem,
      matchResult,
      priceComparison: null,
      selected: true,
      status: 'NEW_ITEM',
    };

    setAnalyzedLines(prev => [newLine, ...prev]);
    showToast('info', 'Added new item row. You can edit the price or details directly.');
  };

  // Delete line item
  const handleDeleteLine = (lineId: string) => {
    setAnalyzedLines(prev => prev.filter(l => l.id !== lineId));
  };

  // Summary counts
  const priceChangeCount = analyzedLines.filter(l => l.status === 'PRICE_CHANGE').length;
  const unchangedCount = analyzedLines.filter(l => l.status === 'UNCHANGED').length;
  const needsMatchingCount = analyzedLines.filter(l => l.status === 'NEEDS_MATCHING').length;
  const confirmedNewCount = analyzedLines.filter(l => l.status === 'CONFIRMED_NEW').length;
  const invalidDataCount = analyzedLines.filter(l => l.status === 'INVALID_DATA').length;
  const selectedCount = analyzedLines.filter(l => l.selected).length;

  // Review screen filter & search states
  const [reviewSearchQuery, setReviewSearchQuery] = useState('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'ALL' | 'CHANGES' | 'NEEDS_MATCHING' | 'CONFIRMED_NEW' | 'UNCHANGED' | 'INVALID'>('ALL');

  const displayedLines = useMemo(() => {
    let list = analyzedLines;
    if (reviewStatusFilter === 'CHANGES') list = list.filter(l => l.status === 'PRICE_CHANGE');
    else if (reviewStatusFilter === 'NEEDS_MATCHING') list = list.filter(l => l.status === 'NEEDS_MATCHING');
    else if (reviewStatusFilter === 'CONFIRMED_NEW') list = list.filter(l => l.status === 'CONFIRMED_NEW');
    else if (reviewStatusFilter === 'UNCHANGED') list = list.filter(l => l.status === 'UNCHANGED');
    else if (reviewStatusFilter === 'INVALID') list = list.filter(l => l.status === 'INVALID_DATA');

    if (reviewSearchQuery.trim()) {
      const q = reviewSearchQuery.toLowerCase().trim();
      list = list.filter(l => 
        l.extracted.rawDescription.toLowerCase().includes(q) ||
        (l.extracted.itemCode && l.extracted.itemCode.toLowerCase().includes(q)) ||
        (l.matchResult.product && l.matchResult.product.name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [analyzedLines, reviewStatusFilter, reviewSearchQuery]);

  // State for direct catalog apply and catalog product matching modal
  const [isDirectApplying, setIsDirectApplying] = useState(false);
  const [matchingLineId, setMatchingLineId] = useState<string | null>(null);
  const [matchingSearchQuery, setMatchingSearchQuery] = useState('');

  // Find active line being matched to catalog
  const matchingLine = matchingLineId ? analyzedLines.find(l => l.id === matchingLineId) : null;
  const filteredCatalogForMatching = useMemo(() => {
    if (!matchingLine) return [];
    const q = matchingSearchQuery.toLowerCase().trim();
    // R07: Manual search MUST stay within selected supplier, even when supplier has 0 active products.
    // Never fall back to or search across other suppliers' catalogs!
    return products
      .filter(p => {
        if (selectedSupplierId && p.supplierId !== selectedSupplierId) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.itemCode && p.itemCode.toLowerCase().includes(q)) ||
          (p.chineseName && p.chineseName.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .slice(0, 50);
  }, [matchingLine, products, matchingSearchQuery, selectedSupplierId]);

  const handleSelectCatalogProduct = (lineId: string, product: Product) => {
    setAnalyzedLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      const matchResult: MatchedResult = {
        product,
        confidence: 1,
        matchReason: 'NAME_MATCH',
        possibleDuplicates: [],
      };
      const priceComp = comparePrices(
        l.extracted.casePrice || 0,
        l.extracted.packPrice || 0,
        product,
        priceMonitoringSettings
      );
      const status: AnalyzedLine['status'] = priceComp.hasPriceChange 
        ? (priceComp.isFirstPrice ? 'FIRST_PRICE' : 'PRICE_CHANGE') 
        : 'UNCHANGED';
      return {
        ...l,
        matchResult,
        priceComparison: priceComp,
        status,
        selected: true,
      };
    }));
    setMatchingLineId(null);
    setMatchingSearchQuery('');
    showToast('success', `Linked to "${product.name}". Price comparison updated!`);
  };

  const handleUnlinkCatalogProduct = (lineId: string) => {
    setAnalyzedLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      return {
        ...l,
        matchResult: { product: null, confidence: 0, matchReason: 'NONE', possibleDuplicates: [] },
        priceComparison: null,
        status: 'NEEDS_MATCHING',
        selected: false,
      };
    }));
    setMatchingLineId(null);
    showToast('info', 'Unlinked from catalog item. Set to Needs Matching.');
  };

  // Direct Apply & Update Prices to Catalog (Instant update without separate approval step)
  const handleDirectApply = async () => {
    if (!currentUser) return;
    setIsDirectApplying(true);
    try {
      const selectedLines = analyzedLines.filter(l => l.selected);
      if (selectedLines.length === 0) {
        showToast('warning', 'No items selected to update. Please select at least one item using the checkboxes.');
        setIsDirectApplying(false);
        return;
      }

      // Safeguard: Ensure no unlinked/unconfirmed items are processed directly
      const unconfirmed = selectedLines.filter(l => l.status === 'NEEDS_MATCHING' || l.status === 'INVALID_DATA');
      if (unconfirmed.length > 0) {
        showToast('warning', `${unconfirmed.length} selected item(s) need matching or confirmation as a new product first. Please link them or uncheck them.`);
        setIsDirectApplying(false);
        return;
      }

      const activeSupplier = suppliers.find(s => s.id === selectedSupplierId);
      const supplierName = activeSupplier ? activeSupplier.name : 'Unknown Supplier';

      let pricesUpdated = 0;
      let newItemsCreated = 0;

      for (const line of selectedLines) {
        if (line.matchResult.product) {
          const product = line.matchResult.product;
          const prodCasePrice = product.casePrice;
          const prodPackPrice = product.packPrice;
          const newCasePrice = (line.extracted.casePrice !== undefined && line.extracted.casePrice >= 0)
            ? line.extracted.casePrice 
            : prodCasePrice;
          const newPackPrice = (line.extracted.packPrice !== undefined && line.extracted.packPrice >= 0)
            ? line.extracted.packPrice 
            : prodPackPrice;

          const resolvedItemCode = line.extracted.itemCode || product.itemCode;

          // 1. Update product in database catalog
          const updatedProduct: any = {
            ...product,
          };
          if (resolvedItemCode !== undefined) {
            updatedProduct.itemCode = resolvedItemCode;
          }
          if (newCasePrice !== undefined) {
            updatedProduct.casePrice = newCasePrice;
          } else {
            delete updatedProduct.casePrice;
          }
          if (newPackPrice !== undefined) {
            updatedProduct.packPrice = newPackPrice;
          } else {
            delete updatedProduct.packPrice;
          }
          await useAppStore.getState().updateProduct(updatedProduct);

          // 2. Write permanent price history record (audit trail)
          const historyRecord: any = {
            id: crypto.randomUUID(),
            productId: product.id,
            productName: product.name,
            supplierId: selectedSupplierId,
            supplierName,
            effectiveDate: invoiceDate || new Date().toISOString().split('T')[0],
            invoiceRef: invoiceNumber.trim() || 'Invoice Scan',
            approvedByUserId: currentUser.id,
            approvedByUserName: currentUser.displayName,
            approvedAt: new Date().toISOString(),
            notes: `Directly applied from invoice scan (${fileName || 'Direct Scan'})`,
          };
          if (resolvedItemCode !== undefined) {
            historyRecord.itemCode = resolvedItemCode;
          }
          if (prodCasePrice !== undefined) {
            historyRecord.previousCasePrice = prodCasePrice;
            historyRecord.oldCasePrice = prodCasePrice;
          }
          if (newCasePrice !== undefined) {
            historyRecord.newCasePrice = newCasePrice;
          }
          if (prodPackPrice !== undefined) {
            historyRecord.previousPackPrice = prodPackPrice;
            historyRecord.oldPackPrice = prodPackPrice;
          }
          if (newPackPrice !== undefined) {
            historyRecord.newPackPrice = newPackPrice;
          }
          await useAppStore.getState().addPriceHistoryRecord(historyRecord as PriceHistoryRecord);

          // 3. Save as APPROVED notice for full history tracking
          const noticeId = `pcn_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const noticeOld = prodCasePrice !== undefined ? prodCasePrice : (prodPackPrice !== undefined ? prodPackPrice : 0);
          const noticeNew = newCasePrice !== undefined ? newCasePrice : (newPackPrice !== undefined ? newPackPrice : 0);
          const priceDiff = noticeNew - noticeOld;
          const percentChange = noticeOld > 0 
            ? Number((((noticeNew - noticeOld) / noticeOld) * 100).toFixed(1)) 
            : 0;
          const approvedNotice: any = {
            id: noticeId,
            productId: product.id,
            productName: product.name,
            supplierId: selectedSupplierId,
            supplierName,
            priceDiff,
            percentChange,
            invoiceNumber: invoiceNumber.trim(),
            invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
            detectedDate: new Date().toISOString(),
            status: 'APPROVED',
            uploadedByUserId: currentUser.id,
            uploadedByUserName: currentUser.displayName,
            reviewedByUserId: currentUser.id,
            reviewedByUserName: currentUser.displayName,
            reviewedAt: new Date().toISOString(),
            effectiveDate: invoiceDate || new Date().toISOString().split('T')[0],
            notes: 'Directly applied from invoice scan',
          };
          if (resolvedItemCode !== undefined) approvedNotice.itemCode = resolvedItemCode;
          if (product.unitType !== undefined) approvedNotice.unitType = product.unitType;
          if (fileName) approvedNotice.scannedFileName = fileName;
          if (prodCasePrice !== undefined) approvedNotice.oldCasePrice = prodCasePrice;
          if (newCasePrice !== undefined) approvedNotice.newCasePrice = newCasePrice;
          if (prodPackPrice !== undefined) approvedNotice.oldPackPrice = prodPackPrice;
          if (newPackPrice !== undefined) approvedNotice.newPackPrice = newPackPrice;
          await useAppStore.getState().addPriceChangeNotice(approvedNotice as PriceChangeNotice);
          pricesUpdated++;
        } else if (line.status === 'CONFIRMED_NEW' || line.status === 'NEW_ITEM') {
          const noticeId = `nin_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const topDup = line.matchResult.possibleDuplicates[0];
          const newNoticePayload: any = {
            id: noticeId,
            supplierId: selectedSupplierId,
            supplierName,
            rawDescription: line.extracted.rawDescription,
            detectedCasePrice: line.extracted.casePrice || 0,
            detectedPackPrice: line.extracted.packPrice || 0,
            vat: line.extracted.vatRate || 0,
            invoiceNumber: invoiceNumber.trim(),
            invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
            detectedDate: new Date().toISOString(),
            status: 'PENDING',
            uploadedByUserId: currentUser.id,
            uploadedByUserName: currentUser.displayName,
          };
          if (line.extracted.itemCode) newNoticePayload.rawItemCode = line.extracted.itemCode;
          if (line.extracted.packSize) newNoticePayload.rawPackSize = line.extracted.packSize;
          if (fileName) newNoticePayload.scannedFileName = fileName;
          if (topDup?.product?.id) newNoticePayload.possibleDuplicateProductId = topDup.product.id;
          if (topDup?.product?.name) newNoticePayload.possibleDuplicateProductName = topDup.product.name;
          if (topDup?.score !== undefined) newNoticePayload.duplicateMatchScore = topDup.score;
          await useAppStore.getState().addNewItemNotice(newNoticePayload);
          newItemsCreated++;
        }
      }

      showToast(
        'success',
        `Prices Updated: ${pricesUpdated} products directly updated in catalog! ${newItemsCreated > 0 ? `(${newItemsCreated} new items queued for review)` : ''}`
      );
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Direct apply error', err);
      showToast('error', `Failed to directly update prices: ${err.message}`);
    } finally {
      setIsDirectApplying(false);
    }
  };

  // Submit notices to Firestore (Pending Manager Approval flow)
  const handleSubmitNotices = async () => {
    if (!currentUser) return;
    setIsSubmitting(true);

    try {
      const selectedLines = analyzedLines.filter(l => l.selected);
      if (selectedLines.length === 0) {
        showToast('warning', 'No items selected to submit. Please select at least one item using the checkboxes.');
        setIsSubmitting(false);
        return;
      }

      // Safeguard: Ensure no unlinked/unconfirmed items are submitted
      const unconfirmed = selectedLines.filter(l => l.status === 'NEEDS_MATCHING' || l.status === 'INVALID_DATA');
      if (unconfirmed.length > 0) {
        showToast('warning', `${unconfirmed.length} selected item(s) need matching or confirmation as a new product before submission. Please link or confirm them.`);
        setIsSubmitting(false);
        return;
      }

      const activeSupplier = suppliers.find(s => s.id === selectedSupplierId);
      const supplierName = activeSupplier ? activeSupplier.name : 'Unknown Supplier';

      let priceNoticesCreated = 0;
      let newItemsCreated = 0;

      for (const line of selectedLines) {
        if (line.status === 'PRICE_CHANGE' && line.matchResult.product && line.priceComparison) {
          const prod = line.matchResult.product;
          const isPack = line.priceComparison.priceType === 'PACK';
          const lineCase = (line.extracted.casePrice !== undefined && line.extracted.casePrice >= 0)
            ? line.extracted.casePrice
            : (!isPack ? line.priceComparison.newPrice : prod.casePrice);
          const linePack = (line.extracted.packPrice !== undefined && line.extracted.packPrice >= 0)
            ? line.extracted.packPrice
            : (isPack ? line.priceComparison.newPrice : prod.packPrice);

          const noticeId = `pcn_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const notice: any = {
            id: noticeId,
            productId: prod.id,
            productName: prod.name,
            supplierId: selectedSupplierId,
            supplierName,
            priceDiff: line.priceComparison.priceDiff,
            percentChange: line.priceComparison.percentChange,
            invoiceNumber: invoiceNumber.trim(),
            invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
            detectedDate: new Date().toISOString(),
            status: 'PENDING',
            uploadedByUserId: currentUser.id,
            uploadedByUserName: currentUser.displayName,
          };
          const resolvedItemCode = line.extracted.itemCode || prod.itemCode;
          if (resolvedItemCode !== undefined) notice.itemCode = resolvedItemCode;
          if (prod.unitType !== undefined) notice.unitType = prod.unitType;
          if (fileName) notice.scannedFileName = fileName;
          if (fileBase64) notice.scannedFileUrl = `data:${fileMime};base64,${fileBase64.substring(0, 100)}...`;
          if (prod.casePrice !== undefined) notice.oldCasePrice = prod.casePrice;
          if (lineCase !== undefined) notice.newCasePrice = lineCase;
          if (prod.packPrice !== undefined) notice.oldPackPrice = prod.packPrice;
          if (linePack !== undefined) notice.newPackPrice = linePack;
          await addPriceChangeNotice(notice as PriceChangeNotice);
          priceNoticesCreated++;
        } else if (line.status === 'CONFIRMED_NEW' || line.status === 'NEW_ITEM') {
          const noticeId = `nin_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const topDup = line.matchResult.possibleDuplicates[0];
          const noticePayload: any = {
            id: noticeId,
            supplierId: selectedSupplierId,
            supplierName,
            rawDescription: line.extracted.rawDescription,
            detectedCasePrice: line.extracted.casePrice || 0,
            detectedPackPrice: line.extracted.packPrice || 0,
            vat: line.extracted.vatRate || 0,
            invoiceNumber: invoiceNumber.trim(),
            invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
            detectedDate: new Date().toISOString(),
            status: 'PENDING',
            uploadedByUserId: currentUser.id,
            uploadedByUserName: currentUser.displayName,
          };
          if (line.extracted.itemCode) noticePayload.rawItemCode = line.extracted.itemCode;
          if (line.extracted.packSize) noticePayload.rawPackSize = line.extracted.packSize;
          if (fileName) noticePayload.scannedFileName = fileName;
          if (topDup?.product?.id) noticePayload.possibleDuplicateProductId = topDup.product.id;
          if (topDup?.product?.name) noticePayload.possibleDuplicateProductName = topDup.product.name;
          if (topDup?.score !== undefined) noticePayload.duplicateMatchScore = topDup.score;
          await addNewItemNotice(noticePayload as NewItemNotice);
          newItemsCreated++;
        }
      }

      showToast(
        'success',
        `Successfully generated notices: ${priceNoticesCreated} price updates & ${newItemsCreated} new items queued for Manager Approval!`
      );

      // Trigger optional email alert if enabled
      if (priceMonitoringSettings.enableEmailAlerts && (priceNoticesCreated > 0 || newItemsCreated > 0)) {
        try {
          const response = await sendEmail({
              purpose: 'price-alert',
              supplierId: selectedSupplierId,
              subject: `[HT Orders] Review Required: ${priceNoticesCreated} Price Changes & ${newItemsCreated} New Items Detected`,
              html: `
                <div style="font-family: sans-serif; max-width: 600px; padding: 20px;">
                  <h2 style="color: #1e3a8a;">New Invoice Price Discrepancies Detected</h2>
                  <p>A supplier document was scanned and flagged for review:</p>
                  <ul>
                    <li><strong>Supplier:</strong> ${supplierName}</li>
                    <li><strong>Invoice/Delivery Ref:</strong> ${invoiceNumber || 'N/A'}</li>
                    <li><strong>Uploaded By:</strong> ${currentUser.displayName}</li>
                    <li><strong>Price Changes:</strong> ${priceNoticesCreated}</li>
                    <li><strong>New / Unrecognised Items:</strong> ${newItemsCreated}</li>
                  </ul>
                  <p>Please log in to the Order System to approve or reject these changes.</p>
                </div>
              `
          });
          if (!response.ok) throw await readEmailError(response);
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Please contact an administrator.';
          showToast('warning', `Review notices were saved, but the email alert was not sent. ${detail}`);
        }
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to submit notices', err);
      showToast('error', `Failed to create review notices: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAll = () => {
    setStep('UPLOAD');
    setFileBase64('');
    setFileMime('');
    setFileName('');
    setAnalyzedLines([]);
    setReviewSearchQuery('');
    setReviewStatusFilter('ALL');
    setDetectedSupplierRaw('');
    setSupplierDetectionConfidence('AUTO_MATCHED');
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-5xl w-full h-[94vh] max-h-[95vh] flex flex-col p-3 sm:p-5 overflow-hidden">
      {/* Title Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
            <Sparkles size={22} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Upload Invoice, Price List, or Delivery Note</h3>
            <p className="text-xs text-gray-500 font-medium">
              Upload PDF invoice, photo/scan (JPEG, PNG), or Excel spreadsheet (XLSX, CSV) to update prices.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* STEP 1: UPLOAD / CAMERA */}
      {step === 'UPLOAD' && (
        <div className="py-6 flex flex-col items-center justify-center flex-1 overflow-y-auto custom-scrollbar">
          <div className="w-full max-w-lg space-y-4">
            {errorMessage && (
              <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl space-y-2 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-red-500 shrink-0" />
                    <span className="font-semibold">{errorMessage}</span>
                  </div>
                  <button 
                    onClick={() => setErrorMessage(null)} 
                    className="text-red-500 hover:text-red-700 font-bold text-xs shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
                {errorMessage.toLowerCase().includes('gemini api key') && (
                  <div className="p-3 bg-white/90 rounded-lg border border-red-100 text-[11px] text-gray-700 space-y-1.5 mt-1">
                    <p className="font-bold text-red-900">How to configure on Vercel:</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600">
                      <li>In your open Vercel tab, navigate to <strong>Settings &rarr; Environment Variables</strong></li>
                      <li>Add Key: <code className="bg-gray-100 text-red-800 font-mono font-bold px-1.5 py-0.5 rounded">GEMINI_API_KEY</code></li>
                      <li>Value: Paste your Google Gemini API Key</li>
                      <li>Save and <strong>Redeploy</strong> the latest deployment</li>
                    </ol>
                  </div>
                )}
              </div>
            )}

            {/* Optional Supplier Selector before upload */}
            <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Building size={14} className="text-brand-600" />
                  Supplier Selection (Auto or Manual)
                </label>
                <span className="text-[10px] font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
                  {preSelectedSupplierId === 'auto' ? '🤖 Auto-Detect ON' : '📌 Locked to Supplier'}
                </span>
              </div>
              <select
                value={preSelectedSupplierId}
                onChange={(e) => setPreSelectedSupplierId(e.target.value)}
                className="w-full bg-gray-50 hover:bg-gray-100/80 border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
              >
                <option value="auto">🤖 Auto-detect Supplier from document (Recommended)</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>🏢 {s.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 leading-tight">
                {preSelectedSupplierId === 'auto' 
                  ? 'Our OCR engine will automatically scan the company letterhead, logo, and invoice header to detect the supplier.'
                  : `Document items will be matched directly against ${suppliers.find(s => s.id === preSelectedSupplierId)?.name}'s catalog.`}
              </p>
            </div>

            {/* Upload Area */}
            <div 
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileProcess(file);
              }}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all group ${
                isDragOver 
                  ? 'border-brand-600 bg-brand-50/60 scale-[1.01]' 
                  : 'border-gray-300 hover:border-brand-500 bg-gray-50 hover:bg-brand-50/40'
              }`}
            >
              <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-gray-200 text-brand-600 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <UploadCloud size={32} />
              </div>
              <h4 className="text-sm font-bold text-gray-800">
                Click or Drag & Drop PDF, Photo, or Excel Spreadsheet
              </h4>
              <p className="text-xs text-gray-500 mt-1">
                Supports PDF, JPG, PNG, WebP, Excel (.xlsx, .xls, .xlt) and CSV (up to 25MB)
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-3 text-[11px] text-gray-600">
                <span className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-gray-200 shadow-2xs font-medium">
                  <FileText size={13} className="text-red-500" /> PDF Invoice
                </span>
                <span className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-gray-200 shadow-2xs font-medium">
                  <ImageIcon size={13} className="text-blue-500" /> Photo / JPEG
                </span>
                <span className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-gray-200 shadow-2xs font-medium">
                  <FileSpreadsheet size={13} className="text-emerald-600" /> Excel (.xlsx, .xls, .xlt) / CSV
                </span>
              </div>
            </div>

            {/* Hidden Input for Desktop / File Upload */}
            <input 
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.xlsx,.xls,.xlt,.xltx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="hidden"
              onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileProcess(file);
              }}
            />

            {/* Camera Capture for Tablet & Mobile */}
            <div className="flex items-center justify-center gap-3">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">or</span>
            </div>

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-gray-50 text-gray-800 border-2 border-gray-200 hover:border-gray-300 py-3.5 px-4 rounded-2xl font-bold text-sm shadow-sm transition-all active:scale-[0.99]"
            >
              <Camera size={18} className="text-brand-600" />
              <span>Take Photo with Tablet / Mobile Camera</span>
            </button>

            {/* Hidden Input for Camera Capture */}
            <input 
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileProcess(file);
              }}
            />

            <div className="bg-blue-50/70 p-3.5 rounded-xl border border-blue-100 text-xs text-blue-800">
              <p className="font-bold flex items-center gap-1.5 mb-1">
                <Sparkles size={14} className="text-brand-600" />
                Zero-Risk Safety Guarantee
              </p>
              <p className="text-blue-700 leading-relaxed">
                You can review every price, link items with your catalog, or choose to submit for manager approval before anything takes effect.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: EXTRACTING PROGRESS */}
      {step === 'EXTRACTING' && (
        <div className="py-16 flex flex-col items-center justify-center flex-1 text-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-brand-50 rounded-2xl flex items-center justify-center text-brand-600 animate-pulse">
              <Sparkles size={36} />
            </div>
            <Loader2 size={24} className="animate-spin text-brand-600 absolute -top-1 -right-1" />
          </div>
          <h4 className="text-lg font-bold text-gray-900 mb-1">Analyzing Document with Gemini OCR</h4>
          <p className="text-xs text-gray-500 max-w-sm mb-4">
            Detecting supplier name, invoice numbers, line item descriptions, and checking prices against catalog...
          </p>
          <div className="flex items-center gap-2 text-xs font-semibold text-brand-600 bg-brand-50 px-3 py-1.5 rounded-full">
            <FileText size={14} />
            <span className="truncate max-w-[200px]">{fileName}</span>
          </div>
        </div>
      )}

      {/* STEP 3: REVIEW & VERIFICATION */}
      {step === 'REVIEW' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden mt-2 space-y-2">
          {/* Header Controls Bar */}
          <div className="bg-gray-50/95 p-2.5 rounded-xl border border-gray-200/90 flex flex-wrap items-center justify-between gap-2.5 flex-shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                  Supplier
                </label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => handleSupplierChange(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 shadow-2xs max-w-[170px] truncate"
                >
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                  Invoice #
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-10492"
                  className="w-28 bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 shadow-2xs"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                  Date
                </label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 shadow-2xs"
                />
              </div>
            </div>

            {/* Quick Metrics Badges (Clickable filters) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setReviewStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  reviewStatusFilter === 'ALL'
                    ? 'bg-gray-800 text-white shadow-2xs'
                    : 'bg-white hover:bg-gray-100 text-gray-600 border border-gray-200'
                }`}
              >
                All ({analyzedLines.length})
              </button>
              <button
                type="button"
                onClick={() => setReviewStatusFilter('CHANGES')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  reviewStatusFilter === 'CHANGES'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {priceChangeCount} Price Changed
              </button>
              <button
                type="button"
                onClick={() => setReviewStatusFilter('NEEDS_MATCHING')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  reviewStatusFilter === 'NEEDS_MATCHING'
                    ? 'bg-orange-600 text-white shadow-2xs'
                    : 'bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200'
                }`}
              >
                {needsMatchingCount} Needs Matching
              </button>
              <button
                type="button"
                onClick={() => setReviewStatusFilter('CONFIRMED_NEW')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  reviewStatusFilter === 'CONFIRMED_NEW'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200'
                }`}
              >
                {confirmedNewCount} Confirmed New
              </button>
              <button
                type="button"
                onClick={() => setReviewStatusFilter('UNCHANGED')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  reviewStatusFilter === 'UNCHANGED'
                    ? 'bg-green-600 text-white shadow-2xs'
                    : 'bg-green-50 hover:bg-green-100 text-green-800 border border-green-200'
                }`}
              >
                {unchangedCount} Unchanged
              </button>
              {invalidDataCount > 0 && (
                <button
                  type="button"
                  onClick={() => setReviewStatusFilter('INVALID')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    reviewStatusFilter === 'INVALID'
                      ? 'bg-red-600 text-white shadow-2xs'
                      : 'bg-red-50 hover:bg-red-100 text-red-800 border border-red-200'
                  }`}
                >
                  {invalidDataCount} Invalid Data
                </button>
              )}
            </div>
          </div>

          {/* Supplier Auto-Detection & Verification Status Banner */}
          {supplierDetectionConfidence === 'AUTO_MATCHED' && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs px-3 py-2 rounded-xl flex items-center justify-between gap-2 flex-shrink-0 shadow-2xs">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                <span className="font-medium">
                  <strong>Supplier Auto-Detected:</strong> {suppliers.find(s => s.id === selectedSupplierId)?.name}
                  {detectedSupplierRaw && cleanStr(detectedSupplierRaw) !== cleanStr(suppliers.find(s => s.id === selectedSupplierId)?.name || '') && (
                    <span className="text-emerald-700 ml-1">(from document: "{detectedSupplierRaw}")</span>
                  )}
                </span>
              </div>
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md flex-shrink-0">
                AI Matched
              </span>
            </div>
          )}

          {supplierDetectionConfidence === 'MANUAL_REQUIRED' && (
            <div className="bg-amber-50 border border-amber-300 text-amber-900 text-xs px-3 py-2.5 rounded-xl flex items-start sm:items-center justify-between gap-2 flex-shrink-0 shadow-2xs">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5 sm:mt-0" />
                <div>
                  <span className="font-bold">⚠️ Supplier verification needed: </span>
                  <span className="text-amber-800">
                    {detectedSupplierRaw 
                      ? `Document displays "${detectedSupplierRaw}", which doesn't directly match any registered supplier.` 
                      : `Could not identify supplier from document headers.`}
                    {' '}Currently selected: <strong>{suppliers.find(s => s.id === selectedSupplierId)?.name || 'Default'}</strong>. If this is different, please select the right supplier from the dropdown above to match items!
                  </span>
                </div>
              </div>
            </div>
          )}

          {supplierDetectionConfidence === 'PRE_SELECTED' && (
            <div className="bg-blue-50 border border-blue-200 text-blue-900 text-xs px-3 py-2 rounded-xl flex items-center justify-between gap-2 flex-shrink-0 shadow-2xs">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-blue-600 flex-shrink-0" />
                <span>
                  <strong>Locked Supplier:</strong> {suppliers.find(s => s.id === selectedSupplierId)?.name} (Catalog items matched for this supplier)
                </span>
              </div>
              <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md flex-shrink-0">
                User Selected
              </span>
            </div>
          )}

          {/* Subheader Toolbar: Search, Select All, Add Item, and Quick Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0 px-0.5">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <input
                type="text"
                placeholder={`Search ${displayedLines.length} items...`}
                value={reviewSearchQuery}
                onChange={(e) => setReviewSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500 shadow-2xs"
              />
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              {reviewSearchQuery && (
                <button
                  type="button"
                  onClick={() => setReviewSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  const allSelected = displayedLines.every(l => l.selected);
                  const newSel = !allSelected;
                  const idsToToggle = new Set(displayedLines.map(l => l.id));
                  setAnalyzedLines(prev => prev.map(l => idsToToggle.has(l.id) ? { ...l, selected: newSel } : l));
                }}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-lg transition-colors shadow-2xs"
              >
                {displayedLines.every(l => l.selected) ? 'Deselect All' : `Select All (${displayedLines.length})`}
              </button>

              {(priceChangeCount > 0 || confirmedNewCount > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setAnalyzedLines(prev => prev.map(l => ({
                      ...l,
                      selected: l.status === 'PRICE_CHANGE' || l.status === 'CONFIRMED_NEW'
                    })));
                    showToast('info', `Selected ${priceChangeCount + confirmedNewCount} actionable items.`);
                  }}
                  className="text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1.5 rounded-lg transition-colors shadow-2xs"
                >
                  Select Changes ({priceChangeCount + confirmedNewCount})
                </button>
              )}

              <button
                type="button"
                onClick={handleAddManualLine}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg border border-brand-200 transition-colors shadow-2xs"
              >
                <PlusCircle size={14} />
                <span>+ Add Line Item</span>
              </button>

              {/* Top Quick Apply Button */}
              <button
                type="button"
                disabled={isSubmitting || isDirectApplying || selectedCount === 0}
                onClick={handleDirectApply}
                title={selectedCount === 0 ? "Select at least one item using checkboxes to apply" : "Immediately update selected product prices directly in catalog"}
                className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg shadow-2xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDirectApplying ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Zap size={13} className="fill-white" />
                )}
                <span>Apply & Update ({selectedCount})</span>
              </button>
            </div>
          </div>

          {/* Main Items Scrollable Table - Guaranteed proper flex height without pushing footer out */}
          <div className="flex-1 min-h-[180px] overflow-y-auto custom-scrollbar border border-gray-200 rounded-xl bg-white divide-y divide-gray-100 shadow-2xs">
            {displayedLines.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-xs font-medium space-y-3">
                {analyzedLines.length === 0 ? (
                  <div className="space-y-3 max-w-md mx-auto py-4">
                    <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto">
                      <AlertTriangle size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-800">No items were automatically detected</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        The document may have faint text or an unusual layout. You can add items manually below or try another file.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddManualLine}
                      className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition-all"
                    >
                      <PlusCircle size={15} />
                      <span>+ Add Line Item Manually</span>
                    </button>
                  </div>
                ) : (
                  <div className="py-6">
                    <p>No items found matching the current search or filter.</p>
                    <button
                      type="button"
                      onClick={() => { setReviewSearchQuery(''); setReviewStatusFilter('ALL'); }}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-600 underline"
                    >
                      Clear search filter
                    </button>
                  </div>
                )}
              </div>
            ) : (
              displayedLines.map((line) => {
                const isSelected = line.selected;
                const isPriceChange = line.status === 'PRICE_CHANGE';
                const isUnchanged = line.status === 'UNCHANGED';
                const isNeedsMatching = line.status === 'NEEDS_MATCHING';
                const isConfirmedNew = line.status === 'CONFIRMED_NEW';
                const isInvalidData = line.status === 'INVALID_DATA';
                const matchedProduct = line.matchResult.product;

                return (
                  <div
                    key={line.id}
                    className={`p-3 transition-colors flex items-start gap-3 hover:bg-gray-50/70 ${
                      isSelected ? 'bg-brand-50/20' : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAnalyzedLines(prev => prev.map(l => l.id === line.id ? { ...l, selected: checked } : l));
                      }}
                      className="mt-1.5 w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-gray-300 cursor-pointer"
                    />

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Top Line: Item Description, SKU, and Status Badge */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <input
                            type="text"
                            value={line.extracted.rawDescription}
                            onChange={(e) => {
                              const newDesc = e.target.value;
                              setAnalyzedLines(prev => prev.map(l => {
                                if (l.id !== line.id) return l;
                                const updatedExtracted = { ...l.extracted, rawDescription: newDesc };
                                const matchResult = matchExtractedItem(newDesc, updatedExtracted.itemCode, selectedSupplierId, products);
                                let priceComp: PriceComparisonResult | null = null;
                                let status: AnalyzedLine['status'] = l.status === 'CONFIRMED_NEW' ? 'CONFIRMED_NEW' : 'NEEDS_MATCHING';
                                if (matchResult.product) {
                                  priceComp = comparePrices(
                                    updatedExtracted.casePrice || 0,
                                    updatedExtracted.packPrice || 0,
                                    matchResult.product,
                                    priceMonitoringSettings
                                  );
                                  status = priceComp.hasPriceChange 
                                    ? (priceComp.isFirstPrice ? 'FIRST_PRICE' : 'PRICE_CHANGE') 
                                    : 'UNCHANGED';
                                }
                                return {
                                  ...l,
                                  extracted: updatedExtracted,
                                  matchResult,
                                  priceComparison: priceComp,
                                  status,
                                  selected: status === 'PRICE_CHANGE' || status === 'CONFIRMED_NEW' ? true : l.selected
                                };
                              }));
                            }}
                            className="text-xs font-bold text-gray-900 w-full bg-transparent hover:bg-gray-100/70 focus:bg-white border border-transparent hover:border-gray-200 focus:border-brand-500 rounded px-1.5 py-0.5 outline-none transition-colors"
                          />
                          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5 px-1.5 flex-wrap">
                            {line.extracted.itemCode && (
                              <span className="font-mono bg-gray-100 px-1 py-0.5 rounded text-[10px]">
                                SKU: {line.extracted.itemCode}
                              </span>
                            )}
                            {line.extracted.packSize && (
                              <span>Pack: {line.extracted.packSize}</span>
                            )}
                            <span>Qty: {line.extracted.quantity}</span>
                          </div>
                          {line.extracted.notes && (
                            <div className="flex items-center gap-1 text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md mt-1 mx-1.5 w-fit">
                              <Sparkles size={11} className="text-purple-600 shrink-0" />
                              <span className="font-medium">{line.extracted.notes}</span>
                            </div>
                          )}
                        </div>

                        {/* Status Badge & Delete */}
                        <div className="flex items-center gap-2 shrink-0">
                          {isPriceChange && line.priceComparison && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                              <AlertTriangle size={11} />
                              Matched — Price Changed ({line.priceComparison.priceDiff > 0 ? `+£${line.priceComparison.priceDiff.toFixed(2)}` : `-£${Math.abs(line.priceComparison.priceDiff).toFixed(2)}`})
                            </span>
                          )}
                          {isUnchanged && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200">
                              <CheckCircle2 size={11} />
                              Matched — Unchanged
                            </span>
                          )}
                          {isNeedsMatching && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                              <HelpCircle size={11} />
                              Needs Matching
                            </span>
                          )}
                          {isConfirmedNew && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                              <PlusCircle size={11} />
                              Confirmed New Product
                            </span>
                          )}
                          {isInvalidData && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                              <AlertCircle size={11} />
                              Invalid / Missing Price
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteLine(line.id)}
                            title="Remove this line item"
                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Middle Line: Catalog Product Match Selector */}
                      <div className="bg-gray-50/80 rounded-lg p-2 border border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Catalog Match:</span>
                          {matchedProduct ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-gray-800">{matchedProduct.name}</span>
                              {matchedProduct.itemCode && (
                                <span className="font-mono text-[10px] text-gray-500 bg-white px-1 py-0.2 rounded border border-gray-200">
                                  {matchedProduct.itemCode}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => { setMatchingLineId(line.id); setMatchingSearchQuery(matchedProduct.name.split(' ')[0] || ''); }}
                                className="text-[11px] font-bold text-brand-600 hover:text-brand-800 underline ml-1"
                              >
                                Change Match
                              </button>
                            </div>
                          ) : isConfirmedNew ? (
                            <div className="flex items-center gap-2">
                              <span className="text-blue-700 font-bold">New catalog product to register</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAnalyzedLines(prev => prev.map(l => l.id === line.id ? { ...l, status: 'NEEDS_MATCHING', selected: false } : l));
                                }}
                                className="text-[11px] font-bold text-gray-500 hover:text-gray-700 underline"
                              >
                                Revert
                              </button>
                              <button
                                type="button"
                                onClick={() => { setMatchingLineId(line.id); setMatchingSearchQuery(''); }}
                                className="text-[11px] font-bold text-brand-600 hover:text-brand-800 underline ml-1"
                              >
                                Match Catalog Item Instead
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-gray-400 italic">Not matched yet</span>
                              <button
                                type="button"
                                onClick={() => { setMatchingLineId(line.id); setMatchingSearchQuery(''); }}
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded transition-colors"
                              >
                                <LinkIcon size={11} />
                                <span>Select from Catalog to Match</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAnalyzedLines(prev => prev.map(l => l.id === line.id ? { ...l, status: 'CONFIRMED_NEW', selected: true } : l));
                                  showToast('info', `Confirmed "${line.extracted.rawDescription}" as new product.`);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded transition-colors"
                              >
                                <PlusCircle size={11} />
                                <span>Confirm as New Product</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Similar Product Hint if unlinked */}
                        {!matchedProduct && line.matchResult.possibleDuplicates.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleSelectCatalogProduct(line.id, line.matchResult.possibleDuplicates[0].product)}
                            className="text-[10px] text-amber-700 font-bold bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded transition-colors"
                          >
                            💡 Match with "{line.matchResult.possibleDuplicates[0].product.name}"?
                          </button>
                        )}
                      </div>

                      {/* Bottom Line: Distinct Box Price & Pack Price Inputs */}
                      <div className="pt-1.5 border-t border-gray-100 flex flex-wrap items-center justify-between text-xs gap-3 px-1">
                        <div className="text-[11px] text-gray-500">
                          {matchedProduct ? (
                            <span>
                              Catalog Recorded: <strong className="text-gray-700">Box £{(matchedProduct.casePrice || 0).toFixed(2)}</strong> &bull; <strong className="text-gray-700">Pack £{(matchedProduct.packPrice || 0).toFixed(2)}</strong>
                            </span>
                          ) : (
                            <span className="text-gray-400">Set prices to apply to catalog:</span>
                          )}
                        </div>

                        {/* Price Input Fields: Box and Pack distinct */}
                        <div className="flex items-center gap-3">
                          {/* Box / Case Price Input */}
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-extrabold text-gray-600">Box/Case £:</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.extracted.casePrice || 0}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                updateLinePrice(line.id, 'casePrice', val);
                              }}
                              className="w-18 bg-white border border-gray-300 rounded px-2 py-0.5 text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-brand-500"
                            />
                          </div>

                          {/* Pack / Unit Price Input */}
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-extrabold text-gray-600">Pack/Unit £:</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.extracted.packPrice || 0}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                updateLinePrice(line.id, 'packPrice', val);
                              }}
                              className="w-18 bg-white border border-gray-300 rounded px-2 py-0.5 text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-brand-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Sticky Bottom Action Bar - ALWAYS visible, never cut off! */}
          <div className="sticky bottom-0 bg-white pt-2.5 pb-1 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2.5 flex-shrink-0 z-20 shadow-md">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={resetAll}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <RefreshCw size={13} />
                <span>Scan Another</span>
              </button>
              <span className="text-xs font-bold text-gray-500 border-l border-gray-200 pl-2">
                Selected: <strong className="text-gray-900">{selectedCount}</strong> / {displayedLines.length} items
              </span>
              {selectedCount === 0 && (priceChangeCount > 0 || confirmedNewCount > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setAnalyzedLines(prev => prev.map(l => ({
                      ...l,
                      selected: l.status === 'PRICE_CHANGE' || l.status === 'CONFIRMED_NEW'
                    })));
                    showToast('info', `Selected ${priceChangeCount + confirmedNewCount} actionable items.`);
                  }}
                  className="text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded-lg transition-colors"
                >
                  Select Changes ({priceChangeCount + confirmedNewCount})
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isDirectApplying}
                className="px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>

              {/* Submit for Manager Approval */}
              <button
                type="button"
                disabled={isSubmitting || isDirectApplying || selectedCount === 0}
                onClick={handleSubmitNotices}
                title={selectedCount === 0 ? "Select at least one item using checkboxes to submit" : "Queues updates for approval in the Pending Approvals tab"}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    <span>Submit for Approval {selectedCount > 0 ? `(${selectedCount})` : '(0)'}</span>
                  </>
                )}
              </button>

              {/* Instant Direct Apply & Update to Catalog */}
              <button
                type="button"
                disabled={isSubmitting || isDirectApplying || selectedCount === 0}
                onClick={handleDirectApply}
                title={selectedCount === 0 ? "Select at least one item using checkboxes to apply" : "Immediately updates the product prices in the catalog now and records an audit log"}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDirectApplying ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Updating Catalog...</span>
                  </>
                ) : (
                  <>
                    <Zap size={14} className="fill-white" />
                    <span>Apply & Update Catalog {selectedCount > 0 ? `(${selectedCount})` : '(0)'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Catalog Product Matcher Modal */}
      {matchingLine && (
        <Modal
          isOpen={!!matchingLineId}
          onClose={() => { setMatchingLineId(null); setMatchingSearchQuery(''); }}
          className="max-w-2xl w-full max-h-[90vh] flex flex-col p-4 sm:p-6"
        >
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                <LinkIcon size={18} />
              </div>
              <div>
                <h4 className="text-base font-bold text-gray-900">Match Invoice Item to Catalog Product</h4>
                <p className="text-xs text-gray-500">
                  Select the product that corresponds to: <span className="font-semibold text-gray-800">"{matchingLine.extracted.rawDescription}"</span>
                </p>
              </div>
            </div>
            <button
              onClick={() => { setMatchingLineId(null); setMatchingSearchQuery(''); }}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>

          <div className="py-3 flex-shrink-0">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                autoFocus
                placeholder="Search products by name, Chinese name, or SKU code..."
                value={matchingSearchQuery}
                onChange={(e) => setMatchingSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white"
              />
              {matchingSearchQuery && (
                <button
                  type="button"
                  onClick={() => setMatchingSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-[220px] max-h-[50vh] overflow-y-auto custom-scrollbar border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
            {filteredCatalogForMatching.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400 space-y-1">
                <p>No products found matching "{matchingSearchQuery}".</p>
                <p className="text-[11px] text-gray-500">Try typing a keyword or checking another supplier.</p>
              </div>
            ) : (
              filteredCatalogForMatching.map(product => {
                const isCurrentMatch = matchingLine.matchResult.product?.id === product.id;
                const isSelectedSup = product.supplierId === selectedSupplierId;
                return (
                  <div
                    key={product.id}
                    className={`p-3 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors ${
                      isCurrentMatch ? 'bg-brand-50/40' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-900">{product.name}</span>
                        {product.chineseName && (
                          <span className="text-xs text-gray-500 font-medium">{product.chineseName}</span>
                        )}
                        {isSelectedSup && (
                          <span className="text-[10px] font-bold bg-brand-50 text-brand-700 px-1.5 py-0.2 rounded border border-brand-100">
                            Current Supplier
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
                        {product.itemCode && (
                          <span className="font-mono bg-gray-100 px-1 py-0.5 rounded text-[10px]">
                            SKU: {product.itemCode}
                          </span>
                        )}
                        <span>Box: £{(product.casePrice || 0).toFixed(2)}</span>
                        <span>Pack: £{(product.packPrice || 0).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isCurrentMatch ? (
                        <span className="text-xs font-bold text-brand-600 bg-brand-50 px-2.5 py-1 rounded-lg border border-brand-200 flex items-center gap-1">
                          <Check size={13} />
                          Currently Selected
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectCatalogProduct(matchingLine.id, product)}
                          className="text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg transition-colors shadow-2xs flex items-center gap-1"
                        >
                          <LinkIcon size={12} />
                          <span>Select Product</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between flex-shrink-0 mt-3">
            {matchingLine.matchResult.product && (
              <button
                type="button"
                onClick={() => handleUnlinkCatalogProduct(matchingLine.id)}
                className="text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 transition-colors flex items-center gap-1.5"
              >
                <Unlink size={13} />
                <span>Unlink (Keep as New Product)</span>
              </button>
            )}
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => { setMatchingLineId(null); setMatchingSearchQuery(''); }}
                className="text-xs font-bold text-gray-600 hover:bg-gray-100 px-4 py-1.5 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
};
