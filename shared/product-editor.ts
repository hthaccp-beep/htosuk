import type {Product} from '../types';
import {productFields} from './product-workbench';
export const productFieldLabels:Record<string,string>={name:'Product name',chineseName:'Chinese name',itemCode:'Supplier code',categoryId:'Category',packSize:'Pack size',casePrice:'Case price',packPrice:'Unit price',vatRate:'VAT rate',unitType:'Ordering units',caseUnitName:'Case label',packUnitName:'Unit label',active:'Active',allowedBranchIds:'Available branches',minParLevel:'Minimum stock',targetParLevel:'Target stock'};
export function changedProductFields(original:Product,values:Product){return productFields.filter(k=>JSON.stringify(original[k]??null)!==JSON.stringify(values[k]??null));}
export function moveProductRow<T extends {id:string}>(rows:T[],id:string,position:number){
 if(!Number.isFinite(position))return rows;const index=rows.findIndex(r=>r.id===id);if(index<0)return rows;
 const next=[...rows];const [row]=next.splice(index,1);next.splice(Math.max(0,Math.min(next.length,Math.floor(position)-1)),0,row);return next;
}
export function productEditorErrors(product:Product){
 const errors:string[]=[];
 if(!product.name?.trim())errors.push('Enter a product name.');
 if(!product.categoryId)errors.push('Choose a category.');
 for(const k of ['casePrice','packPrice','minParLevel','targetParLevel'] as const){const v=product[k];if(v!=null&&(!Number.isFinite(v)||v<0))errors.push(`${productFieldLabels[k]} must be zero or greater.`);}
 return errors;
}

export const bulkProductFields=['categoryId','casePrice','packPrice','vatRate','packSize','unitType','caseUnitName','packUnitName','active','minParLevel','targetParLevel'] as const;
export function bulkProductValue(field:string,raw:string):string|number|boolean{
 if(!bulkProductFields.includes(field as any))throw new Error('Choose a supported field.');
 const value=raw.trim();
 if(!value)throw new Error('Enter a value before applying it.');
 if(['casePrice','packPrice','vatRate','minParLevel','targetParLevel'].includes(field)){
  if(!/^\d+(\.\d+)?$/.test(value)||!Number.isFinite(Number(value)))throw new Error('Enter a number of zero or greater.');
  if(field==='vatRate'&&Number(value)>1)throw new Error('Use a decimal VAT rate, for example 0.20.');
  return Number(value);
 }
 if(field==='active'){if(!['true','false'].includes(value))throw new Error('Choose Active or Inactive.');return value==='true';}
 if(field==='unitType'&&!['DUAL','CASE_ONLY','PACK_ONLY'].includes(value))throw new Error('Choose valid ordering units.');
 return value;
}
