import {subscribeProtectedRecords} from '../utils/secureRead';
import {createContext,useContext,useEffect,useState} from 'react';
import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../firebase-config';
import {can,useAppStore} from '../store';
import {shareFirestore} from './sharedFirestore';
import {useDatabaseStatus,reportDatabaseError} from './databaseStatus';
import {orderScopeKey} from '../shared/order-scope';
import {mergeProductSnapshot} from '../shared/product-snapshot';
import {databaseErrorMessage} from '../shared/database-errors';
import type {Product} from '../types';

type Snapshot={products:Product[];fromCache:boolean};
type Source=(scope:string,supplierId:string,next:(value:Snapshot)=>void,error:(error:any)=>void,fullIntegrity:boolean)=>()=>void;
const liveSource:Source=(scope,supplierId,next,error,fullIntegrity)=>shareFirestore(scope,fullIntegrity?'catalogue:integrity':'catalogue:supplier:'+supplierId,
 (publish,fail)=>!can(useAppStore.getState().currentUser,'view_prices')?subscribeProtectedRecords({resource:'products',...(fullIntegrity?{}:{supplierId})},products=>publish({products,fromCache:false}),fail):onSnapshot(fullIntegrity?collection(db,'products'):query(collection(db,'products'),where('supplierId','==',supplierId)),{includeMetadataChanges:true},snapshot=>publish({products:snapshot.docs.map(d=>({...d.data(),id:d.id}) as Product),fromCache:snapshot.metadata.fromCache}),fail),next,error);
// The offline preview injects synthetic records; production always uses the scoped listener.
export const SupplierProductsSource=createContext<Source>(liveSource);

export function useSupplierProducts(supplierId:string,fullIntegrity=false){
 const source=useContext(SupplierProductsSource),user=useAppStore(s=>s.currentUser),quota=useDatabaseStatus(s=>s.quotaMessage);
 const permissions=useAppStore(s=>s.rolePermissions);
 const scope=user?.active?orderScopeKey(user)+JSON.stringify(permissions):'',key=JSON.stringify([scope,supplierId,fullIntegrity]);
 const [state,setState]=useState({key:'',ready:false,error:''});
 useEffect(()=>{
  if(!scope||!supplierId||quota){setState({key,ready:false,error:''});return;}
  let disposed=false;
  setState({key,ready:false,error:''});
  const stop=source(scope,supplierId,value=>{
   if(disposed)return;
   // An empty local cache is not evidence of an empty supplier catalogue.
   if(value.fromCache){setState({key,ready:false,error:''});return;}
   const store=useAppStore.getState();
   store.setProducts(fullIntegrity?value.products:mergeProductSnapshot(store.products,value.products,supplierId));
   setState({key,ready:true,error:''});
  },error=>{
   if(disposed)return;
   reportDatabaseError(error);
   setState({key,ready:false,error:databaseErrorMessage(error,'This supplier’s products could not be loaded. Select the supplier again to retry.')});
  },fullIntegrity);
  return()=>{disposed=true;stop();};
 },[source,scope,supplierId,key,quota,fullIntegrity]);
 return {ready:!!scope&&!!supplierId&&!quota&&state.key===key&&state.ready,error:quota||(state.key===key?state.error:'')};
}
