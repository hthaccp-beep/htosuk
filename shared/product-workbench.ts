import type {Product, Category} from '../types';

const norm=(v:unknown)=>String(v??'').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
export function productSequence(products:Product[],categories:Category[]):Product[]{
 const cats=new Map(categories.filter(c=>c.active!==false).map(c=>[c.id,c.displayOrder??999]));
 return [...products].sort((a,b)=>{
  if(a.cataloguePosition!=null||b.cataloguePosition!=null)return (a.cataloguePosition??Infinity)-(b.cataloguePosition??Infinity)||a.id.localeCompare(b.id,'en-GB');
  return (cats.get(a.categoryId)??999)-(cats.get(b.categoryId)??999)||(a.displayOrder??999)-(b.displayOrder??999)||(a.itemCode&&b.itemCode?a.itemCode.localeCompare(b.itemCode,'en-GB',{numeric:true}):a.name.localeCompare(b.name,'en-GB'))||a.id.localeCompare(b.id,'en-GB');
 });
}
export type MatchInput={systemId?:string;code?:string;name?:string;packSize?:string;unit?:string};
export function matchSupplierProduct(input:MatchInput,products:Product[],supplierId:string){
 const pool=products.filter(p=>!p.removedAt&&p.supplierId===supplierId);
 let matches:Product[]=[];let reason='Unmatched — select an existing product or leave for review';
 if(input.systemId){matches=pool.filter(p=>p.id===input.systemId);reason='System ID';}
 else if(norm(input.code)){matches=pool.filter(p=>norm(p.itemCode)===norm(input.code));reason='Supplier code';}
 if(!input.systemId&&!matches.length&&norm(input.name)){
  matches=pool.filter(p=>[p.name,p.chineseName].some(n=>norm(n)===norm(input.name))&&(!input.packSize||norm(p.packSize)===norm(input.packSize))&&(!input.unit||[p.caseUnitName,p.packUnitName,p.unitType].some(u=>norm(u)===norm(input.unit))));reason='Name, pack and unit — confirm match';
 }
 if(matches.length===1){const p=matches[0];if(input.packSize&&p.packSize&&norm(input.packSize)!==norm(p.packSize))return {productId:'',reason:'Pack size differs — manual review',suggestions:matches};if(input.unit&&![p.caseUnitName||'Box',p.packUnitName||'Unit',p.unitType].some(u=>norm(u)===norm(input.unit)))return {productId:'',reason:'Pricing unit differs — manual review',suggestions:matches};return {productId:p.id,reason,suggestions:matches};}
 if(matches.length>1)return {productId:'',reason:'Duplicate match — manual review',suggestions:matches};
 const words=norm(input.name).split(' ').filter(Boolean);
 return {productId:'',reason:input.systemId?'System ID not found for this supplier':reason,suggestions:pool.filter(p=>words.some(w=>w.length>2&&norm(p.name).includes(w))).slice(0,6)};
}
export const productFields=['name','chineseName','itemCode','categoryId','packSize','casePrice','packPrice','vatRate','unitType','caseUnitName','packUnitName','active','allowedBranchIds','minParLevel','targetParLevel'] as const;
export function productFingerprint(p:Product){return JSON.stringify([p.id,p.supplierId,...productFields.map(k=>p[k]??null),p.displayOrder,p.cataloguePosition??null,...(p.removedAt?[p.removedAt]:[])]);}
export function rowValue(row:Record<string,unknown>,...names:string[]){for(const name of names){const key=Object.keys(row).find(k=>norm(k).replace(/[^\p{L}\p{N}]/gu,'')===norm(name).replace(/[^\p{L}\p{N}]/gu,''));if(key!==undefined)return row[key];}return undefined;}
export function documentRow(row:Record<string,any>){return {systemId:String(rowValue(row,'SystemID')??''),code:String(rowValue(row,'ItemCode','ProductCode','Code','SKU')??''),name:String(rowValue(row,'Name','ProductName','Description','rawDescription')??''),packSize:String(rowValue(row,'PackSize')??''),unit:String(rowValue(row,'Unit','UnitOfMeasurement','unitTypeDetected')??''),casePrice:rowValue(row,'PriceBox','CasePrice'),packPrice:rowValue(row,'PriceUnit','PackPrice'),quantity:rowValue(row,'Quantity','Qty'),lineTotal:rowValue(row,'LineTotal','NetAmount','invoicedLineTotal','totalPrice')};}
