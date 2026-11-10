
import { Product, Category, Branch } from '../types';
import {productCSVEditable,productCSVExtra,productCSVTechnical} from '../shared/product-csv';
import {productSequence} from '../shared/product-workbench';

export const parseCSVLine = (line: string): string[] => {
  const values: string[] = [];
  let cur = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        cur += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  values.push(cur.trim());
  return values;
};

export const parseCSV = (csvText: string): Record<string, string>[] => {
  // 1. Sanitize text: Remove BOM, normalize newlines
  const cleanText = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleanText.split('\n').filter(line => line.trim() !== '');
  
  if (lines.length < 2) return [];

  // 2. Header parsing using robust parser
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const result: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const currentLine = lines[i];
    const values = parseCSVLine(currentLine);
    
    // Pad values if row is short
    while (values.length < headers.length) {
      values.push('');
    }

    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      let val = values[index] !== undefined ? values[index] : '';
      // Unquote: "Data" -> Data
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      // Unescape double quotes: "" -> "
      val = val.replace(/""/g, '"');
      
      if (header) {
        obj[header] = val;
      }
    });
    result.push(obj);
  }
  return result;
};

export const generateProductCSV = (products: Product[], categories: Category[], branches: Branch[]): string => {
  // Sort branches to ensure consistent column order
  const sortedBranches = [...branches].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const branchHeaders = sortedBranches.map(b => b.code);

  // Headers now include dynamic Branch Codes at the end
  const headers = [
    ...productCSVEditable, ...branchHeaders, ...productCSVExtra.filter(k=>!['CataloguePosition','BranchScope','SupplierID'].includes(k)), ...productCSVTechnical
  ];
  
  const rows = productSequence(products,categories).map((p,index) => {
    // A missing category is not a category named "Uncategorized". Blank cells
    // preserve the saved assignment on reimport, including legacy missing links.
    const catName = categories.find(c => c.id === p.categoryId)?.name || '';
    
    // R05: Escape fields and neutralize spreadsheet formula injection for text cells
    const escape = (val: string | undefined | number) => {
      if (val === undefined || val === null) return '';
      let str = String(val);
      // Neutralize formula injection (=, +, -, @, \t, \r) only for string fields
      if (typeof val === 'string' && /^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Calculate Branch Availability Columns
    const branchValues = sortedBranches.map(b => {
        const isAvailable = (p.allowedBranchIds||[]).length === 0 || (p.allowedBranchIds||[]).includes(b.id);
        return isAvailable ? 'Yes' : 'No';
    });

    return [
      index+1,
      escape(p.itemCode),
      escape(p.name),
      escape(p.chineseName),
      escape(catName),
      escape(p.packSize),
      p.casePrice ?? '',
      p.packPrice ?? '',
      p.active === undefined ? '' : p.active ? 'TRUE' : 'FALSE',
      (p.allowedBranchIds||[]).length ? 'SELECTED' : 'ALL',
      ...branchValues,
      p.vatRate ?? '', p.unitType ?? '', escape(p.caseUnitName), escape(p.packUnitName),
      p.minParLevel ?? '', p.targetParLevel ?? '',
      '2', escape(p.id), escape(p.supplierId)
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
};
