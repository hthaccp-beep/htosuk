import {useOrderLeaveGuard} from './useOrderLeaveGuard';
import React, {useCallback,useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
import {Link,useNavigate,useLocation} from 'react-router-dom';
import {ArrowRight,Check} from 'lucide-react';
import {can,useAppStore} from '../../store';
import type {OrderRecord,OrderItem,ManualOrderItem,Product} from '../../types';
import {getCaseUnitLabel,getPackUnitLabel} from '../../types';
import {isSupplierEligibleForOrder,isUserAuthorizedForBranch} from '../../utils/accessControl';
import {calculateOrderTotals} from '../../utils/orderPricing';
import {validateDeliveryDate,getLondonDateTime} from '../../utils/deliveryScheduler';
import {computeFulfillmentStatus,canUserProcessFulfillment,STANDARD_SHORTAGE_REASONS} from '../../utils/fulfillmentEngine';
import {Button,Field,Heading,Panel,Modal,money,day,clean,useAction} from './ui';
import {captureCurrentPrices,canEditOutgoing,deliveryUpdate} from './orderModel';
import {orderMinimum} from '../../shared/order-minimum';
import {BasketTotal} from './OrderMinimum';
import {ProductPicker,BasketContents} from './OrderBuilderParts';
import {orderQuantity,MAX_ORDER_QUANTITY} from './orderingHelpers';
import {OrderDetailsDialog} from './OrderDetailsDialog';
import {basketAfterDetailsChange,type OrderDetails} from './orderDetails';
import './order-composer.css';
import {useOrderDataRequest} from '../../hooks/syncRequests';
import {validateOrderLines} from '../../shared/order-entry';
import {EmailRouting,useOrderSend} from './OrderSendWorkflow';
import type {OrderEmailRoute} from '../../shared/order-email-route';

export function NewOrder(){
  const location=useLocation(),navigate=useNavigate();
  const userId=useAppStore(s=>s.currentUser?.id);
  const [request,setRequest]=useState(()=>({key:location.key,search:location.search}));
  useEffect(()=>{
    // Consume explicit draft/repeat links once. A refresh or a new session then opens a blank form.
    if(location.state?.consumedOrderSource)return;
    setRequest({key:location.key,search:location.search});
    if(location.search)navigate('/new-order',{replace:true,state:{consumedOrderSource:true}});
  },[location.key,location.search,location.state,navigate]);
  return <OrderComposer key={`${userId}:${request.key}`} sourceSearch={request.search}/>;
}
function OrderComposer({sourceSearch}:{sourceSearch:string}){
  const store=useAppStore(),user=store.currentUser!,email=useOrderSend();
  const params=new URLSearchParams(sourceSearch),navigate=useNavigate();
  const sourceId=params.get('draft')||params.get('repeat'),source=store.orders.find(o=>o.id===sourceId),editing=!!params.get('draft');
  const storageKey=`htos-composer:${user.id}:${sourceId||'new'}`;
  const [loaded,setLoaded]=useState(false),[step,setStep]=useState(0),[branchId,setBranch]=useState(''),[supplierId,setSupplier]=useState('');
  const [date,setDate]=useState(''),[notes,setNotes]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState('');
  useOrderDataRequest(supplierId,sourceId||'');
  const [items,setItems]=useState<OrderItem[]>([]),[manual,setManual]=useState<ManualOrderItem[]>([]);
  const [checked,setChecked]=useState(false),[route,setRoute]=useState<OrderEmailRoute|null>(null),[saved,setSaved]=useState<OrderRecord|null>(null);
  const identity=useRef({id:crypto.randomUUID(),createdAt:new Date().toISOString()});
  const action=useAction();
  const leave=useOrderLeaveGuard(!saved&&(!!branchId||!!supplierId||!!date||items.length>0||manual.length>0||!!notes),action.busy);
  const [detailsOpen,setDetailsOpen]=useState(true);
  const currentDetails={branchId,supplierId,date};
  useEffect(()=>{if(source&&!loaded){setBranch(source.branchId);setSupplier(source.supplierId);setDate(editing?source.deliveryDate||getLondonDateTime().dateStr:getLondonDateTime().dateStr);setNotes(source.comments||'');setItems(source.items);setManual(source.manualItems||[]);setLoaded(true);setStep(0);setDetailsOpen(true);}},[source,loaded,editing]);
  useEffect(()=>{try{sessionStorage.removeItem(storageKey);}catch{}},[storageKey]);
  const branches=store.branches.filter(b=>b.active&&isUserAuthorizedForBranch(user,b.id));
  const suppliers=store.suppliers.filter(s=>isSupplierEligibleForOrder(user,s,branchId,undefined,can(user,'create_orders')));
  const branch=branches.find(b=>b.id===branchId),supplier=suppliers.find(s=>s.id===supplierId);
  const minimumCheck=orderMinimum(supplier,branchId,items,manual),showPrices=can(user,'view_prices');
  const eligibleProducts=useMemo(()=>store.products.filter(p=>p.active&&p.supplierId===supplierId&&(!p.allowedBranchIds?.length||p.allowedBranchIds.includes(branchId))),[store.products,supplierId,branchId]);
  const categories=useMemo(()=>store.categories.filter(c=>c.active&&(!c.supplierId||c.supplierId===supplierId)),[store.categories,supplierId]);
  const searchTerm=useDeferredValue(search.trim().toLowerCase());
  const visible=useMemo(()=>eligibleProducts.filter(p=>[p.name,p.itemCode,p.chineseName,p.id].some(value=>value?.toLowerCase().includes(searchTerm))),[eligibleProducts,searchTerm]);
  const qty=useCallback((product:Product,unit:'caseQty'|'packQty',value:string)=>{const number=orderQuantity(value);action.setError(Number(value)>MAX_ORDER_QUANTITY?`Maximum ${MAX_ORDER_QUANTITY} per quantity field. The quantity has been set to ${MAX_ORDER_QUANTITY}.`:'');setItems(current=>{
    const found=current.find(i=>i.productId===product.id);
    const item:OrderItem={productId:product.id,productNameSnapshot:product.name,chineseNameSnapshot:product.chineseName,itemCodeSnapshot:product.itemCode,caseQty:0,packQty:0,casePriceSnapshot:product.casePrice,packPriceSnapshot:product.packPrice,caseUnitSnapshot:getCaseUnitLabel(product),packUnitSnapshot:getPackUnitLabel(product),vatRate:product.vatRate||0,...found,[unit]:number};
    return [...current.filter(i=>i.productId!==product.id),item].filter(i=>i.caseQty>0||i.packQty>0);
  });},[action.setError]);
  const validate=()=>{
    validateOrderLines(items,manual);
    if(!branch||!supplier)throw new Error('Choose an available branch and supplier.');
    const delivery=validateDeliveryDate(date,supplier,branchId);if(!delivery.valid)throw new Error(delivery.error);
    if(items.some(i=>!eligibleProducts.some(p=>p.id===i.productId)))throw new Error('An item is no longer available. Remove it before continuing.');
  };
  const beginReview=()=>{try{validate();action.setError('');setChecked(false);setRoute(null);setStep(2);}catch(e){action.setError((e as Error).message);}};
  const previewEmail=()=>action.run(async()=>{validate();if(!checked)throw new Error('Please double-check the order details first.');setRoute(null);setStep(3);setRoute(await email.preview(branchId,supplierId));},'');
  const save=(status:'DRAFT'|'PLACED')=>action.run(async()=>{
    if(saved)throw new Error('This order is already saved. Open it from the order book.');
    if(!navigator.onLine)throw new Error('Reconnect before saving. Your selections are still here.');
    if(!can(user,status==='PLACED'?'submit_orders':editing?'edit_drafts':'create_orders'))throw new Error('Your role cannot perform this action.');
    validate();
    if(status==='PLACED'&&(!checked||!route?.ready))throw new Error('Review the order details and email recipients before sending.');
    if(!editing){const captured=captureCurrentPrices(items,store.products);if(captured.some((item,i)=>item.casePriceSnapshot!==items[i].casePriceSnapshot||item.packPriceSnapshot!==items[i].packPriceSnapshot||item.vatRate!==items[i].vatRate)){setItems(captured);setChecked(false);setStep(2);throw new Error('Catalogue prices changed. The order record has been refreshed. Please check the details again.');}}
    if(editing&&(!source||source.status!=='DRAFT'))throw new Error('This draft is no longer available for editing.');
    const order:OrderRecord=clean({id:editing?source!.id:identity.current.id,branchId,branchNameSnapshot:branch!.name,supplierId,supplierNameSnapshot:supplier!.name,orderedByUserId:editing?source!.orderedByUserId:user.id,orderedByNameSnapshot:editing?source!.orderedByNameSnapshot:user.displayName,createdAt:editing?source!.createdAt:identity.current.createdAt,deliveryDate:date,items:editing?items:captureCurrentPrices(items,store.products),manualItems:manual,comments:notes,minimumOrderCheck:minimumCheck,emailTo:supplier!.email,status,emailStatus:'SKIPPED',receivedStatus:'NEW'});
    if(editing)await store.updateOrder(order.id,order);else await store.addOrder(order);
    const persisted=useAppStore.getState().orders.find(o=>o.id===order.id)||order;
    leave.saved();
    setSaved(persisted);
    setBranch('');setSupplier('');setDate('');setNotes('');setItems([]);setManual([]);setSearch('');setCategory('');setChecked(false);setRoute(null);
    if(status==='PLACED'){
      // The record already exists: failure must never create a second order or silently resend.
      setStep(4);
      await email.send(persisted,route!,branch,supplier,store.products,patch=>store.updateOrder(order.id,patch));
    }else navigate('/orders?order='+order.id);
  },status==='PLACED'?'Order saved. The mail server accepted your order email and PDF.':'Draft saved.');
  const closeReview=()=>{if(action.busy)return;if(saved)navigate('/orders?order='+saved.id);else{setStep(1);setChecked(false);action.setError('');}};
  const meta=<div className="h-review-meta"><div><small>ORDERING BRANCH</small><strong>{branch?.name}</strong></div><div><small>SUPPLIER</small><strong>{supplier?.name}</strong></div><div><small>DELIVERY DATE</small><strong>{day(date)}</strong></div></div>;
  const confirmDetails=(next:OrderDetails)=>{
    const basket=basketAfterDetailsChange(currentDetails,next,items,manual,store.products);
    setItems(basket.items);setManual(basket.manual);setBranch(next.branchId);setSupplier(next.supplierId);setDate(next.date);
    setSearch('');setCategory('');setChecked(false);setRoute(null);action.setError('');setStep(1);setDetailsOpen(false);
  };
  return <div className={`h-composer h-composer-compact ${step>0?'is-building':''}`}>
    {leave.dialog}
    <Heading eyebrow="ORDERING" title="Place order"/>
    {step<2&&action.feedback}
    {sourceId&&!source&&<div className="h-notice">The source order is loading or outside the current history range. Open it from Order history after loading its date range.</div>}
    {step===0&&!saved&&<section className="h-start-placeholder"><h2>Start with your order details</h2><p>Choose the branch, supplier and delivery date, then add products.</p><Button disabled={!!sourceId&&!loaded} onClick={()=>setDetailsOpen(true)}>Start your order <ArrowRight size={16}/></Button></section>}
    {step>0&&!saved&&<>
      <section className="h-order-details-bar" aria-label="Confirmed order details">
        <div><small>Ordering branch</small><strong>{branch?.name||'Branch unavailable'}</strong></div>
        <div><small>Supplier</small><strong>{supplier?.name||'Supplier unavailable'}</strong></div>
        <div><small>Delivery date</small><strong>{day(date)}</strong></div>
        <div className="h-order-details-actions">
        <Button variant="secondary" onClick={()=>{setStep(1);setDetailsOpen(true);}}><span className="h-desktop-edit-label">Change details</span><span className="h-phone-edit-label">Edit</span></Button>
        </div>
      </section>
      <div className="h-order-catalogue"><section className="h-panel" aria-label="Choose products"><ProductPicker products={visible} checklistProducts={eligibleProducts} categories={categories} search={search} setSearch={setSearch} category={category} setCategory={setCategory} items={items} manual={manual} setManual={setManual} qty={qty}/></section>
        <div className="h-basket-dock"><BasketTotal check={minimumCheck} showPrices={showPrices} compact/><small className="h-basket-note">Add a supplier note at review</small><Button variant="secondary" busy={action.busy} onClick={()=>save('DRAFT')}>Save draft</Button><Button busy={action.busy} onClick={beginReview}>Review order · {items.length+manual.length} <ArrowRight size={16}/></Button></div>
      </div>
    </>}
    {detailsOpen&&!saved&&(!sourceId||loaded)&&<OrderDetailsDialog current={currentDetails} items={items} manual={manual} editing={editing} started={step>0} onClose={()=>setDetailsOpen(false)} onConfirm={confirmDetails}/>}
      {step>=2&&<Modal title={step===2?'Review order':step===3?'Review order & email':action.busy?'Sending your order…':action.error?'Order saved · email needs attention':'Order placed'} onClose={closeReview} wide>
        {step<4&&<>{meta}<BasketTotal check={minimumCheck} showPrices={showPrices}/>{step===2?<><p className="h-notice">Please check every item and quantity, and confirm the correct branch, supplier and delivery date.</p><BasketContents showPrices={showPrices} items={items} manual={manual} products={store.products} removeItem={id=>{setItems(rows=>rows.filter(i=>i.productId!==id));setChecked(false);}} removeManual={id=>{setManual(rows=>rows.filter(i=>i.id!==id));setChecked(false);}}/><Field label="Note to supplier" hint="Optional. Included in the order email and purchase order."><textarea value={notes} maxLength={3000} onChange={e=>{setNotes(e.target.value);setChecked(false);}} rows={2} placeholder="Add delivery instructions or a message for the supplier"/></Field><label className="h-order-confirm-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/><span>I have checked the items, quantities, ordering branch, supplier and delivery date.</span></label></>:<><p className="h-notice">{items.length+manual.length} items checked. Confirm & Send will save this order and email the purchase order PDF to these recipients.</p>{notes&&<div className="h-notice"><strong>Note to supplier</strong><p className="h-supplier-note-preview">{notes}</p></div>}{route?<EmailRouting route={route}/>:action.busy?<p role="status">Checking saved email recipients…</p>:<p>Email routing could not be loaded. Go back and try again, or save a draft.</p>}</>}</>}
        {step===4&&action.busy&&<p role="status">Your order has been saved. Waiting for the mail server…</p>}
        {step===4&&action.error&&<p className="h-notice">Your order is saved once in the order book. Check its email status and the branch inbox before using Resend email.</p>}
        {action.feedback}
        <div className="h-dialog-foot">{step===4?<><Button variant="secondary" disabled={action.busy} onClick={closeReview}>View saved order</Button><Button disabled={action.busy} onClick={()=>navigate('/new-order',{replace:true})}>Start new order</Button></>:<><Button variant="secondary" disabled={action.busy} onClick={()=>{action.setError('');if(step===3)setStep(2);else closeReview();}}>{step===3?'Back to details':'Keep editing'}</Button><Button variant="secondary" busy={action.busy} onClick={()=>save('DRAFT')}>Save draft</Button>{step===2?<Button busy={action.busy} disabled={!checked} onClick={previewEmail}>Confirm details & review email <ArrowRight size={16}/></Button>:<Button busy={action.busy} disabled={!route?.ready||!checked} onClick={()=>save('PLACED')}>Confirm & Send <Check size={16}/></Button>}</>}</div>
      </Modal>}
  </div>;
}
export function OrderLines({items,manual=[],showPrices=true}:{items:OrderItem[];manual?:ManualOrderItem[];showPrices?:boolean}){const products=useAppStore(state=>state.products);return <div className="h-table-wrap"><table className="h-table"><thead><tr><th>Item</th><th>Cases</th><th>Units</th>{showPrices&&<th className="number">Line total</th>}</tr></thead><tbody>{items.map(item=><tr key={item.productId}><td><strong>{item.productNameSnapshot}</strong><small lang="zh">{item.chineseNameSnapshot||products.find(product=>product.id===item.productId)?.chineseName}</small><small>{item.itemCodeSnapshot}</small></td><td>{item.caseQty}</td><td>{item.packQty}</td>{showPrices&&<td className="number">{money(calculateOrderTotals([item]).grandTotal)}</td>}</tr>)}{manual.map(m=><tr key={m.id}><td><strong>{m.description}</strong><small>Custom item</small></td><td>{m.caseQty}</td><td>{m.packQty}</td>{showPrices&&<td className="number">{m.pricingStatus==='UNPRICED'?'Unpriced':money(calculateOrderTotals([], [m]).grandTotal)}</td>}</tr>)}</tbody></table></div>;}

export { OrderBook } from './OrderHistory';
function DispatchQuantity({value,max,label,disabled,onChange}:{value:number;max:number;label:string;disabled:boolean;onChange:(value:number)=>void}){
  const [text,setText]=useState(String(value));
  useEffect(()=>{setText(previous=>Number(previous||0)===value?previous:String(value));},[value]);
  return <input aria-label={label} type="text" inputMode="decimal" disabled={disabled||max===0} value={text} onBlur={()=>setText(String(value))} onChange={e=>{const raw=e.target.value;if(!/^\d*(\.\d{0,2})?$/.test(raw))return;const next=Number(raw||0);if(!Number.isFinite(next))return;setText(next>max?String(max):raw);onChange(Math.min(max,next));}}/>;
}
export function ReceiveOrder({order,onClose}:{order:OrderRecord;onClose:()=>void}){
  const store=useAppStore(),action=useAction();const [items,setItems]=useState(order.items.map(i=>({...i,sentCaseQty:i.sentCaseQty??i.caseQty,sentPackQty:i.sentPackQty??i.packQty}))),[manual,setManual]=useState((order.manualItems||[]).map(i=>({...i,sentCaseQty:i.sentCaseQty??i.caseQty,sentPackQty:i.sentPackQty??i.packQty}))),[notes,setNotes]=useState(order.fulfillmentNotes||'');
  const status=computeFulfillmentStatus(items,manual);
  const access=canUserProcessFulfillment(store.currentUser,order,store.suppliers,store.branches);
  if(!can(store.currentUser,'view_received_orders')||!access.allowed)return <Modal title="Supplier access required" onClose={onClose}><p>{access.reason||'Your role does not have incoming-order access.'}</p><Button onClick={onClose}>Close</Button></Modal>;
  const missingReason=[...items,...manual].some(i=>(i.sentCaseQty<i.caseQty||i.sentPackQty<i.packQty)&&(!i.shortageReason?.trim()||/^Other:\s*$/.test(i.shortageReason)));
  const close=()=>{if(!action.busy)onClose();};
  return <Modal title={order.receivedStatus==='PROCESSED'?'Review dispatch':'Process order'} onClose={close} className="h-process-order" wide>
    <div className="h-process-body">
      <div className="h-process-meta"><div><small>ORDERING BRANCH</small><strong>{order.branchNameSnapshot}</strong></div><div><small>SUPPLIER</small><strong>{order.supplierNameSnapshot}</strong></div><div><small>DELIVERY</small><strong>{day(order.deliveryDate)}</strong></div></div>
      <p className="h-muted">Check each item and confirm the quantities you are sending. Reduce the quantity and add a reason for anything short.</p>
      <div className={`h-notice ${status.hasShortages?'h-shortage-summary':''}`} role="status">{status.hasShortages?`${status.shortItemCount} item${status.shortItemCount===1?'':'s'} short — check the highlighted rows.`:'All items ready to send in full.'}</div>
      <p className="h-process-scroll-hint">Swipe across the table to see all quantities and shortage reasons.</p>
      <div className="h-table-wrap" tabIndex={0} role="region" aria-label="Dispatch quantities"><table className="h-table h-process-lines"><thead><tr><th>Item</th><th>Ordered<br/>boxes / cases</th><th>Send<br/>boxes / cases</th><th>Ordered<br/>units / packs</th><th>Send<br/>units / packs</th><th>Status / shortage reason</th></tr></thead><tbody>
      {[...items.map((i,index)=>({i,index,kind:'catalogue'})),...manual.map((i,index)=>({i,index,kind:'manual'}))].map(({i,index,kind})=>{
        const change=(field:string,value:string|number)=>kind==='catalogue'?setItems(items.map((item,j)=>j===index?{...item,[field]:value}:item)):setManual(manual.map((item,j)=>j===index?{...item,[field]:value}:item));
        const short=i.sentCaseQty<i.caseQty||i.sentPackQty<i.packQty;
        const name='productNameSnapshot' in i?i.productNameSnapshot:i.description;
        const caseUnit=getCaseUnitLabel({caseUnitName:i.caseUnitSnapshot}),packUnit=getPackUnitLabel({packUnitName:i.packUnitSnapshot});
        return <tr key={kind+index} className={short?'h-short-line':''}>
          <td><strong>{name}</strong>{'chineseNameSnapshot' in i&&<small lang="zh">{i.chineseNameSnapshot}</small>}{kind==='manual'&&<small>Custom item</small>}</td>
          <td>{i.caseQty}<small>{caseUnit}</small></td><td><DispatchQuantity label={`${name}: ${caseUnit} to send`} disabled={action.busy} max={i.caseQty} value={i.sentCaseQty} onChange={value=>change('sentCaseQty',value)}/></td>
          <td>{i.packQty}<small>{packUnit}</small></td><td><DispatchQuantity label={`${name}: ${packUnit} to send`} disabled={action.busy} max={i.packQty} value={i.sentPackQty} onChange={value=>change('sentPackQty',value)}/></td>
          <td>{short?<><select aria-label={`${name}: shortage reason`} disabled={action.busy} value={STANDARD_SHORTAGE_REASONS.includes(i.shortageReason as any)?i.shortageReason:i.shortageReason?'Other (See Notes)':''} onChange={e=>change('shortageReason',e.target.value==='Other (See Notes)'?'Other: ':e.target.value)}><option value="">Select reason</option>{STANDARD_SHORTAGE_REASONS.map(r=><option key={r} value={r}>{r}</option>)}</select>{i.shortageReason&&!STANDARD_SHORTAGE_REASONS.includes(i.shortageReason as any)&&<input aria-label={`${name}: shortage note`} disabled={action.busy} value={i.shortageReason} onChange={e=>change('shortageReason',e.target.value)}/>}</>:<span className="h-line-full"><Check size={14}/>Full</span>}</td>
        </tr>;
      })}</tbody></table></div>
      {canEditOutgoing(store.currentUser!,order)&&<Field label="Dispatch notes"><textarea disabled={action.busy} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional notes for the receiving branch"/></Field>}
      <p className="h-muted">Saving moves this order to Incoming Orders → Order history. The delivery note can be sent from there.</p>{action.feedback}
    </div>
    <div className="h-dialog-foot"><Button variant="secondary" disabled={action.busy} onClick={close}>Cancel</Button><Button busy={action.busy} disabled={missingReason} onClick={()=>action.run(async()=>{if(missingReason)throw new Error('Add a reason for each shortage.');await store.markOrderAsProcessed(order.id,clean(deliveryUpdate(order,store.currentUser!,items,manual,status.status,notes)));onClose();})}><Check size={16}/>Confirm dispatch</Button></div>
  </Modal>;
}

