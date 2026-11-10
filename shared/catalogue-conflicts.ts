import type {Product} from '../types.ts';
import {decodeCSVText} from './product-csv.ts';

export interface CatalogueChoice {rowNumber:number;productId:string}
export interface CatalogueConflict {
 rowNumber:number;
 incoming:{systemId:string;itemCode:string;name:string;packSize:string;casePrice:string;packPrice:string};
 candidates:Pick<Product,'id'|'name'|'chineseName'|'itemCode'|'packSize'|'casePrice'|'packPrice'|'active'>[];
}
const codeKey=(code:string|undefined)=>(code||'').trim().toUpperCase();

export function validateCatalogueChoices(value:unknown,rowCount:number):CatalogueChoice[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>rowCount||value.some(c=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['rowNumber','productId'].includes(k))||!Number.isInteger(c.rowNumber)||c.rowNumber<2||c.rowNumber>rowCount+1||typeof c.productId!=='string'||!c.productId||c.productId.length>128)||new Set(value.map(c=>c.rowNumber)).size!==value.length)throw new Error('Invalid product choices. Select the CSV again and review the conflicts.');
 return value;
}

/** Pure review: candidates come only from the chosen supplier, never from client records. */
export function resolveCatalogueConflicts(rows:Record<string,string>[],supplierId:string,products:Product[],choices:CatalogueChoice[]=[]){
 validateCatalogueChoices(choices,rows.length);
 const catalogue=products.filter(p=>!p.removedAt&&p.supplierId===supplierId);
 const conflicts:CatalogueConflict[]=[];
 rows.forEach((row,index)=>{
  const systemId=row.SystemID?.trim()||'',original=catalogue.find(p=>p.id===systemId);
  // An unknown/foreign SystemID is an error for the normal validator, never a match suggestion.
  if(systemId&&!original)return;
  const itemCode=decodeCSVText(row.ItemCode?.trim()||'')||original?.itemCode||'';
  const matches=itemCode?catalogue.filter(p=>codeKey(p.itemCode)===codeKey(itemCode)):[];
  const candidates=original?[original,...matches.filter(p=>p.id!==original.id)]:matches;
  if(candidates.length<2)return;
  conflicts.push({rowNumber:index+2,incoming:{systemId,itemCode,name:decodeCSVText(row.Name||''),packSize:decodeCSVText(row.PackSize||''),casePrice:row.PriceBox||'',packPrice:row.PriceUnit||''},candidates:candidates.map(p=>({id:p.id,name:p.name,chineseName:p.chineseName||'',itemCode:p.itemCode||'',packSize:p.packSize||'',casePrice:p.casePrice,packPrice:p.packPrice,active:p.active}))});
 });
 const resolvedRows=rows.map(r=>({...r})),reviewedIds=new Set<string>(),protectedIds=new Set<string>();
 const selections=choices.map(choice=>{
  const conflict=conflicts.find(c=>c.rowNumber===choice.rowNumber);
  const product=conflict?.candidates.find(p=>p.id===choice.productId);
  if(!conflict||!product)throw new Error(`Row ${choice.rowNumber}: choose one of the conflicting products for this supplier.`);
  const row=resolvedRows[choice.rowNumber-2];row.SystemID=product.id;
  // Keep the chosen identity/code. A conflict choice must never transfer a code to another product.
  row.ItemCode=''; // Blank catalogue cells preserve the selected product's exact saved code.
  reviewedIds.add(product.id);conflict.candidates.forEach(p=>protectedIds.add(p.id));
  return {rowNumber:choice.rowNumber,productId:product.id,name:product.name,itemCode:product.itemCode||'',csvSystemId:conflict.incoming.systemId,csvItemCode:conflict.incoming.itemCode};
 });
 return {rows:resolvedRows,conflicts,unresolved:conflicts.filter(c=>!choices.some(choice=>choice.rowNumber===c.rowNumber)),reviewedIds,protectedIds,selections};
}
