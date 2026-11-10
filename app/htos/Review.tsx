import {documentUnit,scannedLine,hasDocumentPrices} from '../../shared/document-scan';
import {deliveryIssues} from '../../shared/delivery-check';
import {documentReviewLines,deliveryReviewLines,type CheckDocumentKind,type DocumentReviewLine} from '../../shared/document-review';
import {DamageEvidence} from './DamageEvidence';
import {useCheckWorkflow} from './CheckWorkflow';
import React,{useState} from 'react';
import {useAppStore} from '../../store';
import type {OrderRecord,InvoiceEvidence} from '../../types';
import {calculateOrderReconciliation,type ReconciledLineInput} from '../../utils/invoiceReconciliation';
import {Button,Field,Modal,Tag,api,money,today,useAction,csv} from './ui';
import {readSupplierFile} from './documentFiles';
import {documentRow,matchSupplierProduct,rowValue} from '../../shared/product-workbench';
import {invoiceFlags} from '../../shared/invoice-flags';
import {damagePhoto} from './invoiceEvidence';

export function InvoiceReview({order,onClose,kind='INVOICE',onKindChange,footer}:{order:OrderRecord;onClose:()=>void;kind?:CheckDocumentKind;onKindChange?:(kind:CheckDocumentKind)=>void;footer?:React.ReactNode}){
 const initialDelivery=kind==='DELIVERY',receipt=order.deliveryCheck;
 const [dirty,setDirty]=useState(false),[partial,setPartial]=useState(receipt?.partial||false);
 const store=useAppStore(),action=useAction(),request=useCheckWorkflow(),existing=order.invoiceVerification,locked=!!order.supplierCase||order.creditNoteClaim?.emailStatus==='SENT';
 const [number,setNumber]=useState(initialDelivery?receipt?.reference||'':existing?.invoiceNumber==='[NOT_PROVIDED]'?'':existing?.invoiceNumber||''),[noNumber,setNoNumber]=useState(existing?.invoiceNumberNotProvided||false),[date,setDate]=useState((initialDelivery?receipt?.date:existing?.invoiceDate)||today()),[reference,setReference]=useState(initialDelivery?receipt?.reference||'':existing?.evidenceReference||''),[notes,setNotes]=useState((initialDelivery?receipt?.notes:existing?.notes)||''),[evidence,setEvidence]=useState<InvoiceEvidence[]>((initialDelivery?receipt?.evidence:existing?.evidence||receipt?.evidence)||[]),[scanRows,setScanRows]=useState<any[]|null>(null);
 const [lines,setLines]=useState<DocumentReviewLine[]>(()=>documentReviewLines(order,kind));
 const delivery=!existing&&!hasDocumentPrices(lines);
 const [scanInfo,setScanInfo]=useState('');
 const options={comparisonOnly:true,verifierName:store.currentUser!.displayName,invoiceNumber:number,invoiceNumberNotProvided:noNumber,invoiceDate:date,remarks:notes,evidenceReference:reference,reviewMethod:'MANUAL' as const};
 const result=calculateOrderReconciliation(order,lines,options);
 const pricesComplete=lines.every(l=>l.invoicedCaseQty!=null&&l.invoicedPackQty!=null&&(!l.invoicedCaseQty||l.invoicedCasePrice!=null)&&(!l.invoicedPackQty||l.invoicedPackPrice!=null));
 const set=(i:number,key:string,value:any)=>setLines(current=>current.map((l,n)=>n===i?{...l,[key]:value,...(key.startsWith('delivered')?{receiptConfirmed:true}:{}),isReviewed:key==='isReviewed'?value:false}:l));
 const save=(draft:boolean)=>action.run(async()=>{
  if(scanRows)throw new Error('Finish matching or cancel the uploaded document first.');
  if(delivery)await request({action:'delivery-check',orderId:order.id,expectedVersion:receipt?.version||0,draft,reference:number,date,partial,notes,evidence,lines:deliveryReviewLines(lines)});
  else await request({action:'invoice-review',orderId:order.id,expectedVersion:existing?.version||0,combined:true,expectedDeliveryVersion:receipt?.version||0,partial,draft,invoiceNumber:number,invoiceNumberNotProvided:noNumber,invoiceDate:date,evidenceReference:reference,notes,evidence,lines});
  setDirty(false);onClose();
 },'Document check saved.');
 const scan=(file:File)=>action.run(async()=>{
  setDirty(true);const parsed=await readSupplierFile(file);
  if(!parsed.rows.length)throw new Error('No item rows were found. Try a clearer document or enter the details below.');
  setNumber(parsed.invoiceNumber||'');setNoNumber(false);setDate(parsed.invoiceDate||'');setReference(file.name);
  setScanInfo([parsed.supplierName&&'Supplier on document: '+parsed.supplierName,'Check the reference and date, then count what arrived.'].filter(Boolean).join(' · '));
  const products=order.items.map(i=>({...store.products.find(p=>p.id===i.productId),id:i.productId,name:i.productNameSnapshot,itemCode:i.itemCodeSnapshot,supplierId:order.supplierId})) as any;
  const rows:any[]=parsed.rows.map((row:any)=>{const d=documentRow(row),m=matchSupplierProduct({...d,unit:''},products,order.supplierId);return {row,description:d.name,code:d.code,lineId:m.productId||'',reason:[m.reason,rowValue(row,'notes')].filter(Boolean).join(' · '),unit:documentUnit(d.unit),skip:false};});
  if(rows.every(r=>r.lineId&&r.unit&&!rowValue(r.row,'notes'))&&new Set(rows.map(r=>r.lineId)).size===rows.length){
   setLines(current=>current.map(l=>{const r=rows.find(r=>r.lineId===l.lineId);return r?scannedLine(l,r.row,r.unit as 'case'|'pack'):{...l,isReviewed:false};}));
   setScanRows(null);
  }else setScanRows(rows);
 },'Document scanned. Review the suggested values; missing information stays blank.');
 const applyScan=()=>action.run(async()=>{
  if(!scanRows)return;const chosen=scanRows.filter(r=>!r.skip);
  if(chosen.some(r=>!r.lineId||!r.unit))throw new Error('Match each selected line and confirm its quantity unit.');
  if(new Set(chosen.map(r=>r.lineId)).size!==chosen.length)throw new Error('Multiple document rows match one item. Combine them manually and record the reason.');
  setLines(current=>current.map(l=>{const r=chosen.find(r=>r.lineId===l.lineId);return r?scannedLine(l,r.row,r.unit):{...l,isReviewed:false};}));
  if(scanRows.some(r=>r.skip))setNotes(n=>[n,'Document rows requiring management review: '+scanRows.filter(r=>r.skip).map(r=>r.description+' ['+r.code+']').join('; ')].filter(Boolean).join('\n'));
  setScanRows(null);
 },'Document values loaded. Count what arrived and check every line.');
 const exportReview=()=>csv(`HTOS-invoice-review-${order.id}.csv`,[['Item','Code','Ordered cases','Ordered units','Received cases','Received units','Invoiced cases','Invoiced units','Agreed case price','Agreed unit price','Invoice case price','Invoice unit price','Damaged cases','Damaged units','Issue','Notes'],...lines.map(l=>[l.description,l.itemCode,l.orderedCaseQty,l.orderedPackQty,l.deliveredCaseQty,l.deliveredPackQty,l.invoicedCaseQty,l.invoicedPackQty,l.expectedCasePrice,l.expectedPackPrice,l.invoicedCasePrice,l.invoicedPackPrice,l.damagedCaseQty,l.damagedPackQty,l.issueType,l.notes])]);
 const receiptLines=deliveryReviewLines(lines);
 const deliveryReady=receiptLines.every(l=>l.checked&&l.receivedCases!=null&&l.receivedUnits!=null);
 const close=()=>{if(!action.busy&&(!dirty||window.confirm('Discard unsaved check changes?')))onClose();};
 const upload=(event:React.ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];event.target.value='';if(file)void scan(file);};
 return <Modal title="Delivery note / invoice check" onClose={close} wide className="h-document-review">
  <div className="h-document-heading"><div><strong>{order.branchNameSnapshot}</strong><small>{order.supplierNameSnapshot} · #{order.id.slice(0,8).toUpperCase()}</small></div><Tag>{delivery?'Quantities · No prices supplied':'Quantities & prices'}</Tag></div>
  <p className="h-muted">Upload a delivery note or invoice. We read items, quantities and any prices shown, then compare them with the saved order. Missing prices stay blank; confirm what physically arrived.</p>
  {scanInfo&&<p className="h-notice" role="status">{scanInfo}</p>}
  {locked&&<p className="h-notice">This check supports a supplier request and is locked. Add follow-up details in credit tracking.</p>}
  <fieldset className="h-check-fieldset" disabled={locked||action.busy} onChangeCapture={()=>setDirty(true)}>
   <div className="h-form-grid">
    <Field label="Document reference"><input aria-label="Document reference" disabled={noNumber} value={number} onChange={e=>setNumber(e.target.value)}/></Field>
    <Field label="Document date"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field>
    {<label className="h-check"><input type="checkbox" checked={noNumber} onChange={e=>setNoNumber(e.target.checked)}/>Document reference not provided</label>}
    <Field label="Upload document" hint="PDF or photo: automatic AI scan. CSV / Excel: automatic table import. Up to 3 MB."><input type="file" accept=".csv,.xlsx,.xls,application/pdf,image/jpeg,image/png,image/webp" onChange={upload}/></Field>
    <Field label="Take document photo"><input type="file" capture="environment" accept="image/jpeg,image/png,image/webp" onChange={upload}/></Field>
   </div>
   {<label className="h-check"><input type="checkbox" checked={partial} onChange={e=>setPartial(e.target.checked)}/>Partial delivery — remaining items are still expected</label>}
   <p className="h-muted">Enter zero for missing items. Use cumulative quantities for partial deliveries. Record damaged or wrong items as rejected quantities.</p>
   <div className="h-table-wrap"><table className="h-table h-invoice-lines"><thead><tr><th>Ordered item</th><th>Actually received</th><th>On document</th><th>Document price £</th><th>Damaged / rejected</th><th>Line net £</th><th>Result / notes</th><th>Checked</th></tr></thead><tbody>{lines.map((l,i)=><tr key={l.lineId}>
    <td data-label="Ordered item"><strong>{l.description}</strong><small>{l.itemCode}</small><small>Ordered {l.orderedCaseQty} cases / {l.orderedPackQty} units</small>{<small>Agreed {money(l.expectedCasePrice)} / {money(l.expectedPackPrice)}</small>}</td>
    {[['deliveredCaseQty','deliveredPackQty'],['invoicedCaseQty','invoicedPackQty'],['invoicedCasePrice','invoicedPackPrice'],['damagedCaseQty','damagedPackQty']].map(keys=><td key={keys[0]} data-label={keys[0].startsWith('delivered')?'Received':keys[0].startsWith('damaged')?'Damaged / rejected':keys[0].endsWith('Price')?'Document price £':'On document'}>{keys.map((key,k)=><label key={key}><small>{k===0?'Cases':'Units'}</small><input aria-label={l.description+' '+key} type="number" min="0" step="0.01" value={(l as any)[key]??''} onChange={e=>set(i,key,e.target.value===''?undefined:Number(e.target.value))}/></label>)}</td>)}
    {<td data-label="Line net £"><input aria-label={l.description+' net total'} type="number" min="0" step="0.01" placeholder="Not supplied" value={l.invoicedLineTotal??''} onChange={e=>set(i,'invoicedLineTotal',e.target.value===''?undefined:Number(e.target.value))}/><small>Printed net total, if shown</small></td>}
    <td data-label="Result / notes"><Tag>{delivery?deliveryIssues(receiptLines[i],partial).join(' · ')||'Matched':invoiceFlags(l).join(' · ')||'Matched'}</Tag>
     <select aria-label={l.description+' issue'} value={l.issueType||'NONE'} onChange={e=>{set(i,'deliveryIssue',undefined);set(i,'issueType',e.target.value);}}><option value="NONE">No manual issue</option>{!delivery&&<><option value="SHORTAGE">Missing / short</option><option value="PRICE_OVERCHARGE">Price difference</option></>}<option value="DAMAGED">Damaged</option><option value="WRONG_ITEM">Wrong item</option></select>
     <input aria-label={l.description+' notes'} placeholder="Discrepancy notes" value={l.notes||''} onChange={e=>set(i,'notes',e.target.value)}/>
     {!delivery&&<label className="h-check"><input type="checkbox" checked={!!l.isGenuineZeroPrice} onChange={e=>set(i,'isGenuineZeroPrice',e.target.checked)}/>Genuine free item</label>}
    </td><td data-label="Checked"><input aria-label={'Reviewed '+l.description} type="checkbox" checked={!!l.isReviewed} onChange={e=>set(i,'isReviewed',e.target.checked)}/></td>
   </tr>)}</tbody></table></div>
   {!delivery&&<div className="h-mini-stats"><div><span>Ordered</span><strong>{money(result.totalOrderedValue)}</strong></div><div><span>Invoiced</span><strong>{pricesComplete?money(result.totalInvoicedValue):'Not entered'}</strong></div><div><span>Proposed credit · confirm facts first</span><strong>{pricesComplete&&lines.every(l=>l.receiptConfirmed&&l.deliveredCaseQty!=null&&l.deliveredPackQty!=null)?money(result.discrepancyTotal):'Awaiting receipt / prices'}</strong></div></div>}
   <DamageEvidence lines={lines} value={evidence} onChange={value=>{setDirty(true);setEvidence(value);}}/>
   <Field label="Check notes / extra items"><textarea value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
  </fieldset>
  {!delivery&&result.blockingReasons.length>0&&<div className="h-notice">{result.blockingReasons.join(' ')}</div>}{action.feedback}
  <div className="h-dialog-foot"><Button variant="secondary" disabled={action.busy} onClick={close}>Close</Button>{!delivery&&<Button variant="secondary" onClick={exportReview}>Export review CSV</Button>}<Button variant="secondary" disabled={locked} busy={action.busy} onClick={()=>save(true)}>Save draft</Button><Button busy={action.busy} disabled={locked||(delivery?!deliveryReady:!result.canFinalize)} onClick={()=>save(false)}>Confirm check</Button></div>
  {!dirty&&footer}
  {scanRows&&<Modal title="Match document lines" wide onClose={()=>setScanRows(null)}><p>Confirm product and quantity unit. Items outside this order stay flagged in review notes; no products are created.</p><div className="h-table-wrap"><table className="h-table"><thead><tr><th>Document item</th><th>Order item</th><th>Quantity unit</th><th>Flag separately</th></tr></thead><tbody>{scanRows.map((r,i)=><tr key={i}><td>{r.description}<small>{r.code} · {r.reason}</small><small>Document unit: {documentRow(r.row).unit||'Not shown'} · Quantity: {String(documentRow(r.row).quantity??'Not shown')}</small></td><td><select aria-label={`Invoice match ${i+1}`} value={r.lineId} onChange={e=>setScanRows(scanRows.map((x,n)=>i===n?{...x,lineId:e.target.value}:x))}><option value="">Unmatched</option>{lines.map(l=><option key={l.lineId} value={l.lineId}>{l.description}</option>)}</select></td><td><select aria-label={`Billing unit ${i+1}`} value={r.unit} onChange={e=>setScanRows(scanRows.map((x,n)=>i===n?{...x,unit:e.target.value}:x))}><option value="">Confirm</option><option value="case">Case / box</option><option value="pack">Unit / pack</option></select></td><td><input aria-label={`Flag row ${i+1}`} type="checkbox" checked={r.skip} onChange={e=>setScanRows(scanRows.map((x,n)=>i===n?{...x,skip:e.target.checked}:x))}/></td></tr>)}</tbody></table></div>{action.feedback}<div className="h-dialog-foot"><Button busy={action.busy} onClick={applyScan}>Use reviewed matches</Button></div></Modal>}
 </Modal>;
}

