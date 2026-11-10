import test from 'node:test';
import assert from 'node:assert/strict';
import {hasIncomingBranchScope,incomingSupplierBranches,incomingOrderSupplierIds,orderScopeKey} from '../shared/order-scope.ts';
import {supplierDispatchAccess} from '../shared/dispatch-access.ts';
import {saveFulfillment} from '../server/fulfillment-workflow-service.ts';

const branches=[{id:'ealing',name:'Ealing',active:true,actsAsSupplier:false},{id:'cpu',name:'CPU',active:true,actsAsSupplier:true},{id:'sushi',name:'Sushi',active:true,actsAsSupplier:true},{id:'closed',name:'Closed',active:false,actsAsSupplier:true}];
const suppliers=[{id:'internal-cpu',name:'CPU supplier',active:true,linkedBranchId:'cpu'},{id:'internal-sushi',name:'Sushi supplier',active:true,linkedBranchId:'sushi'},{id:'external',name:'External',active:true}];
const user={id:'manager',role:'MANAGER',active:true,branchId:'ealing'};

test('incoming needs an explicit supplying branch assignment, not ordering or all-branch access',()=>{
 for(const profile of [user,{...user,allBranches:true},{...user,supplierIds:['internal-cpu']},{...user,role:'GM'}]){
  assert.deepEqual(incomingSupplierBranches(profile,branches),[]);
  assert.deepEqual(incomingOrderSupplierIds(profile,suppliers,branches),[]);
 }
 const assigned={...user,branchIds:['cpu','sushi']};
 assert.deepEqual(incomingSupplierBranches(assigned,branches).map(b=>b.id),['cpu','sushi']);
 assert.deepEqual(incomingOrderSupplierIds(assigned,suppliers,branches),['cpu','internal-cpu','internal-sushi','sushi']);
 assert.equal(hasIncomingBranchScope({...assigned,active:false},'cpu'),false);
 assert.equal(hasIncomingBranchScope({...user,role:'CREATOR'},'cpu'),true);
 assert.deepEqual(incomingSupplierBranches({...user,role:'CREATOR'},branches).map(b=>b.id),['cpu','sushi']);
});

test('legacy branch IDs cannot expose an unrelated supplier with the same ID',()=>{
 const assigned={...user,branchId:'cpu'};
 assert.deepEqual(incomingOrderSupplierIds(assigned,[...suppliers,{id:'cpu',name:'External collision',active:true}],branches),['internal-cpu']);
});

test('scope keys change when incoming assignments or custom permissions change',()=>{
 for(const change of [{branchIds:['cpu']},{permissionMode:'CUSTOM',customPermissions:[]}])assert.notEqual(orderScopeKey(user),orderScopeKey({...user,...change}));
 assert.notEqual(orderScopeKey(user,{MANAGER:['view_prices']}),orderScopeKey(user,{MANAGER:[]}));
});

test('dispatch server denies another branch, even with incoming permission, and writes nothing',async()=>{
 const order={id:'o',supplierId:'internal-cpu',branchId:'ealing',status:'PLACED',items:[],manualItems:[]};
 const data=new Map<string,any>([['users/manager',user],['settings/role_permissions',{map:{MANAGER:['view_received_orders']}}],['orders/o',order],['suppliers/internal-cpu',suppliers[0]],['branches/cpu',branches[1]]]);
 const before=structuredClone(data);let writes=0;
 const db={collection:(collection:string)=>({doc:(id:string)=>({path:collection+'/'+id})}),runTransaction:(run:any)=>run({get:async(ref:any)=>({data:()=>structuredClone(data.get(ref.path))}),update:()=>{writes++;},create:()=>{writes++;}})};
 await assert.rejects(saveFulfillment(db,user.id,{orderId:'o',updates:{items:[],manualItems:[]}}),/assigned to internal supplier branch/);
 assert.equal(writes,0);assert.deepEqual(data,before);
 const assigned={...user,branchIds:['cpu']};
 assert.equal(supplierDispatchAccess(assigned as any,order as any,suppliers as any,branches as any).allowed,true);
});

test('branch, supplier and role changes discard cached incoming/history records',async()=>{
 const {useAppStore}=await import('../store.ts');
 const before=useAppStore.getState();
 const outgoing=[{id:'outgoing',createdAt:'2026-10-18'}] as any;
 const incoming=[{id:'incoming',createdAt:'2026-10-18'}] as any;
 const archived=[{id:'archived',createdAt:'2026-10-01'}] as any;
 const seed=()=>useAppStore.setState({currentUser:{...user,branchIds:['cpu'],displayName:'Sample',username:'sample@example.invalid'} as any,branches:branches as any,suppliers:suppliers as any,rolePermissions:{MANAGER:['view_received_orders']} as any,_liveOrders:outgoing,_incomingOrders:incoming,_archivedOrders:archived,orders:[...outgoing,...incoming,...archived]});
 try{
  seed();
  useAppStore.getState().setBranches([...branches] as any);
  assert.deepEqual(useAppStore.getState()._incomingOrders,incoming);
  useAppStore.getState().setBranches(branches.map(b=>b.id==='cpu'?{...b,active:false}:b) as any);
  assert.deepEqual(useAppStore.getState().orders,outgoing);
  assert.deepEqual(useAppStore.getState()._archivedOrders,[]);
  seed();
  useAppStore.getState().setSuppliers(suppliers.map(s=>s.id==='internal-cpu'?{...s,linkedBranchId:'sushi'}:s) as any);
  assert.deepEqual(useAppStore.getState().orders,outgoing);
  assert.deepEqual(useAppStore.getState()._incomingOrders,[]);
  seed();
  useAppStore.getState().setRolePermissions({MANAGER:[]} as any);
  // A role change invalidates price-bearing outgoing caches as well as incoming history.
  assert.deepEqual(useAppStore.getState().orders,[]);
  assert.deepEqual(useAppStore.getState()._archivedOrders,[]);
 }finally{useAppStore.setState(before);}
});
