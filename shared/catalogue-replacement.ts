import type {Product} from '../types.ts';
import {decodeCSVText} from './product-csv.ts';
import {CatalogueValidationError,type CatalogueIssue} from './catalogue-errors.ts';

/** A complete exported catalogue is authoritative; only explicit saved IDs are reused. */
export function validateReplacementRows(rows:Record<string,string>[]){
 if(!rows.length||rows.length>240)throw new Error('Use one complete catalogue with 1 to 240 rows. Do not split a replacement into partial files.');
 const ids=new Set<string>(),codes=new Map<string,number>();
 const issues:CatalogueIssue[]=[];
 rows.forEach((row,index)=>{
  const number=index+2;
  if(!['SystemID','ItemCode','Name','Active'].every(key=>Object.hasOwn(row,key))||!row.Name?.trim()||!['true','false','yes','no','y','n','1','0'].includes(row.Active?.trim().toLowerCase()))issues.push({row:number,field:'Name / Active',message:`Row ${number}: replacement needs the complete HTOS export with Name and Active filled in. Use bulk editing for partial updates.`});
  const id=row.SystemID?.trim(),code=decodeCSVText(row.ItemCode?.trim()||'').toUpperCase();
  if(id&&ids.has(id))issues.push({row:number,field:'SystemID',message:`Row ${number}: this Product ID appears twice in the CSV. Keep one row per product.`});
  if(id)ids.add(id);
  if(code&&codes.has(code))issues.push({row:number,field:'ItemCode',message:`Rows ${codes.get(code)} and ${number}: duplicate ItemCode ${code} in the CSV. Keep one row per supplier product.`});
  if(code)codes.set(code,number);
  // Supplier codes are optional in the original 2027 template. Blank SystemID
  // means a new product, never a guessed name match; its ID is assigned at save.
 });
 if(issues.length)throw new CatalogueValidationError(issues,'file');
}

export function prepareCatalogueReplacement(rows:Record<string,string>[],supplierId:string,products:Product[]){
 validateReplacementRows(rows);
 const ids=new Set(rows.map(row=>row.SystemID?.trim()).filter(Boolean));
 const issues:CatalogueIssue[]=[];
 rows.forEach((row,index)=>{if(row.SystemID?.trim()&&!products.some(p=>p.id===row.SystemID.trim()&&p.supplierId===supplierId))issues.push({row:index+2,field:'SystemID',message:`Row ${index+2}: SystemID does not belong to this supplier. Use its HTOS export; leave SystemID blank only for a new product.`});});
 // Omitted records remain available to historical references, but cannot interfere with this list.
 const retained=products.filter(p=>p.supplierId===supplierId&&ids.has(p.id));
 const codes=new Set<string>();
 for(const [index,row] of rows.entries()){
  const code=decodeCSVText(row.ItemCode?.trim()||'')||retained.find(p=>p.id===row.SystemID?.trim())?.itemCode||'';
  const key=code.trim().toUpperCase();
  if(key&&codes.has(key))issues.push({row:index+2,field:'ItemCode',message:`Row ${index+2}: Duplicate ItemCode ${code} in the replacement list. Keep one row per supplier product.`});
  if(key)codes.add(key);
 }
 if(issues.length)throw new CatalogueValidationError(issues);
 return {rows,products:retained};
}
