import {useDatabaseStatus} from '../../hooks/databaseStatus';
import {useUpdateProtection} from '../../hooks/useUpdateProtection';
import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {useAppStore} from '../../store';
import {generateProductCSV} from '../../utils/csvHelpers';
import {parseSupplierCatalogCSV} from '../../utils/supplierCatalogImport';
import {productSequence,productFingerprint} from '../../shared/product-workbench';
import {validateReplacementRows} from '../../shared/catalogue-replacement';
import {assertSupplierReviewUnchanged} from '../../shared/catalogue-review';
import {decodeCSVText} from '../../shared/product-csv';
import {validateCatalogueFile} from '../../shared/catalogue-file-validation';
import {CatalogueValidationError} from '../../shared/catalogue-errors';
import {CatalogueValidationNotice} from './CatalogueValidationNotice';
import {readSupplierFile} from './documentFiles';
import Papa from 'papaparse';
import {api,Button,useAction} from './ui';
import {SupplierFileReview} from './SupplierFileReview';
import {CatalogueFileReview,CatalogueNewProductChoices,FileReviewFrame} from './ProductFileReview';
import {CatalogueConflictReview} from './CatalogueConflictReview';
import type {CatalogueChoice} from '../../shared/catalogue-conflicts';

type ImportMode='catalogue'|'replace-catalogue'|'prices'|'supplier-file';
export const CatalogImportContext=createContext<(body:any)=>Promise<any>>(body=>api('/api/admin/workspace',body));
export const SupplierFileReaderContext=createContext(readSupplierFile);
export function ProductTransfer({supplierId,disabled=false,compact=false,onSaved,onExit,onFlowChange}:{supplierId:string;disabled?:boolean;compact?:boolean;onSaved:()=>void;onExit?:()=>void;onFlowChange?:(active:boolean)=>void}){
 const store=useAppStore(),request=useContext(CatalogImportContext),action=useAction(),catalogueInput=useRef<HTMLInputElement>(null),supplierInput=useRef<HTMLInputElement>(null);
 const readFile=useContext(SupplierFileReaderContext),quota=useDatabaseStatus(s=>s.quotaMessage);
 const [review,setReview]=useState<any>(null),[removeMissing,setRemoveMissing]=useState(false),[matching,setMatching]=useState<any>(null),[result,setResult]=useState<any>(null);
 const [readingKind,setReadingKind]=useState<'catalogue'|'supplier'|null>(null),[failedFile,setFailedFile]=useState<{file:File;kind:'catalogue'|'supplier'}|null>(null);
 const [catalogueMode,setCatalogueMode]=useState<'catalogue'|'replace-catalogue'>('catalogue');
 const [useRowOrder,setUseRowOrder]=useState(false);
 const [validationError,setValidationError]=useState<CatalogueValidationError|null>(null);
 const feedback=validationError?<CatalogueValidationNotice error={validationError}/>:action.feedback;
 const captureValidation=(error:unknown)=>{setValidationError(error instanceof CatalogueValidationError?error:null);throw error;};
 const [conflictReview,setConflictReview]=useState<any>(null),[conflictChoices,setConflictChoices]=useState<CatalogueChoice[]>([]);
 const supplierPrepared=useRef<{key:string;review:any}|null>(null);
 const supplier=store.suppliers.find(s=>s.id===supplierId),owner=store.currentUser?.role==='CREATOR';
 useEffect(()=>{setCatalogueMode('catalogue');setUseRowOrder(false);},[supplierId,owner]);
 const active=!!(readingKind||failedFile||review||matching||conflictReview||result);
 useUpdateProtection((active && !result) || action.busy);
 useEffect(()=>{onFlowChange?.(active);},[active,onFlowChange]);
 useEffect(()=>{if(!active||result)return;const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[active,result]);
 const cancel=()=>{if(action.busy)return;setValidationError(null);setCatalogueMode('catalogue');setUseRowOrder(false);setReview(null);setMatching(null);setConflictReview(null);setConflictChoices([]);setFailedFile(null);supplierPrepared.current=null;action.setError('');onExit?.();};
 const finish=(summary:any,name:string)=>{setCatalogueMode('catalogue');setUseRowOrder(false);setResult({...summary,supplierName:name});setReview(null);setMatching(null);setConflictReview(null);setFailedFile(null);supplierPrepared.current=null;};
 const exportFile=()=>{
  if(!supplierId||!supplier)return;
  const content=generateProductCSV(productSequence(store.products.filter(p=>p.supplierId===supplierId&&!p.removedAt),store.categories),store.categories,store.branches);
  const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`Catalog_${supplier.name.replace(/[^\p{L}\p{N}_-]/gu,'_')}_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);onExit?.();
 };
 const prepare=async(csv:string,mode:ImportMode,fileSource:any,targetSupplierId=supplierId,choices?:CatalogueChoice[],conflictExpected?:string,newProductDefaults?:any,orderChoice=useRowOrder)=>{
  setValidationError(null);
  try{
  const rows=parseSupplierCatalogCSV(csv);validateCatalogueFile(rows,targetSupplierId,store.branches,mode==='replace-catalogue');
  if(mode==='replace-catalogue')validateReplacementRows(rows);
  const requestId=crypto.randomUUID();
  const response=await request({action:'catalog-preview',csv,supplierId:targetSupplierId,requestId,removeMissing:mode==='replace-catalogue',mode,fileSource,conflictChoices:choices,conflictExpected,...(['catalogue','replace-catalogue'].includes(mode)?{newProductDefaults,useRowOrder:orderChoice}:{})});
  return {...response,csv,supplierId:targetSupplierId,requestId,supplierName:store.suppliers.find(s=>s.id===targetSupplierId)?.name,mode,fileSource,conflictChoices:choices,conflictExpected,newProductDefaults,useRowOrder:orderChoice,assignedSupplierRows:rows.filter(row=>!row.SupplierID?.trim()).length};
  }catch(error){return captureValidation(error);}
 };
 const showPreview=(prepared:any)=>{
  if(prepared.status==='conflicts'){setConflictReview(prepared);setConflictChoices(prepared.conflictChoices||[]);setReview(null);}
  else {setRemoveMissing(prepared.mode==='replace-catalogue');setReview(prepared);}
 };
 const commit=async(prepared:any,remove:boolean)=>{
  setValidationError(null);
  try{
  const {csv,supplierId,requestId,expected,mode,fileSource,conflictChoices,conflictExpected,newProductDefaults,useRowOrder}=prepared;
  const saved=await request({action:'catalog-commit',csv,supplierId,requestId,expected,removeMissing:remove,mode,fileSource,conflictChoices,conflictExpected,reviewed:true,...(['catalogue','replace-catalogue'].includes(mode)?{newProductDefaults,useRowOrder}:{})});
  finish(saved,prepared.supplierName);
  }catch(error){captureValidation(error);}
 };
 const upload=(file:File,kind:'catalogue'|'supplier')=>action.run(async()=>{
  setValidationError(null);
  if(!supplierId||!supplier)throw new Error('Select supplier before uploading a file.');
  setReadingKind(kind);setFailedFile({file,kind});setConflictReview(null);setConflictChoices([]);
  try{
   if(kind==='catalogue'&&!/\.(csv|xlsx|xls)$/i.test(file.name))throw new Error('Upload your edited HTOS CSV or Excel export here. Use Upload File for PDFs and photos.');
   const document=await readFile(file);
   if(!document.rows.length||document.rows.length>240)throw new Error(kind==='catalogue'&&catalogueMode==='replace-catalogue'?'Choose one complete catalogue with 1 to 240 product rows. Do not split a replacement into partial files.':'Choose a file with 1 to 240 product rows. Larger add-and-update files can be split into parts; missing products are kept.');
   const headers=Object.keys(document.rows[0]).map(h=>h.trim().toLowerCase());
   const template=!document.scanned&&headers.includes('systemid')&&headers.some(h=>['pricebox','priceunit','displayorder','position','active'].includes(h));
   if(kind==='catalogue'&&!template)throw new Error('This is not an HTOS catalogue file. Use Export CSV, edit that file and keep its column headings. For a supplier’s own file, choose Upload File.');
   if(kind==='catalogue')showPreview(await prepare(Papa.unparse(document.rows),owner?catalogueMode:'catalogue',{name:file.name}));
   else setMatching({document,file,supplierId});
   setFailedFile(null);
  }catch(error){captureValidation(error);}finally{setReadingKind(null);}
 },'');
 const saveCatalogue=(names:Record<string,string>)=>action.run(async()=>{
  let prepared=review;
  const edits=review.details.filter((item:any)=>names[item.id]!==undefined&&names[item.id]!==item.after.name);
  if(edits.length){
   const rows=parseSupplierCatalogCSV(review.csv).map((row,index)=>{
    const choice=review.selections?.find((selection:any)=>selection.rowNumber===index+2);
    const item=edits.find((item:any)=>item.rowNumber!==undefined?item.rowNumber===index+2:choice?item.id===choice.productId:row.SystemID?row.SystemID===item.id:!!row.ItemCode&&decodeCSVText(row.ItemCode)===item.itemCode);
    if(!item)return row;
    const name=names[item.id].trim();if(!name)throw new Error('Enter a name for every product.');
    return {...row,Name:/^[=+\-@\t\r]/.test(name)?`'${name}`:name};
   });
   prepared=await prepare(Papa.unparse(rows),review.mode,review.fileSource,review.supplierId,review.conflictChoices,review.conflictExpected,review.newProductDefaults,review.useRowOrder);
   if(prepared.status==='conflicts'||prepared.expected!==review.expected)throw new Error('The catalogue changed during your review. Nothing was saved. Cancel and upload the file again.');
   setReview(prepared);
  }
  await commit(prepared,removeMissing);
 },'');
 const saveSupplier=(csv:string,source:any,draft:any)=>action.run(async()=>{
  const selected=draft.lines.filter((line:any)=>line.selected);
  const products=selected.map((line:any)=>draft.products.find((p:any)=>p.id===line.productId));
  const key=JSON.stringify([csv,products.map(productFingerprint)]);
  // Reuse the reviewed request on an explicit retry; the server receipt prevents duplicate saves.
  let prepared=supplierPrepared.current?.key===key?supplierPrepared.current.review:null;
  if(!prepared){
   prepared=await prepare(csv,'supplier-file',source,matching.supplierId);
   assertSupplierReviewUnchanged(prepared.matchedItems||[],products);
   supplierPrepared.current={key,review:prepared};
  }
  await commit(prepared,false);
 },'');
 return <div className="h-product-transfer">
  {!active&&<><div className="h-product-files-toolbar" role="group" aria-label="Product files">
   <div><Button variant="secondary" disabled={!supplierId||disabled||action.busy} onClick={exportFile}>Export CSV</Button><small>All active and inactive products for this supplier</small></div>
   <div><Button variant="secondary" disabled={!supplierId||disabled||action.busy} onClick={()=>catalogueInput.current?.click()}>Upload CSV</Button><small>{catalogueMode==='replace-catalogue'?'Replace the complete list':'Add and update · missing products kept'}</small></div>
   <div><Button variant="secondary" disabled={!supplierId||disabled||action.busy} onClick={()=>supplierInput.current?.click()}>Upload File</Button><small>Match a supplier’s prices</small></div>
  </div><details className="h-product-file-options" open={compact?undefined:true}><summary>{catalogueMode==='replace-catalogue'?'CSV: Replace complete list · file guide':'CSV: Add and update · file guide'}</summary>{owner&&<label className="h-product-file-guide">CSV action <select aria-label="CSV action" value={catalogueMode} disabled={disabled||action.busy} onChange={e=>setCatalogueMode(e.target.value as 'catalogue'|'replace-catalogue')}><option value="catalogue">Add and update (recommended)</option><option value="replace-catalogue">Replace complete list</option></select>{catalogueMode==='replace-catalogue'&&<p role="status">Use a complete supplier file. Omitted active products become inactive only after you review and confirm.</p>}</label>}
  <label className="h-product-file-guide"><input type="checkbox" checked={useRowOrder} disabled={disabled||action.busy} onChange={e=>setUseRowOrder(e.target.checked)}/> Use CSV row order</label><p>Leave off to keep positions unless you edit Position. When on, file products come first; omitted products follow in their current order. Review before saving.</p>
  <details className="h-product-file-guide"><summary>File guide</summary><p><strong>Export CSV:</strong> includes all active and inactive products for the selected supplier, excluding deleted products.</p><p><strong>Upload CSV:</strong> Add and update is the default. Keep SystemID for existing items. With a blank SystemID, a unique supplier code matches an existing active or inactive product; otherwise a new product receives an ID automatically. Supplier codes can be blank for genuinely new products. Export after saving to keep their assigned IDs. Missing products are kept unless you explicitly choose removal. Past orders stay unchanged.</p><p>Blank SupplierID cells use the selected supplier; different supplier IDs are rejected. Keep headings and supplier codes as text. Blank optional cells keep current values; 0 means a zero price. Blank new prices remain unknown. Use FALSE in Active to hide an item.</p><p><strong>Position:</strong> one sequence for the catalogue, bulk editor, ordering and checklist. SystemID identifies a product; it is not its position. Keep CSVVersion and the identifiers at the right of the export. Older HTOS exports are still accepted.</p><p><strong>BranchScope:</strong> ALL means all permitted branches, including eligible future branches. SELECTED uses the Yes/No branch columns. Supplier and user restrictions still apply. New products with missing category or branch choices need confirmation in the review.</p><p>{store.branches.map(b=>b.code+' — '+b.name).join('; ')}</p><p><strong>Upload File:</strong> Excel, CSV, PDF, JPG, PNG or WebP, up to 3 MB. Match existing HTOS items and review names and prices. Missing items are kept. PDFs and photos need the scanning service; Excel and CSV are read locally.</p><p>Each upload accepts up to 240 rows. Replacement requires the complete list and must not be split. In replacement mode, keep existing SystemIDs: blank IDs deliberately create new products. Save or discard editor changes before using files.</p></details></details></>}
  <input ref={catalogueInput} hidden type="file" accept=".csv,.xlsx,.xls" aria-label="Upload edited HTOS catalogue" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file,'catalogue');e.target.value='';}}/>
  <input ref={supplierInput} hidden type="file" accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp" aria-label="Upload supplier price file" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file,'supplier');e.target.value='';}}/>
  {readingKind&&<div className="h-file-reading" role="status"><strong>Checking {failedFile?.file.name}</strong><p>{readingKind==='supplier'?'Reading the file and finding product matches. PDF and photo scanning may take a moment.':'Checking product details and the complete supplier list.'} Nothing has been saved.</p></div>}
  {failedFile&&!readingKind&&<FileReviewFrame title="Check the file" subtitle={failedFile.file.name}>{feedback}<p>Your products have not changed. Correct the file and choose it again, or retry if the service was unavailable.</p><div className="h-file-review-actions"><Button variant="secondary" onClick={cancel}>Cancel upload</Button><Button variant="secondary" onClick={()=>(failedFile.kind==='catalogue'?catalogueInput:supplierInput).current?.click()}>Choose another file</Button><Button disabled={!!quota} onClick={()=>void upload(failedFile.file,failedFile.kind)}>Retry check</Button></div></FileReviewFrame>}
  {matching&&<FileReviewFrame title={`Review supplier file · ${supplier?.name}`} subtitle="Update selected names and prices · GBP excluding VAT"><p className="h-file-policy">{owner?'Owner prices update when you confirm. No further approval.':'Names save when you confirm. Prices are submitted for approval.'}</p><SupplierFileReview {...matching} inline directSave busy={action.busy} quota={quota} error={feedback} onClose={cancel} onReview={(csv,source,draft)=>void saveSupplier(csv,source,draft)}/></FileReviewFrame>}
  {conflictReview&&!review&&<FileReviewFrame title="Choose the correct product" subtitle={conflictReview.supplierName}><CatalogueConflictReview inline supplierName={conflictReview.supplierName} conflicts={conflictReview.conflicts} choices={conflictChoices} busy={action.busy} error={feedback} onChoose={choice=>setConflictChoices(current=>[...current.filter(c=>c.rowNumber!==choice.rowNumber),choice])} onClose={cancel} onContinue={()=>void action.run(async()=>showPreview(await prepare(conflictReview.csv,'catalogue',conflictReview.fileSource,conflictReview.supplierId,conflictChoices,conflictReview.expected)),'')}/></FileReviewFrame>}
  {review?.status==='details-required'&&<CatalogueNewProductChoices key={review.requestId} review={review} busy={action.busy} error={feedback} onCancel={cancel} onCheck={defaults=>void action.run(async()=>showPreview(await prepare(review.csv,review.mode,review.fileSource,review.supplierId,review.conflictChoices,review.conflictExpected,defaults,review.useRowOrder)),'')}/>}
  {review&&review.status!=='details-required'&&<CatalogueFileReview key={review.requestId} review={review} busy={action.busy} error={feedback} quota={quota} removeMissing={removeMissing} onRemoveMissing={setRemoveMissing} onCancel={cancel} onSave={names=>void saveCatalogue(names)}/>}
  {result&&<FileReviewFrame title="Product list saved" subtitle={result.supplierName}><div className="h-file-complete" role="status"><p><strong>{result.added} added · {result.updated} updated · {result.removed} removed</strong></p><p>{result.immediatePrices?`${result.pricesApplied} prices updated.`:`${result.proposed} prices waiting for approval.`} Past orders are unchanged.</p></div><div className="h-file-review-actions"><span>Choose a supplier again for your next task.</span><Button onClick={()=>{setResult(null);onSaved();}}>Done</Button></div></FileReviewFrame>}
 </div>;
}
