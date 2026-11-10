import {documentRow,rowValue} from './product-workbench.ts';
import type {DocumentReviewLine} from './document-review.ts';

// Missing document facts must never become zero, one, or calculated OCR facts.
export function documentNumber(value:unknown):number|undefined {
 if(value==null||value==='')return undefined;
 const text=String(value).trim().replace(/^£\s*/,'').replace(/,/g,'');
 if(!/^\d+(?:\.\d+)?$/.test(text))return undefined;
 const result=Number(text);
 return Number.isFinite(result)&&result>=0&&result<=1e7?result:undefined;
}
export function documentUnit(value:unknown):'case'|'pack'|'' {
 const unit=String(value||'').trim().toUpperCase();
 if(['CASE','CASES','BOX','BOXES','BX','CS'].includes(unit))return 'case';
 if(['PACK','PACKS','UNIT','UNITS','EA','EACH','PK','PC','PCS'].includes(unit))return 'pack';
 return '';
}
export function normaliseScannedNumbers(item:any){
 const unitTypeDetected=String(item.unitTypeDetected||item.unit||item.unitType||'');
 const unit=documentUnit(unitTypeDetected);
 const unitPrice=documentNumber(item.unitPrice??item.price);
 return {
  quantity:documentNumber(item.quantity??item.qty??item.deliveredCaseQty),
  unitTypeDetected,
  casePrice:documentNumber(item.casePrice??item.invoicedCasePrice)??(unit==='case'?unitPrice:undefined),
  packPrice:documentNumber(item.packPrice??item.invoicedPackPrice)??(unit==='pack'?unitPrice:undefined),
  unitPrice,
  totalPrice:documentNumber(item.totalPrice??item.total??item.lineTotal??item.totalLinePrice),
 };
}
export function hasDocumentPrices(lines:DocumentReviewLine[]){
 return lines.some(l=>l.invoicedCasePrice!=null||l.invoicedPackPrice!=null||l.invoicedLineTotal!=null);
}
export function scannedLine(line:DocumentReviewLine,row:any,unit:'case'|'pack'):DocumentReviewLine {
 const data=documentRow(row);
 const quantity=documentNumber(data.quantity??rowValue(row,unit==='case'?'CaseQty':'PackQty'));
 const price=documentNumber((unit==='case'?data.casePrice:data.packPrice)??rowValue(row,'UnitPrice','Price'));
 return {...line,
  invoicedCaseQty:unit==='case'?quantity:0,invoicedPackQty:unit==='pack'?quantity:0,
  invoicedCasePrice:unit==='case'?price:undefined,invoicedPackPrice:unit==='pack'?price:undefined,
  invoicedLineTotal:documentNumber(data.lineTotal),isReviewed:false,
 };
}
