import React,{useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {useAppStore,can} from '../../store';
import {isSupplierEligibleForOrder,isUserAuthorizedForBranch} from '../../utils/accessControl';
import {deliveryDateBounds,getLondonDateTime,validateDeliveryDate} from '../../utils/deliveryScheduler';
import type {OrderItem,ManualOrderItem} from '../../types';
import {basketAfterDetailsChange,type OrderDetails} from './orderDetails';
import {Button,Field,Modal} from './ui';
import {usePhoneLayout} from './usePhoneLayout';
import {mobileDeliveryDates} from './mobileDeliveryDates';

export function OrderDetailsDialog({current,items,manual,editing,started,onClose,onConfirm}:{current:OrderDetails;items:OrderItem[];manual:ManualOrderItem[];editing:boolean;started:boolean;onClose:()=>void;onConfirm:(details:OrderDetails)=>void}){
  const store=useAppStore(),user=store.currentUser!;
  const phone=usePhoneLayout();
  const [details,setDetails]=useState(current),[error,setError]=useState('');
  const branches=store.branches.filter(b=>b.active&&isUserAuthorizedForBranch(user,b.id));
  const suppliers=store.suppliers.filter(s=>isSupplierEligibleForOrder(user,s,details.branchId,undefined,can(user,'create_orders')));
  const branch=branches.find(b=>b.id===details.branchId),supplier=suppliers.find(s=>s.id===details.supplierId);
  const delivery=supplier&&details.date?validateDeliveryDate(details.date,supplier,details.branchId):null;
  const availableDates=phone&&supplier?mobileDeliveryDates(supplier,details.branchId):[];
  const removed=basketAfterDetailsChange(current,details,items,manual,store.products).removed;
  const change=(patch:Partial<OrderDetails>)=>{setDetails(value=>({...value,...patch}));setError('');};
  return <Modal title={started?'Change order details':'Start your order'} onClose={onClose} className="h-order-details-dialog">
    <p className="h-details-intro">Check these three details before choosing products.</p>
    <form onSubmit={event=>{event.preventDefault();if(!branch||!supplier||!details.date){setError('Choose a branch, supplier and delivery date.');return;}const check=validateDeliveryDate(details.date,supplier,details.branchId);if(!check.valid){setError(check.error||'Choose an available delivery date.');return;}onConfirm(details);}}>
      <Field label="1 · Ordering branch"><select autoFocus required disabled={editing} value={details.branchId} onChange={event=>{const branchId=event.target.value;change({branchId,supplierId:'',date:''});}}><option value="">Select branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="2 · Supplier"><select required disabled={editing||!branch} value={details.supplierId} onChange={event=>change({supplierId:event.target.value,date:''})}><option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="3 · Delivery date">{phone?<select required disabled={!supplier} value={details.date} onChange={event=>change({date:event.target.value})}>
        <option value="">Select delivery date</option>
        {details.date&&!availableDates.some(d=>d.value===details.date)&&<option value={details.date} disabled>{details.date} — unavailable</option>}
        {availableDates.map(date=><option key={date.value} value={date.value}>{date.label}</option>)}
      </select>:<input type="date" required disabled={!supplier} min={getLondonDateTime().dateStr} max={deliveryDateBounds().max} value={details.date} onChange={event=>change({date:event.target.value})}/>}</Field>
      {phone&&supplier&&<p className="h-details-help">{availableDates.length?'Available dates in the next 7 days.':'No delivery dates are available in the next 7 days. Check the supplier schedule.'}</p>}
      {supplier?.deliverySchedules&&(supplier.deliverySchedules[details.branchId]||supplier.deliverySchedules.default)&&<p className="h-details-help">{supplier.deliverySchedules[details.branchId]||supplier.deliverySchedules.default}</p>}
      {delivery&&!delivery.valid&&<div className="h-notice error" role="alert">{delivery.error}</div>}
      {error&&<div className="h-notice error" role="alert">{error}</div>}
      {removed.length>0&&<div className="h-details-removals" role="status"><strong>{removed.length} {removed.length===1?'item will':'items will'} leave this basket</strong><p>These items are not available for the selected branch or supplier. Cancel to keep your current order.</p><ul>{removed.map((name,i)=><li key={i}>{name}</li>)}</ul></div>}
      <p className="h-details-help">{editing?'The branch and supplier are fixed for a saved draft.':'You can change these details later.'} Add your supplier note at review.</p>
      <div className="h-dialog-foot"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!branch||!supplier||!delivery?.valid}>{started?'Apply changes':'Confirm & choose products'}<ArrowRight size={16}/></Button></div>
    </form>
  </Modal>;
}
