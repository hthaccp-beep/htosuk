import React,{useContext,useState} from 'react';
import {Trash2} from 'lucide-react';
import type {Product} from '../../types';
import {can,useAppStore} from '../../store';
import {hasSupplierScope} from '../../shared/order-scope';
import {CatalogImportContext} from './ProductTransfer';
import {Button,Modal,useAction} from './ui';

type Selection={id:string;expected:string;original:Product};
export function ProductBulkDelete({supplierId,selected,blocked,onSaved}:{supplierId:string;selected:Selection[];blocked:boolean;onSaved:()=>void}){
 const user=useAppStore(s=>s.currentUser),suppliers=useAppStore(s=>s.suppliers),action=useAction(),request=useContext(CatalogImportContext);
 const [review,setReview]=useState<{rows:Selection[];requestId:string}|null>(null);
 if(!user||!can(user,'manage_products')||!hasSupplierScope(user,supplierId))return null;

 const close=()=>{if(!action.busy){setReview(null);action.setError('');}};
 return <><Button variant="danger" disabled={blocked||!selected.length||selected.length>450} title={blocked?'Save or discard your edits before deleting.':selected.length>450?'Select up to 450 products at a time.':'Delete the selected products'} onClick={()=>{action.setError('');setReview({rows:[...selected],requestId:crypto.randomUUID()});}}><Trash2 size={16}/> Delete selected ({selected.length})</Button>
 {blocked&&<small>Save or discard your edits before deleting.</small>}{selected.length>450&&<small>Select up to 450 products at a time.</small>}
 {review&&<Modal title={`Delete ${review.rows.length} selected ${review.rows.length===1?'product':'products'}?`} onClose={close}>
  <p><strong>{suppliers.find(s=>s.id===supplierId)?.name}</strong></p>
  <p>Remove these active or inactive items from ordering and the product list. Past orders and their saved prices stay unchanged.</p>
  <p>Deleted items will also be removed from <strong>Show inactive</strong>.</p>
  <ul className="h-import-change-list">{review.rows.map(row=><li key={row.id}><strong>{row.original.name}</strong><span>{row.original.itemCode||'No supplier code'}{row.original.active===false?' · Inactive':''}</span></li>)}</ul>
  {action.feedback}<div className="h-dialog-foot"><Button variant="secondary" disabled={action.busy} onClick={close}>Cancel</Button><Button variant="danger" busy={action.busy} onClick={()=>action.run(async()=>{
   const result=await request({action:'product-remove',supplierId,requestId:review.requestId,rows:review.rows.map(({id,expected})=>({id,expected}))});
   const ids=review.rows.map(row=>row.id);
   if(result?.success!==true||typeof result.removedAt!=='string'||!Number.isFinite(Date.parse(result.removedAt))||!Array.isArray(result.productIds)||result.productIds.length!==ids.length||new Set(result.productIds).size!==ids.length||result.productIds.some((id:string)=>!ids.includes(id)))throw new Error('Deletion could not be confirmed. Keep this selection and try again.');
   const store=useAppStore.getState();store.setProducts(store.products.map(p=>ids.includes(p.id)?{...p,active:false,removedAt:p.removedAt||result.removedAt}:p));
   store.showToast('success',`${result.removed} products deleted from the catalogue. Past orders are unchanged.`);
   setReview(null);onSaved();
  },'')}>Delete selected</Button></div>
 </Modal>}</>;
}
