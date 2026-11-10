import React, {useRef} from 'react';

// Presentation only: hiding a column never removes its pending values.
export const productColumnDefinitions = {
 product: ['Product name',200], chineseName:['Chinese name',150], position:['Position',70],
 code:['Code',90], category:['Category',135], packSize:['Pack size',110],
 casePrice:['Case £',72], packPrice:['Unit £',72], vat:['VAT',65],
 units:['Ordering units',135], caseUnitName:['Case label',100], packUnitName:['Unit label',100],
 active:['Active',65], branches:['Branches',180], minParLevel:['Min. stock',85], targetParLevel:['Target stock',90],
 systemId:['System ID',180], changes:['Changes',95],
} as const;
export type ProductColumn = keyof typeof productColumnDefinitions;
export const productColumnPresets:Record<string,ProductColumn[]> = {
 Everyday:['code','category','packSize','casePrice','packPrice','vat','active'],
 Prices:['code','packSize','casePrice','packPrice','vat'],
 'All columns':(Object.keys(productColumnDefinitions) as ProductColumn[]).filter(k=>k!=='product'&&k!=='changes'),
};
export function ProductColumnChooser({selected,onChange}:{selected:ProductColumn[];onChange:(columns:ProductColumn[])=>void}) {
 const details=useRef<HTMLDetailsElement>(null);
 const close=()=>{details.current!.open=false;details.current!.querySelector('summary')?.focus();};
 return <details className="h-column-chooser" ref={details} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}}}>
  <summary>Choose columns</summary>
  <div className="h-column-options">
   <strong>Columns to show</strong><p>Product name and selection stay visible.</p>
   <div className="h-column-presets">{Object.entries(productColumnPresets).map(([label,keys])=><button type="button" key={label} aria-pressed={keys.length===selected.length&&keys.every(k=>selected.includes(k))} onClick={()=>onChange([...keys])}>{label}</button>)}</div>
   <div className="h-column-checks">{productColumnPresets['All columns'].map(key=><label key={key}><input type="checkbox" checked={selected.includes(key)} onChange={e=>onChange(e.target.checked?[...selected,key]:selected.filter(k=>k!==key))}/>{productColumnDefinitions[key][0]}</label>)}</div>
   <p>Hidden columns keep their edits and appear in your review.</p>
   <button type="button" onClick={close}>Done</button>
  </div>
 </details>;
}
