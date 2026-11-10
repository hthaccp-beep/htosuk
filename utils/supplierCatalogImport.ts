import Papa from 'papaparse';
import {applyCataloguePositions} from '../shared/catalogue-position.ts';
import type { Branch, Category, Product } from '../types.ts';
import {productCSVBase,productCSVExtra,productCSVLegacy,productCSVTechnical,decodeCSVText} from '../shared/product-csv.ts';
import {CatalogueValidationError,catalogueIssue,type CatalogueIssue} from '../shared/catalogue-errors.ts';
import {collectCatalogueFileIssues,csvNumber as numeric,csvBoolean as booleanValue} from '../shared/catalogue-file-validation.ts';

// One commit, including new categories. Larger files must be split before review.
export const MAX_CATALOG_IMPORT_WRITES = 450;
export interface CatalogImportPlan {
  categories: Category[];
  creates: Product[];
  updates: { id: string; changes: Partial<Product> }[];
  unchanged: number;
  untouched: number;
  rowNumbers?: Record<string, number>;
  orderPreview?: {id:string;name:string;before:number|null;after:number;inFile:boolean}[];
}

export function parseSupplierCatalogCSV(text: string): Record<string, string>[] {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
    delimiter: ',',
  });
  if (result.errors.length) throw new CatalogueValidationError(result.errors.map(error=>({...(error.row!==undefined?{row:error.row+1}:{}),message:`The CSV has invalid quoting or formatting: ${error.message}. Fix the file structure before checking product values.`})),'structure');
  const [rawHeaders, ...data] = result.data;
  if (!rawHeaders || data.length === 0) throw new Error('The CSV contains no product rows.');
  const canonical=[...productCSVBase,...productCSVExtra,...productCSVLegacy,...productCSVTechnical];
  const headers = rawHeaders.map(h => canonical.find(k=>k.toLowerCase()===h.trim().toLowerCase())||h.trim());
  const headingIssues=headers.flatMap((h,index)=>!h||headers.indexOf(h)!==index?[{row:1,field:`Column ${index+1}`,message:`CSV headings must be non-empty and unique. Column ${index+1} ${h?`repeats ${h}`:'has no heading'}.`}]:[]);
  if(headingIssues.length)throw new CatalogueValidationError(headingIssues,'structure');
  if (!headers.includes('SystemID') && !headers.includes('ItemCode')) {
    throw new Error('Use the exported product CSV format with SystemID or ItemCode.');
  }
  const issues:CatalogueIssue[]=[];
  const rows=data.map((values, index) => {
    if (values.length !== headers.length) issues.push({row:index+2,message:`CSV row ${index + 2} has the wrong number of columns (${values.length}; expected ${headers.length}).`});
    return Object.fromEntries(headers.map((h, i) => [h, (values[i]||'').trim()]));
  });
  if(issues.length)throw new CatalogueValidationError(issues,'structure');
  return rows;
}

/** Builds a validated, non-destructive plan. This function never writes to storage. */
export function planSupplierCatalogImport(args: {
  rows: Record<string, string>[];
  supplierId: string;
  products: Product[];
  categories: Category[];
  branches: Branch[];
  newId: () => string;
  reviewedConflictIds?: ReadonlySet<string>;
  allowUncodedCreates?: boolean;
  checkUncodedDuplicates?: boolean;
  useRowOrder?: boolean;
  appendNew?: boolean;
}): CatalogImportPlan {
  const { rows, supplierId, products, categories, branches, newId } = args;
  if (!supplierId || !rows.length) throw new Error('Choose a supplier and a non-empty product CSV.');
  const issues=collectCatalogueFileIssues(rows,supplierId,branches);
  const plan: CatalogImportPlan = { categories: [], creates: [], updates: [], unchanged: 0, untouched: 0, rowNumbers: {} };
  const localCategories = [...categories];
  const supplierProducts = products.filter(p => !p.removedAt && p.supplierId === supplierId);
  const touchedIds = new Set<string>();
  const touchedRows = new Map<string, number>();
  const uncodedNames = new Map<string, number>();
  const seenCodes = new Set<string>();
  const normalizeCode = (code: string | undefined) => (code || '').trim().toUpperCase();
  const activeBranches = branches.filter(b => b.active);

  const known = new Set<string>([...productCSVBase,...productCSVExtra,...productCSVLegacy,...productCSVTechnical,...branches.flatMap(b=>[b.code,b.name])].map(h=>h.toLowerCase()));
  const unknown = Object.keys(rows[0]).filter(h=>!known.has(h.toLowerCase()));
  if(unknown.length) issues.push({field:'Headings',message:`Unrecognised columns: ${unknown.join(', ')}. Use the product export template so no details are silently skipped.`});

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    // The editor's existing 300-character limit also applies to changed text
    // on saved products. Report every such field before dependent row checks.
    const candidates=row.SystemID?.trim()?supplierProducts.filter(p=>p.id===row.SystemID.trim()):supplierProducts.filter(p=>!!row.ItemCode?.trim()&&normalizeCode(p.itemCode)===normalizeCode(decodeCSVText(row.ItemCode.trim())));
    if(candidates.length===1)for(const [heading,field] of [['Name','name'],['ChineseName','chineseName'],['ItemCode','itemCode'],['PackSize','packSize'],['CaseUnitName','caseUnitName'],['PackUnitName','packUnitName']] as const){
      const value=decodeCSVText(row[heading]?.trim()||'');
      if(value&&value!==candidates[0][field]&&value.length>300)issues.push({row:rowNumber,field:heading,message:`Row ${rowNumber}: ${heading} must be at most 300 characters when updating a saved product.`});
    }
    // Category identity is independent of product matching and other cell errors.
    if(!row.Category?.trim()&&row.CategoryID?.trim()&&!categories.some(c=>c.id===row.CategoryID&&(!c.supplierId||c.supplierId===supplierId)))
      issues.push({row:rowNumber,field:'CategoryID',message:`Row ${rowNumber}: CategoryID does not belong to this supplier.`});
    try {
    const systemId = row.SystemID?.trim();
    const code = decodeCSVText(row.ItemCode?.trim()||'');
    let existing: Product | undefined;
    if (systemId) {
      existing = products.find(p => p.id === systemId);
      if (existing?.removedAt) throw new Error(`Row ${rowNumber}: this product was deleted. Remove its SystemID only if you intend to add a new product.`);
      if (!existing || existing.supplierId !== supplierId) {
        throw new Error(`Row ${rowNumber}: SystemID does not belong to an existing product for this supplier. Remove it only when deliberately adding a new product.`);
      }
    } else if (code) {
      const matches = supplierProducts.filter(p => normalizeCode(p.itemCode) === normalizeCode(code));
      if (matches.length > 1) throw new Error(`Row ${rowNumber}: duplicate catalogue code ${code}; use a reviewed SystemID.`);
      existing = matches[0];
    } else if (!args.allowUncodedCreates) {
      throw new Error(`Row ${rowNumber}: provide SystemID or ItemCode. Names alone cannot identify products.`);
    }
    if (existing && touchedIds.has(existing.id)) throw new Error(`Rows ${touchedRows.get(existing.id)} and ${rowNumber}: this product appears more than once. Keep one row with its SystemID and the details you want to save.`);
    // Never guess identity from a name. A repeated uncoded upload must not silently
    // create another product; an export supplies the saved ID for the next update.
    if (args.checkUncodedDuplicates && !existing && !code && row.Name?.trim()) {
      const nameKey = decodeCSVText(row.Name.trim()).toLocaleLowerCase('en-GB').replace(/\s+/g, ' ');
      if (supplierProducts.some(p => p.name.trim().toLocaleLowerCase('en-GB').replace(/\s+/g, ' ') === nameKey)) {
        throw new Error(`Row ${rowNumber}: a product with this name already exists for this supplier. Export the catalogue and keep its SystemID to update it, or provide a distinct name/code for a different product.`);
      }
      if (uncodedNames.has(nameKey)) throw new Error(`Rows ${uncodedNames.get(nameKey)} and ${rowNumber}: new products without codes have the same name. Keep one row or give different products distinct names/codes.`);
      uncodedNames.set(nameKey, rowNumber);
    }
    const effectiveCode = code || existing?.itemCode;
    if (effectiveCode) {
      const normalized = normalizeCode(effectiveCode);
      const reviewedUnchangedCode=!!existing&&args.reviewedConflictIds?.has(existing.id)&&normalizeCode(existing.itemCode)===normalized;
      if (seenCodes.has(normalized)&&!reviewedUnchangedCode) throw new Error(`Row ${rowNumber}: duplicate ItemCode ${effectiveCode}.`);
      if (code && !reviewedUnchangedCode && supplierProducts.some(p => p.id !== existing?.id && normalizeCode(p.itemCode) === normalized)) {
        throw new Error(`Row ${rowNumber}: ItemCode ${code} already belongs to another product for this supplier.`);
      }
      seenCodes.add(normalized);
    }
    if (existing) { touchedIds.add(existing.id); touchedRows.set(existing.id, rowNumber); }
    if (!existing && ((!code && !args.allowUncodedCreates) || !row.Name?.trim())) throw new Error(`Row ${rowNumber}: new products require ${args.allowUncodedCreates ? 'Name' : 'ItemCode and Name'}.`);

    const changes: Partial<Product> = {};
    for (const [heading, field] of [
      ['Name', 'name'], ['ItemCode', 'itemCode'], ['ChineseName', 'chineseName'], ['PackSize', 'packSize'], ['CaseUnitName','caseUnitName'], ['PackUnitName','packUnitName'],
    ] as const) {
      // Empty cells preserve existing values. Clearing fields is an explicit product edit.
      if (row[heading]?.trim()) changes[field] = decodeCSVText(row[heading].trim());
    }
    for (const [heading, field] of [
      ['PriceBox', 'casePrice'], ['PriceUnit', 'packPrice'], ['DisplayOrder', 'displayOrder'], ['VATRate','vatRate'], ['MinParLevel','minParLevel'], ['TargetParLevel','targetParLevel'], ['CataloguePosition','cataloguePosition'],
    ] as const) {
      if (row[heading]?.trim() && !(args.useRowOrder && ['DisplayOrder','CataloguePosition'].includes(heading))) changes[field] = numeric(row[heading].trim(), heading, rowNumber);
    }
    if (row.Active?.trim()) changes.active = booleanValue(row.Active.trim(), 'Active', rowNumber);
    if(!args.useRowOrder&&row.CSVVersion!=='2'&&row.Position?.trim() && !row.CataloguePosition?.trim()) changes.cataloguePosition=numeric(row.Position,'Position',rowNumber);
    if(changes.cataloguePosition!==undefined && (!Number.isInteger(changes.cataloguePosition)||changes.cataloguePosition<1)) throw new Error(`Row ${rowNumber}: CataloguePosition must be a whole number starting at 1.`);
    if(changes.vatRate!==undefined && changes.vatRate>1) throw new Error(`Row ${rowNumber}: VATRate uses decimals, for example 0.20 for 20%.`);
    if(row.UnitType?.trim()){
      if(!['DUAL','CASE_ONLY','PACK_ONLY'].includes(row.UnitType)) throw new Error(`Row ${rowNumber}: UnitType must be DUAL, CASE_ONLY or PACK_ONLY.`);
      changes.unitType=row.UnitType as Product['unitType'];
    }

    const suppliedCategoryName = decodeCSVText(row.Category?.trim()||'');
    const existingCategory = existing && categories.find(c => c.id === existing.categoryId);
    // Older HTOS exports used this placeholder for missing category links.
    // Preserve those links rather than silently creating/assigning a category.
    const legacyPlaceholder = !!existing && !existingCategory && !row.CategoryID?.trim() &&
      ['uncategorized','uncategorised'].includes(suppliedCategoryName.toLowerCase());
    const categoryName = legacyPlaceholder ? '' : suppliedCategoryName;
    const categoryMatches = (c: Category) => c.name.toLowerCase() === categoryName.toLowerCase() && (c.supplierId === supplierId || !c.supplierId);
    // Equal category names may exist globally and for individual suppliers.
    // An unchanged name must retain this product's original category identity.
    let category = categoryName ? (existingCategory && categoryMatches(existingCategory) ? existingCategory : localCategories.find(categoryMatches)) : undefined;
    if (categoryName && !category) {
      category = { id: newId(), name: categoryName, supplierId, active: true, displayOrder: 9999 };
      localCategories.push(category);
      plan.categories.push(category);
    }
    if (category) changes.categoryId = category.id;
    if(!categoryName && row.CategoryID?.trim()){
      if(!localCategories.some(c=>c.id===row.CategoryID&&(!c.supplierId||c.supplierId===supplierId))) throw new Error(`Row ${rowNumber}: CategoryID does not belong to this supplier.`);
      changes.categoryId=row.CategoryID;
    }

    const scope=row.BranchScope?.trim().toUpperCase();
    if(scope&&!['ALL','SELECTED'].includes(scope)) throw new Error(`Row ${rowNumber}: BranchScope must be ALL or SELECTED.`);
    const fileBranches=scope?branches:activeBranches;
    const branchValues = fileBranches.map(b => {
      const key = Object.keys(row).find(k => k.toLowerCase() === b.code.toLowerCase() || k.toLowerCase() === b.name.toLowerCase());
      return { branch: b, value: key ? row[key]?.trim() : undefined };
    });
    if (branchValues.some(b => b.value)) {
      if (branchValues.some(b => !b.value)) throw new Error(`Row ${rowNumber}: provide Yes/No for every active branch to change availability, or leave all branch cells blank.`);
      const allowed = branchValues.filter(b => booleanValue(b.value!, b.branch.code, rowNumber)).map(b => b.branch.id);
      if (!allowed.length && (scope==='SELECTED' || (changes.active ?? existing?.active ?? true))) {
        throw new Error(`Row ${rowNumber}: select at least one branch for SELECTED availability. An empty branch list means all branches in this app.`);
      }
      if(scope==='ALL' && allowed.length!==fileBranches.length) throw new Error(`Row ${rowNumber}: use BranchScope SELECTED when any branch is No.`);
      changes.allowedBranchIds = scope==='SELECTED'?allowed:allowed.length === fileBranches.length ? [] : allowed;
    } else if(row.AllowedBranchIds?.trim()) {
      const ids=row.AllowedBranchIds==='*'?[]:row.AllowedBranchIds.split('|').map(s=>s.trim()).filter(Boolean);
      if(ids.some(id=>!branches.some(b=>b.id===id))) throw new Error(`Row ${rowNumber}: AllowedBranchIds contains an unknown branch.`);
      if(scope==='SELECTED'&&!ids.length)throw new Error(`Row ${rowNumber}: select at least one branch for SELECTED availability.`);
      changes.allowedBranchIds=ids;
    } else if(scope==='ALL') changes.allowedBranchIds=[];
    else if(scope==='SELECTED') {
      throw new Error(`Row ${rowNumber}: provide Yes/No branch columns for SELECTED availability.`);
    }

    if (existing) {
      plan.rowNumbers![existing.id] = rowNumber;
      const changedFields = Object.fromEntries(Object.entries(changes).filter(([key, value]) =>
        key==='allowedBranchIds' ? JSON.stringify([...(existing.allowedBranchIds||[])].sort())!==JSON.stringify([...(value as string[])].sort()) : JSON.stringify(existing[key as keyof Product]) !== JSON.stringify(value)
      ));
      if (Object.keys(changedFields).length) plan.updates.push({ id: existing.id, changes: changedFields });
      else plan.unchanged++;
    } else {
      const categoryId = changes.categoryId || localCategories.find(c => c.supplierId === supplierId || !c.supplierId)?.id;
      if (!categoryId) throw new Error(`Row ${rowNumber}: choose a Category for the new product.`);
      const id = newId();
      plan.rowNumbers![id] = rowNumber;
      plan.creates.push({
        id, supplierId, categoryId, name: decodeCSVText(row.Name.trim()), itemCode: code,
        displayOrder: 9999, allowedBranchIds: [], active: true, ...changes,
      });
    }
    } catch(error) { issues.push(catalogueIssue(error)); }
  });
  plan.untouched = supplierProducts.filter(p => !touchedIds.has(p.id)).length;
  if(!issues.length&&(args.useRowOrder||args.appendNew&&plan.creates.length||rows.some(r=>r.CSVVersion==='2')))
    applyCataloguePositions(plan,supplierProducts,categories,rows,args.useRowOrder);
  if (plan.categories.length + plan.creates.length + plan.updates.length > MAX_CATALOG_IMPORT_WRITES) {
    issues.push({message:`This import exceeds ${MAX_CATALOG_IMPORT_WRITES} changes including categories. Split it into smaller files; nothing has been saved.`});
  }
  if(issues.length)throw new CatalogueValidationError(issues);
  return plan;
}

/** Enforces one commit and exposes no delete operation to the importer. */
export async function commitSupplierCatalogImport(plan: CatalogImportPlan, writer: {
  createCategory(category: Category): void;
  createProduct(product: Product): void;
  updateProduct(id: string, changes: Partial<Product>): void;
  commit(): Promise<unknown>;
}): Promise<void> {
  const count = plan.categories.length + plan.creates.length + plan.updates.length;
  if (count === 0) return;
  if (count > MAX_CATALOG_IMPORT_WRITES) throw new Error('The import is too large for one safe save.');
  plan.categories.forEach(category => writer.createCategory(category));
  plan.creates.forEach(product => writer.createProduct(product));
  plan.updates.forEach(product => writer.updateProduct(product.id, product.changes));
  await writer.commit();
}
