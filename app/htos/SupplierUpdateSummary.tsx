import React from 'react';
import type {Product} from '../../types';
import {assessFileLine,type FileLine} from '../../shared/supplier-file';
import {money} from './SupplierFileReview';

/** Server-confirmed changes, with the document matching warnings retained from the draft. */
export function SupplierUpdateSummary({items,lines,products,supplierId,supplierName}:{items:any[];lines:FileLine[];products:Product[];supplierId:string;supplierName:string}){
 return <div className="h-file-price-summary"><table><caption>Selected updates · GBP excluding VAT</caption><thead><tr><th>HTOS product / ID</th><th>Supplier item</th><th>Case price</th><th>Unit price</th><th>Warnings</th></tr></thead><tbody>{items.map(item=>{
  const line=lines.find(l=>l.productId===item.id);
  const flags=[...new Set<string>([...item.flags,...(line?assessFileLine(line,products,supplierId,supplierName).flags:[])])];
  return <tr key={item.id}><td><small>{item.itemCode||item.id}</small>{item.before.name!==item.after.name?<><del>{item.before.name}</del><strong className="h-file-new-name">{item.after.name}</strong></>:<strong>{item.after.name}</strong>}</td><td>{line?.code}<small>{line?.name}</small><small>Pack: {line?.packSize||'Not supplied'}</small></td><td>{money(item.before.casePrice)} → <strong>{money(item.after.casePrice)}</strong></td><td>{money(item.before.packPrice)} → <strong>{money(item.after.packPrice)}</strong></td><td>{flags.length?flags.map(flag=><p key={flag} className="h-file-review-warning">{flag}</p>):'Matched'}</td></tr>;
 })}</tbody></table></div>;
}
