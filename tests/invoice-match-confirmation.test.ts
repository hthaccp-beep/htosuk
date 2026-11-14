import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractionCase,extractionFixture} from './fixtures/invoice-extraction.ts';
import {attachInvoiceExtraction,matchInvoiceExtraction} from '../shared/invoice-extraction.ts';
import {invoiceMatchConfirmation,type MatchConfirmationInput} from '../shared/invoice-match-confirmation.ts';
import {confirmInvoiceRowUnits} from '../shared/invoice-unit-review.ts';
function setup(){
 const r=extractionCase();r.lines=r.lines.slice(0,1);r.lines[0]={...r.lines[0],name:'Sample green tea',code:'',unit:'box',ordered:4,received:4,expectedPrice:30};
 const f=extractionFixture();f.rows=[{...f.rows[0],code:null,description:'GREEN TEA — sample',unit:'packet',quantity:80,unitPrice:1.5,netAmount:120,uncertain:[]}];
 const record=attachInvoiceExtraction(r,r.documents[0].id,f),row=matchInvoiceExtraction(record,r.documents[0].id,f).rows[0];
 const input:MatchConfirmationInput={lineId:r.lines[0].id,pack:'20',manual:false,quantity:'',price:'',evidence:'label',note:'',checked:true};
 return {record,row,input};
}
test('one pack entry prepares reconciled invoice figures and explicit evidence, without mutation',()=>{
 const {record,row,input}=setup(),before=JSON.stringify(record),draft=invoiceMatchConfirmation(record,row,input);
 assert.equal(draft.ready,true);assert.deepEqual(draft.figures,{quantity:4,unitPrice:30});assert.match(draft.payload!.reason,/Supplier pack label.*1 box = 20 packet/);assert.equal(JSON.stringify(record),before);
 const saved=confirmInvoiceRowUnits(record,draft.payload,'accounts','2026-11-14');assert.equal(saved.lines[0].invoiceQuantity,4);assert.equal(saved.lines[0].invoicePrice,30);assert.equal(saved.lines[0].expectedPrice,30);assert.equal(saved.lines[0].reviewed,false);assert.notEqual(saved.status,'APPROVED');assert.deepEqual(saved.documents,record.documents);
});
test('missing evidence, unchecked identity and invalid factors cannot enable saving',()=>{
 const {record,row,input}=setup();for(const patch of [{evidence:''},{evidence:'invalid'},{checked:false},{pack:''},{pack:'0'},{pack:'-1'},{pack:'NaN'},{pack:'Infinity'},{pack:'1000001'},{lineId:'unknown'},{evidence:'other',note:'ok'}])assert.equal(invoiceMatchConfirmation(record,row,{...input,...patch}).ready,false,JSON.stringify(patch));
});
test('same-unit conversion removes retyping but still needs Accounts confirmation',()=>{
 const {record,row,input}=setup();record.lines[0].unit='pk';row.source.unit='Pack';
 const result=invoiceMatchConfirmation(record,row,{...input,pack:'',evidence:'invoice'});assert.equal(result.ready,true);assert.deepEqual(result.figures,{quantity:80,unitPrice:1.5});
 assert.equal(invoiceMatchConfirmation(record,row,{...input,pack:'',checked:false}).ready,false);
});
test('manual correction needs reconciled figures and a meaningful note',()=>{
 const {record,row,input}=setup();row.source.uncertain=['Weight unclear'];
 assert.equal(invoiceMatchConfirmation(record,row,input).ready,false);
 const manual={...input,manual:true,quantity:'4',price:'30',note:'Supplier specification checked: 20 packets per box.'};
 assert.equal(invoiceMatchConfirmation(record,row,manual).ready,true);
 for(const patch of [{note:''},{quantity:'3'},{price:'Infinity'},{quantity:'-4',price:'-30'},{quantity:''}])assert.equal(invoiceMatchConfirmation(record,row,{...manual,...patch}).ready,false);
});
test('weight/count, stale reading and delivery notes never get automatic figures',()=>{
 for(const kind of ['weight','stale','delivery','unknown','total']){const {record,row,input}=setup();if(kind==='weight')row.source.unit='kg';if(kind==='stale')record.documents[0].sha256='changed';if(kind==='delivery')(record.extraction.draft as any).extracted.documentType='DELIVERY_NOTE';if(kind==='unknown')row.source.unit='Unit unclear';if(kind==='total')row.source.netAmount=121;assert.equal(invoiceMatchConfirmation(record,row,input).ready,false,kind);}
});
