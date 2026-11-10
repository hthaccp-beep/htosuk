import type { Category, ManualOrderItem, OrderItem, Product, Supplier, User, Branch } from '../../types';
import { incomingOrderSupplierIds } from '../../shared/order-scope.ts';
import {productSequence} from '../../shared/product-workbench';

import {MAX_ORDER_QUANTITY} from '../../shared/order-entry.ts';
export {MAX_ORDER_QUANTITY};
export const MAX_CUSTOM_ITEMS = 5;
export function isOrderQuantityText(value: string) {
  return !/[^0-9]/.test(value);
}
export function orderQuantity(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(MAX_ORDER_QUANTITY, Math.max(0, Math.floor(number))) : 0;
}
export function validateBasketQuantities(items: OrderItem[], manual: ManualOrderItem[]) {
  if (manual.length > MAX_CUSTOM_ITEMS) throw new Error('An order can contain up to 5 custom items.');
  if ([...items, ...manual].some(item => [item.caseQty, item.packQty].some(q => !Number.isInteger(q) || q < 0 || q > MAX_ORDER_QUANTITY))) {
    throw new Error(`Enter a whole quantity from 0 to ${MAX_ORDER_QUANTITY} in each box or unit field.`);
  }
}
export function incomingSupplierIds(user: User, suppliers: Supplier[], branches: Branch[], branchId = '') {
  return new Set(incomingOrderSupplierIds(user,suppliers,branches.filter(b=>!branchId||b.id===branchId)));
}
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

const sortValue = (value: unknown) => value == null || value === '' || !Number.isFinite(Number(value)) ? 999 : Number(value);
export function orderedProductGroups(products: Product[], categories: Category[]) {
  const activeCategories = new Map(categories.filter(c=>c.active!==false).map(c=>[c.id,c]));
  const groups = new Map<string,{id:string;name:string;products:Product[]}>();
  // Catalogue positions order products within each category. Do not split a
  // category when an imported catalogue interleaves it with another category.
  for(const p of productSequence(products,categories)){
    const cat=activeCategories.get(p.categoryId);
    const id=p.categoryId||'__uncategorized__';
    const group=groups.get(id);
    if(group)group.products.push(p);
    else groups.set(id,{id,name:cat?.name||'Other Items',products:[p]});
  }
  const categoryIndex = new Map(categories.map((category,index)=>[category.id,index]));
  return [...groups.values()].sort((a,b)=>{
    const catA=activeCategories.get(a.id),catB=activeCategories.get(b.id);
    if(!catA||!catB)return Number(!catA)-Number(!catB);
    return sortValue(catA.displayOrder)-sortValue(catB.displayOrder)
      || (categoryIndex.get(a.id)!-categoryIndex.get(b.id)!);
  });
}
// Dimensions match OrderSystem2027: 285mm safe height, 10mm heading,
// 4.2mm category/product rows and a 6mm cut strip between copies.
export function checklistLayout(counts: number[]) {
  const height = (columns:number) => 10 + counts.filter(n=>n>0).reduce((sum,n)=>sum+4.2+Math.ceil(n/columns)*4.2,0);
  const columns = height(3)<=285 ? 3 : 4;
  const unitHeight = height(columns);
  return {columns,copies:counts.some(n=>n>0)?Math.max(1,Math.floor(291/(unitHeight+6))):0,unitHeight};
}
export function checklistHtml(products: Product[], categories: Category[], supplier: string, _branch = '', _date = '') {
  const groups = orderedProductGroups(products,categories);
  const layout = checklistLayout(groups.map(g=>g.products.length));
  let index = 0;
  const content = groups.map(group => {
    let rows = '';
    for(let start=0;start<group.products.length;start+=layout.columns) {
      const cells = Array.from({length:layout.columns},(_,offset)=>{
        const product=group.products[start+offset];
        if(!product)return '<div class="item-cell empty"></div>';
        return '<div class="item-cell"><span class="idx">'+(++index)+'</span><div class="text"><strong class="en">'+escapeHtml(product.name)+'</strong>'+(product.chineseName?'<span class="cn" lang="zh">'+escapeHtml(product.chineseName)+'</span>':'')+'</div><div class="checks"><span></span><span></span></div></div>';
      }).join('');
      rows += '<div class="row">'+cells+'</div>';
    }
    return '<section><h2>'+escapeHtml(group.name)+'</h2>'+rows+'</section>';
  }).join('');
  const unit = '<article class="checklist-unit"><header class="sheet-header"><h1>'+escapeHtml(supplier)+'</h1><span class="sheet-label">ORDER CHECKLIST</span></header><div class="grid-body">'+content+'</div></article>';
  const body = Array.from({length:layout.copies},()=>unit).join('<div class="cut-line"><span>✂</span></div>');
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+escapeHtml(supplier)+' checklist</title><style>'+ 
    '*{box-sizing:border-box}html{background:#eef0e8}body{margin:5mm auto;padding:0;width:200mm;font-family:"Arial Narrow",Arial,"Microsoft YaHei",sans-serif;color:#213b35;background:white;font-size:'+(layout.columns===3?'7.5':'7')+'pt}.sheet-header{height:10mm;display:grid;grid-template-columns:29mm minmax(0,1fr) 29mm;align-items:center;gap:2mm;border-bottom:2pt solid #25765b}h1{grid-column:2;margin:0;padding:0;text-align:center;text-transform:uppercase;font-size:11pt;line-height:1.15;color:#173a31;overflow-wrap:anywhere}.sheet-label{text-align:right;font-size:6pt;letter-spacing:.6px;color:#5d7866}.idx{background:#f5f7f0;color:#57715f}.checks{background:white}.en{font-weight:600}.checklist-unit{background:white}h2{height:4.2mm;margin:0;padding:0 1mm;background:#e3ebdc;color:#254e36;font-size:7pt;line-height:4.2mm;text-transform:uppercase;border-right:1px solid #93a695;border-bottom:1px solid #93a695;break-after:avoid}.grid-body{border-top:1px solid #93a695;border-left:1px solid #93a695}.row{display:flex;height:4.2mm;break-inside:avoid}.item-cell{width:'+100/layout.columns+'%;display:flex;align-items:stretch;min-width:0;border-right:1px solid #93a695;border-bottom:1px solid #93a695}.idx{width:'+(layout.columns===3?5:4)+'mm;flex:none;border-right:1px solid #93a695;font-size:6.5pt;text-align:center;line-height:4mm}.text{display:flex;align-items:center;gap:2px;flex:1;min-width:0;padding:0 2px;white-space:nowrap;overflow:hidden}.en{overflow:hidden;text-overflow:ellipsis}.cn{font-size:6pt;color:#526b5d;overflow:hidden;text-overflow:ellipsis}.checks{width:'+(layout.columns===3?10:8)+'mm;display:flex;flex:none}.checks span{width:50%;border-left:1px solid #93a695}.cut-line{height:6mm;display:flex;align-items:center;color:#7a8c7d}.cut-line:after{content:"";flex:1;border-top:1px dashed #a6b4a3}.cut-line span{font-size:8pt;margin-right:2mm}.checklist-unit{break-inside:'+(layout.unitHeight<=285?'avoid':'auto')+'}section{break-inside:auto}@page{size:A4 portrait;margin:5mm}@media print{html{background:white}body{width:auto;margin:0}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body data-columns="'+layout.columns+'" data-copies="'+layout.copies+'">'+body+'</body></html>';
}
