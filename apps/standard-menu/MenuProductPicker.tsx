import React, {useEffect, useRef, useState} from 'react';
import {FileText, Search, ArrowRight, Upload, Download} from 'lucide-react';
import {useMenuSession,canMenu as can} from './session';
import type {MenuProduct, ProductChoice, Specification} from '../../shared/menu-recipes';
import {SPEC_EXTENSIONS, SPEC_MAX_BYTES} from '../../shared/menu-recipes';
import {Button, Field, Modal, Empty, day, useAction} from '../../app/htos/ui';
import {useMenuApi, fileBase64, downloadSpecification} from './menuApi';

export function MenuProductPicker({onChoose,onClose,excluded=[],initialSupplier='',ingredientName}: {
  onChoose:(choice:ProductChoice)=>void;onClose:()=>void;excluded?:string[];initialSupplier?:string;ingredientName?:string;
}) {
  const api = useMenuApi();
  const {suppliers:allowed,supplierCursor,loadMoreSuppliers} = useMenuSession();
  const [supplierId,setSupplier] = useState(initialSupplier),[products,setProducts] = useState<MenuProduct[]>([]);
  const [cursor,setCursor] = useState<string|null>(null),[search,setSearch] = useState('');
  const [loading,setLoading] = useState(false),[error,setError] = useState('');
  const [specProduct,setSpecProduct] = useState<ProductChoice|null>(null);
  const generation = useRef(0);
  async function load(id:string,more=false) {
    const current = ++generation.current;setLoading(true);setError('');
    try {
      const result = await api({action:'menu-products',supplierId:id,cursor:more ? cursor : null});
      if (current !== generation.current) return;
      setProducts(p => more ? [...p,...result.products] : result.products);setCursor(result.cursor);
    } catch(e) {if(current===generation.current)setError((e as Error).message);}
    finally {if(current===generation.current)setLoading(false);}
  }
  useEffect(() => {setProducts([]);setCursor(null);setSearch('');if(supplierId)void load(supplierId);return()=>{generation.current++;};},[supplierId]);
  const choice = (p:MenuProduct):ProductChoice => ({productId:p.id,supplierId:p.supplierId,productName:p.name,itemCode:p.itemCode,
    packSize:p.packSize,supplierName:allowed.find(s=>s.id===p.supplierId)?.name || '',note:''});
  const matches = products.filter(p => `${p.name} ${p.itemCode}`.toLowerCase().includes(search.toLowerCase()));
  return <Modal title="Select supplier, then product" onClose={onClose} wide className="m-picker">
    {ingredientName&&<p className="m-help">Ingredient: <strong>{ingredientName}</strong></p>}
    {supplierCursor&&<Button variant="secondary" busy={loading} onClick={async()=>{setLoading(true);try{await loadMoreSuppliers();}catch(e){setError((e as Error).message);}finally{setLoading(false);}}}>Load more suppliers</Button>}<div className="m-picker-tools"><Field label="Supplier"><select aria-label="Supplier" value={supplierId} onChange={e=>setSupplier(e.target.value)}><option value="">Select a supplier</option>{allowed.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Search loaded products"><div className="m-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Product name or code" disabled={!supplierId}/></div></Field></div>
    {error&&<div role="alert" className="h-notice error">{error} <Button variant="quiet" onClick={()=>void load(supplierId)}>Retry</Button></div>}
    {!supplierId ? <Empty title="Choose the supplier first">Products come from your existing HTOS catalogue.</Empty> : <>
      <p className="m-help">{products.length} products loaded. {cursor ? 'Load more to search the rest of this supplier’s catalogue.' : 'All available products from this supplier are loaded.'}</p>
      <div className="m-product-results">{matches.map(p=><div className="m-product-result" key={p.id}><div><strong>{p.name}</strong><small>{p.itemCode || 'No product code'} · {p.packSize || 'Pack size not recorded'}</small></div><Button variant="quiet" aria-label={`Specifications for ${p.name}`} onClick={()=>setSpecProduct(choice(p))}><FileText size={17}/><span>Specs</span></Button><Button variant="secondary" disabled={excluded.includes(p.id)} onClick={()=>onChoose(choice(p))}>{excluded.includes(p.id)?'Selected':'Select'}<ArrowRight size={15}/></Button></div>)}</div>
      {!loading&&!matches.length&&<Empty title={products.length?'No matching loaded products':'No available products'}>{cursor?'Load more products or change the search.':'Choose another supplier or check the catalogue.'}</Empty>}
      {loading&&<p role="status">Loading products…</p>}{cursor&&<Button variant="secondary" busy={loading} onClick={()=>void load(supplierId,true)}>Load more products</Button>}
    </>}
    {specProduct&&<ProductSpecifications product={specProduct} onClose={()=>setSpecProduct(null)}/>}
  </Modal>;
}

export function ProductSpecifications({product,onClose,onChanged}: {product:ProductChoice;onClose:()=>void;onChanged?:()=>void}) {
  const api = useMenuApi(), action = useAction();
  const {account:user} = useMenuSession();
  const [files,setFiles] = useState<Specification[]>([]),[cursor,setCursor] = useState<string|null>(null),[loading,setLoading] = useState(true),[loadError,setLoadError] = useState('');
  const [selected,setSelected] = useState<File|null>(null),[date,setDate] = useState(''),[note,setNote] = useState('');
  const request = useRef({id:crypto.randomUUID(),payload:''});
  const input = useRef<HTMLInputElement>(null);
  const load = async(more=false) => {setLoading(true);setLoadError('');try{const result=await api({action:'menu-spec-list',productId:product.productId,cursor:more?cursor:null});setFiles(f=>more?[...f,...result.specifications]:result.specifications);setCursor(result.cursor);}catch(e){setLoadError((e as Error).message);}finally{setLoading(false);}};
  useEffect(()=>{void load();},[product.productId]);
  const upload = () => action.run(async()=>{
    if(!selected)throw new Error('Choose a specification file first.');
    if(!SPEC_EXTENSIONS.includes(selected.name.split('.').pop()?.toLowerCase() as any)||selected.size>SPEC_MAX_BYTES||!selected.size)throw new Error('Choose PDF, Excel, Word, CSV, TXT, JPG or PNG, up to 2 MB.');
    const body = {action:'menu-spec-upload',productId:product.productId,fileName:selected.name,base64:await fileBase64(selected),specificationDate:date,note};
    const payload = JSON.stringify(body);
    if(request.current.payload!==payload)request.current={id:crypto.randomUUID(),payload};
    await api({...body,requestId:request.current.id});setSelected(null);setDate('');setNote('');if(input.current)input.current.value='';onChanged?.();await load();
  },'Specification saved as an unreviewed source.');
  return <Modal title="Product specifications" onClose={()=>{if(!action.busy)onClose();}} wide className="m-specs">
    <p><strong>{product.productName}</strong><br/>{product.supplierName} · {product.itemCode||'No product code'}</p>
    <p className="m-help">Files belong to this exact supplier product. Uploading a file does not approve its allergen information.</p>
    {can(user,'manage_product_specs')&&<section className="m-upload"><h3>Add a specification</h3><Field label="File" hint="PDF, Excel, Word, CSV, TXT, JPG or PNG · maximum 2 MB"><input ref={input} type="file" accept={SPEC_EXTENSIONS.map(e=>'.'+e).join(',')} disabled={action.busy} onChange={e=>setSelected(e.target.files?.[0]||null)}/></Field><div className="m-two"><Field label="Specification date (if known)"><input type="date" value={date} disabled={action.busy} onChange={e=>setDate(e.target.value)}/></Field><Field label="Source or notes"><input value={note} maxLength={1000} disabled={action.busy} onChange={e=>setNote(e.target.value)} placeholder="For example, supplier specification revision"/></Field></div><Button busy={action.busy} disabled={!selected} onClick={upload}><Upload size={16}/>Upload specification</Button></section>}
    {action.feedback}{loadError&&<div role="alert" className="h-notice error">{loadError}<Button variant="quiet" onClick={()=>void load()}>Retry</Button></div>}
    <h3>Saved specifications</h3>{loading&&<p role="status">Loading specifications…</p>}
    {files.map(f=><div className="m-spec-file" key={f.id}><FileText size={19}/><div><strong>{f.fileName}</strong><small>Specification: {day(f.specificationDate)} · {(f.bytes/1024).toFixed(0)} KB</small><small>Uploaded {day(f.uploadedAt)} by {f.uploadedByName} · Unreviewed</small>{f.note&&<p>{f.note}</p>}</div><Button variant="secondary" busy={action.busy} aria-label={`Download ${f.fileName}`} onClick={()=>action.run(async()=>downloadSpecification(await api({action:'menu-spec-download',productId:product.productId,id:f.id})), '')}><Download size={16}/><span>Download</span></Button></div>)}
    {!loading&&!files.length&&!loadError&&<Empty title="No specifications attached">Add the supplier’s original file when it is available.</Empty>}
    {cursor&&<Button variant="secondary" busy={loading} onClick={()=>void load(true)}>Load older specifications</Button>}
  </Modal>;
}
