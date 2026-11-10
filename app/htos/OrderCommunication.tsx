import React,{useState,useEffect} from 'react';
import {useOrderDataRequest} from '../../hooks/syncRequests';
import { Mail, Download, Printer } from 'lucide-react';
import { can,useAppStore } from '../../store';
import type { OrderRecord } from '../../types';

import {EmailRouting,useOrderSend} from './OrderSendWorkflow';
import type {OrderEmailRoute} from '../../shared/order-email-route';
import { canEditOutgoing } from './orderModel';
import { emailState } from './communicationState';
import { Button,Modal,Tag,useAction,shortId } from './ui';

export function EmailStatus({order}:{order:OrderRecord}){const status=emailState(order);return <span title={status.detail}><Tag tone={status.tone}>{status.label}</Tag></span>;}
export function OrderEmail({order,review=false}:{order:OrderRecord;review?:boolean}) {
  const store=useAppStore(),action=useAction(),[open,setOpen]=useState(review),email=useOrderSend(),[route,setRoute]=useState<OrderEmailRoute|null>(null),[loading,setLoading]=useState(false);
  const allowed=order.status==='PLACED'&&order.emailStatus!=='SENT'&&can(store.currentUser,'submit_orders')&&canEditOutgoing(store.currentUser!,order);
  useOrderDataRequest(open&&allowed?order.supplierId:'');
  useEffect(()=>{if(!open||!allowed)return;let cancelled=false;setRoute(null);setLoading(true);action.setError('');email.preview(order.branchId,order.supplierId).then(next=>{if(!cancelled)setRoute(next);}).catch(e=>{if(!cancelled)action.setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[open,allowed,order.branchId,order.supplierId,email]);
  const supplier=store.suppliers.find(s=>s.id===order.supplierId),branch=store.branches.find(b=>b.id===order.branchId);
  const state=emailState(order);
  const send=()=>action.run(async()=>{
    if(!allowed)throw new Error('You cannot send email for this order.');
    if(!navigator.onLine)throw new Error('Reconnect before sending.');
    if(!route?.ready)throw new Error('Review the email recipients first.');
    await email.send(order,route,branch,supplier,store.products,patch=>store.updateOrder(order.id,patch),'resend');
    setOpen(false);
  },'Mail server accepted the email and PDF.');
  if(!allowed)return null;
  return <><Button variant="quiet" onClick={()=>setOpen(true)}><Mail size={15}/>Send email</Button>{!open&&action.feedback}{open&&<Modal title="Review order email" onClose={()=>{if(!action.busy)setOpen(false);}}><div className="h-notice"><EmailStatus order={order}/><p>{state.detail}</p></div>{route?<EmailRouting route={route}/>:loading?<p role="status">Checking saved recipients…</p>:<p>Check the branch email settings before trying again.</p>}{action.feedback}<div className="h-dialog-foot"><Button variant="secondary" disabled={action.busy} onClick={()=>setOpen(false)}>Cancel</Button><Button busy={action.busy} disabled={!route?.ready} onClick={send}>Confirm & send email</Button></div></Modal>}</>;
}
export function OrderDocument({order,mode='ORDER',onClose}:{order:OrderRecord;mode?:'ORDER'|'DELIVERY'|'CHECKLIST';onClose:()=>void}){
  const store=useAppStore(),[url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let cancelled=false,objectUrl='';import('../../utils/orderEmail').then(({generateOrderPDF})=>generateOrderPDF(order,store.branches.find(b=>b.id===order.branchId),store.suppliers.find(s=>s.id===order.supplierId),store.products,mode)).then(base64=>{if(cancelled)return;const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));objectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));setUrl(objectUrl);}).catch(e=>setError(e.message));return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[order,store.branches,store.suppliers,store.products,mode]);
  return <Modal title={mode==='ORDER'?'Purchase order PDF':mode==='DELIVERY'?'Delivery note PDF':'Packing slip PDF'} onClose={onClose} wide>{error?<div role="alert" className="h-notice error">{error}</div>:url?<iframe title="Order PDF preview" className="h-pdf-preview" src={url}/>:<p>Preparing document…</p>}<div className="h-dialog-foot"><Button variant="secondary" onClick={onClose}>Close</Button>{url&&<><a className="h-button secondary" href={url} download={`HTOS-${shortId(order.id)}-${mode.toLowerCase()}.pdf`}><Download size={15}/> Download PDF</a><a className="h-button" href={url} target="_blank" rel="noreferrer"><Printer size={15}/> Open to print</a></>}</div></Modal>;
}
