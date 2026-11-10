import React, { memo, useMemo, useRef, useState } from 'react';
import { Printer, Plus, Trash2, Search } from 'lucide-react';
import type { Category, Product, OrderItem, ManualOrderItem } from '../../types';
import { getCaseUnitLabel, getPackUnitLabel, isCaseQtyAllowed, isPackQtyAllowed } from '../../types';
import { Button, Field, Modal, Empty } from './ui';
import {lineNet} from '../../shared/order-minimum';
import {money} from './ui';
import {OrderQuantityInput} from './OrderQuantityInput';
import { checklistHtml, checklistLayout, orderedProductGroups, MAX_CUSTOM_ITEMS, MAX_ORDER_QUANTITY, orderQuantity } from './orderingHelpers';

type Props = {
  products: Product[]; checklistProducts: Product[]; categories: Category[];
  search: string; setSearch: (s:string)=>void; category: string; setCategory:(s:string)=>void;
  items:OrderItem[]; manual:ManualOrderItem[]; setManual:React.Dispatch<React.SetStateAction<ManualOrderItem[]>>;
  qty:(p:Product,u:'caseQty'|'packQty',v:string)=>void;
};
const ProductCard=memo(function ProductCard({product,item,qty}:{product:Product;item?:OrderItem;qty:Props['qty']}) {
  return <article className={`h-order-card ${item?'selected':''}`}>
    <div className="h-product-description"><strong>{product.name}</strong>{product.chineseName&&<small lang="zh" className="h-chinese-name">{product.chineseName}</small>}</div>
    <div className="h-card-quantities">{(['caseQty','packQty'] as const).map(unit=>{
      if(unit==='caseQty'?!isCaseQtyAllowed(product):!isPackQtyAllowed(product))return null;
      const label=unit==='caseQty'?getCaseUnitLabel(product):getPackUnitLabel(product);
      return <label key={unit} className={`h-quantity ${item?.[unit]?'has-quantity':''}`}>{label}<OrderQuantityInput label={`${product.name} ${label} quantity`} value={item?.[unit]||0} onChange={value=>qty(product,unit,value)}/></label>;
    })}</div>
  </article>;
});
export function OrderChecklist(p:{checklistProducts:Product[];categories:Category[];supplierName:string}) {
  const [checklist,setChecklist]=useState(false);
  const frame=useRef<HTMLIFrameElement>(null);
  const allGroups=useMemo(()=>orderedProductGroups(p.checklistProducts,p.categories),[p.checklistProducts,p.categories]);
  const printLayout=useMemo(()=>checklistLayout(allGroups.map(group=>group.products.length)),[allGroups]);
  const printDocument=useMemo(()=>checklist?checklistHtml(p.checklistProducts,p.categories,p.supplierName):'', [checklist,p.checklistProducts,p.categories,p.supplierName]);
  return <>
    <Button variant="secondary" disabled={!p.checklistProducts.length} onClick={()=>setChecklist(true)}><Printer size={16}/> Checklist</Button>
    {checklist&&<Modal title="Order checklist" onClose={()=>setChecklist(false)} wide><div className="h-checklist-intro"><div><strong>{p.supplierName}</strong><p>Full catalogue · Blank boxes for your order quantities</p></div><div className="h-checklist-badges"><span>A4 portrait</span><span>{printLayout.columns} columns</span><span>{printLayout.copies} {printLayout.copies===1?'copy':'copies'}</span></div></div><iframe ref={frame} title="Order checklist preview" className="h-checklist-preview" sandbox="allow-same-origin allow-modals" srcDoc={printDocument}/><div className="h-dialog-foot"><Button variant="secondary" onClick={()=>setChecklist(false)}>Close</Button><Button onClick={()=>{frame.current?.contentWindow?.focus();frame.current?.contentWindow?.print();}}><Printer size={16}/> Print checklist</Button></div></Modal>}
  </>;
}
export function ProductPicker(p:Props) {
  const [filtersOpen,setFiltersOpen]=useState(false);
  const selected=useMemo(()=>new Map(p.items.map(i=>[i.productId,i])),[p.items]);
  const groups=useMemo(()=>orderedProductGroups(p.products,p.categories).filter(g=>!p.category||p.category===g.products[0]?.categoryId),[p.products,p.categories,p.category]);
  const update=(id:string,changes:Partial<ManualOrderItem>)=>p.setManual(rows=>rows.map(row=>row.id===id?{...row,...changes}:row));
  return <>
    <div className={`h-toolbar h-order-toolbar ${filtersOpen?'h-filters-open':'h-filters-closed'}`}><div className="h-search"><Search size={17}/><input aria-label="Search products" placeholder="Search English, Chinese or code" value={p.search} onChange={e=>p.setSearch(e.target.value)}/></div><Button className="h-phone-filter-toggle" variant="secondary" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(value=>!value)} aria-label="Product filters">Filters{p.category?' · Active':''}</Button><select aria-label="Product category" value={p.category} onChange={e=>p.setCategory(e.target.value)}><option value="">All categories</option>{p.categories.filter(c=>p.checklistProducts.some(product=>product.categoryId===c.id)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><small>Max {MAX_ORDER_QUANTITY} per field</small></div>
    {groups.length?<div className="h-product-container">{groups.map(group=><section className="h-product-group" key={group.id}><h3>{group.name}</h3><div className="h-product-grid">{group.products.map(product=><ProductCard key={product.id} product={product} item={selected.get(product.id)} qty={p.qty}/>)}</div></section>)}</div>:<Empty title="No matching products">Try a different search or category.</Empty>}
    <div className="h-custom"><div className="h-inline-heading"><h3>Custom items · {p.manual.length}/{MAX_CUSTOM_ITEMS}</h3><Button variant="quiet" disabled={p.manual.length>=MAX_CUSTOM_ITEMS} onClick={()=>p.setManual(rows=>rows.length>=MAX_CUSTOM_ITEMS?rows:[...rows,{id:crypto.randomUUID(),description:'',caseQty:0,packQty:0,pricingStatus:'UNPRICED'}])}><Plus size={16}/> Add custom item</Button></div>{p.manual.map((m,index)=><div key={m.id} className="h-custom-card"><Field label={`Custom item ${index+1}`}><input aria-label={`Custom item ${index+1} description`} maxLength={200} placeholder="English or Chinese description" value={m.description} onChange={e=>update(m.id,{description:e.target.value})}/></Field><div className="h-card-quantities">{(['caseQty','packQty'] as const).map(unit=><label key={unit} className={`h-quantity ${m[unit]?'has-quantity':''}`}>{unit==='caseQty'?'Box':'Unit'}<OrderQuantityInput label={`Custom item ${index+1} ${unit==='caseQty'?'boxes':'units'}`} value={m[unit]} onChange={value=>update(m.id,{[unit]:orderQuantity(value)})}/></label>)}<Button variant="quiet" aria-label={`Remove custom item ${index+1}`} onClick={()=>p.setManual(rows=>rows.filter(row=>row.id!==m.id))}><Trash2 size={16}/></Button></div></div>)}</div>
  </>;
}
export function BasketContents({items,manual,products,removeItem,removeManual,showPrices=false}:{showPrices?:boolean;items:OrderItem[];manual:ManualOrderItem[];products:Product[];removeItem:(id:string)=>void;removeManual:(id:string)=>void}) {
  const byId=useMemo(()=>new Map(products.map(p=>[p.id,p])),[products]);
  const quantityText=(box:number,unit:number,boxLabel='Box',unitLabel='Unit')=>[box>0?`${box} ${boxLabel}`:'',unit>0?`${unit} ${unitLabel}`:''].filter(Boolean).join(' · ');
  return <div className="h-selected-items" aria-label="Basket contents">{!items.length&&!manual.length&&<p>No items selected yet.</p>}{items.map(i=>{const product=byId.get(i.productId);return <div key={i.productId}><div><strong>{i.productNameSnapshot}</strong>{(i.chineseNameSnapshot||product?.chineseName)&&<small lang="zh">{i.chineseNameSnapshot||product?.chineseName}</small>}</div><span className="h-basket-quantity">{quantityText(i.caseQty,i.packQty,i.caseUnitSnapshot||getCaseUnitLabel(product),i.packUnitSnapshot||getPackUnitLabel(product))}{showPrices&&<small>{lineNet(i).unpriced?`Known value ${money(lineNet(i).amount)} · price missing`:money(lineNet(i).amount)} excl. VAT</small>}</span><button className="h-icon-button" aria-label={`Remove ${i.productNameSnapshot}`} onClick={()=>removeItem(i.productId)}><Trash2 size={15}/></button></div>;})}{manual.map((m,index)=><div key={m.id}><div><strong>{m.description.trim()||`Custom item ${index+1}`}</strong><small>Custom item{showPrices?' · price not set; excluded from total':''}</small></div><span className="h-basket-quantity">{quantityText(m.caseQty,m.packQty)||'Enter quantity'}</span><button className="h-icon-button" aria-label={`Remove ${m.description||'custom item '+(index+1)} from basket`} onClick={()=>removeManual(m.id)}><Trash2 size={15}/></button></div>)}</div>;
}

