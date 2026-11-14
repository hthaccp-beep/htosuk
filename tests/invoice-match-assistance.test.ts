import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {attachInvoiceExtraction,invoiceExtractionDraft} from '../shared/invoice-extraction.ts';
import {suggestInvoiceItems,compareInvoiceUnits} from '../shared/invoice-match-assistance.ts';
import {invoiceItemReview,invoiceItemCounts} from '../shared/invoice-item-review.ts';
function setup(){const r=(()=>{const c=extractionCase();return attachInvoiceExtraction(c,c.documents[0].id,extractionFixture());})();return {r,row:structuredClone(invoiceExtractionDraft(r)!.rows[0].source)};}
test('supplier wording, plurals and bilingual descriptions give suggestions, never allocations',()=>{
 const {r,row}=setup();r.lines[0].name='Green Pak Choy';row.description='GREEN PAKCHOY 青白菜';row.code=null;
 const before=JSON.stringify(r),s=suggestInvoiceItems(r,row);assert.equal(s[0].lineId,r.lines[0].id);assert.ok(s[0].warnings.length);assert.equal(JSON.stringify(r),before);
});
test('ambiguous carrots remain separate choices; packaging is not product identity',()=>{
 const {r,row}=setup();r.lines[0].name='Carrot (Small)';r.lines[1].name='Carrot (BIG)';row.code=null;row.description='CARROT 紅蘿蔔';
 const s=suggestInvoiceItems(r,row);assert.equal(s.length,2);assert.ok(s.every(v=>v.warnings.some(w=>w.includes('More than one'))));
 r.lines=r.lines.slice(0,1);r.lines[0].name='Plastic Bag';row.description='PRAWN CRACKER BAG';assert.deepEqual(suggestInvoiceItems(r,row),[]);
});
test('wrong references, stale documents, blank readings and conflicting variants are not suggested',()=>{
 const {r,row}=setup();row.orderReference='OTHER';assert.deepEqual(suggestInvoiceItems(r,row),[]);row.orderReference=r.id;
 r.lines[0].name='Frozen prawn';row.description='Fresh prawns';row.code=null;assert.deepEqual(suggestInvoiceItems(r,row),[]);
 row.description=r.lines[0].name;row.quantity=row.unitPrice=row.netAmount=null;assert.deepEqual(suggestInvoiceItems(r,row),[]);
 row.quantity=1;r.documents[0].sha256='new';assert.deepEqual(suggestInvoiceItems(r,row),[]);
});
test('same code with changed wording carries a confirmation warning',()=>{const {r,row}=setup();row.description='Different wording';assert.match(suggestInvoiceItems(r,row)[0].warnings.join(' '),/wording differs/);});
test('pack/box conversion requires a supplied factor even when totals agree',()=>{
 const {r,row}=setup(),line=r.lines[0];line.unit='box';line.ordered=4;line.received=4;line.expectedPrice=30;row.quantity=80;row.unit='packet';row.unitPrice=1.5;row.netAmount=120;
 const before=JSON.stringify(r);const without=compareInvoiceUnits(r,row,line);assert.equal(without.totalsAgree,true);assert.equal(without.proposal,undefined);assert.equal(without.canEnterPack,true);
 assert.deepEqual(compareInvoiceUnits(r,row,line,20).proposal,{quantity:4,unitPrice:30});assert.equal(JSON.stringify(r),before);
});
test('known abbreviations and metric units can produce a draft, not price changes',()=>{
 const {r,row}=setup(),line=r.lines[0];line.unit='pk';row.unit='Pack';row.quantity=3;row.unitPrice=16;row.netAmount=48;
 assert.deepEqual(compareInvoiceUnits(r,row,line).proposal,{quantity:3,unitPrice:16});
 line.unit='kg';row.unit='g';row.quantity=5000;row.unitPrice=.01;row.netAmount=50;assert.deepEqual(compareInvoiceUnits(r,row,line).proposal,{quantity:5,unitPrice:10});
});
test('weight versus fillets is never inferred even if prices are numerically equal',()=>{
 const {r,row}=setup(),line=r.lines[0];line.unit='fillet';line.expectedPrice=10;row.unit='Kg';row.quantity=5.4;row.unitPrice=10;row.netAmount=54;
 const c=compareInvoiceUnits(r,row,line,2);assert.equal(c.proposal,undefined);assert.equal(c.canEnterPack,false);assert.match(c.message,/Weight/);
});
test('uncertain basis, arithmetic and readings block calculations',()=>{
 for(const kind of ['orderedQuantity','unknown','arithmetic','uncertain','weight','priceUnit','currency','type','gross','stale']){
  const {r,row}=setup(),line=r.lines[0];row.unit=line.unit;row.quantity=2;row.unitPrice=10;row.netAmount=20;
  if(kind==='orderedQuantity')row.orderedQuantity=99;if(kind==='unknown')row.unit='Unit';if(kind==='arithmetic')row.netAmount=99;if(kind==='uncertain')row.uncertain=['Blurred'];if(kind==='weight')row.weightQuantity=2;
  if(kind==='priceUnit')row.priceUnit='kg';if(kind==='currency')invoiceExtractionDraft(r)!.extracted.currency='USD';if(kind==='type')invoiceExtractionDraft(r)!.extracted.documentType='DELIVERY_NOTE';if(kind==='gross')invoiceExtractionDraft(r)!.extracted.priceBasis='GROSS';if(kind==='stale')r.documents[0].sha256='new';
  assert.equal(compareInvoiceUnits(r,row,line,2).proposal,undefined,kind);
 }
});
test('unknown agreed price stays unknown and partial delivery has no pack hint',()=>{
 const {r,row}=setup(),line=r.lines[0];line.expectedPrice=0;line.unit='box';line.received=1;line.ordered=2;row.unit='packet';row.quantity=24;row.unitPrice=1;row.netAmount=24;
 const c=compareInvoiceUnits(r,row,line);assert.equal(c.orderTotal,undefined);assert.equal(c.totalsAgree,undefined);assert.equal(c.packHint,undefined);
});
test('invalid pack factors cannot calculate',()=>{const {r,row}=setup();r.lines[0].unit='box';row.unit='packet';for(const n of [0,-1,NaN,Infinity,1000001])assert.equal(compareInvoiceUnits(r,row,r.lines[0],n).proposal,undefined);});
test('suggestions do not reduce unmatched counts or change saved financial figures',()=>{
 let r=extractionCase();r.lines[0].name='Green Pak Choy';const f=extractionFixture();f.rows[0].code=null;f.rows[0].description='GREEN PAKCHOY 青白菜';r=attachInvoiceExtraction(r,r.documents[0].id,f);
 const before=JSON.stringify(r),view=invoiceItemReview(r),scan=view.find(v=>!v.lineId)!;assert.ok(scan.matchSuggestions?.length);assert.equal(invoiceItemCounts(view).unmatched,1);assert.equal(JSON.stringify(r),before);
});
