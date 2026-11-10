import React,{useEffect,useMemo,useState} from 'react';
import Papa from 'papaparse';
import {useAppStore} from '../../store';
import {assessFileLine,catalogueFileLines,chooseFileSource,initialMatchedSelection,selectedSupplierUpdates,normalText,fileFields,mapFileLines,suggestColumns,type ColumnMap,type FileField,type FileLine} from '../../shared/supplier-file';
import {Button,Modal} from './ui';
import './supplier-file.css';

export const money=(value:number|null|undefined)=>value==null?'Not set':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:4}).format(value);
export function SupplierFileReview({document,file,supplierId,busy,error,draft,onClose,onReview,inline=false,directSave=false,quota=''}:{inline?:boolean;directSave?:boolean;quota?:string;document:any;file:File;supplierId:string;busy:boolean;error:React.ReactNode;draft?:any;onClose:()=>void;onReview:(csv:string,source:any,draft:any)=>void}){
 const {products:currentProducts,suppliers}=useAppStore();
 const [products]=useState(()=>currentProducts.filter(p=>!p.removedAt&&p.supplierId===supplierId).map(p=>({...p,allowedBranchIds:[...p.allowedBranchIds]})));
 const supplierName=suppliers.find(s=>s.id===supplierId)?.name||'Selected supplier',headers=Object.keys(document.rows[0]||{});
 const [checked,setChecked]=useState(false);
 const [mapping,setMapping]=useState<ColumnMap>(()=>draft?.mapping||suggestColumns(headers));
 const sources=useMemo(()=>mapFileLines(document.rows,mapping,products,supplierId),[document.rows,mapping,products,supplierId]);
 const buildLines=(map:ColumnMap)=>initialMatchedSelection(catalogueFileLines(mapFileLines(document.rows,map,products,supplierId),products,supplierId),products,supplierId,supplierName);
 const [lines,setLines]=useState<FileLine[]>(()=>draft?.catalogueFirst?draft.lines:buildLines(mapping));
 const [search,setSearch]=useState(''),[sourceSearch,setSourceSearch]=useState<Record<string,string>>({}),[editing,setEditing]=useState('');
 const [pages,setPages]=useState({matched:0,unmatched:0}),[url,setUrl]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{if(!document.scanned)return;const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file,document.scanned]);
 useEffect(()=>setChecked(false),[lines]);
 const selected=lines.filter(l=>l.selected);
 const assessment=useMemo(()=>new Map(lines.map(l=>[l.id,assessFileLine(l,products,supplierId,supplierName,selected)])),[lines,products,supplierId,supplierName]);
 const unchanged=lines.filter(l=>l.sourceId&&assessment.get(l.id)?.unchanged&&!l.selected);
 const matches=lines.filter(l=>!!l.sourceId&&!unchanged.includes(l)),unmatched=lines.filter(l=>!l.sourceId);
 const visible=(list:FileLine[])=>list.filter(l=>{const p=assessment.get(l.id)?.product;return normalText([p?.itemCode,p?.name,p?.chineseName,l.proposedName].join(' ')).includes(normalText(search));});
 const matchedView=visible(matches),unmatchedView=visible(unmatched);
 const invalid=selected.some(l=>{const a=assessment.get(l.id)!;return !l.sourceId||a.blocked.length||a.unchanged;});
 const warningCount=selected.filter(l=>assessment.get(l.id)!.flags.length>0).length;
 const patch=(id:string,values:Partial<FileLine>)=>{setLines(ls=>ls.map(l=>{if(l.id!==id)return l;const next={...l,...values,reviewed:false};if(values.selected===undefined){const a=assessFileLine(next,products,supplierId,supplierName);next.selected=!!next.sourceId&&!a.unchanged;}return next;}));setMessage('');};
 const changeMapping=(key:FileField,value:string)=>{const next={...mapping,[key]:value};setMapping(next);setLines(buildLines(next));setSourceSearch({});setEditing('');setPages({matched:0,unmatched:0});setMessage('Matches updated. Review the selected items below.');};
 const choose=(line:FileLine,sourceId:string)=>{
  const source=sources.find(s=>s.id===sourceId);
  if(source&&lines.some(l=>l.id!==line.id&&l.sourceId===source.id)){setMessage('That supplier item is already matched. Clear its other match first.');return;}
  const next=chooseFileSource(line,source),a=assessFileLine(next,products,supplierId,supplierName);
  next.selected=!!source&&!a.blocked.length&&!a.unchanged;
  setLines(ls=>ls.map(l=>l.id===line.id?next:l));setEditing('');setMessage(source?'Item matched and added to the top list. Review it before updating.':'Match cleared. Find this item under Needs matching.');
 };
 const picker=(line:FileLine)=>{
  const p=assessment.get(line.id)?.product,code=p?.itemCode||p?.id,term=normalText(sourceSearch[line.id]||'');
  const options=sources.filter(s=>s.id===line.sourceId||normalText([s.code,s.name,s.packSize].join(' ')).includes(term)).slice().sort((a,b)=>a.code.localeCompare(b.code,'en-GB',{numeric:true,sensitivity:'base'})||a.name.localeCompare(b.name));
  return <div className="h-file-picker"><label>Find supplier item<input aria-label={`Find supplier item for ${code}`} placeholder="Search file by code, name or pack" value={sourceSearch[line.id]||''} onChange={e=>setSourceSearch(v=>({...v,[line.id]:e.target.value}))}/></label><label>Supplier-file item<select aria-label={`Supplier item for ${code}`} value={line.sourceId||''} onChange={e=>choose(line,e.target.value)}><option value="">Choose supplier item...</option>{options.map(s=>{const used=lines.some(l=>l.id!==line.id&&l.sourceId===s.id);return <option key={s.id} value={s.id} disabled={used}>{s.code||'No code'} · {s.name||'No description'} · Row {Number(s.id)+1}{used?' (already matched)':''}</option>;})}</select></label>{!options.length&&<small>No supplier items found. Try a different code or name.</small>}</div>;
 };
 const pagination=(kind:'matched'|'unmatched',length:number,size:number)=>{
  const last=Math.max(0,Math.ceil(length/size)-1),page=Math.min(pages[kind],last);
  return length>size&&<div className="h-file-tools"><span>Page {page+1} of {last+1}</span><Button variant="quiet" disabled={busy||page===0} onClick={()=>setPages(p=>({...p,[kind]:page-1}))}>Previous {kind}</Button><Button variant="quiet" disabled={busy||page===last} onClick={()=>setPages(p=>({...p,[kind]:page+1}))}>Next {kind}</Button></div>;
 };
 const pageRows=(list:FileLine[],kind:'matched'|'unmatched',size:number)=>{const page=Math.min(pages[kind],Math.max(0,Math.ceil(list.length/size)-1));return list.slice(page*size,(page+1)*size);};
 const content=<>
  <div className="h-supplier-file h-file-compact">
   <p className="h-file-intro"><strong>{file.name}</strong><span>{matches.length} matched · {unmatched.length} need matching · GBP excluding VAT</span></p>
   <p>Matched items are ready to review. Edit a product name or price if needed. Match the remaining items below, or leave them unchanged.</p>
   {!!document.scanned&&<details className="h-file-source"><summary>View original document</summary>{/\.pdf$/i.test(file.name)?<iframe title="Original supplier PDF" src={url}/>:<img alt="Original supplier document" src={url}/>}</details>}
   {!document.scanned&&<details className="h-file-mapping" open={(!mapping.casePrice&&!mapping.packPrice)||undefined}><summary>Spreadsheet columns</summary><p>Changing columns rebuilds matching and clears your edits. Never use a line total as a product price.</p><div>{(Object.keys(fileFields) as FileField[]).map(key=><label key={key}>{fileFields[key]}<select value={mapping[key]} disabled={busy} onChange={e=>changeMapping(key,e.target.value)}><option value="">Not supplied</option>{headers.map(h=><option key={h}>{h}</option>)}</select></label>)}</div><Button variant="secondary" disabled={busy} onClick={()=>{setLines(buildLines(mapping));setPages({matched:0,unmatched:0});setMessage('Matching checked. Review the matched products below; no changes have been saved.');}}>Check matching</Button></details>}
   {!lines.length&&<p className="h-file-error">This supplier has no saved products. Add its catalogue first, then match prices.</p>}
   <div className="h-file-tools"><input aria-label="Search HTOS items" placeholder="Find HTOS Product ID or name" disabled={busy} value={search} onChange={e=>{setSearch(e.target.value);setPages({matched:0,unmatched:0});}}/><Button variant="secondary" disabled={busy||!matches.length} onClick={()=>setLines(ls=>ls.map(l=>{const a=assessFileLine(l,products,supplierId,supplierName);return {...l,selected:!!l.sourceId&&!a.blocked.length&&!a.unchanged&&a.product?.active!==false};}))}>Select matched updates</Button><Button variant="quiet" disabled={busy||!selected.length} onClick={()=>setLines(ls=>ls.map(l=>({...l,selected:false})))}>Clear selection</Button></div>
   <fieldset disabled={busy} className="h-file-rows"><legend className="sr-only">Matched products and remaining items</legend>
   <section aria-label="Matched items"><h3 className="h-file-group-title">Matched items <span>{matchedView.length}</span></h3>
   {!!matchedView.length?<div className="h-file-match-table" tabIndex={0} role="region" aria-label="Matched products and price warnings"><table><thead><tr><th aria-label="Select updates"/><th>HTOS product / ID</th><th>Supplier item</th><th>Case price (£)</th><th>Unit price (£)</th><th>Checks</th></tr></thead><tbody>{pageRows(matchedView,'matched',20).map(line=>{const a=assessment.get(line.id)!,p=a.product!,code=p?.itemCode||line.productId;return <React.Fragment key={line.id}><tr>
    <td><input type="checkbox" aria-label={`Update ${code}`} checked={line.selected} disabled={a.unchanged&&!a.blocked.length} onChange={e=>patch(line.id,{selected:e.target.checked})}/></td>
    <td><small>{code}{p?.active===false?' · Inactive':''}</small><input className="h-file-name" aria-label={`HTOS name for ${code}`} maxLength={300} value={line.proposedName??p?.name??''} onChange={e=>patch(line.id,{proposedName:e.target.value})}/><small>{line.proposedName!==undefined&&line.proposedName!==p?.name?`Was: ${p?.name}`:`Pack: ${p?.packSize||'Not recorded'}`}</small></td>
    <td><strong>{line.code||'No code'}</strong><span>{line.name||'No description'}</span><small>Pack: {line.packSize||'Not supplied'}</small><button type="button" className="h-file-link" aria-label={`Change match for ${code}`} aria-expanded={editing===line.id} onClick={()=>setEditing(editing===line.id?'':line.id)}>Change match</button></td>
    <td><input aria-label={`Case price for ${code}`} inputMode="decimal" value={line.casePrice} onChange={e=>patch(line.id,{casePrice:e.target.value})}/><small>Was {money(p?.casePrice)}</small></td>
    <td><input aria-label={`Unit price for ${code}`} inputMode="decimal" value={line.packPrice} onChange={e=>patch(line.id,{packPrice:e.target.value})}/><small>Was {money(p?.packPrice)}</small></td>
    <td>{a.blocked.map(t=><p className="h-file-error" key={t}>{t}</p>)}{a.flags.length>0?<details className="h-file-warning"><summary>{a.flags.length} warning{a.flags.length===1?'':'s'}</summary>{a.flags.map(t=><p key={t}>{t}</p>)}</details>:!a.blocked.length&&<span>{a.unchanged?'Unchanged':'Matched'}</span>}</td>
   </tr>{editing===line.id&&<tr><td colSpan={6}><div className="h-file-change">{picker(line)}<Button variant="quiet" onClick={()=>setEditing('')}>Close matching</Button></div></td></tr>}</React.Fragment>;})}</tbody></table></div>:<p>No matched items in this view.</p>}
   {pagination('matched',matchedView.length,20)}</section>
   <details className="h-file-unmatched"><summary>Needs matching ({unmatchedView.length})</summary><section aria-label="Needs matching"><p>Choose a supplier item only for the products you want to update. Sorted by Product ID / item code.</p>
   {pageRows(unmatchedView,'unmatched',10).map(line=>{const p=assessment.get(line.id)?.product;return <article key={line.id} className="h-file-row h-file-match"><div><small>{p?.itemCode||line.productId}</small><strong>{p?.name}</strong><span>Pack: {p?.packSize||'Not recorded'}</span><small>{line.reason}</small></div>{picker(line)}</article>;})}
   {!unmatchedView.length&&<p>No unmatched items in this view.</p>}{pagination('unmatched',unmatchedView.length,10)}</section></details>
   {!!unchanged.length&&<details className="h-file-unchanged"><summary>{unchanged.length} unchanged products</summary><ul>{unchanged.map(line=><li key={line.id}>{assessment.get(line.id)?.product?.itemCode} · {assessment.get(line.id)?.product?.name}</li>)}</ul></details>}
   </fieldset>
   <div className="h-file-footer"><p role="status" className="h-file-next">{invalid?'Correct the selected errors, or untick those items.':`${selected.length} selected · ${warningCount} with warnings. Review these changes before saving.`}</p>{message&&<p role="status">{message}</p>}{error}
   {directSave&&<label className="h-file-check"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>I checked the matches, names, packs, warnings and GBP prices excluding VAT.</label>}{quota&&<p role="alert">{quota}</p>}<div className="h-dialog-foot"><span className="h-file-help">Unselected items and past orders stay unchanged.</span><Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!selected.length||invalid||(directSave&&(!checked||!!quota))} onClick={()=>{
    try{const rows=selectedSupplierUpdates(lines,products,supplierId,supplierName);onReview(Papa.unparse(rows),{name:file.name,reference:String(document.invoiceNumber||''),date:String(document.invoiceDate||''),supplier:String(document.supplierName||''),currency:'GBP',notes:String(document.notes||'').slice(0,2000)},{catalogueFirst:true,mapping,lines,products});}catch(e){setMessage((e as Error).message);}
   }}>{directSave?`Confirm & save (${selected.length})`:`Review updates (${selected.length})`}</Button></div></div>
  </div>
 </>;
 return inline?content:<Modal title={`Match supplier prices · ${supplierName}`} className="h-file-dialog" wide onClose={()=>{if(!busy)onClose();}}>{content}</Modal>;
}
