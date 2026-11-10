import {useState} from 'react';
import {can,useAppStore} from '../../store';
import {useSupplierProducts} from '../../hooks/useSupplierProducts';
import {isSupplierEligibleForOrder,isUserAuthorizedForBranch} from '../../utils/accessControl';
import {OrderChecklist} from './OrderBuilderParts';
import {Empty,Field,Heading} from './ui';
import './checklists.css';

export default function Checklists(){
 const store=useAppStore(),user=store.currentUser;
 const [chosenBranch,setBranch]=useState(''),[chosenSupplier,setSupplier]=useState('');
 const branches=store.branches.filter(branch=>branch.active&&isUserAuthorizedForBranch(user,branch.id));
 const branch=branches.find(branch=>branch.id===chosenBranch)||(branches.length===1?branches[0]:undefined);
 const suppliers=store.suppliers.filter(supplier=>isSupplierEligibleForOrder(user,supplier,branch?.id||'',undefined,can(user,'create_orders')));
 const supplier=suppliers.find(supplier=>supplier.id===chosenSupplier);
 const {ready,error}=useSupplierProducts(supplier?.id||'');
 const products=store.products.filter(product=>product.active&&product.supplierId===supplier?.id&&(!product.allowedBranchIds?.length||product.allowedBranchIds.includes(branch?.id||'')));
 const categories=store.categories.filter(category=>category.active&&(!category.supplierId||category.supplierId===supplier?.id));
 return <>
  <Heading eyebrow="PRINT A CHECKLIST" title="Order checklist">Print a blank checklist without starting an order. No delivery date needed.</Heading>
  {!branches.length?<Empty title="No branches available">Ask your administrator to check your branch access.</Empty>:<section className="h-panel h-checklist-picker" aria-label="Choose a checklist">
   <div className="h-checklist-selectors">
    {branches.length===1?<div className="h-checklist-branch"><span>Branch</span><strong>{branch?.name}</strong></div>:<Field label="Branch" hint="Choose the branch to show its available suppliers and products."><select aria-label="Branch" value={branch?.id||''} onChange={event=>{setBranch(event.target.value);setSupplier('');}}><option value="">Select branch</option>{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>}
    <Field label="Supplier"><select aria-label="Supplier" disabled={!branch} value={supplier?.id||''} onChange={event=>setSupplier(event.target.value)}><option value="">Select supplier</option>{suppliers.map(supplier=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
   </div>
   {error?<p className="h-notice error" role="alert">{error}</p>:supplier&&!ready?<p role="status">Loading this supplier’s checklist…</p>:supplier&&ready?<div className="h-checklist-ready"><div><strong>{supplier.name}</strong><p>{products.length} active products available to this branch · Blank quantity boxes</p></div>{products.length?<OrderChecklist key={branch?.id+':'+supplier.id} checklistProducts={products} categories={categories} supplierName={supplier.name}/>:<p>No active products available for this branch and supplier.</p>}</div>:<p className="h-checklist-hint">{!branch?'Select a branch, then a supplier to open its checklist.':!suppliers.length?'No suppliers are available with your current access. Ask your administrator to check your assignments.':'Select a supplier to preview and print its checklist.'}</p>}
  </section>}
 </>;
}
