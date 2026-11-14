import React,{useState} from 'react';
import {InvoiceUploadStatus,useInvoiceUploadSummaries} from './InvoiceUploadStatus';
import './order-list.css';
import {MinimumFollowUp} from './OrderMinimum';
import {Link,useSearchParams} from 'react-router-dom';
import {Eye,Printer,FileSpreadsheet,Trash2,Truck,Copy,Download,XCircle,Archive,RotateCcw,Calendar,CheckCircle} from 'lucide-react';
import {can,useAppStore} from '../../store';
import type {OrderRecord} from '../../types';
import {getCaseUnitLabel,getPackUnitLabel} from '../../types';
import {canUserProcessFulfillment} from '../../utils/fulfillmentEngine';
import {incomingSupplierIds} from './orderingHelpers';
import {historySuppliers,matchesHistoryFilters} from './historyFilters';
import {invoiceHistoryFilters,matchesInvoiceHistoryStatus} from './historyInvoiceStatus';
import {historyDayGroups} from './historyDayGroups';
import {hasBranchScope,incomingSupplierBranches} from '../../shared/order-scope';
import {canEditOutgoing} from './orderModel';
import {ReceiveOrder} from './Orders';
import {OrderCheck as InvoiceReview} from './DeliveryChecks';
import {invoiceUploadLabel} from '../../shared/invoice-case';
import {EmailStatus,OrderEmail,OrderDocument} from './OrderCommunication';
import {RefundRequest} from './RefundRequest';
import {generateCreditClaimPdf} from '../../utils/creditClaimPdf';
import {dispatchDeliveryNoteNotification} from '../../utils/deliveryCommunication';
import {generateWhatsAppLink} from '../../utils/whatsapp';
import {sendEmail} from '../../utils/sendEmail';
import {Button,Field,Empty,Tag,Modal,day,today,shortId,useAction,api} from './ui';

export function OrderBook({incoming=false}:{incoming?:boolean}) {
  const store=useAppStore(),user=store.currentUser!,[params,setParams]=useSearchParams(),action=useAction();
  const [search,setSearch]=useState(''),[status,setStatus]=useState(params.get('status')||'ALL'),[branchId,setBranch]=useState(''),[internalBranch,setInternalBranch]=useState(''),[tab,setTab]=useState('new'),[from,setFrom]=useState(''),[to,setTo]=useState(today());
  const [supplierId,setSupplier]=useState('');
  const [document,setDocument]=useState<{order:OrderRecord;mode:'ORDER'|'DELIVERY'|'CHECKLIST'}|null>(null),[invoice,setInvoice]=useState<OrderRecord|null>(null),[process,setProcess]=useState<OrderRecord|null>(null),[remove,setRemove]=useState<OrderRecord|null>(null);
  const internal=incomingSupplierBranches(user,store.branches);
  const linked=incomingSupplierIds(user,store.suppliers,store.branches,internalBranch);
  const scoped=store.orders.filter(o=>!incoming||o.status==='PLACED'&&linked.has(o.supplierId));
  const supplierOptions=historySuppliers(incoming?[]:scoped);
  const candidates=scoped.filter(o=>incoming
    ? (!branchId||o.branchId===branchId)&&(tab==='history'?o.receivedStatus==='PROCESSED':o.receivedStatus!=='PROCESSED')&&`${o.supplierNameSnapshot} ${o.branchNameSnapshot} ${o.id}`.toLowerCase().includes(search.toLowerCase())
    : matchesHistoryFilters(o,{branchId,supplierId,status:['DRAFT','CANCELLED','ARCHIVED','PLACED','OPEN','PROCESSED'].includes(status)?status:'ALL',search:''})
  ).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const invoiceStatusesEnabled=!incoming&&import.meta.env.VITE_ENABLE_INVOICE_CASES==='true'&&can(user,'scan_invoices');
  const uploadIds=invoiceStatusesEnabled?candidates.filter(o=>o.status==='PLACED'&&!o.invoiceVerification&&!o.deliveryCheck&&!o.supplierCase&&canEditOutgoing(user,o)).map(o=>o.id):[];
  const {summaries:uploadSummaries,loading:statusLoading,failed:statusFailed}=useInvoiceUploadSummaries(uploadIds,!!invoice||!!params.get('order'));
  const orders=incoming?candidates:candidates.filter(o=>matchesInvoiceHistoryStatus(o,uploadSummaries[o.id],status));
  const invoiceStatus=(o:OrderRecord)=><InvoiceUploadStatus order={o} summary={uploadSummaries[o.id]} enabled={invoiceStatusesEnabled&&canEditOutgoing(user,o)} loading={statusLoading}/>;
  const hasFilters=Boolean(branchId||supplierId||search||status!=='ALL'||internalBranch);
  const clearFilters=()=>{setBranch('');setSupplier('');setSearch('');setStatus('ALL');setParams(previous=>{const next=new URLSearchParams(previous);next.delete('status');return next;});};
  const days=incoming?[]:historyDayGroups(orders);
  const [collapsedDays,setCollapsedDays]=useState<Record<string,boolean>>({});
  const [filtersOpen,setFiltersOpen]=useState(false);
  const selected=store.orders.find(o=>o.id===params.get('order'));
  const canInvoice=(o:OrderRecord)=>o.status==='PLACED'&&can(user,'scan_invoices')&&canEditOutgoing(user,o);
  const canRemove=(o:OrderRecord)=>canEditOutgoing(user,o)&&can(user,o.status==='DRAFT'?'delete_drafts':'cancel_orders');
  const actions=(o:OrderRecord)=><div className="h-history-actions">
    <Button variant="quiet" title="View order" aria-label={`View order ${shortId(o.id)}`} onClick={()=>setParams({order:o.id})}><Eye size={17}/><span className="h-history-action-label">View order</span></Button>
    {canInvoice(o)&&<Button variant="quiet" title={invoiceUploadLabel} aria-label={invoiceUploadLabel+' · '+shortId(o.id)} onClick={()=>setInvoice(o)}><FileSpreadsheet size={17}/><span className="h-history-action-label">{invoiceUploadLabel}</span></Button>}
    <Button variant="quiet" title={incoming?'Packing checklist':'Print / PDF'} aria-label={`Print order ${shortId(o.id)}`} onClick={()=>setDocument({order:o,mode:incoming?'CHECKLIST':'ORDER'})}><Printer size={17}/><span className="h-history-action-label">{incoming?'Checklist':'Print / PDF'}</span></Button>
    {o.status==='DRAFT'&&can(user,'edit_drafts')&&<Link className="h-button quiet" to={`/new-order?draft=${o.id}`}>Edit</Link>}
    {canRemove(o)&&<Button variant="quiet" title={o.status==='DRAFT'?'Delete draft':o.status==='CANCELLED'?(o.archived?'Restore order':'Remove from list'):'Cancel order'} aria-label={`${o.status==='DRAFT'?'Delete draft':o.status==='CANCELLED'?(o.archived?'Restore order':'Remove from list'):'Cancel order'} ${shortId(o.id)}`} onClick={()=>setRemove(o)}>{o.status==='DRAFT'?<Trash2 size={17}/>:o.status==='CANCELLED'?(o.archived?<RotateCcw size={17}/>:<Archive size={17}/>):<XCircle size={17}/>}<span className="h-history-action-label">{o.status==='DRAFT'?'Delete draft':o.status==='CANCELLED'?(o.archived?'Restore order':'Remove from list'):'Cancel order'}</span></Button>}
  </div>;
  return <div className={`h-order-list ${filtersOpen?'h-filters-open':'h-filters-closed'}`}>
    <header className="h-order-list-heading"><h1>{incoming?'Incoming orders':'Order history'}</h1><Button className="h-phone-filter-toggle" variant="secondary" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(value=>!value)}>Filters{hasFilters?' · Active':''}</Button><select aria-label="Ordering branch filter" value={branchId} onChange={e=>setBranch(e.target.value)}><option value="">All ordering branches</option>{store.branches.filter(b=>incoming||hasBranchScope(user,b.id)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></header>
    {incoming&&<div className="h-tabs"><button className={tab==='new'?'active':''} onClick={()=>setTab('new')}>New orders <Tag>{scoped.filter(o=>o.receivedStatus!=='PROCESSED').length}</Tag></button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Order history <Tag>{scoped.filter(o=>o.receivedStatus==='PROCESSED').length}</Tag></button></div>}
    <section className="h-panel" aria-label={incoming?'Incoming orders':'Saved orders'}>
      {incoming?<div className="h-toolbar"><input aria-label="Search orders" placeholder="Search branch, supplier or order" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Internal supplier branch" value={internalBranch} onChange={e=>setInternalBranch(e.target.value)}><option value="">All supplier branches</option>{internal.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><span className="h-order-count">{orders.length} {orders.length===1?'order':'orders'}</span></div>:<>
        <div className="h-toolbar h-history-filters">
          <label className="h-field h-history-filter"><span>Supplier</span><select aria-label="Supplier" value={supplierId} onChange={e=>setSupplier(e.target.value)}><option value="">All suppliers</option>{supplierOptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="h-field h-history-filter"><span>Invoice / order status</span><select aria-label="Invoice / order status" value={status} onChange={e=>setStatus(e.target.value)}>{invoiceHistoryFilters.filter(([value])=>invoiceStatusesEnabled||['ALL','DRAFT','CANCELLED','ARCHIVED'].includes(value)).map(([value,label])=><option key={value} value={value}>{label}</option>)}{['PLACED','OPEN','PROCESSED'].includes(status)&&<option value={status}>Orders from overview</option>}</select></label>
        </div>
        <div className="h-history-filter-summary"><span className="h-order-count" role="status">{statusLoading?'Loading invoice statuses…':orders.length+' '+(orders.length===1?'order':'orders')}</span>{hasFilters&&<Button variant="quiet" onClick={clearFilters}>Clear filters</Button>}{statusFailed&&<span role="status">Invoice statuses unavailable. Open an order to check its report.</span>}</div>
      </>}
      {(!incoming||tab==='history')&&<details className="h-history-range"><summary>View older history</summary><div className="h-form-grid"><Field label="From"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></Field><Field label="To"><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></Field><Button busy={action.busy} disabled={!from||!to||from>to} onClick={()=>action.run(()=>store.fetchArchivedOrders(from,to,incoming),'History loaded.')}>Load history</Button></div></details>}{action.feedback}
    {!orders.length?<Empty title={incoming?(tab==='new'?'No new orders':'No processed orders yet'):statusLoading?'Loading invoice statuses…':statusFailed?'Invoice statuses unavailable':'No matching orders'}>{statusFailed?'Clear the status filter to see your orders.':'Try another filter or load an older date range.'}</Empty>:incoming?<div className="h-incoming-cards">{orders.map(o=>{
      const access=canUserProcessFulfillment(user,o,store.suppliers,store.branches);
      const allowed=can(user,'view_received_orders')&&access.allowed;
      const reason=access.reason||'Your role does not have incoming-order access.';
      return <article className="h-incoming-card" key={o.id} aria-label={`Incoming order ${shortId(o.id)}`}>
        <div className="h-incoming-card-head"><div><h2>{o.branchNameSnapshot}</h2><p>{o.orderedByNameSnapshot} · #{shortId(o.id)}</p></div><Tag>{o.items.length+(o.manualItems||[]).length} items</Tag></div>
        <div className="h-incoming-meta"><span><Calendar size={14}/>{day(o.createdAt)}</span><span><Truck size={14}/>Due {day(o.deliveryDate)}</span><span>{o.supplierNameSnapshot}</span><EmailStatus order={o}/></div>
        {o.status==='PLACED'&&<MinimumFollowUp compact check={o.minimumOrderCheck} showPrices={can(user,'view_prices')}/>} {o.receivedStatus==='PROCESSED'&&<FulfillmentSummary order={o}/>}
        <div className="h-incoming-card-actions"><Button variant="quiet" onClick={()=>setDocument({order:o,mode:'CHECKLIST'})}><Printer size={16}/>Print checklist</Button><div className="h-incoming-primary">{o.receivedStatus==='PROCESSED'&&<DeliveryEmail order={o}/>}<Button disabled={!allowed} title={!allowed?reason:undefined} onClick={()=>setProcess(o)}><CheckCircle size={16}/>{o.receivedStatus==='PROCESSED'?'Review dispatch':'Process order'}</Button><Button variant="quiet" title="Delete incoming order" aria-label={`Delete incoming order ${shortId(o.id)}`} disabled={!canRemove(o)} onClick={()=>setRemove(o)}><Trash2 size={17}/></Button></div></div>
        {!allowed&&<p className="h-incoming-access">{reason}</p>}
      </article>;
    })}</div>:<>
     <div className="h-mobile-history" aria-label="Orders grouped by order date">
      <p className="h-history-group-note">By order date · Tap an order for actions</p>
      {days.map((group,index)=><section className="h-history-day" key={group.key}>
       <h2><button type="button" className="h-history-day-toggle" aria-expanded={!(collapsedDays[group.key]??index>0)} aria-controls={`history-day-${group.key}`} onClick={()=>setCollapsedDays(previous=>({...previous,[group.key]:!(previous[group.key]??index>0)}))}><span>{group.label}</span><span>{group.orders.length} {group.orders.length===1?'order':'orders'} <span aria-hidden="true">{(collapsedDays[group.key]??index>0)?'＋':'−'}</span></span></button></h2>
       <div id={`history-day-${group.key}`} hidden={collapsedDays[group.key]??index>0}>
        {group.orders.map(o=><details className="h-mobile-history-order" key={o.id}>
         <summary><strong>{o.branchNameSnapshot.replace(/^Hare\s*&\s*Tortoise\s*[–-]\s*/i,'')} · {o.supplierNameSnapshot}</strong><span className="h-mobile-history-meta">{invoiceStatus(o)}<span>Delivery {day(o.deliveryDate)}</span></span></summary>
         <div className="h-mobile-history-expanded"><EmailStatus order={o}/><p>#{shortId(o.id)} · Ordered {new Date(o.createdAt).toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'})}<br/>{o.branchNameSnapshot}</p>
          {o.status==='PLACED'&&<MinimumFollowUp compact check={o.minimumOrderCheck} showPrices={can(user,'view_prices')}/>}
          {o.status==='PLACED'&&o.emailStatus!=='SENT'&&<OrderEmail order={o}/>}
          <div className="h-order-list-actions">{actions(o)}</div>
         </div>
        </details>)}
       </div>
      </section>)}
     </div>
     <div className="h-table-wrap h-order-list-scroll h-desktop-history" tabIndex={0} role="region" aria-label={incoming?'Incoming orders table':'Order book table'}>
      <table role="table" className={`h-table h-order-list-table ${incoming?'incoming':'outgoing'}`}>
       <thead role="rowgroup"><tr role="row">{incoming?<><th scope="col">Ordered by</th><th scope="col">Ordered</th><th scope="col">Delivery</th><th scope="col">Supplier</th><th scope="col">Items</th><th scope="col">Status</th><th scope="col">Actions</th></>:<><th scope="col">Ordered</th><th scope="col">Delivery</th><th scope="col">Branch</th><th scope="col">Supplier</th><th scope="col">Invoice / order status</th><th scope="col">Actions</th></>}</tr></thead>
       <tbody role="rowgroup">{orders.map(o=><tr role="row" key={o.id}>
        <td role="cell" data-label={incoming?'Ordered by':'Ordered'}>{incoming?<><strong>{o.branchNameSnapshot}</strong><small>#{shortId(o.id)} · {o.orderedByNameSnapshot}</small></>:<><strong>{day(o.createdAt)}</strong><small>{new Date(o.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · #{shortId(o.id)}</small></>}</td>
        {incoming&&<td>{day(o.createdAt)}<small>{new Date(o.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</small></td>}
        <td role="cell" data-label="Delivery">{day(o.deliveryDate)}</td>{!incoming&&<td role="cell" data-label="Branch">{o.branchNameSnapshot}</td>}<td role="cell" data-label="Supplier">{o.supplierNameSnapshot}</td>
        {incoming&&<td className="number">{o.items.length+(o.manualItems||[]).length}</td>}
        <td role="cell" data-label="Status"><div className="h-order-list-status">{invoiceStatus(o)}{incoming&&o.status==='PLACED'&&<MinimumFollowUp compact check={o.minimumOrderCheck} showPrices={can(user,'view_prices')}/>}{incoming?(o.receivedStatus==='PROCESSED'?<FulfillmentSummary order={o}/>:<><EmailStatus order={o}/><small>Awaiting processing</small></>):<details><summary>Order messages{o.status==='PLACED'&&(o.minimumOrderCheck?.needsFollowUp||o.emailStatus!=='SENT')?' · action needed':''}</summary><EmailStatus order={o}/>{o.status==='PLACED'&&<MinimumFollowUp compact check={o.minimumOrderCheck} showPrices={can(user,'view_prices')}/>}{o.status==='PLACED'&&o.emailStatus!=='SENT'&&<OrderEmail order={o}/>}</details>}</div></td>
        <td role="cell" data-label="Actions"><div className="h-order-list-actions">{actions(o)}{incoming&&o.receivedStatus==='PROCESSED'&&<DeliveryEmail order={o}/>} {incoming&&tab==='new'&&can(user,'view_received_orders')&&canUserProcessFulfillment(user,o,store.suppliers,store.branches).allowed&&<Button onClick={()=>setProcess(o)}><Truck size={15}/> Process</Button>}</div></td>
       </tr>)}</tbody>
      </table>
     </div>
    </>}</section>
    {selected&&<OrderDetails order={selected} onClose={()=>setParams({})}/>} {document&&<OrderDocument {...document} onClose={()=>setDocument(null)}/>} {invoice&&<InvoiceReview order={invoice} onClose={()=>setInvoice(null)}/>} {process&&<ReceiveOrder order={process} onClose={()=>setProcess(null)}/>} {remove&&<Modal title={remove.status==='DRAFT'?'Delete draft?':remove.status==='CANCELLED'?(remove.archived?'Restore to order list?':'Remove from order list?'):'Cancel placed order?'} onClose={()=>setRemove(null)}><p>{remove.status==='DRAFT'?'This permanently deletes the draft.':remove.status==='CANCELLED'?(remove.archived?'This returns the order to the list. It stays cancelled and no email is sent.':'This hides the cancelled order from the order list and latest activity. You can find and restore it using the Archived filter. No order details are deleted.'):'The order stays in history as cancelled. Contact the supplier separately if it was already sent.'}</p><p>#{shortId(remove.id)} · {remove.supplierNameSnapshot}</p>{action.feedback}<div className="h-dialog-foot"><Button variant="secondary" onClick={()=>setRemove(null)}>Keep order</Button><Button variant="danger" busy={action.busy} onClick={()=>action.run(async()=>{if(remove.status==='DRAFT')await store.deleteOrder(remove.id);else await api('/api/admin/order-action',{action:remove.status==='CANCELLED'?(remove.archived?'restore':'archive'):'cancel',orderId:remove.id});setRemove(null);},'Order updated.')}>Confirm {remove.status==='DRAFT'?'delete':remove.status==='CANCELLED'?(remove.archived?'restore':'removal'):'cancellation'}</Button></div></Modal>}
  </div>;
}
export function FulfillmentSummary({order}:{order:OrderRecord}){return <div className="h-fulfillment-summary"><span>Fulfillment: <Tag tone={order.fulfillmentStatus==='FULFILLED'?'green':'amber'}>{order.fulfillmentStatus==='FULFILLED'?'Fulfilled':order.fulfillmentStatus==='PARTIAL'?'Partial / shortages':order.fulfillmentStatus==='UNFULFILLED'?'Unfulfilled':'Processed'}</Tag></span><span>Delivery note: <Tag tone={order.deliveryEmailStatus==='SENT'?'green':order.deliveryEmailStatus==='FAILED'?'red':''}>{order.deliveryEmailStatus==='SENT'?'Sent':order.deliveryEmailStatus==='FAILED'?'Failed':order.deliveryEmailStatus==='PENDING'?'Pending':'Not sent'}</Tag></span></div>;}
function OrderDetails({order,onClose}:{order:OrderRecord;onClose:()=>void}){
  const store=useAppStore(),user=store.currentUser!,action=useAction(),[document,setDocument]=useState<'ORDER'|'DELIVERY'|'CHECKLIST'|null>(null),[invoice,setInvoice]=useState(false),[process,setProcess]=useState(false),[refund,setRefund]=useState(false);
  const branch=store.branches.find(b=>b.id===order.branchId),supplier=store.suppliers.find(s=>s.id===order.supplierId);
  return <Modal title={`Order details · #${shortId(order.id)}`} onClose={onClose} className="h-order-details"><div className="h-order-details-body"><div className="h-review-meta"><div><small>BRANCH</small><strong>{order.branchNameSnapshot}</strong></div><div><small>SUPPLIER</small><strong>{order.supplierNameSnapshot}</strong></div><div><small>CREATED</small><strong>{new Date(order.createdAt).toLocaleString('en-GB')}</strong></div><div><small>DELIVERY</small><strong>{day(order.deliveryDate)}</strong></div></div><div className="h-communication-card"><div><small>COMMUNICATION STATUS</small><p><EmailStatus order={order}/></p>{order.emailSentAt&&<small>Accepted {new Date(order.emailSentAt).toLocaleString('en-GB')}</small>}{order.emailError&&order.emailStatus!=='SENT'&&<p className="h-muted">{order.emailError}</p>}{order.whatsAppStatus==='OPENED'&&<Tag>WhatsApp link opened</Tag>}</div><OrderEmail order={order}/></div>{order.status==='PLACED'&&branch&&supplier?.mobileNumber&&can(user,'submit_orders')&&canEditOutgoing(user,order)&&<a className="h-button quiet" href={generateWhatsAppLink({...order,manualItems:order.manualItems||[]},branch,supplier.mobileNumber,store.products)} target="_blank" rel="noreferrer">Open WhatsApp order</a>}<MinimumFollowUp check={order.status==='PLACED'?order.minimumOrderCheck:undefined} showPrices={can(user,'view_prices')}/><h3 className="h-details-label">Items ordered</h3><CompactOrderLines order={order}/>{order.comments&&<div className="h-notice">{order.comments}</div>}{order.receivedStatus==='PROCESSED'&&<><FulfillmentSummary order={order}/><div className="h-dispatch-lines">{[...order.items.map(i=>({name:i.productNameSnapshot,...i})),...(order.manualItems||[]).map(i=>({name:i.description,...i}))].map((i,index)=><div key={index}><strong>{i.name}</strong><span>Sent {i.sentCaseQty??i.caseQty} {i.caseUnitSnapshot||'Box'} · {i.sentPackQty??i.packQty} {i.packUnitSnapshot||'Unit'}</span>{i.shortageReason&&<small>{i.shortageReason}</small>}</div>)}</div>{order.fulfillmentNotes&&<p className="h-notice">{order.fulfillmentNotes}</p>}<DeliveryEmail order={order}/></>}{action.feedback}</div><div className="h-detail-actions"><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="secondary" onClick={()=>setDocument('ORDER')}><Printer size={16}/> Print / PDF</Button>{order.status==='DRAFT'&&can(user,'edit_drafts')&&<Link className="h-button" to={`/new-order?draft=${order.id}`}>Edit draft</Link>}{order.status==='PLACED'&&<>{can(user,'place_orders')&&canEditOutgoing(user,order)&&<Link className="h-button secondary" to={`/new-order?repeat=${order.id}`}><Copy size={16}/> Repeat order</Link>}{can(user,'scan_invoices')&&canEditOutgoing(user,order)&&<Button variant="secondary" onClick={()=>setInvoice(true)}><FileSpreadsheet size={16}/> Check delivery / invoice</Button>}{can(user,'view_received_orders')&&canUserProcessFulfillment(user,order,store.suppliers,store.branches).allowed&&<Button variant="secondary" onClick={()=>setProcess(true)}><Truck size={16}/>{order.receivedStatus==='PROCESSED'?'Review dispatch':'Process order'}</Button>}{order.receivedStatus==='PROCESSED'&&<Button variant="secondary" onClick={()=>setDocument('DELIVERY')}>Delivery note PDF</Button>}</>}{order.creditNoteClaim&&can(user,'view_prices')&&<Button variant="secondary" onClick={()=>action.run(async()=>{const result=generateCreditClaimPdf(order.creditNoteClaim!,branch,supplier);result.doc.save(result.fileName);},'Credit claim downloaded.')}><Download size={16}/> Credit claim PDF</Button>}{(order.creditNoteClaim||order.supplierCase)&&can(user,'scan_invoices')&&canEditOutgoing(user,order)&&<Button onClick={()=>setRefund(true)}>Supplier request / credits</Button>}</div>{refund&&<RefundRequest order={order} onClose={()=>setRefund(false)}/>}{document&&<OrderDocument order={order} mode={document} onClose={()=>setDocument(null)}/>} {invoice&&<InvoiceReview order={order} onClose={()=>setInvoice(false)}/>} {process&&<ReceiveOrder order={order} onClose={()=>setProcess(false)}/>}</Modal>;
}

function CompactOrderLines({order}:{order:OrderRecord}) {
  const lines=[...order.items.map(i=>({...i,name:i.productNameSnapshot,chinese:i.chineseNameSnapshot,code:i.itemCodeSnapshot})),...(order.manualItems||[]).map(i=>({...i,name:i.description,chinese:'',code:'Custom item'}))];
  return <ul className="h-compact-order-lines">{lines.map((line,index)=><li key={index}><div><strong>{line.name}</strong>{line.chinese&&<small lang="zh">{line.chinese}</small>}{line.code&&<small>{line.code}</small>}</div><span>{[line.caseQty>0?`${line.caseQty} ${getCaseUnitLabel({caseUnitName:line.caseUnitSnapshot})}`:'',line.packQty>0?`${line.packQty} ${getPackUnitLabel({packUnitName:line.packUnitSnapshot})}`:''].filter(Boolean).join(' · ')||'0'}</span></li>)}</ul>;
}

function DeliveryEmail({order}:{order:OrderRecord}){
  const store=useAppStore(),action=useAction(),[open,setOpen]=useState(false),branch=store.branches.find(b=>b.id===order.branchId),supplier=store.suppliers.find(s=>s.id===order.supplierId);
  if(!branch||order.deliveryEmailStatus==='SENT'||!can(store.currentUser,'submit_orders')||!canEditOutgoing(store.currentUser!,order))return null;
  return <><Button variant="quiet" onClick={()=>setOpen(true)}>Send delivery note</Button>{open&&<Modal title="Send delivery note" onClose={()=>setOpen(false)}><p>To: {branch.contactEmail||branch.email||'No email configured'}</p><p className="h-muted">The delivery note includes quantities dispatched and any shortages. Check the branch inbox before sending again after a previous attempt.</p>{action.feedback}<div className="h-dialog-foot"><Button variant="secondary" onClick={()=>setOpen(false)}>Cancel</Button><Button busy={action.busy} onClick={()=>action.run(async()=>{const result=await dispatchDeliveryNoteNotification({order,branch,supplier,products:store.products,recipientEmail:branch.contactEmail||branch.email||'',sendEmailFn:sendEmail});await store.updateOrder(order.id,{deliveryEmailStatus:result.status,deliveryEmailError:result.error||'',...(result.sentAt?{deliveryEmailSentAt:result.sentAt}:{}),deliveryEmailRetryCount:(order.deliveryEmailRetryCount||0)+1});if(!result.success)throw new Error(result.error);setOpen(false);},'Delivery note accepted by mail server.')}>Confirm & send</Button></div></Modal>}</>;
}


