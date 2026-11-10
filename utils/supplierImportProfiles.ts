import * as XLSX from 'xlsx';

export type SerializableFormulaId = 
  | 'EXPLICIT_OR_TOTAL_DIV_CASE' 
  | 'EXPLICIT_OR_UNITS_MUL_PACK' 
  | 'EXPLICIT_ONLY' 
  | 'AUTO_BEST_EFFORT';

export interface ColumnMappingProfile {
  id: string;
  name: string;
  supplierId?: string;
  description: string;
  version?: number;
  formulaId?: SerializableFormulaId;
  formulaParams?: Record<string, any>;
  // Field mappings (exact headers or patterns)
  columns: {
    itemCode: string[];
    description: string[];
    unitsPerCase?: string[];
    caseQty?: string[]; // Note: quantity of cases, NOT price!
    packPrice?: string[]; // Price per single unit/pack
    casePrice?: string[]; // Price per outer case/box
    total?: string[]; // Line total (e.g. Total LC)
    packaging?: string[]; // UoM / Pack size description
    category?: string[];
    vatRate?: string[];
  };
  // How to derive case price if not explicitly given
  deriveCasePrice?: (row: Record<string, any>, parsed: {
    unitsPerCase: number;
    caseQty: number;
    packPrice: number;
    casePrice?: number;
    total: number;
  }) => number;
}

export function resolveDeriveCasePrice(formulaId?: SerializableFormulaId) {
  return (row: Record<string, any>, parsed: {
    unitsPerCase: number;
    caseQty: number;
    packPrice: number;
    casePrice?: number;
    total: number;
  }): number => {
    // R08 FIX: Explicit case price always takes precedence if valid and > 0!
    if (typeof parsed.casePrice === 'number' && Number.isFinite(parsed.casePrice) && parsed.casePrice > 0) {
      return parsed.casePrice;
    }
    if (formulaId === 'EXPLICIT_ONLY') {
      return 0;
    }
    if (formulaId === 'EXPLICIT_OR_TOTAL_DIV_CASE' || !formulaId || formulaId === 'AUTO_BEST_EFFORT') {
      if (parsed.total > 0 && parsed.caseQty > 0) {
        return Math.round((parsed.total / parsed.caseQty) * 100) / 100;
      }
    }
    if (formulaId === 'EXPLICIT_OR_UNITS_MUL_PACK' || !formulaId || formulaId === 'AUTO_BEST_EFFORT') {
      if (parsed.unitsPerCase > 0 && parsed.packPrice > 0) {
        return Math.round((parsed.unitsPerCase * parsed.packPrice) * 100) / 100;
      }
    }
    return 0;
  };
}

// Built-in supplier profiles
export const BUILT_IN_IMPORT_PROFILES: ColumnMappingProfile[] = [
  {
    id: 'profile_tazaki',
    name: 'Tazaki Foods Ltd — Price List',
    supplierId: 's_tazaki',
    description: 'Direct mapping for Tazaki price lists: Item No., Unit Qty (units/case), Case Qty (count), Unit Price (pack), Total (LC)',
    columns: {
      itemCode: ['item no.', 'item no', 'item_no', 'itemno', 'item code', 'product code', 'art no'],
      description: ['item description', 'description', 'product description', 'item name', 'product name'],
      unitsPerCase: ['unit qty', 'unit quantity', 'units per case', 'inner qty', 'pack qty'],
      caseQty: ['case qty', 'case quantity', 'cases', 'no of cases'],
      packPrice: ['unit price', 'pack price', 'unit cost', 'pack cost', 'single price'],
      casePrice: ['case price', 'box price', 'outer price'],
      total: ['total (lc)', 'total lc', 'total', 'line total', 'total amount'],
      packaging: ['case uom', 'uom', 'pack size', 'packaging', 'size'],
      category: ['category', 'group', 'product category']
    },
    deriveCasePrice: (row, parsed) => {
      // 1. If explicit casePrice column exists and is > 0, use it
      // 2. If total and caseQty exist: total / caseQty (for Tazaki Case Qty = 1, so Total = Case Price)
      if (parsed.total > 0 && parsed.caseQty > 0) {
        return Math.round((parsed.total / parsed.caseQty) * 100) / 100;
      }
      // 3. If unitsPerCase and packPrice exist: unitsPerCase * packPrice
      if (parsed.unitsPerCase > 0 && parsed.packPrice > 0) {
        return Math.round((parsed.unitsPerCase * parsed.packPrice) * 100) / 100;
      }
      return 0;
    }
  },
  {
    id: 'profile_standard',
    name: 'Standard App Template',
    description: 'Fixed application spreadsheet format with explicit Pack Price and Case Price columns',
    columns: {
      itemCode: ['supplier product code', 'supplier code', 'product code', 'item code', 'sku', 'code'],
      description: ['description', 'product name', 'item description', 'name'],
      unitsPerCase: ['units per case', 'units/case', 'pack size qty', 'inner count'],
      packPrice: ['pack price', 'unit price', 'piece price', 'inner price'],
      casePrice: ['case price', 'box price', 'carton price'],
      total: ['total', 'line total'],
      packaging: ['packaging', 'pack size', 'uom', 'unit'],
      category: ['category', 'department']
    }
  },
  {
    id: 'profile_ht_group',
    name: 'Hare & Tortoise Group Price List',
    supplierId: 's_ht_internal',
    description: 'Direct mapping for Hare & Tortoise Group Excel: ITEMNO, ITEM DESCRIPTION, CASE PRICE. Skips category headers and order-by columns.',
    columns: {
      itemCode: ['itemno', 'item no', 'item no.', 'item code', 'itemcode', 'code', 'sku'],
      description: ['item description', 'description', 'name', 'product name'],
      casePrice: ['case price', 'caseprice', 'pricebox', 'price box'],
      packPrice: ['priceunit', 'price unit', 'pack price', 'unit price'],
      packaging: ['packsize', 'pack size', 'size', 'uom'],
      category: ['category', 'chinesename', 'chinese name']
    },
    deriveCasePrice: (row, parsed) => {
      // For Hare & Tortoise Group, CASE PRICE is read directly
      if (parsed.casePrice && parsed.casePrice > 0) return parsed.casePrice;
      const rawPrice = row['CASE PRICE'] || row['Case Price'] || row['PRICE'] || row['Price'];
      if (rawPrice !== undefined) {
        const p = parseFloat(String(rawPrice).replace(/[^0-9.-]/g, ''));
        if (!isNaN(p) && p > 0) return p;
      }
      if (parsed.packPrice > 0 && parsed.unitsPerCase > 0) return Math.round(parsed.packPrice * parsed.unitsPerCase * 100) / 100;
      return 0;
    }
  },
  {
    id: 'profile_four_seasons',
    name: 'Four Seasons / Fresh Produce Price List',
    supplierId: 's_fskong',
    description: 'Mapping for Four Seasons & fresh produce: handles multi-column product sheets, handwritten notes, pack specifications',
    columns: {
      itemCode: ['item code', 'code', 'ref', 'sku', 'item no', 'no.'],
      description: ['description', 'item description', 'produce', 'item', 'product'],
      casePrice: ['case price', 'box price', 'crate price', 'price', 'cost'],
      packPrice: ['pack price', 'unit price', 'kg price', 'per kg', 'per bunch'],
      packaging: ['packaging', 'pack size', 'crate', 'box', 'uom', 'weight']
    }
  },
  {
    id: 'profile_jfc',
    name: 'JFC International Price List',
    supplierId: 's_jfc',
    description: 'Mapping for JFC item catalogues and price notifications',
    columns: {
      itemCode: ['item code', 'item no', 'itemno', 'product code', 'sku', 'code'],
      description: ['description', 'item description', 'product name', 'name'],
      unitsPerCase: ['pack/size', 'units', 'case pack'],
      casePrice: ['case price', 'price', 'unit price', 'cost'],
      packPrice: ['pack price', 'piece price'],
      packaging: ['pack size', 'spec', 'uom']
    }
  },
  {
    id: 'profile_harro',
    name: 'Harro Foods Ltd Price List',
    supplierId: 's_harro',
    description: 'Mapping for Harro Foods catalogues',
    columns: {
      itemCode: ['code', 'item code', 'product code', 'ref'],
      description: ['product description', 'description', 'name'],
      casePrice: ['case price', 'price', 'trade price'],
      packPrice: ['unit price', 'pack price'],
      packaging: ['pack size', 'size', 'uom']
    }
  }
];

const LOCAL_STORAGE_KEY = 'app_supplier_import_profiles_v1';

export function getSavedImportProfiles(): ColumnMappingProfile[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return BUILT_IN_IMPORT_PROFILES;
    const custom: ColumnMappingProfile[] = JSON.parse(raw);
    // R08 FIX: Re-hydrate deriveCasePrice function from serializable formulaId
    const hydratedCustom = custom.map(p => ({
      ...p,
      deriveCasePrice: p.deriveCasePrice || resolveDeriveCasePrice(p.formulaId || 'AUTO_BEST_EFFORT')
    }));
    // Combine built-in with custom, custom overrides matching id
    const customIds = new Set(hydratedCustom.map(c => c.id));
    const combined = [
      ...hydratedCustom,
      ...BUILT_IN_IMPORT_PROFILES.filter(b => !customIds.has(b.id))
    ];
    return combined;
  } catch {
    return BUILT_IN_IMPORT_PROFILES;
  }
}

export function saveImportProfile(profile: ColumnMappingProfile): void {
  try {
    const current = getSavedImportProfiles();
    const filtered = current.filter(p => p.id !== profile.id);
    filtered.push(profile);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.warn('Failed to save profile to localStorage:', err);
  }
}

export function findProfileForSupplier(supplierId: string | undefined, sampleHeadersOrFilename?: string): ColumnMappingProfile {
  const profiles = getSavedImportProfiles();
  if (supplierId) {
    const matched = profiles.find(p => p.supplierId === supplierId);
    if (matched) return matched;
  }
  if (sampleHeadersOrFilename) {
    const lower = sampleHeadersOrFilename.toLowerCase();
    if (lower.includes('hare') || lower.includes('tortoise') || lower.includes('order by case') || lower.includes('order by piece')) {
      const ht = profiles.find(p => p.id === 'profile_ht_group');
      if (ht) return ht;
    }
    if (lower.includes('four seasons') || lower.includes('fourseasons') || lower.includes('four season') || lower.includes('fskong')) {
      const fs = profiles.find(p => p.id === 'profile_four_seasons');
      if (fs) return fs;
    }
    if (lower.includes('tazaki')) {
      const taz = profiles.find(p => p.id === 'profile_tazaki');
      if (taz) return taz;
    }
    if (lower.includes('jfc')) {
      const jfc = profiles.find(p => p.id === 'profile_jfc');
      if (jfc) return jfc;
    }
    if (lower.includes('harro')) {
      const harro = profiles.find(p => p.id === 'profile_harro');
      if (harro) return harro;
    }
  }
  return profiles.find(p => p.id === 'profile_tazaki') || profiles[0];
}

/**
 * Generates and downloads the Solution A Standard Excel Template (.xlsx)
 */
export function downloadStandardTemplate(): void {
  const templateData = [
    {
      'Supplier Product Code': 'YK84001A',
      'Description': 'Yutaka Edamame 500g',
      'Units per Case': 10,
      'Pack Price': 1.47,
      'Case Price': 14.70,
      'Packaging': '10x500g',
      'Category': 'Frozen Food',
      'Currency': 'GBP',
      'Effective Date': '2026-01-26'
    },
    {
      'Supplier Product Code': 'F0553',
      'Description': 'House Java Curry 1kg',
      'Units per Case': 20,
      'Pack Price': 6.85,
      'Case Price': 137.00,
      'Packaging': '20x1kg',
      'Category': 'Dry Goods',
      'Currency': 'GBP',
      'Effective Date': '2026-01-26'
    },
    {
      'Supplier Product Code': 'R1330',
      'Description': 'Nanohana 500g',
      'Units per Case': 20,
      'Pack Price': 1.42,
      'Case Price': 28.40,
      'Packaging': '20x500g',
      'Category': 'Frozen Food',
      'Currency': 'GBP',
      'Effective Date': '2026-01-26'
    },
    {
      'Supplier Product Code': 'Q0052',
      'Description': 'Ajinomoto Chicken & Vegetable Gyoza',
      'Units per Case': 10,
      'Pack Price': 4.20,
      'Case Price': 42.00,
      'Packaging': '10x600g',
      'Category': 'Frozen Food',
      'Currency': 'GBP',
      'Effective Date': '2026-01-26'
    },
    {
      'Supplier Product Code': 'Q0156',
      'Description': 'Ajinomoto Chicken & Vegetable Gyoza (Special)',
      'Units per Case': 10,
      'Pack Price': 4.60,
      'Case Price': 46.00,
      'Packaging': '10x600g',
      'Category': 'Frozen Food',
      'Currency': 'GBP',
      'Effective Date': '2026-01-26'
    }
  ];

  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PriceListTemplate');
  
  // Set column widths
  ws['!cols'] = [
    { wch: 22 }, // Supplier Product Code
    { wch: 35 }, // Description
    { wch: 15 }, // Units per Case
    { wch: 12 }, // Pack Price
    { wch: 12 }, // Case Price
    { wch: 14 }, // Packaging
    { wch: 16 }, // Category
    { wch: 10 }, // Currency
    { wch: 14 }, // Effective Date
  ];

  XLSX.writeFile(wb, 'Supplier_Price_List_Standard_Template.xlsx');
}
