import React from 'react';
import type {CatalogueChoice,CatalogueConflict} from '../../shared/catalogue-conflicts';
import {Button,Modal} from './ui';
import {money} from './SupplierFileReview';
import './catalogue-conflicts.css';

export function CatalogueConflictReview({supplierName,conflicts,choices,busy,error,onChoose,onContinue,onClose,inline=false}:{inline?:boolean;supplierName:string;conflicts:CatalogueConflict[];choices:CatalogueChoice[];busy:boolean;error:React.ReactNode;onChoose:(choice:CatalogueChoice)=>void;onContinue:()=>void;onClose:()=>void}){
 const remaining=conflicts.filter(c=>!choices.some(choice=>choice.rowNumber===c.rowNumber)).length;
 const content=<>
  <p><strong>{supplierName}</strong> · {conflicts.length} {conflicts.length===1?'conflict':'conflicts'}. Select which HTOS product each CSV row should update.</p>
  <p className="h-conflict-hint">Each row updates only the product you choose, keeping its ID and supplier code. Conflicting records are not merged or hidden, even in full catalogue mode. Past orders stay unchanged.</p>
  {conflicts.map(conflict=>{
   const incoming=conflict.incoming,selected=choices.find(c=>c.rowNumber===conflict.rowNumber)?.productId;
   return <fieldset className="h-conflict-row" key={conflict.rowNumber} disabled={busy}>
    <legend>CSV row {conflict.rowNumber} · {incoming.itemCode||'No supplier code'}</legend>
    <div className="h-conflict-incoming"><strong>{incoming.name||'Name unchanged'}</strong><span>Pack: {incoming.packSize||'unchanged'}</span><span>Case: {incoming.casePrice?`£${incoming.casePrice.replace(/^£\s*/,'')}`:'unchanged'} · Unit: {incoming.packPrice?`£${incoming.packPrice.replace(/^£\s*/,'')}`:'unchanged'}</span></div>
    <div className="h-conflict-options">{conflict.candidates.map(product=><label key={product.id} className={`h-conflict-option ${selected===product.id?'selected':''}`}>
     <span className="h-conflict-choice"><input type="radio" name={`conflict-${conflict.rowNumber}`} checked={selected===product.id} onChange={()=>onChoose({rowNumber:conflict.rowNumber,productId:product.id})}/><strong>Use this product</strong><span>{product.active===false?'Inactive':'Active'}</span></span>
     <strong className="h-conflict-name">{product.name}</strong>{product.chineseName&&<span>{product.chineseName}</span>}
     <dl><div><dt>Supplier code</dt><dd>{product.itemCode||'Not set'}</dd></div><div><dt>Pack size</dt><dd>{product.packSize||'Not set'}</dd></div><div><dt>Current case / unit</dt><dd>{money(product.casePrice)} / {money(product.packPrice)}</dd></div><div><dt>Product ID</dt><dd>{product.id}</dd></div></dl>
     <small>{product.id===incoming.systemId?'Matches the CSV’s saved Product ID':'Matches the CSV’s supplier code'}</small>
    </label>)}</div>
   </fieldset>;
  })}
  <div className="h-conflict-footer">{error}<p role="status">{remaining?`Choose a product for ${remaining} ${remaining===1?'row':'rows'} to continue.`:'All conflicts selected. Continue to review the changes before saving.'}</p><div className="h-dialog-foot"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel upload</Button><Button busy={busy} disabled={remaining>0} onClick={onContinue}>Continue to review</Button></div></div>
 </>;
 return inline?<div className="h-catalogue-conflicts">{content}</div>:<Modal title="Choose the correct product" wide className="h-catalogue-conflicts" onClose={onClose}>{content}</Modal>;
}
