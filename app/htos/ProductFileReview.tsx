import React,{useEffect,useRef,useState} from 'react';
import {useAppStore} from '../../store';
import {productFieldLabels} from '../../shared/product-editor';
import {Button} from './ui';
import {money} from './SupplierFileReview';
import './product-files.css';
import type {CatalogueDefaults} from '../../shared/catalogue-defaults';

export function CatalogueNewProductChoices({review,busy,error,onCancel,onCheck}:{review:any;busy:boolean;error:React.ReactNode;onCancel:()=>void;onCheck:(defaults:CatalogueDefaults)=>void}){
 const store=useAppStore(),[categoryId,setCategory]=useState(''),[branchScope,setScope]=useState(''),[branchIds,setBranches]=useState<string[]>([]);
 const category=review.needed.some((r:any)=>r.category),branches=review.needed.some((r:any)=>r.branches);
 const invalid=category&&!categoryId||branches&&(!branchScope||branchScope==='SELECTED'&&!branchIds.length);
 return <FileReviewFrame title={`Review CSV · ${review.supplierName}`} subtitle={review.fileSource?.name||'HTOS catalogue CSV'}>
  <p><strong>Complete the new products</strong></p><p>Choose defaults only for the missing cells listed below. Existing products and values supplied in your file keep their settings. Nothing has been saved.</p>
  <ul>{review.needed.map((r:any)=><li key={r.row}>Row {r.row} · {r.name}: {[r.category?'category':'',r.branches?'branch availability':''].filter(Boolean).join(' and ')}</li>)}</ul>
  <fieldset disabled={busy} className="h-csv-defaults">
   {category&&<label>Category for new products with no category<select aria-label="New product category" value={categoryId} onChange={e=>setCategory(e.target.value)}><option value="">Choose category</option>{store.categories.filter(c=>!c.supplierId||c.supplierId===review.supplierId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><small>For different categories, fill the Category cells in your CSV.</small></label>}
   {branches&&<><label>Availability for new products with no branch choice<select aria-label="New product branch availability" value={branchScope} onChange={e=>setScope(e.target.value)}><option value="">Choose availability</option><option value="ALL">All permitted branches</option><option value="SELECTED">Selected branches</option></select></label><p>Supplier restrictions and each user’s access still apply. All permitted branches includes eligible future branches.</p>{branchScope==='SELECTED'&&<div>{store.branches.map(b=><label key={b.id}><input type="checkbox" checked={branchIds.includes(b.id)} onChange={e=>setBranches(ids=>e.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/>{b.code} — {b.name}</label>)}</div>}</>}
  </fieldset>
  <p>Blank new prices stay unknown. New products default to Active; the next check shows their status, assigned position and all proposed changes before saving.</p>
  {error}<div className="h-file-review-actions"><Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel upload</Button><Button busy={busy} disabled={!!invalid} onClick={()=>onCheck({...(category?{categoryId}:{}),...(branches?{branchScope:branchScope as 'ALL'|'SELECTED',branchIds}: {})})}>Check changes</Button></div>
 </FileReviewFrame>;
}

export function FileReviewFrame({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start'});},[]);
 return <section className="h-product-file-review" aria-label={title}>
  <header><p className="h-file-eyebrow">Product files · Review before saving</p><h3 tabIndex={-1} ref={heading}>{title}</h3><p>{subtitle}</p></header>{children}
 </section>;
}

export function CatalogueFileReview({review,busy,error,quota,removeMissing,onRemoveMissing,onCancel,onSave}:{review:any;busy:boolean;error:React.ReactNode;quota:string;removeMissing:boolean;onRemoveMissing:(remove:boolean)=>void;onCancel:()=>void;onSave:(names:Record<string,string>)=>void}){
 const store=useAppStore(),[names,setNames]=useState<Record<string,string>>({}),[checked,setChecked]=useState(false);
 const replacement=review.mode==='replace-catalogue',removed=removeMissing?review.missing.length:0;
 const invalid=Object.values(names).some(name=>!name.trim());
 const changed=review.added+review.updated+removed>0;
 const display=(field:string,value:any,categoryLabel?:string)=>{
  if(value===undefined||value===null||value==='')return 'Not set';
  if(field==='categoryId')return categoryLabel||store.categories.find(c=>c.id===value)?.name||'Category unavailable';
  if(field==='allowedBranchIds')return !value.length?'All permitted branches':value.map((id:string)=>store.branches.find(b=>b.id===id)?.name||id).join(', ');
  if(field==='active')return value?'Active':'Inactive';
  if(field==='vatRate')return `${Number(value)*100}%`;
  return String(value);
 };
 return <FileReviewFrame title={`Review CSV · ${review.supplierName}`} subtitle={review.fileSource?.name||'HTOS catalogue CSV'}>
  <div className="h-file-operation"><strong>{replacement?'Replace complete list':'Add and update'}</strong><p>{replacement?'This complete CSV sets the supplier’s product list and active statuses. Omitted active products become inactive; past orders stay unchanged.':'New products are added and existing products updated. Missing products are kept by default. Blank optional cells keep current values. Past orders stay unchanged.'}</p></div>
  <ul className="h-file-totals" aria-label="Import totals"><li><strong>{review.added}</strong> New</li><li><strong>{review.updated}</strong> Updated</li><li><strong>{removed}</strong> Removed</li><li><strong>{review.unchanged}</strong> Unchanged</li></ul>
  {review.added>0&&<p>New products receive SystemIDs automatically. Export after saving to keep these IDs for future updates.</p>}
  {review.assignedSupplierRows>0&&<p>{review.assignedSupplierRows} rows with no SupplierID use the selected supplier: <strong>{review.supplierName}</strong>.</p>}
  <p>{review.useRowOrder?'Use CSV row order: file products come first; omitted products follow in their current relative order.':'Existing positions are kept unless you changed Position. New products with a blank Position are appended.'} Supplier restrictions and user access remain in place.</p>
  {review.orderPreview?.length>0&&<p>Position numbers are kept in step across the catalogue, CSV, order screen and checklist. Where legacy numbering needs aligning, the review lists it as a Position update; this does not change prices or branch access.</p>}
  {review.orderPreview?.length>0&&<details><summary>Review complete product order · {review.orderPreview.length} products</summary><ol>{review.orderPreview.map((p:any)=><li key={p.id}>{p.name}{p.before===null?' · New':p.before!==p.after?` · Was position ${p.before}`:''}{!p.inFile?' · Not in file; retained':''}</li>)}</ol></details>}
  {!changed&&<p role="status"><strong>No changes.</strong> These products already match HTOS.</p>}
  <p className="h-file-policy">{review.immediatePrices?'Owner prices update when you confirm. No further approval.':`${review.proposed} price changes will be submitted for approval.`} Prices are in GBP excluding VAT.</p>
  {!!review.details.length&&<div className="h-csv-review-table" tabIndex={0} role="region" aria-label={review.orderPreview?"CSV changes, in product order":"CSV changes, sorted by product code"}><table><thead><tr><th>HTOS product / code</th><th>Other changes</th><th>Case price</th><th>Unit price</th><th>Checks</th></tr></thead><tbody>{review.details.map((item:any)=>{
   const fields=item.fields.filter((field:string)=>!['name','casePrice','packPrice','id','supplierId',...(review.orderPreview?['displayOrder']:[])].includes(field));
   const name=names[item.id]??item.after.name;
   return <tr key={item.id}><td><small>{item.action==='Add'?'New product':'Update'} · {item.itemCode||'No code'}</small><input aria-label={`Product name ${item.itemCode||item.id}`} maxLength={300} disabled={busy} value={name} aria-invalid={!name.trim()} onChange={e=>{setNames(current=>({...current,[item.id]:e.target.value}));setChecked(false);}}/>{item.before.name&&item.before.name!==name&&<small>Was: {item.before.name}</small>}<small>Pack: {item.after.packSize||'Not set'}</small></td>
    <td>{fields.length?<details><summary>{fields.length} {fields.length===1?'detail':'details'}</summary><dl>{fields.map((field:string)=><div key={field}><dt>{field==='cataloguePosition'&&item.positionLabels?.before===item.positionLabels?.after?'Position numbering (order unchanged)':field==='cataloguePosition'?'Position':productFieldLabels[field]||field}</dt><dd>{item.action!=='Add'&&<><span>{display(field,field==='cataloguePosition'&&item.positionLabels?item.positionLabels.before:item.before[field],item.categoryLabels?.before)}</span><span aria-hidden="true"> → </span></>}<strong>{display(field,field==='cataloguePosition'&&item.positionLabels?item.positionLabels.after:item.after[field],item.categoryLabels?.after)}</strong></dd></div>)}</dl></details>:'Name / price only'}</td>
    {(['casePrice','packPrice'] as const).map(field=><td key={field}><small>{item.action==='Add'?'New':`Was ${money(item.before[field])}`}</small><strong>{money(item.after[field])}</strong></td>)}
    <td>{item.flags.length?item.flags.map((flag:string)=><p className="h-file-review-warning" key={flag}>{flag}</p>):<span>{item.action==='Add'?'New product':'Matched by Product ID / code'}</span>}</td>
   </tr>;
  })}</tbody></table></div>}
  {!!review.missing.length&&<section className="h-file-removals"><div><strong>{removed?`${removed} products to remove`:`${review.missing.length} missing products will be kept`}</strong>{!replacement&&<Button variant="secondary" disabled={busy} onClick={()=>{onRemoveMissing(!removeMissing);setChecked(false);}}>{removeMissing?'Keep missing products':'Remove missing products'}</Button>}</div><p>Removed items become inactive. Their Product IDs and past orders are kept.</p><details><summary>{removeMissing?'Review removed products':'View missing products'}</summary><ul>{[...review.missing].sort((a:any,b:any)=>a.itemCode.localeCompare(b.itemCode,'en-GB',{numeric:true})).map((item:any)=><li key={item.id}><strong>{item.itemCode||'No code'}</strong> · {item.name}</li>)}</ul></details></section>}
  {!!review.unchanged&&<details className="h-file-unchanged"><summary>{review.unchanged} unchanged products</summary><p>These rows already match HTOS. They will keep their current details and Product IDs.</p><ul>{review.unchangedItems?.map((p:any,i:number)=><li key={i}>{p.name}</li>)}</ul></details>}
  <div className="h-file-review-footer">{error}{quota&&<p role="alert">{quota}</p>}{invalid&&<p role="alert" className="h-file-error">Enter a name for every product before saving.</p>}
   {changed&&<label className="h-file-check"><input type="checkbox" disabled={busy} checked={checked} onChange={e=>setChecked(e.target.checked)}/>I checked the products, price warnings{removed?' and removals':''} above.</label>}
   <div className="h-file-review-actions"><span>Past orders stay unchanged.</span><Button variant="secondary" disabled={busy} onClick={onCancel}>{changed?'Cancel upload':'Done'}</Button>{changed&&<Button busy={busy} disabled={invalid||!checked||!!quota} onClick={()=>onSave(names)}>{removed?`Confirm & save · remove ${removed}`:'Confirm & save'}</Button>}</div>
  </div>
 </FileReviewFrame>;
}
