import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDeliveryDate,deliveryDateBounds} from '../utils/deliveryScheduler.ts';
import {validateOrderLines} from '../shared/order-entry.ts';
import {supplierDispatchAccess} from '../shared/dispatch-access.ts';
import {saveOrderEntry} from '../server/order-entry-service.ts';
import {saveFulfillment} from '../server/fulfillment-workflow-service.ts';
import {orderEmailRouting} from '../server/email-service.ts';
const now=new Date('2026-10-11T12:00:00Z');
const supplier:any={id:'supplier',name:'Kitchen',active:true,linkedBranchId:'warehouse',allBranches:true,deliveryRules:{default:[0,1,2,3,4,5,6]},email:'supplier@example.test'};
const branch:any={id:'branch',name:'Ordering branch',active:true,email:'branch@example.test'};
const warehouse:any={id:'warehouse',name:'Warehouse',active:true,actsAsSupplier:true};
const user:any={id:'user',displayName:'Tester',active:true,role:'STAFF',branchId:'branch'};
const item:any={productId:'rice',productNameSnapshot:'Rice',caseQty:1,packQty:0,casePriceSnapshot:10,packPriceSnapshot:2,vatRate:0};
const order:any={id:'order',branchId:'branch',supplierId:'supplier',orderedByUserId:'user',createdAt:now.toISOString(),status:'PLACED',deliveryDate:'2026-10-14',items:[item],manualItems:[],comments:''};
function database(extra:Record<string,any>={}){
 const data:Record<string,any>={'users/user':user,'branches/branch':branch,'branches/warehouse':warehouse,'suppliers/supplier':supplier,'products/rice':{id:'rice',name:'Rice',supplierId:'supplier',active:true,casePrice:10,packPrice:2},...extra};
 let writes=0;
 const ref=(path:string)=>({path});
 const tx={get:async(r:any)=>({data:()=>data[r.path],exists:!!data[r.path]}),set:(r:any,v:any)=>{data[r.path]=v;writes++;},update:(r:any,v:any)=>{data[r.path]={...data[r.path],...v};writes++;},create:(r:any,v:any)=>{data[r.path]=v;writes++;}};
 return {data,get writes(){return writes;},collection:(c:string)=>({doc:(id='audit')=>ref(c+'/'+id)}),runTransaction:async(fn:any)=>fn(tx)};
}
test('seven calendar days is inclusive; day eight, invalid dates, past and today are rejected',()=>{
 assert.deepEqual(deliveryDateBounds(now),{min:'2026-10-12',max:'2026-10-18'});
 assert.equal(validateDeliveryDate('2026-10-18',supplier,'branch',now).valid,true);
 for(const date of ['2026-10-19','2026-10-11','2026-10-10','2026-02-30','2026-10-12junk']) assert.equal(validateDeliveryDate(date,supplier,'branch',now).valid,false,date);
});
test('London calendar bounds survive spring/autumn DST and UTC midnight differences',()=>{
 assert.deepEqual(deliveryDateBounds(new Date('2026-10-24T23:30:00Z')),{min:'2026-10-26',max:'2026-11-01'});
 assert.deepEqual(deliveryDateBounds(new Date('2026-03-28T12:00:00Z')),{min:'2026-03-29',max:'2026-04-04'});
});
test('supplier closed days and cutoff remain enforced inside the seven-day window',()=>{
 assert.equal(validateDeliveryDate('2026-10-18',undefined,'branch',now).valid,false);
 assert.match(validateDeliveryDate('2026-10-12',supplier,'branch',new Date('2026-10-11T22:30:00Z')).error!,/cutoff/);
});
test('missing names and quantities fail before review; valid Chinese names work',()=>{
 assert.throws(()=>validateOrderLines([item],[{id:'c',description:' ',caseQty:1,packQty:0}]),/Custom item 1: enter a name/);
 assert.throws(()=>validateOrderLines([item],[{id:'c',description:'测试',caseQty:0,packQty:0}]),/enter a box or unit quantity/);
 assert.throws(()=>validateOrderLines([{...item,productNameSnapshot:''}],[]),/enter a name/);
 assert.throws(()=>validateOrderLines([{...item,caseQty:0}],[]),/quantity/);
 assert.throws(()=>validateOrderLines([{...item,caseQty:21}],[]),/0 to 20/);
 assert.doesNotThrow(()=>validateOrderLines([item],[{id:'c',description:'测试',caseQty:0,packQty:2}]));
});
test('only workspace owner bypasses supplier branch assignment',()=>{
 for(const role of ['CREATOR','GM','MANAGER','STAFF']){
  assert.equal(supplierDispatchAccess({...user,role,allBranches:true},order,[supplier],[warehouse]).allowed,role==='CREATOR');
  assert.equal(supplierDispatchAccess({...user,role,branchIds:['warehouse']},order,[supplier],[warehouse]).allowed,true);
 }
 for(const b of [{...warehouse,active:false},{...warehouse,actsAsSupplier:false}])assert.equal(supplierDispatchAccess({...user,branchId:'warehouse'},order,[supplier],[b]).allowed,false);
 assert.equal(supplierDispatchAccess({...user,branchId:'warehouse'},{...order,status:'DRAFT'},[supplier],[warehouse]).allowed,false);
});
test('minimum warning uses saved supplier and authoritative prices, allows sending, survives retry and supplier changes',async()=>{
 const db=database({'suppliers/supplier':{...supplier,minimumOrderAmount:100,branchMinimumOrderAmounts:{branch:50}}});
 const body={mode:'create',order:{...order,minimumOrderCheck:{minimum:0,needsFollowUp:false}}};
 const first=await saveOrderEntry(db,'user',body,now);
 assert.equal(first.order.status,'PLACED');assert.equal(first.order.minimumOrderCheck.shortfall,40);assert.equal(first.order.minimumOrderCheck.needsFollowUp,true);
 db.data['suppliers/supplier'].minimumOrderAmount=200;db.data['suppliers/supplier'].branchMinimumOrderAmounts.branch=70;
 assert.deepEqual((await saveOrderEntry(db,'user',body,now)).order.minimumOrderCheck,first.order.minimumOrderCheck);
 assert.equal(db.writes,1);
});
test('draft save remains allowed below minimum and recalculates on placement',async()=>{
 const db=database({'suppliers/supplier':{...supplier,minimumOrderAmount:50}});
 const first=await saveOrderEntry(db,'user',{mode:'create',order:{...order,status:'DRAFT'}},now);
 db.data['suppliers/supplier'].minimumOrderAmount=60;
 const placed=await saveOrderEntry(db,'user',{mode:'edit',expectedRevision:1,order:{...first.order,status:'PLACED'}},now);
 assert.equal(placed.order.minimumOrderCheck.shortfall,50);assert.equal(placed.order.status,'PLACED');
});
test('server rejects day eight without writing any order',async()=>{
 const db=database();await assert.rejects(saveOrderEntry(db,'user',{mode:'create',order:{...order,deliveryDate:'2026-10-19'}},now),/7 days/);assert.equal(db.writes,0);
});
test('server persists validated snapshots and identical retries reuse the order',async()=>{
 const db=database();const body={mode:'create',order};const first=await saveOrderEntry(db,'user',body,now);const second=await saveOrderEntry(db,'user',body,now);
 assert.equal(db.writes,1);assert.deepEqual(first.order,second.order);assert.equal(first.order.items[0].casePriceSnapshot,10);
 await assert.rejects(saveOrderEntry(db,'user',{...body,order:{...order,comments:'duplicate changed'}},now),/already saved/);
});
test('server rejects invalid custom items, unauthorized scope, revoked submit and unavailable products',async()=>{
 await assert.rejects(saveOrderEntry(database(),'user',{mode:'create',order:{...order,manualItems:[{id:'c',description:'',caseQty:2,packQty:0}]}},now),/name/);
 for(const extra of [{'users/user':{...user,branchId:'other'}},{'users/user':{...user,permissionMode:'CUSTOM',customPermissions:['create_orders']}},{'products/rice':{name:'Rice',supplierId:'supplier',active:false}}]){
  const db=database(extra);await assert.rejects(saveOrderEntry(db,'user',{mode:'create',order},now));assert.equal(db.writes,0);
 }
});
test('draft edit preserves original identity and rejects stale concurrent saves',async()=>{
 const db=database();const draft={...order,status:'DRAFT'};await saveOrderEntry(db,'user',{mode:'create',order:draft},now);
 const original=db.data['orders/order'];
 await assert.rejects(saveOrderEntry(db,'user',{mode:'edit',expectedRevision:0,order:{...original,comments:'edited'}},now),/changed/);
 const result=await saveOrderEntry(db,'user',{mode:'edit',expectedRevision:1,order:{...original,status:'PLACED'}},now);
 assert.equal(result.order.createdAt,original.createdAt);assert.equal(result.order.status,'PLACED');
});
test('server dispatch allows unassigned owner and preserves branch restrictions for other roles',async()=>{
 const changes={items:[{...item,sentCaseQty:1,sentPackQty:0}],manualItems:[]};
 const db=database({'users/user':{...user,role:'CREATOR'},'orders/order':order});
 await saveFulfillment(db,'user',{orderId:'order',updates:changes});assert.equal(db.data['orders/order'].receivedStatus,'PROCESSED');
 db.data['orders/order']=order; db.data['users/user']={...user,role:'GM'};
 await assert.rejects(saveFulfillment(db,'user',{orderId:'order',updates:changes}),/Only staff assigned/);
 db.data['users/user']={...user,branchIds:['warehouse']};await saveFulfillment(db,'user',{orderId:'order',updates:changes});assert.equal(db.data['orders/order'].receivedStatus,'PROCESSED');
});
test('routing includes exact supplier, branch and saved copies without exposing SMTP secrets',()=>{
 const route=orderEmailRouting(branch,supplier,{user:branch.email,pass:'private-password',host:'smtp.example.test',port:465,secure:true,cc:['audit@example.test']},{});
 assert.deepEqual(route.to,['supplier@example.test']);assert.deepEqual(route.cc,['branch@example.test','info@hareandtortoise.co.uk','audit@example.test']);assert.equal(route.replyTo,branch.email);
 assert.doesNotMatch(JSON.stringify(route),/private-password|smtp.example.test/);
 const changed=orderEmailRouting(branch,{...supplier,email:'changed@example.test'},{user:branch.email,pass:'p',host:'smtp.example.test'},{});
 assert.notEqual(route.routeKey,changed.routeKey);
});

test('server accepts 20 per field and rejects 21 for catalogue and custom lines without writes',async()=>{
 for(const custom of [false,true])for(const field of ['caseQty','packQty']){
  for(const quantity of [20,21]){
   const db=database();
   const line={...item,[field]:quantity};
   const candidate={...order,items:custom?[]:[line],manualItems:custom?[{id:'custom',description:'Sample custom item',caseQty:0,packQty:0,[field]:quantity}]:[]};
   const before=JSON.stringify(candidate);
   if(quantity===21){
    await assert.rejects(()=>saveOrderEntry(db,'user',{mode:'create',order:candidate},now),/0 to 20/);
    assert.equal(db.writes,0);
   }else{await saveOrderEntry(db,'user',{mode:'create',order:candidate},now);assert.ok(db.writes>0);}
   assert.equal(JSON.stringify(candidate),before);
  }
 }
});
