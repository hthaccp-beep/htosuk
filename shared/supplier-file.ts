import type {Product} from '../types';

export const normalText=(value:unknown)=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const heading=(value:unknown)=>normalText(value).replace(/[^a-z0-9]/g,'');
export const fileFields={systemId:'System ID',code:'Supplier item code',name:'Product description',packSize:'Pack size',casePrice:'Case price',packPrice:'Unit price',price:'Price (unit to check)',unit:'Pricing unit',notes:'Notes',supplier:'Supplier name',currency:'Currency'};
export type FileField=keyof typeof fileFields;
export type ColumnMap=Record<FileField,string>;
const aliases:Record<FileField,string[]>={systemId:['SystemID'],code:['ItemCode','ItemNo','ProductCode','Code','SKU','ArticleNo'],name:['Name','ProductName','Description','rawDescription','ItemDescription'],packSize:['PackSize','Pack','Size'],casePrice:['PriceBox','CasePrice','BoxPrice'],packPrice:['PriceUnit','PackPrice'],price:['Price','UnitPrice','Cost','NetPrice'],unit:['Unit','UnitOfMeasurement','unitTypeDetected','UOM'],notes:['Notes','Remarks'],supplier:['Supplier','SupplierName','Vendor'],currency:['Currency']};
export function suggestColumns(headers:string[]):ColumnMap{return Object.fromEntries(Object.entries(aliases).map(([field,names])=>[field,headers.find(h=>names.some(n=>heading(n)===heading(h)))||''])) as ColumnMap;}
export function priceUnit(value:unknown){const unit=normalText(value);return ['case','cases','box','boxes','bx','cs'].includes(unit)?'case':['pack','packs','unit','units','each','ea','pc','pcs','pk','bottle','bottles'].includes(unit)?'pack':'';}
export function normalPack(value:unknown){return normalText(value).replace(/×/g,'x').replace(/\s/g,'').replace(/(\d+(?:\.\d+)?)kg\b/g,(_,n)=>`${Number(n)*1000}g`).replace(/(\d+(?:\.\d+)?)l\b/g,(_,n)=>`${Number(n)*1000}ml`);}
export function filePrice(value:unknown):number|undefined{
 if(value==null||String(value).trim()==='')return undefined;
 const text=String(value).trim().replace(/^£\s*/,'');
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))throw new Error('Enter a valid GBP price, for example 12.50.');
 const result=Number(text.replace(/,/g,''));if(!Number.isFinite(result)||result>1e7)throw new Error('Price is too large.');return result;
}
export function priceWarnings(old:any,next:any):string[]{
 const flags:string[]=[];
 for(const key of ['casePrice','packPrice']){
  const value=next[key];if(value==null||value===old?.[key])continue;
  const label=key==='casePrice'?'Case price':'Unit price';
  if(value===0)flags.push(`${label} becomes £0.00`);
  else if(old?.[key]>0){const change=(value-old[key])/old[key]*100;if(Math.abs(change)>=20)flags.push(`${label} ${change>0?'+':''}${change.toFixed(1)}%`);}
  else flags.push(`${label}: no positive current price to compare`);
 }
 return flags;
}
export type FileLine={id:string;sourceId?:string;proposedName?:string;systemId:string;code:string;name:string;packSize:string;unit:string;notes:string;supplier:string;currency:string;rawPrice:string;casePrice:string;packPrice:string;productId:string;reason:string;selected:boolean;reviewed:boolean;};
export function sortedSupplierProducts(products:Product[],supplierId:string){
 return products.filter(p=>!p.removedAt&&p.supplierId===supplierId).slice().sort((a,b)=>Number(!a.itemCode)-Number(!b.itemCode)||String(a.itemCode||a.id).localeCompare(String(b.itemCode||b.id),'en-GB',{numeric:true,sensitivity:'base'})||a.id.localeCompare(b.id));
}
/** One fixed row per HTOS product. Never choose between duplicate file candidates silently. */
export function catalogueFileLines(sources:FileLine[],products:Product[],supplierId:string):FileLine[]{
 return sortedSupplierProducts(products,supplierId).map(p=>{
  const candidates=sources.filter(s=>s.productId===p.id);
  const empty:FileLine={id:p.id,sourceId:'',productId:p.id,systemId:'',code:'',name:'',packSize:'',unit:'',notes:'',supplier:'',currency:'',rawPrice:'',casePrice:'',packPrice:'',reason:candidates.length>1?'Several supplier rows match — choose one':'No supplier item chosen',selected:false,reviewed:false};
  return candidates.length===1?{...candidates[0],id:p.id,sourceId:candidates[0].id,productId:p.id}:empty;
 });
}
export function chooseFileSource(current:FileLine,source?:FileLine):FileLine{
 const empty={systemId:'',code:'',name:'',packSize:'',unit:'',notes:'',supplier:'',currency:'',rawPrice:'',casePrice:'',packPrice:''};
 return {...current,...empty,...source,id:current.id,productId:current.productId,sourceId:source?.id||'',reason:source?'Manually matched':'No supplier item chosen',selected:false,reviewed:false};
}
export function matchFileItem(line:Pick<FileLine,'systemId'|'code'|'name'|'packSize'|'unit'>,products:Product[],supplierId:string){
 const catalogue=products.filter(p=>!p.removedAt&&p.supplierId===supplierId);
 if(line.systemId){const found=catalogue.find(p=>p.id===line.systemId);return found?{productId:found.id,reason:'System ID'}:{productId:'',reason:'System ID not found for this supplier'};}
 const pool=catalogue.filter(p=>p.active!==false);
 if(line.code){const matches=pool.filter(p=>normalText(p.itemCode)===normalText(line.code));if(matches.length===1)return {productId:matches[0].id,reason:'Supplier code'};if(matches.length>1)return {productId:'',reason:'Duplicate supplier code — choose the correct item'};}
 const names=pool.filter(p=>[p.name,p.chineseName].some(n=>n&&normalText(n)===normalText(line.name))&&(!line.packSize||normalPack(p.packSize)===normalPack(line.packSize)));
 return names.length===1?{productId:names[0].id,reason:'Name suggestion — check item and pack'}:{productId:'',reason:names.length>1?'Several possible matches':'No match — choose an existing item'};
}
export function mapFileLines(rows:Record<string,any>[],mapping:ColumnMap,products:Product[],supplierId:string):FileLine[]{
 return rows.map((row,index)=>{
  const get=(key:FileField)=>String(row[mapping[key]]??'').trim();
  const unit=get('unit'),rawPrice=get('price');
  const line:FileLine={id:String(index),systemId:get('systemId'),code:get('code'),name:get('name'),packSize:get('packSize'),unit,notes:get('notes'),supplier:get('supplier'),currency:get('currency'),rawPrice,casePrice:get('casePrice')||(priceUnit(unit)==='case'?rawPrice:''),packPrice:get('packPrice')||(priceUnit(unit)==='pack'?rawPrice:''),productId:'',reason:'',selected:false,reviewed:false};
  return {...line,...matchFileItem(line,products,supplierId)};
 });
}
export function assessFileLine(line:FileLine,products:Product[],supplierId:string,supplierName:string,selected:FileLine[]=[]){
 const product=products.find(p=>p.id===line.productId&&p.supplierId===supplierId),blocked:string[]=[],flags:string[]=[];
 let casePrice:number|undefined,packPrice:number|undefined;
 const nameChanged=!!product&&line.proposedName!==undefined&&line.proposedName.trim()!==product.name;
 if(line.proposedName!==undefined&&(!line.proposedName.trim()||line.proposedName.length>300))blocked.push('Enter a product name of 1 to 300 characters');
 if(!product)blocked.push('Choose a product from this supplier');
 if(line.sourceId==='')blocked.push('Choose a supplier-file item');
 if(line.sourceId&&selected.filter(r=>r.sourceId===line.sourceId).length>1)blocked.push('Supplier-file item selected more than once');
 if(selected.filter(r=>r.productId&&r.productId===line.productId).length>1)blocked.push('Product selected more than once');
 try{casePrice=filePrice(line.casePrice);packPrice=filePrice(line.packPrice);}catch(e){blocked.push((e as Error).message);}
 if(casePrice===undefined&&packPrice===undefined&&!nameChanged)blocked.push('Enter a case or unit price; do not use a line total');
 if(line.currency&&line.currency.toUpperCase()!=='GBP')blocked.push('Currency is not GBP — use a GBP source');
 if(line.supplier&&normalText(line.supplier)!==normalText(supplierName))flags.push('Supplier name differs');
 if(product){
  if(product.active===false)flags.push('Inactive product — stays inactive');
  if(!['System ID','Supplier code'].includes(line.reason))flags.push('Confirm suggested or manually chosen item');
  if(line.code&&normalText(line.code)!==normalText(product.itemCode))flags.push('Item code differs');
  if(line.name&&![product.name,product.chineseName].some(n=>n&&normalText(n)===normalText(line.name)))flags.push('Description differs');
  if(line.packSize&&normalPack(line.packSize)!==normalPack(product.packSize))flags.push('Pack size differs or is not recorded');
  if(line.unit&&!priceUnit(line.unit))flags.push(`Pricing unit ${line.unit} needs checking`);
  if(priceUnit(line.unit)==='case'&&product.unitType==='PACK_ONLY'||priceUnit(line.unit)==='pack'&&product.unitType==='CASE_ONLY')flags.push('Document unit differs from ordering unit');
  if(line.rawPrice&&!priceUnit(line.unit))flags.push('Original price has no confirmed case/unit basis');
  flags.push(...priceWarnings(product,{casePrice,packPrice}));
 }
 if(line.notes)flags.push(line.notes);
 const unchanged=!!product&&!nameChanged&&(casePrice===undefined||casePrice===product.casePrice)&&(packPrice===undefined||packPrice===product.packPrice);
 return {product,casePrice,packPrice,blocked,flags:[...new Set(flags)],unchanged};
}

/** Auto-select unique ID/code matches, including visible warnings, for the final review. */
export function initialMatchedSelection(lines:FileLine[],products:Product[],supplierId:string,supplierName:string){
 return lines.map(line=>{const a=assessFileLine(line,products,supplierId,supplierName);return {...line,selected:!!line.sourceId&&['System ID','Supplier code'].includes(line.reason)&&a.product?.active!==false&&!a.blocked.length&&!a.unchanged};});
}
export function selectedSupplierUpdates(lines:FileLine[],products:Product[],supplierId:string,supplierName:string){
 const selected=lines.filter(l=>l.selected);
 if(!selected.length)throw new Error('Select at least one matched item.');
 return selected.map(line=>{
  const a=assessFileLine(line,products,supplierId,supplierName,selected);
  if(!line.sourceId||a.blocked.length||a.unchanged)throw new Error(a.blocked[0]||'Choose a changed, matched item.');
  return {SystemID:line.productId,Name:line.proposedName!==undefined&&line.proposedName.trim()!==a.product!.name?line.proposedName.trim():'',PriceBox:a.casePrice??'',PriceUnit:a.packPrice??''};
 });
}

/** Local verification only: uses the catalogue already loaded in the workspace. */
export function verifyFileLines(lines:FileLine[],products:Product[],supplierId:string,supplierName:string){
 const counts={ready:0,warnings:0,corrections:0,unchanged:0,unmatched:0};
 const selected=lines.filter(line=>line.selected);
 for(const line of lines){
  const result=assessFileLine(line,products,supplierId,supplierName,selected);
  if(!result.product||line.sourceId==='')counts.unmatched++;
  if(result.blocked.length)counts.corrections++;
  else if(result.unchanged)counts.unchanged++;
  else if(result.flags.length)counts.warnings++;
  else counts.ready++;
 }
 return counts;
}
