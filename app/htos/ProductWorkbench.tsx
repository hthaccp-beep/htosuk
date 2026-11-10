import React,{useState,useEffect,useContext} from 'react';
import {useUpdateProtection} from '../../hooks/useUpdateProtection';
import {changedProductFields,productFieldLabels,productEditorErrors,moveProductRow,bulkProductFields,bulkProductValue} from '../../shared/product-editor';
import './product-editor.css';
import {ProductTransfer,CatalogImportContext} from './ProductTransfer';
import {ProductBulkDelete} from './ProductBulkDelete';
import {productColumnDefinitions,productColumnPresets,ProductColumnChooser,type ProductColumn} from './ProductColumns';
import {useAppStore} from '../../store';
import {useSupplierProducts} from '../../hooks/useSupplierProducts';
import type {Product} from '../../types';
import {productSequence,productFingerprint} from '../../shared/product-workbench';
import {Button,Field,Panel,Modal,Tag,Empty,money,useAction} from './ui';



type Row={id:string;values:Product;original:Product;expected:string};

export function ProductWorkbench({onIndividual}:{onIndividual:()=>void}){
 const store=useAppStore(),action=useAction();const [supplier,setSupplier]=useState(''),[rows,setRows]=useState<Row[]>([]),[search,setSearch]=useState(''),[page,setPage]=useState(0),[reorder,setReorder]=useState(false),[preview,setPreview]=useState(false),[requestId,setRequestId]=useState(()=>crypto.randomUUID()),[onlyChanged,setOnlyChanged]=useState(false);
 const request=useContext(CatalogImportContext);
 const [fileFlow,setFileFlow]=useState(false);
 const catalogue=useSupplierProducts(supplier);
 const owner=store.currentUser?.role==='CREATOR';
 const [selectedIds,setSelectedIds]=useState<Set<string>>(new Set()),[showInactive,setShowInactive]=useState(false),[category,setCategory]=useState(''),[bulkField,setBulkField]=useState(''),[bulkValue,setBulkValue]=useState('');
 const [chosenColumns,setChosenColumns]=useState<ProductColumn[]>([...productColumnPresets.Everyday]);
 const priceHelp=owner?'Owner prices update immediately when you save.':'Price changes go to Catalogue → Price approvals.';
 const visibleColumns:ProductColumn[]=['product',...productColumnPresets['All columns'].filter(k=>chosenColumns.includes(k)),'changes'];
 const load=(id:string)=>{setSupplier(id);setShowInactive(false);setBulkField('');setBulkValue('');setPreview(false);setSearch('');setOnlyChanged(false);setSelectedIds(new Set());setCategory('');setRows(productSequence(store.products.filter(p=>!p.removedAt&&p.supplierId===id),store.categories).map(p=>({id:p.id,values:{...p},original:p,expected:productFingerprint(p)})));setReorder(false);setRequestId(crypto.randomUUID());setPage(0);};
 const changed=rows.filter(r=>changedProductFields(r.original,r.values).length);
 const dirty=!!(changed.length||reorder);
 useUpdateProtection(dirty || action.busy);
 // Wait for a complete supplier snapshot. Refresh clean rows only; remote
 // changes must never erase edits (the server checks their fingerprints).
 useEffect(()=>{if(catalogue.ready&&!dirty)setRows(productSequence(store.products.filter(p=>!p.removedAt&&p.supplierId===supplier),store.categories).map(p=>({id:p.id,values:{...p},original:p,expected:productFingerprint(p)})));},[catalogue.ready,supplier,store.products,store.categories,dirty]);
 const confirmDiscard=()=>!dirty||window.confirm('Discard your unsaved product changes?');
 useEffect(()=>{if(!dirty)return;const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};const navigate=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target.closest('a[href],.h-admin-nav button,.h-tabs button,.h-settings-groups button'):null;if(target&&!window.confirm('Discard your unsaved product changes?')){e.preventDefault();e.stopPropagation();}};window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);};},[dirty]);
 const displayValue=(key:string,value:any):string=>{if(key==='categoryId')return store.categories.find(c=>c.id===value)?.name||value||'—';if(key==='allowedBranchIds')return !value?.length?'All branches':value.map((id:string)=>store.branches.find(b=>b.id===id)?.name||id).join(', ');if(key==='active')return value?'Active':'Inactive';if(key==='casePrice'||key==='packPrice')return value==null?'Keep current price':money(value);if(key==='vatRate')return String((value||0)*100)+'%';return String(value??'—')||'—';};
 const change=(id:string,key:string,value:any)=>setRows(current=>current.map(r=>r.id===id?{...r,values:{...r.values,[key]:value}}:r));
 const move=(id:string,position:number)=>{setRows(current=>moveProductRow(current,id,position));setReorder(true);};
 const applySelection=()=>{try{
  const value=bulkProductValue(bulkField,bulkValue);
  if(!selectedIds.size)throw new Error('Select at least one product.');
  setRows(current=>current.map(r=>selectedIds.has(r.id)?{...r,values:{...r.values,[bulkField]:value}}:r));action.setError('');
 }catch(e:any){action.setError(e.message);}};
 const visible=rows.filter(r=>(showInactive||r.values.active||changedProductFields(r.original,r.values).length>0)&&(!category||r.values.categoryId===category)&&`${r.values.name} ${r.values.chineseName||''} ${r.values.itemCode||''}`.toLowerCase().includes(search.toLowerCase())&&(!onlyChanged||changedProductFields(r.original,r.values).length>0));
 const currentPage=Math.min(page,Math.max(0,Math.ceil(visible.length/30)-1));
 const selected=reorder?rows:changed;
 return <div className="h-product-workbench h-editor-spreadsheet">
 <div className="h-workbench-heading"><Button variant="quiet" disabled={action.busy||fileFlow} onClick={()=>{if(confirmDiscard())onIndividual();}}>← Product catalogue</Button><span>One supplier · one file format</span></div>
 <Panel title="Bulk edit & files" subtitle="Choose a supplier. Edit cells or select products to update together.">
  <div className={`h-editor-start ${fileFlow?'has-file-flow':''}`}><div className="h-editor-tools"><Field label="Supplier" hint="Required for every task. Select again after finishing or leaving."><select aria-label="Supplier" required disabled={action.busy||fileFlow} value={supplier} onChange={e=>{if(confirmDiscard())load(e.target.value);}}><option value="">Select supplier</option>{store.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
  </div><ProductTransfer compact onFlowChange={setFileFlow} key={supplier} supplierId={supplier} disabled={!catalogue.ready||dirty||action.busy} onSaved={()=>load('')} onExit={()=>load('')}/></div>
  {action.feedback}
  {fileFlow?null:!supplier?<Empty title="Choose a supplier to begin">Import a file, edit product details or arrange the order of items. Changes stay here until you review and save them.</Empty>:!catalogue.ready?<p className="h-notice" role={catalogue.error?'alert':'status'}>{catalogue.error||'Loading this supplier’s products…'}</p>:<>
   <div className="h-editor-summary"><strong>{rows.length} products</strong><span>{changed.length} edited</span>{reorder&&<Tag>Order changed</Tag>}<span className="h-editor-approval">{priceHelp}</span></div>
   <div className="h-editor-controls"><div className="h-editor-filters"><input aria-label="Search bulk products" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);setSelectedIds(new Set());}} placeholder="Search name, Chinese name or code"/><select aria-label="Filter bulk category" value={category} onChange={e=>{setCategory(e.target.value);setPage(0);setSelectedIds(new Set());}}><option value="">All categories</option>{store.categories.filter(c=>!c.supplierId||c.supplierId===supplier).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><label><input type="checkbox" checked={showInactive} onChange={e=>{setShowInactive(e.target.checked);setPage(0);setSelectedIds(new Set());}}/> Show inactive</label><label><input type="checkbox" checked={onlyChanged} onChange={e=>{setOnlyChanged(e.target.checked);setPage(0);setSelectedIds(new Set());}}/> Edited only</label><ProductColumnChooser selected={chosenColumns} onChange={setChosenColumns}/></div></div>
   <details className="h-editor-help"><summary>Editing guide</summary><p>Edit cells directly. Choose columns to see more fields. Hidden columns keep their edits. System IDs stay unchanged. Position changes also update Place order, CSV exports and checklists. {priceHelp}</p></details>
   <div className="h-editor-batch">
    <label><input type="checkbox" aria-label="Select all filtered products" checked={visible.length>0&&visible.every(r=>selectedIds.has(r.id))} onChange={e=>setSelectedIds(e.target.checked?new Set(visible.map(r=>r.id)):new Set())}/> {selectedIds.size?`${selectedIds.size} selected`:'Select filtered products'}</label>
    {selectedIds.size>0&&<><select aria-label="Field to update" value={bulkField} onChange={e=>{setBulkField(e.target.value);setBulkValue('');}}><option value="">Select field</option>{bulkProductFields.map(k=><option key={k} value={k}>{productFieldLabels[k]}</option>)}</select>
    {bulkField==='categoryId'?<select aria-label="Value for selected products" value={bulkValue} onChange={e=>setBulkValue(e.target.value)}><option value="">Select category</option>{store.categories.filter(c=>!c.supplierId||c.supplierId===supplier).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>:['active','unitType','vatRate'].includes(bulkField)?<select aria-label="Value for selected products" value={bulkValue} onChange={e=>setBulkValue(e.target.value)}><option value="">Select value</option>{(bulkField==='active'?[['true','Active'],['false','Inactive']]:bulkField==='unitType'?[['DUAL','Case and unit'],['CASE_ONLY','Case only'],['PACK_ONLY','Unit only']]:[['0','0%'],['0.05','5%'],['0.2','20%']]).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>:<input aria-label="Value for selected products" value={bulkValue} placeholder="Enter value" onChange={e=>setBulkValue(e.target.value)}/>}
    <Button variant="secondary" disabled={action.busy||!bulkField||!bulkValue} onClick={applySelection}>Apply to selected</Button><Button variant="quiet" onClick={()=>setSelectedIds(new Set())}>Clear selection</Button><ProductBulkDelete supplierId={supplier} selected={rows.filter(r=>selectedIds.has(r.id))} blocked={dirty||action.busy} onSaved={()=>load('')}/></>}
   </div>
   <fieldset disabled={action.busy} className="h-editor-grid-fieldset"><div className="h-table-wrap h-editor-table" tabIndex={0} role="region" aria-label="Editable products; scroll for more rows and columns"><table className="h-table" style={{width:44+visibleColumns.reduce((sum,key)=>sum+productColumnDefinitions[key][1],0)}}><colgroup><col style={{width:44}}/>{visibleColumns.map(key=><col className={key==='product'?'h-product-name-col':''} key={key} style={{width:productColumnDefinitions[key][1]}}/>)}<col/></colgroup><thead><tr><th scope="col" className="h-editor-select"><span className="sr-only">Select</span></th>{visibleColumns.map(key=><th scope="col" key={key} className={key==='product'?'h-editor-pinned':''}>{productColumnDefinitions[key][0]}</th>)}<th aria-hidden="true" className="h-editor-spacer"/></tr></thead><tbody>{visible.slice(currentPage*30,currentPage*30+30).map(r=>{
    const fields=changedProductFields(r.original,r.values),errors=productEditorErrors(r.values);
    const textCell=(key:'name'|'chineseName'|'itemCode'|'packSize'|'caseUnitName'|'packUnitName')=><input title={r.values[key]||''} aria-label={r.values.name+' '+productFieldLabels[key]} aria-invalid={key==='name'&&!r.values.name.trim()} value={r.values[key]||''} onChange={e=>change(r.id,key,e.target.value)}/>;
    const cell=(key:ProductColumn):React.ReactNode=>{
     switch(key){
      case 'product':return <div className="h-editor-product">{textCell('name')}{r.values.active===false&&<small>Inactive</small>}{errors.map(error=><small key={error} className="h-editor-error">{error}</small>)}</div>;
      case 'chineseName':case 'packSize':case 'caseUnitName':case 'packUnitName':return textCell(key);
      case 'code':return textCell('itemCode');
      case 'position':return <input aria-label={'Position '+r.values.name} type="number" min="1" max={rows.length} defaultValue={rows.indexOf(r)+1} key={r.id+'-'+rows.indexOf(r)} onBlur={e=>{const n=Number(e.target.value);if(n!==rows.indexOf(r)+1)move(r.id,n);}}/>;
      case 'category':return <select aria-label={r.values.name+' category'} value={r.values.categoryId} onChange={e=>change(r.id,'categoryId',e.target.value)}><option value="">Select category</option>{store.categories.filter(c=>!c.supplierId||c.supplierId===supplier).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>;
      case 'casePrice':case 'packPrice':return <input aria-label={r.values.name+' '+key} title={'Current '+money(r.original[key])} type="number" min="0" step="0.01" value={r.values[key]??''} onChange={e=>change(r.id,key,e.target.value===''?undefined:Number(e.target.value))}/>;
      case 'vat':return <select aria-label={r.values.name+' VAT'} value={r.values.vatRate||0} onChange={e=>change(r.id,'vatRate',Number(e.target.value))}><option value={0}>0%</option><option value={.05}>5%</option><option value={.2}>20%</option></select>;
      case 'units':return <select aria-label={r.values.name+' ordering units'} value={r.values.unitType||'DUAL'} onChange={e=>change(r.id,'unitType',e.target.value)}><option value="DUAL">Case and unit</option><option value="CASE_ONLY">Case only</option><option value="PACK_ONLY">Unit only</option></select>;
      case 'active':return <input aria-label={r.values.name+' active'} type="checkbox" checked={r.values.active} onChange={e=>change(r.id,'active',e.target.checked)}/>;
      case 'branches':return <details className="h-editor-branches"><summary>{r.values.allowedBranchIds.length?r.values.allowedBranchIds.length+' selected':'All branches'}</summary><p><Button variant="quiet" onClick={()=>change(r.id,'allowedBranchIds',[])}>Use all branches</Button></p>{store.branches.map(b=><label key={b.id}><input type="checkbox" checked={r.values.allowedBranchIds.includes(b.id)} onChange={e=>change(r.id,'allowedBranchIds',e.target.checked?[...r.values.allowedBranchIds,b.id]:r.values.allowedBranchIds.filter(id=>id!==b.id))}/>{b.name}</label>)}</details>;
      case 'minParLevel':case 'targetParLevel':return <input aria-label={r.values.name+' '+productFieldLabels[key]} type="number" min="0" value={r.values[key]??''} onChange={e=>change(r.id,key,e.target.value===''?0:Number(e.target.value))}/>;
      case 'systemId':return <input aria-label={r.values.name+' System ID'} readOnly title={r.id} value={r.id}/>;
      case 'changes':return fields.length?<><span>{fields.length} edited</span><Button variant="quiet" onClick={()=>setRows(current=>current.map(row=>row.id===r.id?{...row,values:{...row.original}}:row))}>Undo</Button></>:<span className="h-muted">—</span>;
     }
    };
    return <tr key={r.id} className={fields.length?'is-edited':''}><td className="h-editor-select"><input type="checkbox" aria-label={'Select '+r.values.name+' ('+(r.values.itemCode||r.id)+')'} checked={selectedIds.has(r.id)} onChange={e=>setSelectedIds(current=>{const next=new Set(current);e.target.checked?next.add(r.id):next.delete(r.id);return next;})}/></td>{visibleColumns.map(key=><td key={key} data-column={key} className={key==='product'?'h-editor-pinned':''}>{cell(key)}</td>)}<td className="h-editor-spacer"/></tr>;
   })}</tbody></table></div></fieldset>
   {!visible.length&&<Empty title={rows.length?'No products match':'No products for this supplier'}>{rows.length?'Change the search or turn off Edited only.':'Return to the catalogue to add a product.'}</Empty>}
   <div className="h-editor-pagination"><span>{visible.length?currentPage*30+1:0}–{Math.min(visible.length,(currentPage+1)*30)} of {visible.length}</span><Button variant="quiet" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</Button><Button variant="quiet" disabled={(currentPage+1)*30>=visible.length} onClick={()=>setPage(currentPage+1)}>Next</Button></div>
   <div className="h-editor-savebar"><div><strong>{dirty?`${changed.length} products edited${reorder?' · order changed':''}`:'No unsaved changes'}</strong><small>Review your changes before applying them.</small></div><Button variant="secondary" disabled={!dirty||action.busy} onClick={()=>{if(confirmDiscard())load('');}}>Discard changes</Button><Button disabled={!selected.length||action.busy} onClick={()=>{const bad=selected.find(r=>productEditorErrors(r.values).length);if(bad){action.setError(`${bad.values.name||'Unnamed product'}: ${productEditorErrors(bad.values).join(' ')}`);return;}action.setError('');setPreview(true);}}>Review changes →</Button></div>
  </>}
 </Panel>
 {preview&&<Modal title="Review catalogue changes" onClose={()=>{if(!action.busy)setPreview(false);}} wide><div className="h-editor-review"><strong>{store.suppliers.find(s=>s.id===supplier)?.name}</strong><span>{changed.length} products edited{reorder?' · product order updated':''}</span></div><p>Product details will be saved. {priceHelp} Past orders stay unchanged.</p>{reorder&&<details className="h-editor-sequence"><summary>Review the new product order ({rows.length} products)</summary><ol>{rows.map(r=><li key={r.id}>{r.values.name}</li>)}</ol></details>}<div className="h-table-wrap"><table className="h-table"><thead><tr><th>Product</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{changed.flatMap(r=>changedProductFields(r.original,r.values).map(k=><tr key={`${r.id}-${k}`}><td>{r.original.name}</td><td>{productFieldLabels[k]}</td><td>{displayValue(k,r.original[k])}</td><td>{displayValue(k,r.values[k])}</td></tr>))}</tbody></table></div>{selected.length>240&&<p role="alert">Review up to 240 products per save. Discard the sequence change or save a smaller set of edits.</p>}{action.feedback}<div className="h-dialog-foot"><Button variant="secondary" disabled={action.busy} onClick={()=>setPreview(false)}>Keep editing</Button><Button busy={action.busy} disabled={selected.length>240} onClick={()=>action.run(async()=>{const result=await request({action:'product-bulk',requestId,supplierId:supplier,rows:selected.map(r=>({id:r.id,expected:r.expected,values:r.values})),...(reorder?{sequence:rows.map(r=>r.id)}:{})});load('');return result;},owner?'Changes saved. Owner prices updated immediately.':'Changes saved. Proposed prices are waiting in Catalogue → Price approvals.')}>Save changes</Button></div></Modal>}
 </div>;
}
