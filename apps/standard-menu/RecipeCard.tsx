import React, {useEffect} from 'react';
import {createPortal} from 'react-dom';
import {Printer} from 'lucide-react';
import type {RecipeContent, Recipe} from '../../shared/menu-recipes';
import {Modal,Button,day} from '../../app/htos/ui';

export function RecipeCard({recipe,sourceChanged=false,unsaved=false,onClose}: {recipe:RecipeContent|Recipe;sourceChanged?:boolean;unsaved?:boolean;onClose:()=>void}) {
  const saved = !unsaved && 'version' in recipe ? recipe : null;
  useEffect(()=>{document.body.classList.add('m-print-mode');return()=>document.body.classList.remove('m-print-mode');},[]);
  const card = <article className="m-recipe-card"><header><div>HARE &amp; TORTOISE · STANDARD RECIPE</div><h2>{recipe.category || 'Category not recorded'}</h2><h3>{recipe.code || 'No code'} · {recipe.name || 'Unnamed recipe'}</h3></header>
      <div className="m-card-status">{saved ? `Version ${saved.version} · ${saved.status==='approved'&&!sourceChanged?'Recipe approved':'DRAFT — recipe review required'}`:'UNSAVED DRAFT'} · Allergen information not reviewed</div>
      {sourceChanged&&<p className="m-card-warning">A linked product, specification or preparation has changed. Review before use.</p>}
      <div className="m-card-photo">{recipe.photo?<img src={recipe.photo} alt={`${recipe.name} plated presentation`}/>:<span>Plated photograph not added</span>}</div>
      <div className="m-card-yield"><span>Usable batch yield: <b>{recipe.yieldQuantity&&recipe.yieldUnit?`${recipe.yieldQuantity} ${recipe.yieldUnit}`:'Not recorded'}</b></span><span>Portions: <b>{recipe.portions??'Not recorded'}</b></span></div>
      <table><thead><tr><th>Ingredient</th><th>Quantity</th><th>Product code</th><th>Product name</th><th>Supplier</th></tr></thead><tbody>{recipe.ingredients.map(row=><React.Fragment key={row.id}><tr><td><strong>{row.name||'Unnamed ingredient'}</strong>{row.note&&<small>{row.note}</small>}</td><td>{row.quantity??'Not set'} {row.unit}</td><td>{row.preferred?.itemCode||'—'}</td><td>{row.source==='preparation'?row.preparationName||'Preparation not selected':row.preferred?.productName||'Product not selected'}</td><td>{row.source==='preparation'?'HT preparation':row.preferred?.supplierName||'Not selected'}</td></tr>{row.alternatives.map(p=><tr className="m-card-alternative" key={p.productId}><td colSpan={2}>Alternative{p.note?`: ${p.note}`:''}</td><td>{p.itemCode||'—'}</td><td>{p.productName}</td><td>{p.supplierName}</td></tr>)}</React.Fragment>)}</tbody></table>
      <section><h3>Preparation method</h3><p>{recipe.method||'Not recorded'}</p></section>{recipe.kind==='dish'&&<section><h3>Plating</h3><p>{recipe.plating||'Not recorded'}</p></section>}{recipe.notes&&<section><h3>Notes</h3><p>{recipe.notes}</p></section>}
      <footer>{recipe.sourceReference&&<p>Source: {recipe.sourceReference}</p>}{saved&&<p>Saved {day(saved.updatedAt)} by {saved.updatedByName}{saved.approvedAt?` · Recipe approved ${day(saved.approvedAt)} by ${saved.approvedByName}`:''}</p>}<p>Alternative products require a separate allergen check before use. This card is not an allergen declaration.</p></footer>
    </article>;
  return <><Modal title="Standard recipe card" onClose={onClose} wide className="m-card-dialog">
    <div className="m-no-print m-card-actions"><p>Print or choose “Save as PDF” in your browser.</p><Button onClick={()=>window.print()}><Printer size={17}/>Print recipe card</Button></div>
    {card}
  </Modal>{createPortal(<div className="m-print-sheet" aria-hidden="true">{card}</div>,document.body)}</>;
}
