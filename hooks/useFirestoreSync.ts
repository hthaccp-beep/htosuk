import {assignedSuppliers} from '../shared/order-scope.ts';
import {subscribeProtectedRecords} from '../utils/secureRead';
import {useEffect,useMemo} from 'react';
import {collection,onSnapshot,query,where,doc,limit} from 'firebase/firestore';
import {db} from '../firebase-config';
import {can,useAppStore} from '../store';
import {useDatabaseStatus,reportDatabaseError} from './databaseStatus';
import {shareFirestore} from './sharedFirestore';
import {useSyncRequests} from './syncRequests';
import {syncDemand} from '../shared/sync-demand';
import {mergeProductSnapshot} from '../shared/product-snapshot';
import {incomingOrderSupplierIds,outgoingOrderPartitions,orderScopeKey} from '../shared/order-scope.ts';
import {subscribeOrderPartitions} from '../utils/orderQueries.ts';
import {shouldRetainInLiveSync} from '../utils/orderLifecycle';
import {LIVE_SYNC_DAYS} from '../constants';
import {addLog} from '../logger';
import type {User,OrderRecord} from '../types';

const handleError=(context:string)=>(error:any)=>{
 reportDatabaseError(error);
 if(error.code!=='unavailable')addLog('error',`Data sync: ${context}: ${error.message}`);
};
const rows=(snap:any)=>snap.docs.map((d:any)=>({...d.data(),id:d.id}));
const orders=(snap:any)=>snap.docs.map((d:any)=>({...d.data(),id:d.id,_hasPendingWrites:d.metadata.hasPendingWrites})) as OrderRecord[];
function listen(scope:string,key:string,ref:any,select:(snap:any)=>any,apply:(value:any)=>void,request?:Record<string,unknown>){
 if(request&&!can(useAppStore.getState().currentUser,'view_prices'))return shareFirestore(scope,key,(next,error)=>subscribeProtectedRecords(request,next,error),apply,handleError(key));
 return shareFirestore(scope,key,(next,error)=>onSnapshot(ref,snap=>next(select(snap)),error),apply,handleError(key));
}
function useCollection(scope:string,name:string,needed:boolean,apply:(value:any[])=>void){
 useEffect(()=>{if(!scope||!needed)return;return listen(scope,name,collection(db,name),rows,apply);},[scope,name,needed,apply]);
}
function usePriceCollection(scope:string,name:string,needed:boolean,apply:(value:any[])=>void){
 useEffect(()=>{
  const user=useAppStore.getState().currentUser;
  if(!scope||!needed||!user||!can(user,'view_prices')){apply([]);return;}
  const ids=assignedSuppliers(user);if(ids===null)return listen(scope,name,collection(db,name),rows,apply);
  const buckets=new Map<string,any[]>();apply([]);
  const stops=ids.map(id=>listen(scope,name+':'+id,query(collection(db,name),where('supplierId','==',id)),rows,value=>{buckets.set(id,value);apply([...buckets.values()].flat());}));
  return()=>stops.forEach(stop=>stop());
 },[scope,name,needed,apply]);
}
function useSetting(scope:string,name:string,needed:boolean,apply:(value:any)=>void){
 useEffect(()=>{if(!scope||!needed)return;return listen(scope,'settings/'+name,doc(db,'settings',name),snap=>snap.exists()?snap.data():null,value=>{if(value)apply(value);});},[scope,name,needed,apply]);
}
const applyPermissions=(value:any)=>{if(value.map)useAppStore.getState().setRolePermissions(value.map);};
const applyEmail=(value:any)=>{const sanitized={...value};delete sanitized.smtpPass;useAppStore.getState().setEmailConfig(sanitized);};

export function useFirestoreSync(currentUser:User|null,location='*'){
 const permissions=useAppStore(s=>s.rolePermissions);
 const demand=syncDemand(location),userScope=orderScopeKey(currentUser)+JSON.stringify(permissions),incomingPage=location.split('?')[0]==='/deliveries';
 const quota=useDatabaseStatus(s=>s.quotaMessage);
 const scope=currentUser?.active&&!quota?userScope:'',baseScope=currentUser?.active&&!quota?orderScopeKey(currentUser):'';
 const suppliers=useAppStore(s=>s.suppliers),branches=useAppStore(s=>s.branches),rolePermissions=useAppStore(s=>s.rolePermissions),requests=useSyncRequests(s=>s.requests);
 const incomingKey=useMemo(()=>JSON.stringify(currentUser&&can(currentUser,'view_received_orders')?incomingOrderSupplierIds(currentUser,suppliers,branches):[]),[userScope,suppliers,branches,rolePermissions]);
 if(incomingPage&&incomingKey==='[]'){demand.orders=false;demand.products=false;}
 const actions=useAppStore.getState();
 useCollection(baseScope,'branches',true,actions.setBranches);
 useCollection(baseScope,'suppliers',true,actions.setSuppliers);
 useSetting(baseScope,'role_permissions',true,applyPermissions);
 useCollection(baseScope,'users',demand.users,actions.setUsers);
 useCollection(baseScope,'roles',demand.roles,actions.setRoles);
 useCollection(baseScope,'departments',demand.departments,actions.setDepartments);
 useCollection(baseScope,'categories',demand.categories,actions.setCategories);
 usePriceCollection(scope,'price_history',demand.priceHistory,actions.setPriceHistory);
 usePriceCollection(scope,'new_item_notices',demand.newItems,actions.setNewItemNotices);
 usePriceCollection(scope,'price_change_notices',demand.priceNotices,actions.setPriceChangeNotices);
 useSetting(baseScope,'email_config',demand.email,applyEmail);
 useSetting(baseScope,'price_monitoring',demand.priceSettings,actions.setPriceMonitoringSettings);

 const supplierKey=JSON.stringify([...new Set(Object.values(requests).map(r=>r.supplierId).filter(Boolean))].sort());
 const productKey=demand.products?'all':supplierKey!=='[]'?'suppliers:'+supplierKey:demand.productExists?'exists':'none';
 useEffect(()=>{
  if(!scope||productKey==='none')return;
  const assigned=currentUser?assignedSuppliers(currentUser):[];
  if(productKey==='all'&&assigned===null)return listen(scope,'products',collection(db,'products'),rows,actions.setProducts,{resource:'products'});
  if(productKey==='exists'&&assigned===null)return listen(scope,'products:exists',query(collection(db,'products'),limit(1)),rows,value=>actions.setProducts(mergeProductSnapshot(useAppStore.getState().products,value)),{resource:'products',existsOnly:true});
  let disposed=false;
  const stops=((productKey==='all'?assigned:JSON.parse(supplierKey)) as string[]).map(id=>listen(scope,'products:supplier:'+id,query(collection(db,'products'),where('supplierId','==',id)),rows,value=>{
   if(disposed)return;actions.setProducts(mergeProductSnapshot(useAppStore.getState().products,value,id));
  },{resource:'products',supplierId:id}));
  return()=>{disposed=true;stops.forEach(stop=>stop());};
 },[scope,productKey]);

 // Identical tabs use the same day-boundary query, rather than different millisecond cutoffs.
 const cutoff=useMemo(()=>{const date=new Date(Date.now()-LIVE_SYNC_DAYS*86400000);date.setUTCHours(0,0,0,0);return date.toISOString();},[scope]);
 useEffect(()=>{
  if(incomingPage){actions.syncLiveOrders([]);return;}
  if(!scope||!currentUser||!demand.orders)return;
  const partitions=outgoingOrderPartitions(currentUser),global=partitions.some(p=>!p.branchId&&!p.supplierId);
  if(!global)return subscribeOrderPartitions(db,partitions,value=>actions.syncLiveOrders(value.filter(o=>shouldRetainInLiveSync(o,cutoff))),handleError('Outgoing Orders'),scope,!can(currentUser,'view_prices'));
  let recent:OrderRecord[]=[],open:OrderRecord[]=[];
  const publish=()=>{const merged=new Map<string,OrderRecord>();for(const order of [...open,...recent])merged.set(order.id,order);actions.syncLiveOrders([...merged.values()].filter(o=>shouldRetainInLiveSync(o,cutoff)));};
  const stopRecent=listen(scope,'orders:recent:'+cutoff,query(collection(db,'orders'),where('createdAt','>=',cutoff)),orders,value=>{recent=value;publish();},{resource:'orders',start:cutoff});
  const stopOpen=listen(scope,'orders:open',query(collection(db,'orders'),where('receivedStatus','==','NEW')),orders,value=>{open=value;publish();},{resource:'orders',openOnly:true});
  return()=>{stopRecent();stopOpen();};
 },[scope,demand.orders,cutoff,incomingPage]);
 useEffect(()=>{
  if(!scope||!currentUser||!demand.orders){actions.syncIncomingOrders([]);return;}
  const outgoing=outgoingOrderPartitions(currentUser);
  // If outgoing already covers a supplier, no second listener is necessary.
  const global=outgoing.some(p=>!p.branchId&&!p.supplierId);
  const partitions=!incomingPage&&global?[]:(JSON.parse(incomingKey) as string[]).filter(id=>incomingPage||!outgoing.some(p=>!p.branchId&&p.supplierId===id)).map(supplierId=>({supplierId}));
  return subscribeOrderPartitions(db,partitions,value=>actions.syncIncomingOrders(value.filter(o=>shouldRetainInLiveSync(o,cutoff))),handleError('Incoming Orders'),scope,!can(currentUser,'view_prices'));
 },[scope,demand.orders,incomingKey,cutoff,incomingPage]);
 const sourceKey=JSON.stringify([...new Set(Object.values(requests).map(r=>r.sourceOrderId).filter(Boolean))].sort());
 useEffect(()=>{
  if(!scope||demand.orders||sourceKey==='[]')return;
  let disposed=false;
  const stops=(JSON.parse(sourceKey) as string[]).map(id=>listen(scope,'order:'+id,doc(db,'orders',id),snap=>snap.exists()?{...snap.data(),id:snap.id}:null,value=>{
   if(!disposed&&value)actions.appendArchivedOrders(Array.isArray(value)?value:[value]);
  },{resource:'orders',id}));
  return()=>{disposed=true;stops.forEach(stop=>stop());};
 },[scope,demand.orders,sourceKey]);
}
