import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseInvoiceExtraction,matchInvoiceExtraction,attachInvoiceExtraction,useInvoiceExtractionFigures} from '../shared/invoice-extraction.ts';
import {extractionFixture,extractionCase} from './fixtures/invoice-extraction.ts';
const check=(d=extractionFixture())=>{const r=extractionCase();return matchInvoiceExtraction(r,r.documents[0].id,d);};
test('customer PO cell splits but supplier order numbers stay separate',()=>{
 const d=extractionFixture();d.orderReferences=['ORDER-A, ORDER-B'];d.supplierOrderReferences=['SUPPLIER-SO'];
 const parsed=parseInvoiceExtraction(d);assert.deepEqual(parsed.orderReferences,['ORDER-A','ORDER-B']);assert.deepEqual(parsed.supplierOrderReferences,['SUPPLIER-SO']);assert.ok(check(d).rows.every(r=>!r.mayUseFigures));
});
test('supplier references alone never authorise an order match',()=>{const d=extractionFixture();d.supplierOrderReferences=d.orderReferences;d.orderReferences=[];d.rows.forEach(r=>r.orderReference=null);assert.ok(check(d).rows.every(r=>!r.mayUseFigures));});
test('payable net after discount reconciles without false total warnings',()=>{
 const d=extractionFixture();d.netBeforeAdjustment=482;d.adjustment=-24.1;d.net=d.gross=457.9;
 const m=check(d);assert.ok(!m.warnings.some(w=>/does not equal|do not equal|do not agree/.test(w)));assert.match(m.warnings.join(' '),/allocate/);assert.ok(m.rows.every(r=>!r.mayUseFigures));
});
test('incorrect discount or net blocks copying even when row matches',()=>{const d=extractionFixture();d.netBeforeAdjustment=482;d.adjustment=-24.1;assert.ok(check(d).rows.every(r=>!r.mayUseFigures));});
test('duplicated amounts with distinct row numbers cannot be copied when totals disagree',()=>{const d=extractionFixture();d.rows.push({...d.rows[1],row:6});assert.ok(check(d).rows.every(r=>!r.mayUseFigures));const r=extractionCase();assert.throws(()=>useInvoiceExtractionFigures(attachInvoiceExtraction(r,r.documents[0].id,d)),/No unambiguous/);});
test('preprinted lists remain manual even if totals and names appear to match',()=>{const d=extractionFixture();d.layout='PREPRINTED_LIST';assert.ok(check(d).rows.every(r=>!r.mayUseFigures));assert.match(check(d).warnings.join(' '),/row alignment/);});
test('weight, price basis and ordered quantities survive separately and block unit guesses',()=>{
 const d=extractionFixture();Object.assign(d.rows[0],{orderedQuantity:12,weightQuantity:10,weightUnit:'kg',priceUnit:'kg'});
 const r=check(d).rows[0];assert.equal(r.source.quantity,10);assert.equal(r.source.orderedQuantity,12);assert.equal(r.source.weightQuantity,10);assert.equal(r.source.weightUnit,'kg');assert.equal(r.mayUseFigures,false);
});
test('price-unit mismatch blocks copying even when multiplication agrees',()=>{const d=extractionFixture();d.rows[0].priceUnit='kg';assert.equal(check(d).rows[0].mayUseFigures,false);});
test('printed rounding differences require human review, never silent correction',()=>{const d=extractionFixture();d.rows[0].netAmount=189.99;d.net=d.gross=481.99;const m=check(d);assert.equal(m.rows[0].source.netAmount,189.99);assert.equal(m.rows[0].mayUseFigures,false);assert.equal(m.rows[1].mayUseFigures,true);});
test('unreadable totals and missing invoice identity block using all figures',()=>{for(const field of ['net','vat','gross','reference','date'] as const){const d=extractionFixture();d[field]=null;assert.ok(check(d).rows.every(r=>!r.mayUseFigures));}});
test('linked invoice identity and printed customer name survive delivery-note reading',()=>{const d=extractionFixture();d.documentType='DELIVERY_NOTE';d.customerName='Example Customer 3';d.linkedInvoiceReference='INV-EXAMPLE';d.linkedInvoiceDate='2026-11-01';const p=parseInvoiceExtraction(d);assert.equal(p.linkedInvoiceReference,'INV-EXAMPLE');assert.equal(p.linkedInvoiceDate,'2026-11-01');assert.equal(p.customerName,'Example Customer 3');assert.ok(check(d).rows.every(r=>!r.mayUseFigures));});
test('new fields reject negative weights, invalid dates and malformed reference arrays',()=>{const d=extractionFixture();assert.throws(()=>parseInvoiceExtraction({...d,rows:[{...d.rows[0],weightQuantity:-1}]}));assert.throws(()=>parseInvoiceExtraction({...d,linkedInvoiceDate:'2026-02-30'}));assert.throws(()=>parseInvoiceExtraction({...d,supplierOrderReferences:'SO'}));assert.throws(()=>parseInvoiceExtraction({...d,layout:'invented'}));});
test('older drafts remain readable and no missing values become zero',()=>{const p=parseInvoiceExtraction(extractionFixture());assert.equal(p.rows[0].weightQuantity,null);assert.equal(p.netBeforeAdjustment,null);assert.equal(p.layout,'UNKNOWN');assert.ok(check().rows.some(r=>r.mayUseFigures));});
