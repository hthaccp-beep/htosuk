import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateInvoiceUploadFile,canUploadInvoicePreview} from '../shared/invoice-upload-preview.ts';
import {invoiceReviewGuide} from '../shared/invoice-review-guide.ts';
import {attachInvoiceExtraction,matchInvoiceExtraction} from '../shared/invoice-extraction.ts';
import {confirmInvoiceRowUnits,hasConfirmedUnitReview} from '../shared/invoice-unit-review.ts';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {applyInvoiceCommand} from '../server/invoice-case-validation.ts';
import {sampleStaff,sampleOwner} from './fixtures/invoice-workflow.ts';
import {invoiceItemIssueLabels} from '../shared/invoice-issue-labels.ts';
test('simple issue labels distinguish missing, damage, cheaper prices and unknown figures',()=>{
 const r=extractionCase(),l=r.lines[0];l.invoiceQuantity=10;l.invoicePrice=19;l.expectedPrice=18;
 assert.ok(invoiceItemIssueLabels(r,l).some(s=>s.startsWith('Missing 2')));
 assert.ok(invoiceItemIssueLabels(r,l).includes('Price difference'));
 l.invoicePrice=17;assert.ok(invoiceItemIssueLabels(r,l).includes('Price difference'));
 l.invoicePrice=undefined;assert.ok(invoiceItemIssueLabels(r,l).includes('Check details'));assert.ok(!invoiceItemIssueLabels(r,l).includes('No difference'));
 assert.ok(invoiceItemIssueLabels(r,r.lines[2]).some(s=>s.startsWith('Damaged 1')));
});
function unmatched(){const r=extractionCase(),d=extractionFixture();d.rows[0].code='SUPPLIER-ALTERNATE';d.rows[0].description='Sample alternative invoice description';d.rows[0].unit='packets';return attachInvoiceExtraction(r,r.documents[0].id,d);}
const input=(r:ReturnType<typeof unmatched>)=>({page:1,row:1,lineId:r.lines[0].id,quantity:10,unitPrice:19,reason:'Supplier specification and product code checked: one ordered bag.',productConfirmed:true});
test('file preview validates type/size and cannot upload until checked or during an upload',()=>{
 validateInvoiceUploadFile({size:100,type:'image/jpeg'});validateInvoiceUploadFile({size:100,type:'application/pdf'});
 for(const f of [{size:0,type:'image/png'},{size:3*1024*1024+1,type:'image/png'},{size:100,type:'text/html'}])assert.throws(()=>validateInvoiceUploadFile(f));
 assert.throws(()=>validateInvoiceUploadFile({size:100,type:'application/pdf'},true));
 assert.equal(canUploadInvoicePreview(true,true,false),true);assert.equal(canUploadInvoicePreview(false,true,false),false);assert.equal(canUploadInvoicePreview(true,false,false),false);assert.equal(canUploadInvoicePreview(true,true,true),false);
});
test('review guide keeps unknown totals and approval problems visible',()=>{const r=extractionCase(),guide=invoiceReviewGuide(r);assert.equal(guide.totals,'Totals incomplete');assert.equal(guide.attention,r.lines.length);assert.ok(guide.problems.length>0);r.documents=[];assert.match(invoiceReviewGuide(r).next,/Upload the original/);});
test('manual product match requires explicit identity confirmation and never changes agreed prices or receipts',()=>{
 const r=unmatched(),before=structuredClone(r);assert.equal(matchInvoiceExtraction(r,r.documents[0].id,extractionFixture()).rows.length,5);
 assert.throws(()=>confirmInvoiceRowUnits(r,{...input(r),productConfirmed:false},'accounts','2026-11-13'),/Confirm the product/);
 const next=confirmInvoiceRowUnits(r,input(r),'accounts','2026-11-13');assert.equal(next.extraction.unitReviews?.[0].manualProductMatch,true);assert.equal(next.lines[0].invoiceQuantity,10);assert.equal(next.lines[0].invoicePrice,19);assert.equal(next.lines[0].reviewed,false);assert.equal(next.matchingVerified,false);assert.equal(hasConfirmedUnitReview(next,1,1),true);
 assert.deepEqual(next.receipt,before.receipt);assert.deepEqual(next.lines.map(l=>l.expectedPrice),before.lines.map(l=>l.expectedPrice));assert.deepEqual(r,before);
});
test('manual allocation rejects foreign order items, wrong amounts and missing evidence',()=>{
 const r=unmatched();for(const override of [{lineId:'another-case-item'},{quantity:9},{reason:'ok'},{unitPrice:NaN}])assert.throws(()=>confirmInvoiceRowUnits(r,{...input(r),...override},'accounts','2026-11-13'));
 const d=extractionFixture();d.rows[0].code='UNMATCHED';d.rows[0].orderReference='FOREIGN-ORDER';const wrong=attachInvoiceExtraction(extractionCase(),r.documents[0].id,d);assert.throws(()=>confirmInvoiceRowUnits(wrong,input(wrong),'accounts','2026-11-13'),/printed order reference/);
});
test('the same order item cannot be allocated twice and delivery notes cannot establish charges',()=>{
 const r=unmatched();assert.throws(()=>confirmInvoiceRowUnits(r,{...input(r),lineId:r.lines[1].id},'accounts','2026-11-13'),/count them twice/);
 const d=extractionFixture();d.documentType='DELIVERY_NOTE';d.rows[0].code='UNMATCHED';const note=attachInvoiceExtraction(extractionCase(),r.documents[0].id,d);assert.throws(()=>confirmInvoiceRowUnits(note,input(note),'accounts','2026-11-13'),/Delivery-note/);
});
test('staff cannot confirm manual product matches; authorised Accounts audit remains intact',()=>{
 const r=unmatched(),command={...input(r),kind:'confirm-reading-units',requestId:'offline-manual-match',expectedVersion:r.version};
 assert.throws(()=>applyInvoiceCommand(r,command,sampleStaff,{},'2026-11-13T12:00:00Z'));
 const next=applyInvoiceCommand(r,command,sampleOwner,{},'2026-11-13T12:00:00Z');assert.equal(next.audit.at(-1)?.action,'confirm-reading-units');assert.equal(next.status,'REVIEW');
 for(const locked of [{...r,status:'APPROVED' as const},{...r,claim:{state:'SENT'}}])assert.throws(()=>confirmInvoiceRowUnits(locked as any,input(r),'accounts','2026-11-13'),/locked/);
});
