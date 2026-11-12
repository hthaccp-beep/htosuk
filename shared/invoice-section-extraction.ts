import {parseInvoiceExtraction,type ExtractedInvoice,type ExtractedInvoiceRow} from './invoice-extraction.ts';

export interface InvoiceSectionPlan {id:string;kind:'header'|'rows'|'totals';page:number}
export interface InvoiceSectionBundle {
 schemaVersion:1;documentHash:string;plan:InvoiceSectionPlan[];
 results:{id:string;data:unknown}[];
}
const fail=():never=>{throw new Error('Invoice sections are incomplete, duplicated or invalid. No draft figures were applied.');};
const texts=(v:unknown):string[]=>{if(!Array.isArray(v)||v.length>80||v.some(x=>typeof x!=='string'||x.length>1000))return fail();return v;};
/** Normalise only explicit UK/ISO dates; never guess US dates or repair impossible dates. */
export function invoiceSectionDate(value:unknown):string|null {
 if(value===null)return null;
 if(typeof value!=='string')return fail();
 const uk=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
 const iso=uk?`${uk[3]}-${uk[2]}-${uk[1]}`:value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso)return fail();
 return iso;
}
/** Server-prepared evidence only. This does not straighten images, infer missing facts or approve a document. */
export function invoiceFromSections(bundle:InvoiceSectionBundle,documentHash:string):ExtractedInvoice {
 if(!bundle||bundle.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(documentHash)||bundle.documentHash!==documentHash||!Array.isArray(bundle.plan)||bundle.plan.length<3||bundle.plan.length>40||!Array.isArray(bundle.results)||bundle.plan.length!==bundle.results.length)return fail();
 const ids=bundle.plan.map(p=>p.id);
 if(new Set(ids).size!==ids.length||new Set(bundle.results.map(r=>r.id)).size!==ids.length||bundle.results.some(r=>!ids.includes(r.id)))return fail();
 if(bundle.plan.some(p=>!p||!/^[\w-]{1,80}$/.test(p.id)||!['header','rows','totals'].includes(p.kind)||!Number.isInteger(p.page)||p.page<1||p.page>100))return fail();
 if(bundle.plan.filter(p=>p.kind==='header').length!==1||bundle.plan.filter(p=>p.kind==='totals').length!==1||!bundle.plan.some(p=>p.kind==='rows'))return fail();
 const sections=bundle.plan.map(p=>({...p,data:bundle.results.find(r=>r.id===p.id)!.data as any}));
 const h=sections.find(s=>s.kind==='header')!.data,t=sections.find(s=>s.kind==='totals')!.data;
 if(!h||!t)return fail();
 const all:ExtractedInvoiceRow[]=[],warnings=[...texts(h.warnings),...texts(t.warnings)];
 const counters=new Map<number,number>();
 for(const section of sections.filter(s=>s.kind==='rows')){
  if(!section.data||!Array.isArray(section.data.rows)||section.data.rows.length>100)return fail();
  warnings.push(...texts(section.data.warnings));
  for(const r of section.data.rows){
   if(!r)return fail();
   const row=(counters.get(section.page)||0)+1;counters.set(section.page,row);
   all.push({page:section.page,row,code:r.code??null,description:r.description,unit:r.unit??null,
    quantity:r.quantity,unitPrice:r.unitPrice,netAmount:r.netAmount,vatRate:r.vatRate??null,
    orderReference:r.orderReference??null,uncertain:texts(r.uncertain??r.warnings),
    orderedQuantity:r.orderedQuantity??null,weightQuantity:r.weightQuantity??null,weightUnit:r.weightUnit??null,priceUnit:r.priceUnit??null,
    sourceSection:section.id,sourceRow:section.data.rows.indexOf(r)+1});
  }
 }
 if(all.length>400)return fail();
 const parsed=parseInvoiceExtraction({documentType:h.documentType??'UNKNOWN',reference:h.reference,date:invoiceSectionDate(h.date),supplier:h.supplier,customerName:h.customerName??null,
  branch:h.branchEvidence?h.branch:null,orderReferences:h.orderReferences??[],supplierOrderReferences:h.supplierOrderReferences??[],
  currency:t.currency,priceBasis:h.priceBasis??'UNKNOWN',layout:h.layout??'UNKNOWN',rows:all,
  net:t.net,vat:t.vat,gross:t.gross,adjustment:t.adjustment??null,netBeforeAdjustment:t.netBeforeAdjustment??null,warnings:[...new Set(warnings)]});
 // Only wholly blank, unambiguous catalogue rows are excluded. Explicit zero and repeated rows survive.
 const blank=(r:ExtractedInvoiceRow)=>[r.quantity,r.orderedQuantity,r.weightQuantity,r.unitPrice,r.netAmount].every(v=>v==null)&&!r.uncertain.length;
 const blankRows=parsed.rows.filter(blank),rows=parsed.rows.filter(r=>!blank(r));
 return {...parsed,rows,blankRows,readingMethod:'SECTIONS',sectionIds:ids};
}
