import type {Branch} from '../types.ts';
import {productCSVBase, productCSVExtra, productCSVLegacy, productCSVTechnical, decodeCSVText} from './product-csv.ts';
import {CatalogueValidationError, type CatalogueIssue} from './catalogue-errors.ts';

export function csvNumber(value: string, field: string, row: number): number {
  const plain = value.replace(/^£\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(plain))
    throw new Error(`Row ${row}: ${field} must be a non-negative number, for example 12.50.`);
  const number = Number(plain.replace(/,/g, ''));
  if (!Number.isFinite(number)) throw new Error(`Row ${row}: ${field} is too large.`);
  return number;
}
export function csvBoolean(value: string, field: string, row: number): boolean {
  if (['true','yes','y','1'].includes(value.toLowerCase())) return true;
  if (['false','no','n','0'].includes(value.toLowerCase())) return false;
  throw new Error(`Row ${row}: ${field} must contain Yes or No.`);
}

/** Checks every independent cell/row locally; never guesses saved product identities. */
export function collectCatalogueFileIssues(rows: Record<string,string>[], supplierId: string, branches?: Branch[], replacement = false): CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  const ids = new Map<string,number>(), codes = new Map<string,number>();
  const standard = new Set<string>([...productCSVBase,...productCSVExtra,...productCSVLegacy,...productCSVTechnical].map(h=>h.toLowerCase()));
  rows.forEach((row,index)=>{
    const number=index+2;
    const add=(field:string,message:string)=>issues.push({row:number,field,message:`Row ${number}: ${message}`});
    const attempt=<T,>(field:string,fn:()=>T):T|undefined=>{try{return fn();}catch(e){issues.push({row:number,field,message:(e as Error).message});}};
    if(row.SupplierID?.trim() && row.SupplierID.trim()!==supplierId)
      add('SupplierID','SupplierID does not match the selected supplier. Choose the correct supplier and keep the SupplierID column unchanged.');
    const id=row.SystemID?.trim(),code=decodeCSVText(row.ItemCode?.trim()||'').toUpperCase();
    if(row.CSVVersion?.trim()&&row.CSVVersion!=='2')add('CSVVersion','this CSV format is not supported. Use a current HTOS export.');
    if(row.CSVVersion==='2'&&(row.DisplayOrder?.trim()||row.CataloguePosition?.trim()))add('Position','use only Position in the new CSV format; remove legacy DisplayOrder and CataloguePosition values.');
    if(id && ids.has(id))add('SystemID',`this product appears more than once (also row ${ids.get(id)}). Keep one row with its SystemID and the details you want to save.`);
    if(id&&!ids.has(id))ids.set(id,number);
    // Existing distinct IDs may be legitimate reviewed catalogue conflicts.
    if(replacement&&code){
      if(codes.has(code))add('ItemCode',`duplicate ItemCode ${code} (also row ${codes.get(code)}). Keep one row per supplier product.`);
      else codes.set(code,number);
    }
    if(replacement && (!['SystemID','ItemCode','Name','Active'].every(key=>Object.hasOwn(row,key))||!row.Name?.trim()||!row.Active?.trim()))
      add('Name / Active','replacement needs the complete HTOS export with Name and Active filled in. Use bulk editing for partial updates.');
    for(const field of ['PriceBox','PriceUnit','DisplayOrder','VATRate','MinParLevel','TargetParLevel','CataloguePosition',...(!row.CataloguePosition?.trim()?['Position']:[])]){
      if(!row[field]?.trim())continue;
      const value=attempt(field,()=>csvNumber(row[field].trim(),field,number));
      if(value===undefined)continue;
      if(field==='VATRate'&&value>1)add(field,'VATRate uses decimals, for example 0.20 for 20%.');
      if(['Position','CataloguePosition'].includes(field)&&(!Number.isInteger(value)||value<1))add(field,'CataloguePosition must be a whole number starting at 1.');
    }
    if(row.Active?.trim())attempt('Active',()=>csvBoolean(row.Active.trim(),'Active',number));
    if(row.UnitType?.trim()&&!['DUAL','CASE_ONLY','PACK_ONLY'].includes(row.UnitType))add('UnitType','UnitType must be DUAL, CASE_ONLY or PACK_ONLY.');
    const scope=row.BranchScope?.trim().toUpperCase();
    if(scope&&!['ALL','SELECTED'].includes(scope))add('BranchScope','BranchScope must be ALL or SELECTED.');
    const fileBranches=branches?.filter(b=>scope||b.active);
    // Before catalogue access, non-standard headings are possible branch columns.
    // Their identity is verified against actual branches by the planner.
    const fields=fileBranches?fileBranches.map(b=>Object.keys(row).find(k=>[b.code,b.name].some(n=>n.toLowerCase()===k.toLowerCase()))||b.code):Object.keys(row).filter(k=>!standard.has(k.toLowerCase()));
    const filled=fields.filter(k=>row[k]?.trim());
    if(filled.length){
      if(fileBranches&&filled.length!==fields.length)add('Branches','provide Yes/No for every active branch to change availability, or leave all branch cells blank.');
      const values=filled.map(k=>attempt(k,()=>csvBoolean(row[k].trim(),k,number)));
      if(scope==='ALL'&&values.includes(false))add('BranchScope','use BranchScope SELECTED when any branch is No.');
      if(fileBranches && filled.length===fields.length && values.every(v=>v===false) && row.Active?.trim() && ['true','yes','y','1'].includes(row.Active.trim().toLowerCase()))
        add('Branches','select a branch or set Active to No. An empty branch list means all branches in this app.');
    }else if(scope==='SELECTED'&&!row.AllowedBranchIds?.trim())add('Branches','provide Yes/No branch columns for SELECTED availability.');
    if(fileBranches&&!filled.length&&row.AllowedBranchIds?.trim()&&row.AllowedBranchIds!=='*'&&row.AllowedBranchIds.split('|').map(s=>s.trim()).filter(Boolean).some(id=>!branches!.some(b=>b.id===id)))
      add('AllowedBranchIds','AllowedBranchIds contains an unknown branch.');
  });
  return issues;
}

export function validateCatalogueFile(rows:Record<string,string>[],supplierId:string,branches?:Branch[],replacement=false){
  const issues=collectCatalogueFileIssues(rows,supplierId,branches,replacement);
  if(issues.length)throw new CatalogueValidationError(issues,'file');
}
