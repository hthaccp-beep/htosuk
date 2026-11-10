import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPurchaseOrderEmail} from '../shared/order-email-template';
import {renderAuthoritativeOrderEmailHtml} from '../server/email-outbox-service';
import {generateOrderEmailContent} from '../utils/orderEmail';
import {orderReference} from '../shared/order-reference';

const order:any={id:'c874c4c5-f1fd-4a43-99ca-a561266a884b',branchId:'putney',branchNameSnapshot:'Hare & Tortoise - Putney',supplierNameSnapshot:'Sample supplier',createdAt:'2026-10-12T09:36:00Z',deliveryDate:'2026-10-14',orderedByNameSnapshot:'Branch manager',items:[{productNameSnapshot:'Rice',itemCodeSnapshot:'R01',caseQty:2,packQty:1,caseUnitSnapshot:'Box',packUnitSnapshot:'Bag',casePriceSnapshot:99}],manualItems:[{description:'Special item',caseQty:0,packQty:3}],comments:'Side entrance\nRing bell'};
const branch:any={id:'putney',name:'Hare & Tortoise - Putney',address:'Sample branch address',email:'branch@example.invalid',contactPhone:'020 0000 0000',contactPerson:'Branch team'};
const supplier:any={name:'Sample supplier',contactName:'Supplier team',contactPhone:'020 1111 1111',globalAccountCode:'GLOBAL',branchAccountCodes:{putney:'PUT-01'}};

test('purchase email keeps 2027 details and list with HTOS styling and short reference',()=>{
 const html=renderPurchaseOrderEmail(order,branch,supplier);
 for(const text of ['Order Number:</strong> C874C4C5','Contact Person:','Telephone:','Email:','Delivery Date:','14 October 2026','Supplier Contact:','PUT-01','1. [R01] Rice - 2 Box, 1 Bag','2. [MISC] Special item - 3 Unit','Special Comments:','#173a31','DM Sans'])assert.ok(html.includes(text),text);
 for(const text of [order.id,'Official Purchase Order','#b91c1c','Order Qty','99','GLOBAL'])assert.ok(!html.includes(text),text);
 assert.equal(orderReference(order.id),'C874C4C5');assert.equal(orderReference('34d5b8dd'),'34D5B8DD');
});
test('server and client use exactly the same purchase email template',()=>{
 assert.equal(generateOrderEmailContent(order,branch,supplier).htmlBody,renderAuthoritativeOrderEmailHtml(order,branch,supplier));
});
test('all branch/supplier combinations use snapshots and branch-specific account codes',()=>{
 const other={...order,branchId:'other',branchNameSnapshot:'Other branch',supplierNameSnapshot:'Other supplier'};
 const html=renderPurchaseOrderEmail(other,undefined,supplier);
 assert.ok(html.includes('Other branch'));assert.ok(html.includes('Other supplier'));assert.ok(html.includes('GLOBAL'));assert.ok(!html.includes('PUT-01'));
 const offline=renderPurchaseOrderEmail(other);
 assert.ok(offline.includes('Rice'));assert.ok(offline.includes('3 Unit'));
});
test('record text cannot inject markup into the email',()=>{
 const html=renderPurchaseOrderEmail({...order,comments:'<img src=x onerror=alert(1)>',branchNameSnapshot:'A & B',items:[{...order.items[0],productNameSnapshot:'<script>test</script>',itemCodeSnapshot:'<R>'}]},{...branch,address:'<b>Address</b>'},supplier);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('A &amp; B'));assert.ok(html.includes('&lt;b&gt;Address'));
});
