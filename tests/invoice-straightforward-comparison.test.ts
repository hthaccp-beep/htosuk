import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceComparison} from '../shared/invoice-comparison.ts';
import {itemReviewSample} from './fixtures/invoice-item-review.ts';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {attachInvoiceExtraction} from '../shared/invoice-extraction.ts';

test('ordered, received and billed figures remain separate and missing items keep their issue',()=>{
 const r=itemReviewSample();r.lines[0].invoicePrice=19;
 const row=invoiceComparison(r)[0];
 assert.equal(row.ordered,10);assert.equal(row.received,8);assert.equal(row.billedDisplay,10);
 assert.ok(row.issues.includes('Invoiced 10; received 8 bags'));assert.ok(row.issues.includes('Price +£1.00 / bags'));
 assert.match(row.issues.join(' '),/Missing items.*2 bags/);assert.equal(row.matches,false);
});
test('replacement and full credit change follow-up without erasing original damage',()=>{
 const rows=invoiceComparison(itemReviewSample());
 assert.match(rows[2].issues.join(' '),/Damaged/);assert.match(rows[2].followUp.join(' '),/Replacement confirmed/);assert.equal(rows[2].matches,false);
 assert.match(rows[3].issues.join(' '),/Damaged/);assert.match(rows[3].followUp.join(' '),/Full credit approved/);assert.equal(rows[3].matches,false);
});
test('pack mismatch shows raw invoice units with Check pack, never a false price difference',()=>{
 const r=extractionCase(),f=extractionFixture();f.rows[0].unit='packet';f.rows[0].quantity=24;f.rows[0].unitPrice=2;f.rows[0].netAmount=48;
 const next=attachInvoiceExtraction(r,r.documents[0].id,f),row=invoiceComparison(next)[0];
 assert.equal(row.billedDisplay,24);assert.equal(row.billedUnit,'packet');assert.equal(row.priceDisplay,2);assert.equal(row.priceUnit,'packet');
 assert.ok(row.issues.includes('Confirm pack size / unit'));assert.equal(row.issues.some(s=>s.startsWith('Price ')),false);assert.equal(row.matches,false);assert.equal(row.draftFigures,true);
});
test('known same quantities and prices can match without approving invoice',()=>{
 const r=itemReviewSample(),before=structuredClone(r);const row=invoiceComparison(r)[4];
 assert.equal(row.matches,true);assert.equal(r.status,'REVIEW');assert.deepEqual(r,before);
});
test('unknown agreed price never becomes zero or matches',()=>{
 const r=itemReviewSample();r.lines[4].expectedPrice=undefined;
 const row=invoiceComparison(r)[4];assert.equal(row.expectedPrice,undefined);assert.equal(row.matches,false);assert.ok(row.issues.includes('Agreed price not confirmed'));
});
test('extra received and lower price remain visible differences',()=>{
 const r=itemReviewSample();r.lines[4].received=4;r.lines[4].invoiceQuantity=4;r.lines[4].invoicePrice=4;
 const row=invoiceComparison(r)[4];assert.ok(row.issues.includes('Extra 1 bags received'));assert.ok(row.issues.includes('Price −£1.00 / bags'));assert.equal(row.matches,false);
});
test('invoice wording is only repeated when name or code differs; unmatched rows stay separate',()=>{
 const r=extractionCase(),f=extractionFixture();f.rows[0].description='Supplier wording for rice';f.rows.push({...f.rows[0],row:99,code:'EXTRA',description:'Unexpected item',orderReference:null});
 const next=attachInvoiceExtraction(r,r.documents[0].id,f),rows=invoiceComparison(next);
 assert.equal(rows[0].differingWording[0].name,'Supplier wording for rice');assert.equal(rows[0].differingWording[0].code,f.rows[0].code);
 assert.equal(rows.filter(r=>r.lineId).length,5);assert.equal(rows.filter(r=>!r.lineId).length,1);
 const same=extractionFixture();same.rows[0].description=r.lines[0].name;
 assert.equal(invoiceComparison(attachInvoiceExtraction(r,r.documents[0].id,same))[0].differingWording.length,0);
});
test('stale and repeated readings never match or silently combine figures',()=>{
 const r=extractionCase(),f=extractionFixture();f.rows.push({...f.rows[0],row:99});
 const repeated=invoiceComparison(attachInvoiceExtraction(r,r.documents[0].id,f))[0];
 assert.equal(repeated.billedDisplay,undefined);assert.ok(repeated.issues.includes('Check repeated invoice rows'));assert.equal(repeated.matches,false);
 const next=attachInvoiceExtraction(r,r.documents[0].id,extractionFixture());next.documents[0].sha256='changed';
 const stale=invoiceComparison(next)[0];assert.ok(stale.issues.includes('Check document version'));assert.equal(stale.matches,false);
});
