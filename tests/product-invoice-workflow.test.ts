import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchSupplierProduct,productSequence,productFingerprint,documentRow} from '../shared/product-workbench.ts';
import {planProductChanges} from '../server/product-workbench-service.ts';
import {prepareInvoiceReview} from '../server/invoice-workflow-service.ts';
import {orderedProductGroups,checklistHtml} from '../app/htos/orderingHelpers.ts';
import type {Product,OrderRecord} from '../types.ts';
const p:Product={id:'p1',name:'Rice',itemCode:'001',chineseName:'米',supplierId:'s1',categoryId:'c1',displayOrder:1,allowedBranchIds:[],active:true,packSize:'10kg',casePrice:10,packPrice:2};
const cats=[{id:'c1',name:'First',displayOrder:1,active:true},{id:'c2',name:'Second',displayOrder:2,active:true}];
const owner={id:'owner',role:'CREATOR',active:true,displayName:'Owner'};
const body={supplierId:'s1',requestId:'request1',rows:[{id:p.id,expected:productFingerprint(p),values:{name:'New rice',casePrice:12}}]};
test('supplier-scoped exact matching preserves leading-zero codes and Chinese names',()=>{
 assert.equal(matchSupplierProduct({code:'001'},[p,{...p,id:'other',supplierId:'s2'}],'s1').productId,'p1');
 assert.equal(matchSupplierProduct({name:'米'},[p],'s1').productId,'p1');
 assert.equal(matchSupplierProduct({code:'1'},[p],'s1').productId,'');
 assert.equal(matchSupplierProduct({systemId:'p1'},[p],'s2').productId,'');
});
test('duplicate descriptions and mismatched pack sizes require a manual decision',()=>{
 assert.equal(matchSupplierProduct({name:'Rice'},[p,{...p,id:'p2',packSize:'20kg'}],'s1').productId,'');
 assert.equal(matchSupplierProduct({name:'Rice',packSize:'20kg'},[p,{...p,id:'p2',packSize:'20kg'}],'s1').productId,'p2');
 assert.equal(matchSupplierProduct({code:'001',packSize:'20kg'},[p],'s1').productId,'');
 assert.equal(matchSupplierProduct({code:'001'},[p,{...p,id:'p2'}],'s1').productId,'');
});
test('catalogue retains CSV sequence while checklist groups by category then product position',()=>{
 const list=[{...p,cataloguePosition:2},{...p,id:'p2',name:'Noodles',categoryId:'c2',cataloguePosition:1},{...p,id:'p3',name:'Beans',categoryId:'c2',cataloguePosition:3}];
 assert.deepEqual(productSequence(list,cats).map(p=>p.name),['Noodles','Rice','Beans']);
 assert.deepEqual(orderedProductGroups(list,cats).flatMap(g=>g.products.map(p=>p.name)),['Rice','Noodles','Beans']);
 const html=checklistHtml(list,cats,'Supplier');assert.ok(html.indexOf('Rice')<html.indexOf('Noodles'));assert.ok(html.indexOf('Noodles')<html.indexOf('Beans'));
});
test('bulk edit separates metadata from price approval without creating a product',()=>{
 const plan=planProductChanges(owner,{},body,[p],cats,[]);
 assert.equal(plan.updates[0].changes.name,'New rice');assert.equal(plan.updates[0].changes.casePrice,undefined);assert.equal(plan.notices[0].status,'PENDING');assert.equal(plan.notices[0].oldCasePrice,10);assert.equal(plan.notices[0].newCasePrice,12);
 assert.throws(()=>planProductChanges(owner,{},body,[],cats,[]),/missing/);
});
test('bulk edits reject stale versions, duplicates, invalid numbers and removed permission',()=>{
 assert.throws(()=>planProductChanges(owner,{},body,[{...p,name:'changed'}],cats,[]),/changed after/);
 assert.throws(()=>planProductChanges(owner,{}, {...body,rows:[...body.rows,...body.rows]},[p],cats,[]),/more than once/);
 assert.throws(()=>planProductChanges(owner,{}, {...body,rows:[{...body.rows[0],values:{casePrice:-1}}]},[p],cats,[]),/negative/);
 assert.throws(()=>planProductChanges({...owner,role:'MANAGER',permissionMode:'CUSTOM',customPermissions:[]},{},body,[p],cats,[]),/cannot edit/);
});
const order={id:'o1',branchNameSnapshot:'Branch',supplierNameSnapshot:'Supplier',orderedByUserId:'owner',orderedByNameSnapshot:'Owner',createdAt:'2026-10-11',emailTo:'supplier@example.invalid',status:'PLACED',branchId:'b1',supplierId:'s1',items:[{productId:'p1',productNameSnapshot:'Rice',caseQty:10,packQty:0,casePriceSnapshot:10,packPriceSnapshot:2}],manualItems:[],receivedStatus:'NEW'} as OrderRecord;
const invoice={invoiceNumber:'INV1',invoiceDate:'2026-10-11',lines:[{lineId:'p1',deliveredCaseQty:8,deliveredPackQty:0,invoicedCaseQty:10,invoicedPackQty:0,invoicedCasePrice:10,invoicedPackPrice:2,receiptConfirmed:true,isReviewed:true}]};
test('invoice separates ordered, received and billed quantities without changing dispatch',()=>{
 const updates=prepareInvoiceReview(order,invoice,owner);
 assert.equal(updates.invoiceVerification?.discrepancyTotal,20);assert.equal(updates.creditNoteClaim?.totalClaimAmount,20);
 for(const key of ['items','manualItems','receivedStatus','fulfillmentStatus','processedAt'])assert.equal((updates as any)[key],undefined);
 assert.equal(updates.invoiceVerification?.lines?.[0].invoicedCaseQty,10);
});
test('receipt cannot be assumed; drafts retain unconfirmed state',()=>{
 const unknown={...invoice,lines:[{...invoice.lines[0],deliveredCaseQty:undefined,receiptConfirmed:false}]};
 assert.throws(()=>prepareInvoiceReview(order,unknown,owner),/Confirm actual/);
 assert.equal(prepareInvoiceReview(order,{...unknown,draft:true},owner).invoiceVerification?.lines?.[0].receiptConfirmed,false);
});
test('partial damage credits only damaged quantity, not the whole invoice line',()=>{
 const updates=prepareInvoiceReview(order,{...invoice,lines:[{...invoice.lines[0],deliveredCaseQty:10,damagedCaseQty:2,damagedPackQty:0,issueType:'DAMAGED'}]},owner);
 assert.equal(updates.creditNoteClaim?.totalClaimAmount,20);
 assert.throws(()=>prepareInvoiceReview(order,{...invoice,lines:[{...invoice.lines[0],issueType:'DAMAGED'}]},owner),/damaged or rejected/);
});
test('server retains historical prices and rejects forged order lines or damaged evidence',()=>{
 const updates=prepareInvoiceReview(order,{...invoice,lines:[{...invoice.lines[0],expectedCasePrice:1}]},owner);assert.equal(updates.invoiceVerification?.lines?.[0].expectedCasePrice,10);
 assert.throws(()=>prepareInvoiceReview(order,{...invoice,lines:[{...invoice.lines[0],lineId:'other'}]},owner),/not part/);
 assert.throws(()=>prepareInvoiceReview(order,{...invoice,evidence:[{lineId:'p1',dataUrl:'https://example.com'}]},owner),/photograph/);
});
test('recognition reads invoice total and detects explicit zero prices',()=>{
 assert.equal(documentRow({itemCode:'001',rawDescription:'Rice',totalPrice:12,casePrice:0}).lineTotal,12);
 assert.equal(documentRow({PriceBox:'0'}).casePrice,'0');
});
test('the largest current supplier catalogue fits one atomic save with all price proposals',()=>{
 const products=Array.from({length:206},(_,i)=>({...p,id:'p'+i,itemCode:'SKU'+i}));
 const request={...body,rows:products.map(product=>({id:product.id,expected:productFingerprint(product),values:{casePrice:12}})),sequence:products.map(p=>p.id)};
 const plan=planProductChanges(owner,{},request,products,cats,[]);
 assert.equal(plan.updates.length,206);assert.equal(plan.notices.length,206);assert.ok(plan.updates.length+plan.notices.length+2<500);
});


test('reordering rejects a partial or stale catalogue sequence instead of colliding with omitted positions',()=>{
 const other={...p,id:'p2',itemCode:'002'};
 assert.throws(()=>planProductChanges(owner,{}, {...body,sequence:[p.id]},[p,other],cats,[]),/catalogue changed or is incomplete/);
 const rows=[p,other].map(product=>({id:product.id,expected:productFingerprint(product),values:{}}));
 const result=planProductChanges(owner,{}, {...body,rows,sequence:['p2','p1']},[p,other],cats,[]);
 assert.equal(result.updates.find(u=>u.id==='p1')?.changes.cataloguePosition,2);assert.equal(result.updates.find(u=>u.id==='p2')?.changes.cataloguePosition,1);
 assert.equal(result.notices.length,0);
});
