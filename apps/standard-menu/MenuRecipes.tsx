import React, {useEffect, useRef, useState} from 'react';
import {Plus, Search, FileText, Trash2, ArrowUp, ArrowDown, Save, Printer, Check, BookOpen, X, ChevronDown, ImagePlus} from 'lucide-react';
import {useMenuSession,canMenu as can} from './session';
import type {RecipeContent,Recipe,RecipeDetail,RecipeSummary,RecipeIngredient,ProductChoice,RecipeKind} from '../../shared/menu-recipes';
import {newRecipe,newIngredient,tofuVegetableRamenExample,recipeGaps,RECIPE_UNITS} from '../../shared/menu-recipes';
import {Button,Field,Empty,Modal,day,useAction} from '../../app/htos/ui';
import {MenuProductPicker,ProductSpecifications} from './MenuProductPicker';
import {RecipeCard} from './RecipeCard';
import {useMenuApi,fileBase64} from './menuApi';
import './menu-recipes.css';

const amount = (value:string) => value === '' ? null : Number(value);
function Unit({value,onChange,label,disabled=false}: {value:string;onChange:(value:any)=>void;label:string;disabled?:boolean}) {
  return <select disabled={disabled} aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">Unit</option>{RECIPE_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select>;
}
export function MenuRecipes({initialRecipe}: {initialRecipe?:RecipeContent}) {
  const api=useMenuApi(), action=useAction(), {account:user,suppliers,supplierCursor}=useMenuSession();
  const editable=can(user,'edit_menu_recipes');
  const [list,setList]=useState<RecipeSummary[]>([]),[cursor,setCursor]=useState<string|null>(null),[listLoading,setListLoading]=useState(true),[listError,setListError]=useState('');
  const [search,setSearch]=useState(''),[kind,setKind]=useState<RecipeKind>('dish');
  const [draft,setDraft]=useState<RecipeContent|null>(initialRecipe||null),[saved,setSaved]=useState<Recipe|null>(null),[baseline,setBaseline]=useState('');
  const [issues,setIssues]=useState<string[]>([]),[sourceChanged,setSourceChanged]=useState(false),[opening,setOpening]=useState(false);
  const [picker,setPicker]=useState<{rowId:string;alternative:boolean;supplierId?:string}|null>(null),[spec,setSpec]=useState<ProductChoice|null>(null),[library,setLibrary]=useState(false),[preview,setPreview]=useState(false);
  const [history,setHistory]=useState<any[]|null>(null);
  const [showLibrary,setShowLibrary]=useState(!initialRecipe),[expandedRow,setExpandedRow]=useState(''),[detailsOpen,setDetailsOpen]=useState(false);
  const loadGeneration=useRef(0),listGeneration=useRef(0),request=useRef({id:crypto.randomUUID(),payload:''});
  const dirty=!!draft&&JSON.stringify(draft)!==baseline;
  const gaps=draft?recipeGaps(draft):[];
  async function loadList(more=false) {
    const generation=++listGeneration.current;setListLoading(true);setListError('');
    try{const result=await api({action:'menu-list',cursor:more?cursor:null});if(generation===listGeneration.current){setList(l=>more?[...l,...result.recipes]:result.recipes);setCursor(result.cursor);}}
    catch(e){if(generation===listGeneration.current)setListError((e as Error).message);}finally{if(generation===listGeneration.current)setListLoading(false);}
  }
  useEffect(()=>{void loadList();return()=>{listGeneration.current++;loadGeneration.current++;};},[]);
  useEffect(()=>{
    if(!dirty||!editable)return;
    const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const navigate=(event:MouseEvent)=>{const link=(event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement|null;if(link&&link.hash&&link.hash!==location.hash&&!window.confirm('Leave this recipe and discard your unsaved changes?')){event.preventDefault();event.stopPropagation();}};
    window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);
    return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);};
  },[dirty,editable]);
  const mayLeave=()=>!editable||!dirty||window.confirm('Discard your unsaved recipe changes?');
  function accept(detail:RecipeDetail) {
    setSaved(detail.recipe);setDraft(detail.recipe);setBaseline(JSON.stringify(detail.recipe));setIssues(detail.issues);setSourceChanged(detail.sourceChanged);setKind(detail.recipe.kind);
    setList(l=>[detail.recipe,...l.filter(r=>r.id!==detail.recipe.id)]);
  }
  async function open(id:string) {
    if(action.busy||!mayLeave())return;
    const generation=++loadGeneration.current;setOpening(true);
    await action.run(async()=>{const detail=await api({action:'menu-get',id});if(generation===loadGeneration.current){accept(detail);setShowLibrary(false);setExpandedRow('');setDetailsOpen(false);}},'');
    if(generation===loadGeneration.current)setOpening(false);
  }
  function start(example=false) {
    if(!mayLeave())return;
    loadGeneration.current++;const recipe=example?tofuVegetableRamenExample():newRecipe(kind);
    setDraft(recipe);setSaved(null);setBaseline('');setIssues([]);setSourceChanged(false);setKind(recipe.kind);setShowLibrary(false);setExpandedRow('');setDetailsOpen(!example);
  }
  function change(patch:Partial<RecipeContent>) {setDraft(d=>d?{...d,...patch}:null);}
  function ingredient(id:string,patch:Partial<RecipeIngredient>) {setDraft(d=>d?{...d,ingredients:d.ingredients.map(r=>r.id===id?{...r,...patch}:r)}:null);}
  const withRequest=(body:Record<string,unknown>)=>{const payload=JSON.stringify(body);if(request.current.payload!==payload)request.current={id:crypto.randomUUID(),payload};return {...body,requestId:request.current.id};};
  async function persist(approve=false) {
    if(!draft)return;
    await action.run(async()=>{
      const body=approve?{action:'menu-approve',id:draft.id,expectedVersion:saved?.version||0,expectedDependencyHash:saved?.dependencyHash}:{action:'menu-save',recipe:draft,expectedVersion:saved?.version||0};
      const result=await api(withRequest(body));
      // If this read fails, keep the same request ID so retry cannot duplicate the write.
      const detail=await api({action:'menu-get',id:result.id});accept(detail);
    },approve?'Recipe approved. Allergen review is still separate.':'Recipe draft saved.');
  }
  const choose=(choice:ProductChoice)=>{
    if(!picker||!draft)return;
    const row=draft.ingredients.find(r=>r.id===picker.rowId)!;
    ingredient(row.id,picker.alternative?{alternatives:[...row.alternatives,choice]}:{preferred:choice});setPicker(null);
  };
  function move(index:number,direction:number) {if(!draft)return;const rows=[...draft.ingredients];[rows[index],rows[index+direction]]=[rows[index+direction],rows[index]];change({ingredients:rows});}
  const rows=list.filter(r=>r.kind===kind&&`${r.code} ${r.name} ${r.category}`.toLowerCase().includes(search.toLowerCase()));
  const pickerRow=draft?.ingredients.find(r=>r.id===picker?.rowId);
  return <div className="m-workspace">
    <div className="m-toolbar">
      <Button variant="secondary" aria-expanded={showLibrary} aria-controls="recipe-library" disabled={action.busy||opening} onClick={()=>setShowLibrary(v=>!v)}><BookOpen size={17}/>Recipes<ChevronDown size={15}/></Button>
      <div className="m-actions"><Button variant="quiet" onClick={()=>setLibrary(true)}><FileText size={16}/>Product specifications</Button>{editable&&<Button variant="secondary" disabled={action.busy||opening} onClick={()=>start()}><Plus size={16}/>New recipe</Button>}</div>
    </div>
    {showLibrary&&<aside className="m-list" id="recipe-library" aria-label="Recipe library">
      <div className="m-library-tools"><div className="m-workspace-tabs" aria-label="Recipe types"><button aria-pressed={kind==='dish'} onClick={()=>setKind('dish')}>Menu dishes</button><button aria-pressed={kind==='preparation'} onClick={()=>setKind('preparation')}>Preparation recipes</button></div><label className="m-search"><Search size={16}/><input aria-label="Search loaded recipes" placeholder="Search loaded recipes" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
      {listError&&<div className="h-notice error" role="alert">{listError}<Button variant="quiet" onClick={()=>void loadList()}>Retry</Button></div>}
      <div className="m-list-items">{rows.map(r=><button disabled={action.busy||opening} aria-current={draft?.id===r.id?'page':undefined} key={r.id} onClick={()=>void open(r.id)}><span className="m-code">{r.code}</span><strong>{r.name}</strong><small>{r.category||'Uncategorised'} · v{r.version} · {r.status==='approved'?'Approved · check changes':'Draft'}</small></button>)}</div>
      {listLoading&&<p role="status">Loading recipes…</p>}{!listLoading&&!rows.length&&!listError&&<p className="m-help">{list.length?'No matching loaded recipes.':'Your saved recipes will appear here.'}</p>}{cursor&&<Button variant="secondary" busy={listLoading} onClick={()=>void loadList(true)}>Load more recipes</Button>}
      {editable&&kind==='dish'&&<button className="m-example" disabled={action.busy||opening} onClick={()=>start(true)}>Use N2 Tofu &amp; Vegetable Ramen as an example</button>}
    </aside>}
    <section className="m-editor" aria-label="Recipe editor">
      {opening&&<p role="status">Opening recipe…</p>}{action.feedback}
      {!draft?<Empty title="Choose a recipe to begin" action={editable&&<Button onClick={()=>start(true)}>Try the N2 example</Button>}>Open Recipes to choose a saved dish or preparation, or start a new recipe.</Empty>:<>
        <header className="m-editor-top"><div><h1>{draft.code&&<span>{draft.code} </span>}{draft.name||'New recipe'}</h1><p>{saved?`Version ${saved.version} · ${day(saved.updatedAt)}${dirty?' · Unsaved changes':''}`:'Unsaved draft'}</p></div><div className="m-actions"><Button variant="secondary" disabled={action.busy||opening} onClick={()=>action.run(async()=>{if(saved&&!dirty)accept(await api({action:'menu-get',id:saved.id}));setPreview(true);},'')}><Printer size={16}/>Card preview</Button>{editable&&<Button busy={action.busy} disabled={opening||(!dirty&&!sourceChanged)} onClick={()=>void persist()}><Save size={16}/>Save draft</Button>}</div></header>
        <div className="m-review-strip"><span>{saved?.status==='approved'&&!dirty&&!sourceChanged?'Recipe approved':'Recipe: draft'}</span><span>Allergens: not reviewed</span></div>
        {(sourceChanged||issues.length>0)&&<div className="h-notice error" role="alert"><strong>Review linked sources</strong><p>{sourceChanged?'A linked product, specification or preparation has changed. Check the recipe and save a new draft.':''}</p>{issues.map(i=><p key={i}>{i}</p>)}</div>}
        <div className={`m-dish-photo ${draft.photo?'has-photo':''}`}>
          {draft.photo?<img src={draft.photo} alt={`Plated ${draft.name||'recipe'}`}/>:<span>No dish photo yet</span>}
          {editable&&<div className="m-photo-actions"><label className="m-photo-upload"><ImagePlus size={16}/>{draft.photo?'Replace photo':'Add dish photo'}<input type="file" aria-label={draft.photo?'Replace dish photo':'Add dish photo'} accept="image/jpeg,image/png" disabled={action.busy||opening} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void action.run(async()=>{if(file.size>250*1024||!['image/jpeg','image/png'].includes(file.type))throw new Error('Choose a JPG or PNG photograph up to 250 KB.');change({photo:`data:${file.type};base64,${await fileBase64(file)}`});},'');}}/></label>{draft.photo&&<button disabled={action.busy||opening} onClick={()=>change({photo:''})}>Remove</button>}</div>}
        </div>
        <div className="m-table-intro"><p>Select a supplier, then its product. Enter the quantity used in this recipe.</p><span>Alternatives and notes: open a row’s options.</span></div>
        <div className="m-table-scroll" tabIndex={0} role="region" aria-label="Recipe ingredients">
          <table className="m-ingredient-table">
            <caption className="m-visually-hidden">Ingredients, recipe quantities and linked supplier products</caption>
            <thead><tr><th scope="col">Ingredient</th><th scope="col">Quantity</th><th scope="col">Unit</th><th scope="col">Product Code</th><th scope="col">Product Name</th><th scope="col">Supplier</th></tr></thead>
            <tbody>{draft.ingredients.map((row,index)=><React.Fragment key={row.id}>
              <tr className="m-main-row">
                <td data-label="Ingredient"><div className="m-ingredient-name">{editable?<input aria-label={`Ingredient ${index+1} name`} value={row.name} maxLength={160} disabled={action.busy||opening} onChange={e=>ingredient(row.id,{name:e.target.value})} placeholder="Ingredient name"/>:<strong>{row.name}</strong>}<button className="m-options" aria-label={`Options for ${row.name||`ingredient ${index+1}`}`} aria-expanded={expandedRow===row.id} aria-controls={`options-${row.id}`} onClick={()=>setExpandedRow(v=>v===row.id?'':row.id)}><ChevronDown size={16}/></button></div>{row.alternatives.length>0&&<small className="m-alternative-count">{row.alternatives.length} alternative{row.alternatives.length===1?'':'s'}</small>}</td>
                <td data-label="Quantity"><input aria-label={`Quantity for ${row.name||`ingredient ${index+1}`}`} type="number" min="0.001" max="1000000" step="any" value={row.quantity??''} disabled={!editable||action.busy||opening} onChange={e=>ingredient(row.id,{quantity:amount(e.target.value)})} placeholder="Not set"/></td>
                <td data-label="Unit"><Unit value={row.unit} disabled={!editable||action.busy||opening} label={`Unit for ${row.name||`ingredient ${index+1}`}`} onChange={v=>ingredient(row.id,{unit:v})}/></td>
                <td data-label="Product Code" className="m-linked-cell">{row.source==='preparation'?'—':row.preferred?.itemCode||<span className="m-blank">—</span>}</td>
                <td data-label="Product Name" className="m-linked-cell">{row.source==='preparation'?<span>{row.preparationName||'Choose a preparation in row options'}</span>:row.preferred?<button className="m-product-name" disabled={!editable||action.busy||opening} aria-label={`Change product for ${row.name}`} onClick={()=>setPicker({rowId:row.id,alternative:false,supplierId:row.preferred?.supplierId})}>{row.preferred.productName}</button>:<span className="m-blank">—</span>}</td>
                <td data-label="Supplier" className="m-linked-cell">{row.source==='preparation'?<span className="m-blank">Preparation recipe</span>:editable?<select aria-label={`Supplier for ${row.name||`ingredient ${index+1}`}`} disabled={action.busy||opening} value={row.preferred?.supplierId||''} onChange={e=>{if(e.target.value)setPicker({rowId:row.id,alternative:false,supplierId:e.target.value==='__more__'?'':e.target.value});}}><option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}{row.preferred&&!suppliers.some(s=>s.id===row.preferred?.supplierId)&&<option value={row.preferred.supplierId}>{row.preferred.supplierName}</option>}{supplierCursor&&<option value="__more__">More suppliers…</option>}</select>:row.preferred?.supplierName||'Not selected'}</td>
              </tr>
              {expandedRow===row.id&&<tr className="m-options-row"><td colSpan={6}><section id={`options-${row.id}`} aria-label={`Details for ${row.name||`ingredient ${index+1}`}`}>
                <div className="m-section-head"><h3>{row.name||'Ingredient'} — options</h3>{editable&&<div className="m-row-actions"><button aria-label={`Move ingredient ${index+1} up`} disabled={action.busy||opening||index===0} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button aria-label={`Move ingredient ${index+1} down`} disabled={action.busy||opening||index===draft.ingredients.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/></button><button aria-label={`Remove ingredient ${index+1}`} disabled={action.busy||opening} onClick={()=>change({ingredients:draft.ingredients.filter(r=>r.id!==row.id)})}><Trash2 size={16}/></button></div>}</div>
                <fieldset disabled={!editable||action.busy||opening} className="m-fields"><legend className="m-visually-hidden">Ingredient source</legend><div className="m-two"><Field label="Source"><select aria-label="Source" value={row.source} onChange={e=>ingredient(row.id,{source:e.target.value as RecipeIngredient['source'],preferred:null,alternatives:[],preparationId:'',preparationName:''})}><option value="product">Supplier product</option><option value="preparation">Preparation recipe</option></select></Field>{row.source==='preparation'&&<Field label="Linked preparation"><select aria-label="Linked preparation" value={row.preparationId} onChange={e=>ingredient(row.id,{preparationId:e.target.value,preparationName:list.find(r=>r.id===e.target.value)?.name||''})}><option value="">Choose a preparation recipe</option>{list.filter(r=>r.kind==='preparation'&&r.id!==draft.id).map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}{row.preparationId&&!list.some(r=>r.id===row.preparationId)&&<option value={row.preparationId}>{row.preparationName||row.preparationId}</option>}</select><small>{cursor?'Load more recipes in the library to see further preparations.':'Preparation recipes are managed in Recipes.'}</small></Field>}</div></fieldset>
                {row.source==='product'&&<div className="m-product-choices">
                  {row.preferred?<ProductLine product={row.preferred} label="Preferred" onSpecs={()=>setSpec(row.preferred)} action={editable&&<><Button variant="quiet" disabled={action.busy||opening} onClick={()=>setPicker({rowId:row.id,alternative:false,supplierId:row.preferred?.supplierId})}>Change product</Button><button className="h-icon-button" disabled={action.busy||opening} aria-label={`Remove preferred product for ${row.name}`} onClick={()=>ingredient(row.id,{preferred:null,alternatives:[]})}><X size={16}/></button></>}/>:<p className="m-help">Select the supplier in this row to link a product.</p>}
                  {row.alternatives.map((p,i)=><div key={p.productId}><ProductLine product={p} label={`Alternative ${i+1}`} onSpecs={()=>setSpec(p)} action={editable&&<><Button variant="quiet" disabled={action.busy||opening} onClick={()=>{if(window.confirm('Make this the preferred product? Save and review the recipe and allergen information before use.'))ingredient(row.id,{preferred:p,alternatives:row.alternatives.filter(a=>a.productId!==p.productId).concat(row.preferred?[row.preferred]:[])});}}>Make preferred</Button><button className="h-icon-button" disabled={action.busy||opening} aria-label={`Remove alternative ${i+1} for ${row.name}`} onClick={()=>ingredient(row.id,{alternatives:row.alternatives.filter(a=>a.productId!==p.productId)})}><X size={16}/></button></>}/><Field label={`Alternative ${i+1} usage note`}><input disabled={!editable||action.busy||opening} value={p.note} maxLength={500} placeholder="When this alternative can be used" onChange={e=>ingredient(row.id,{alternatives:row.alternatives.map(a=>a.productId===p.productId?{...a,note:e.target.value}:a)})}/></Field></div>)}
                  {editable&&row.preferred&&row.alternatives.length<8&&<Button variant="secondary" disabled={action.busy||opening} onClick={()=>setPicker({rowId:row.id,alternative:true})}><Plus size={15}/>Add alternative product</Button>}
                </div>}
                <Field label="Ingredient notes"><input disabled={!editable||action.busy||opening} value={row.note} maxLength={1000} onChange={e=>ingredient(row.id,{note:e.target.value})} placeholder="Preparation or substitution notes, if known"/></Field>
              </section></td></tr>}
            </React.Fragment>)}</tbody>
          </table>
        </div>
        {!draft.ingredients.length&&<p className="m-help">Add each ingredient, including sauces and garnishes.</p>}
        {editable&&<Button className="m-add-ingredient" variant="quiet" disabled={action.busy||opening||draft.ingredients.length>=60} onClick={()=>change({ingredients:[...draft.ingredients,newIngredient()]})}><Plus size={16}/>Add ingredient</Button>}
        <details className="m-disclosure" key={draft.id} open={detailsOpen} onToggle={e=>setDetailsOpen(e.currentTarget.open)}><summary>Recipe details &amp; method<span>Name, batch yield, portions and preparation</span></summary><fieldset disabled={!editable||action.busy||opening} className="m-fields"><legend className="m-visually-hidden">Recipe details</legend>
          <div className="m-three"><Field label="Recipe code"><input value={draft.code} maxLength={30} readOnly={!!saved} onChange={e=>change({code:e.target.value.toUpperCase()})}/></Field><Field label="Category"><input value={draft.category} maxLength={100} onChange={e=>change({category:e.target.value})} placeholder="Not recorded"/></Field><Field label="Recipe type"><select aria-label="Recipe type" value={draft.kind} disabled={!!saved} onChange={e=>change({kind:e.target.value as RecipeKind})}><option value="dish">Menu dish</option><option value="preparation">Preparation recipe</option></select></Field></div>
          <Field label="Recipe name"><input value={draft.name} maxLength={160} onChange={e=>change({name:e.target.value})}/></Field>
          <div className="m-three"><Field label="Usable batch yield"><input type="number" min="0.001" max="1000000" step="any" value={draft.yieldQuantity??''} onChange={e=>change({yieldQuantity:amount(e.target.value)})} placeholder="Not recorded"/></Field><Field label="Yield unit"><Unit value={draft.yieldUnit} onChange={v=>change({yieldUnit:v})} label="Yield unit"/></Field><Field label="Portions per batch"><input type="number" min="0.001" max="1000000" step="any" value={draft.portions??''} onChange={e=>change({portions:amount(e.target.value)})} placeholder="Not recorded"/></Field></div>
          <div className="m-methods"><Field label="Preparation method"><textarea rows={4} maxLength={12000} value={draft.method} onChange={e=>change({method:e.target.value})} placeholder="Record the agreed method."/></Field>{draft.kind==='dish'&&<Field label="Plating instructions"><textarea rows={4} maxLength={5000} value={draft.plating} onChange={e=>change({plating:e.target.value})} placeholder="Record the agreed presentation."/></Field>}</div>
          <Field label="Recipe notes"><textarea rows={2} maxLength={5000} value={draft.notes} onChange={e=>change({notes:e.target.value})}/></Field><Field label="Source reference"><input value={draft.sourceReference} maxLength={500} onChange={e=>change({sourceReference:e.target.value})}/></Field>
        </fieldset></details>
        <details className="m-disclosure m-approval"><summary>Review &amp; approval<span>{gaps.length?`${gaps.length} items to complete`:'Recipe completeness check passed'} · allergen review separate</span></summary><div className="m-approval-content"><div><p>Recipe approval covers the recipe and its listed product choices. It does not approve allergens.</p>{gaps.length>0&&<ul>{gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>}</div><div className="m-actions">{can(user,'approve_menu_recipes')&&saved&&<Button variant="secondary" busy={action.busy} disabled={dirty||sourceChanged||!!gaps.length||!!issues.length||saved.status==='approved'} onClick={()=>void persist(true)}><Check size={17}/>Approve recipe</Button>}{saved&&<Button variant="quiet" disabled={action.busy} onClick={()=>action.run(async()=>{const result=await api({action:'menu-history',id:saved.id});setHistory(result.versions);},'')}>Version history</Button>}</div></div></details>
      </>}
    </section>
    {picker&&pickerRow&&<MenuProductPicker ingredientName={pickerRow.name} initialSupplier={picker.supplierId} excluded={[...(pickerRow.preferred?[pickerRow.preferred.productId]:[]),...pickerRow.alternatives.map(p=>p.productId)]} onChoose={choose} onClose={()=>setPicker(null)}/>}
    {spec&&<ProductSpecifications product={spec} onClose={()=>setSpec(null)} onChanged={()=>setSourceChanged(true)}/>}
    {library&&<MenuProductPicker onChoose={product=>{setSpec(product);setLibrary(false);}} onClose={()=>setLibrary(false)}/>}
    {preview&&draft&&<RecipeCard recipe={dirty?draft:saved||draft} unsaved={dirty} sourceChanged={sourceChanged} onClose={()=>setPreview(false)}/>}
    {history&&<Modal title="Recipe version history" onClose={()=>setHistory(null)}><p>Latest 20 saved versions. Earlier recipe content is retained in the version archive.</p>{history.map(h=><div className="m-history" key={h.version}><strong>Version {h.version} · {h.status}</strong><span>{day(h.updatedAt)} · {h.updatedByName}</span></div>)}</Modal>}
  </div>;
}
function ProductLine({product,label,onSpecs,action}: {product:ProductChoice;label:string;onSpecs:()=>void;action:React.ReactNode}) {
  return <div className="m-product-line"><span className="m-choice-label">{label}</span><div><strong>{product.productName}</strong><small>{product.itemCode||'No product code'} · {product.supplierName} · {product.packSize||'Pack size not recorded'}</small></div><Button variant="quiet" onClick={onSpecs} aria-label={`Specifications for ${product.productName}`}><FileText size={16}/>Specs</Button><div className="m-actions">{action}</div></div>;
}
