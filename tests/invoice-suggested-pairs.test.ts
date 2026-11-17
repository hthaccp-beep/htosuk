import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction';
import {attachInvoiceExtraction,matchInvoiceExtraction} from '../shared/invoice-extraction';
import {invoiceItemReview,invoiceItemCounts} from '../shared/invoice-item-review';
import {invoiceComparison} from '../shared/invoice-comparison';
import {itemCreditSummary} from '../shared/invoice-credit-summary';

function seafood(){
 const c=extractionCase();c.receipt.issues=[];c.lines=c.lines.slice(0,2).map((l,i)=>({...l,name:i?'Roe Flying Fish Orange Tobiko':'Salmon Fillet Farmed',code:i?'390':'070',unit:i?'pk':'fillet',ordered:i?3:2,received:i?3:2,expectedPrice:i?16.5:9.8}));
 const f=extractionFixture();f.rows=f.rows.slice(0,2).map((r,i)=>({...r,code:null,description:i?'390 - ROE FLYING FISH ORANGE (TOBIKKO)':'O70 - SALMON Farmed BATCH 56SSF1011',unit:i?'Pack':'Kg',quantity:i?3:5.4,unitPrice:i?16.5:9.8,netAmount:i?49.5:52.92}));
 return attachInvoiceExtraction(c,c.documents[0].id,f);
}
test('two seafood pairs display twice, not four times, without allocating or confirming money',()=>{
 const c=seafood(),before=structuredClone(c),rows=invoiceComparison(c);
 assert.equal(rows.length,2);assert.deepEqual(invoiceItemCounts(rows),{items:2,unmatched:0});
 assert.ok(rows.every(r=>r.suggestedMatch&&r.attention&&!r.figuresComparable&&!r.matches&&r.priceCheck==='UNKNOWN'));
 assert.equal(rows[0].readings?.[0].quantity,5.4);assert.equal(rows[0].billedUnit,'Kg');assert.equal(rows[0].unit,'fillet');
 assert.equal(rows[1].readings?.[0].quantity,3);assert.equal(rows[1].priceDisplay,16.5);
 assert.ok(rows.every(r=>itemCreditSummary(c,r).pence===undefined));
 const draft=c.extraction.draft as any;
 assert.ok(matchInvoiceExtraction(c,draft.documentId,draft.extracted).rows.every(r=>!r.lineId&&!r.mayUseFigures));
 assert.deepEqual(c,before);
});
test('duplicate possible invoice rows remain separate and cannot be hidden in one suggestion',()=>{
 const c=seafood(),d=c.extraction.draft as any;d.extracted.rows.push({...d.extracted.rows[0],row:99});
 const rows=invoiceItemReview(c);assert.equal(rows.filter(r=>!r.lineId).length,2);assert.equal(rows[0].suggestedMatch,undefined);assert.equal(rows[0].readings?.length,0);
});
test('ambiguous order choices and conflicting product variants stay unpaired',()=>{
 const c=seafood(),d=c.extraction.draft as any;c.lines[1]={...c.lines[0],id:'other-line'};d.extracted.rows=d.extracted.rows.slice(0,1);
 assert.equal(invoiceItemReview(c).filter(r=>!r.lineId).length,1);
 c.lines=c.lines.slice(0,1);c.lines[0].name='Frozen salmon';c.lines[0].code='';d.extracted.rows[0].description='Fresh salmon';
 assert.equal(invoiceItemReview(c).filter(r=>!r.lineId).length,1);
});
test('stale, blank and foreign-reference readings are never grouped as suggested matches',()=>{
 for(const mode of ['stale','blank','reference']){
  const c=seafood(),d=c.extraction.draft as any;
  if(mode==='stale')c.documents[0].sha256='changed';
  if(mode==='blank')for(const r of d.extracted.rows)r.quantity=r.unitPrice=r.netAmount=null;
  if(mode==='reference')for(const r of d.extracted.rows)r.orderReference='OTHER-ORDER';
  assert.ok(invoiceItemReview(c).every(r=>!r.suggestedMatch),mode);
 }
});
test('a confirmed code match is not stolen by a second similar invoice row',()=>{
 const c=seafood(),d=c.extraction.draft as any;d.extracted.rows[0].code='070';
 d.extracted.rows.push({...d.extracted.rows[0],row:99,code:null});
 const rows=invoiceItemReview(c);assert.equal(rows[0].suggestedMatch,undefined);assert.equal(rows[0].readings?.length,1);assert.equal(rows.filter(r=>!r.lineId).length,1);
});
