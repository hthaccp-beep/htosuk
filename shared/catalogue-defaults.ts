import type {Product,Category,Branch} from '../types.ts';
import {decodeCSVText} from './product-csv.ts';

export type CatalogueDefaults={categoryId?:string;branchScope?:'ALL'|'SELECTED';branchIds?:string[]};
/** Resolve only genuine new rows. Existing identities and restrictions never
 * receive upload defaults; names are not used to guess a product identity. */
export function prepareCatalogueDefaults(rows:Record<string,string>[],supplierId:string,products:Product[],categories:Category[],branches:Branch[],defaults:CatalogueDefaults={}){
 if(!defaults||typeof defaults!=='object'||Array.isArray(defaults)||Object.keys(defaults).some(k=>!['categoryId','branchScope','branchIds'].includes(k)))throw new Error('Invalid new-product choices.');
 if(defaults.categoryId&&!categories.some(c=>c.id===defaults.categoryId&&(!c.supplierId||c.supplierId===supplierId)))throw new Error('Choose a category for this supplier.');
 if(defaults.branchScope&&!['ALL','SELECTED'].includes(defaults.branchScope))throw new Error('Choose all permitted branches or selected branches.');
 if(defaults.branchIds!==undefined&&(!Array.isArray(defaults.branchIds)||defaults.branchIds.some(id=>!branches.some(b=>b.id===id))))throw new Error('Choose valid branches.');
 if(defaults.branchScope==='SELECTED'&&!defaults.branchIds?.length)throw new Error('Select at least one branch for new products.');
 const needed:Array<{row:number;name:string;category:boolean;branches:boolean}>=[];
 const prepared=rows.map((input,index)=>{
  const row={...input};
  const code=decodeCSVText(row.ItemCode?.trim()||'').toUpperCase();
  const existing=!!row.SystemID?.trim()||!!code&&products.some(p=>!p.removedAt&&p.supplierId===supplierId&&p.itemCode?.trim().toUpperCase()===code);
  if(existing)return row;
  const missingCategory=!row.Category?.trim()&&!row.CategoryID?.trim();
  const missingBranches=!row.BranchScope?.trim()&&!row.AllowedBranchIds?.trim()&&!branches.some(b=>Object.entries(row).some(([key,value])=>[b.code,b.name].some(n=>n.toLowerCase()===key.toLowerCase())&&!!value.trim()));
  if(missingCategory&&defaults.categoryId)row.CategoryID=defaults.categoryId;
  if(missingBranches&&defaults.branchScope){
   row.BranchScope=defaults.branchScope;
   if(defaults.branchScope==='SELECTED'){
    // Replace blank branch cells by code, never append ambiguous name aliases.
    for(const branch of branches){const key=Object.keys(row).find(k=>[branch.code,branch.name].some(n=>n.toLowerCase()===k.toLowerCase()))||branch.code;row[key]=defaults.branchIds!.includes(branch.id)?'Yes':'No';}
   }
  }
  const category=missingCategory&&!defaults.categoryId,availability=missingBranches&&!defaults.branchScope;
  if(category||availability)needed.push({row:index+2,name:decodeCSVText(row.Name||'New product'),category,branches:availability});
  return row;
 });
 return {rows:prepared,needed};
}
