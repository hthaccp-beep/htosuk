import React from 'react';
import {AdminProducts} from '../components/admin/AdminProducts';
import {SupplierProductsSource} from '../hooks/useSupplierProducts';
import {createRoot} from 'react-dom/client';
import {useAppStore} from '../store';
import {CatalogImportContext,ProductTransfer} from '../app/htos/ProductTransfer';
import {readApiResponse} from '../shared/api-response';
import '../app/htos/htos.css';
import '../app/htos/product-editor.css';
import '../app/htos/responsive.css';
import '../app/htos/design5.css';
import '../app/htos/admin.css';
import '../app/htos/settings-polish.css';

// Built only by the isolated runner with Firebase configuration replaced by null.
// The test server stores synthetic records in memory; no production endpoints exist.
async function refresh(){
 const response=await fetch('/test-state');
 if(!response.ok)throw new Error('Offline test server unavailable');
 useAppStore.setState(await response.json());
}
await refresh();
const request=async(body:any)=>{
 const response=await fetch('/test-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const value=await readApiResponse(response,body.action);
 if(body.action==='catalog-commit')await refresh();
 return value;
};
const source=(_scope:string,supplierId:string,next:any)=>{next({products:useAppStore.getState().products.filter(p=>p.supplierId===supplierId),fromCache:false});return()=>{};};
createRoot(document.getElementById('root')!).render(<main className="h-app" style={{padding:24,minHeight:'100vh'}}>
 <h1>CSV flow · offline preview</h1><p>Synthetic products only · No Firebase connection · Nothing sent to HTOS</p>
 <SupplierProductsSource.Provider value={source}>{location.hash==='#catalogue'?<div className="h-admin"><AdminProducts/></div>:<CatalogImportContext.Provider value={request}><ProductTransfer supplierId="s" onSaved={()=>{}}/></CatalogImportContext.Provider>}</SupplierProductsSource.Provider>
</main>);
