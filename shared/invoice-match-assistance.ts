import type {InvoiceCase,InvoiceCaseLine} from './invoice-case.ts';
import type {ExtractedInvoiceRow,InvoiceExtractionDraft} from './invoice-extraction.ts';

export interface ItemSuggestion {lineId:string;name:string;reason:string;warnings:string[];score:number}
const normal=(s:string)=>(s||'').normalize('NFKC').toLowerCase().replace(/\bbatch\b.*$/,'').replace(/^\s*\d+\s*[-–]\s*/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases:Record<string,string>={potatoes:'potato',prawns:'prawn',soybeans:'soybean',mushrooms:'mushroom',letuce:'lettuce',shitake:'shiitake',tobikko:'tobiko',hofun:'ho fun',pakchoy:'pak choy'};
function tokens(s:string){return [...new Set(normal(s).split(/\s+/).filter(t=>/^[a-z0-9]+$/.test(t)).flatMap(t=>(aliases[t]||t).split(' ')))];}
const reference=(s:string)=>s.trim().replace(/^#/,'').toLowerCase();
function current(record:InvoiceCase){const d=record.extraction.draft as InvoiceExtractionDraft|undefined;return !!d&&record.documents.some(doc=>doc.id===d.documentId&&doc.sha256===d.documentHash);}
/** Suggestions only: no lineId/candidateIds, financial figures, approvals or persisted records are changed. */
export function suggestInvoiceItems(record:InvoiceCase,row:ExtractedInvoiceRow):ItemSuggestion[]{
 if(!current(record)||[row.quantity,row.unitPrice,row.netAmount,row.weightQuantity].every(n=>n==null))return [];
 const a=tokens(row.description);if(!a.length&&!row.code)return [];
 const result=record.lines.flatMap(line=>{
  if(row.orderReference&&reference(row.orderReference)!==reference(line.orderId))return [];
  const b=tokens(line.name),sameCode=!!row.code&&!!line.code&&normal(row.code)===normal(line.code),sameName=normal(row.description)===normal(line.name);
  const common=a.filter(t=>b.includes(t)),overlap=common.length/Math.max(1,Math.min(a.length,b.length));
  if(!sameCode&&!sameName&&(!common.length||overlap<0.6||common.length===1&&Math.min(a.length,b.length)>1))return [];
  // A bag containing crackers is not a suggestion for a plastic bag, nor a shared size a product identity.
  if(!sameCode&&!sameName&&common.every(t=>/^(bag|box|pack|packet|case|small|big|large|fresh|frozen|\d+)$/.test(t)))return [];
  const warnings:string[]=[];
  if(sameCode&&!sameName)warnings.push('Code matches, but wording differs — confirm product and variant.');
  if(!sameCode&&!sameName)warnings.push('Confirm the full product name, brand and variant.');
  if(row.code&&line.code&&!sameCode)warnings.push('Supplier code differs from the order code.');
  for(const group of [['small','big','large'],['red','green','orange'],['fresh','frozen'],['salted','unsalted']]){const x=a.filter(t=>group.includes(t)),y=b.filter(t=>group.includes(t));if(x.length&&y.length&&!x.some(t=>y.includes(t)))return [];}
  if(row.uncertain.length)warnings.push('The saved reading has unresolved flags.');
  const score=sameCode?100:sameName?95:Math.round(65+25*(2*common.length/(a.length+b.length)));
  return [{lineId:line.id,name:line.name,score,reason:sameCode?'Same product code':sameName?'Same product name':'Similar supplier wording',warnings}];
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 if(result.length>1&&result[0].score-result[1].score<12)for(const r of result)r.warnings.push('More than one possible order item — choose carefully.');
 return result.slice(0,3);
}

const unitAliases:Record<string,string>={bags:'bag',boxes:'box',cases:'case',pk:'pack',packs:'pack',packets:'packet',pcs:'piece',pieces:'piece',bottles:'bottle',fillets:'fillet',kilogram:'kg',kilograms:'kg',gram:'g',grams:'g',litres:'l',litre:'l',millilitres:'ml',millilitre:'ml'};
const unit=(s:string|null|undefined)=>unitAliases[normal(s||'')]||normal(s||'');
const measures:Record<string,{dimension:string;scale:number}>={kg:{dimension:'mass',scale:1000},g:{dimension:'mass',scale:1},l:{dimension:'volume',scale:1000},ml:{dimension:'volume',scale:1}};
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000;
const pence=(n:number)=>Math.round(n*100);
export interface UnitComparison {message:string;orderTotal?:number;invoiceTotal?:number;totalsAgree?:boolean;packHint?:number;canEnterPack:boolean;proposal?:{quantity:number;unitPrice:number};basis?:string}
/** Read-only arithmetic. A proposal must still go through the existing Accounts evidence/confirmation command. */
export function compareInvoiceUnits(record:InvoiceCase,row:ExtractedInvoiceRow,line:InvoiceCaseLine,invoiceUnitsPerOrderedUnit?:number):UnitComparison{
 const result:UnitComparison={message:'Confirm product identity before using these figures.',canEnterPack:false};
 if(!current(record)||!record.lines.some(l=>l.id===line.id))return {...result,message:'Reading or order changed — review the current original.'};
 if(row.orderReference&&reference(row.orderReference)!==reference(line.orderId))return {...result,message:'Different order reference — resolve the document first.'};
 if(valid(row.netAmount))result.invoiceTotal=row.netAmount;
 if(positive(line.expectedPrice)&&valid(line.ordered)){result.orderTotal=line.ordered*line.expectedPrice;if(result.invoiceTotal!=null)result.totalsAgree=pence(result.orderTotal)===pence(result.invoiceTotal);}
 const draft=record.extraction.draft as InvoiceExtractionDraft;
 if(draft.extracted.documentType!=='INVOICE'||record.documents.find(d=>d.id===draft.documentId)?.kind!=='INVOICE'||draft.extracted.currency!=='GBP'||draft.extracted.priceBasis!=='NET')return {...result,message:'Confirm invoice type, GBP and net price basis before calculating.'};
 if(!valid(row.quantity)||!valid(row.unitPrice)||!valid(row.netAmount)||pence(row.quantity*row.unitPrice)!==pence(row.netAmount))return {...result,message:'Quantity × price does not confirm the printed amount — check the original.'};
 if(row.uncertain.length||row.weightQuantity!=null||row.orderedQuantity!=null&&row.orderedQuantity!==row.quantity||row.priceUnit&&unit(row.priceUnit)!==unit(row.unit))return {...result,message:'Reading, weight or price-basis flags need checking first.'};
 const from=unit(row.unit),to=unit(line.unit),x=measures[from],y=measures[to];
 if(!from||!to||['unit','units','unknown','unit unclear'].includes(from)||['unit','units','unknown','unit unclear'].includes(to))return {...result,message:'Invoice or order unit is unclear — check the supplier document.'};
 let factor:number|undefined;
 if(from===to){factor=1;result.basis='Same unit (including spelling/plural abbreviations)';}
 else if(x&&y&&x.dimension===y.dimension){factor=y.scale/x.scale;result.basis='Standard metric conversion';}
 else if(x||y)return {...result,message:'Weight/volume and item counts are different — do not infer a conversion.'};
 else{
  result.canEnterPack=true;
  if(positive(line.ordered)&&line.received===line.ordered&&!record.receipt.issues.some(i=>i.lineId===line.id)&&positive(row.quantity)&&Number.isInteger(row.quantity/line.ordered)&&row.quantity/line.ordered>1)result.packHint=row.quantity/line.ordered;
  result.message='Enter the pack size from the supplier label or specification.';
  if(!positive(invoiceUnitsPerOrderedUnit)||invoiceUnitsPerOrderedUnit>1000000)return result;
  factor=invoiceUnitsPerOrderedUnit;result.basis='Pack size entered by Accounts — evidence required';
 }
 const quantity=row.quantity/factor,unitPrice=row.unitPrice*factor;
 if(!valid(quantity)||!valid(unitPrice)||quantity*unitPrice>1000000||pence(quantity*unitPrice)!==pence(row.netAmount))return {...result,message:'Converted figures do not reconcile; check manually.'};
 return {...result,message:'Calculated draft only — confirm the product and evidence before saving.',proposal:{quantity,unitPrice}};
}
