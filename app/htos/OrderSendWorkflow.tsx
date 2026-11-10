import React, {createContext,useContext} from 'react';
import type {OrderRecord,Branch,Supplier,Product} from '../../types';
import type {OrderEmailRoute} from '../../shared/order-email-route';
import {sendEmail} from '../../utils/sendEmail';
import {sendAndRecordOrderEmail} from './communicationState';
import {api,shortId} from './ui';
export interface OrderSendServices {
  preview(branchId:string,supplierId:string):Promise<OrderEmailRoute>;
  send(order:OrderRecord,route:OrderEmailRoute,branch:Branch|undefined,supplier:Supplier|undefined,products:Product[],save:(patch:Partial<OrderRecord>)=>Promise<unknown>,purpose?:'order'|'resend'):Promise<void>;
}
const services:OrderSendServices={
  preview:(branchId,supplierId)=>api('/api/admin/workspace',{action:'order-email-preview',branchId,supplierId}),
  async send(order,route,branch,supplier,products,save,purpose='order'){
    if(!route.ready)throw new Error(route.error||'Email is not ready.');
    const {generateOrderPDF,generateOrderEmailContent}=await import('../../utils/orderEmail');
    const content=generateOrderEmailContent(order,branch,supplier,products);
    const pdf=await generateOrderPDF(order,branch,supplier,products);
    await sendAndRecordOrderEmail(order,()=>sendEmail({purpose,orderId:order.id,branchId:order.branchId,supplierId:order.supplierId,routeKey:route.routeKey,to:route.to.join(','),subject:content.subject,html:content.htmlBody,attachments:[{filename:'HTOS-'+shortId(order.id)+'.pdf',content:pdf,encoding:'base64'}]}),save);
  }
};
export const OrderSendContext=createContext<OrderSendServices>(services);
export const useOrderSend=()=>useContext(OrderSendContext);
export function EmailRouting({route}:{route:OrderEmailRoute}) {
  return <><dl className="h-email-routing" aria-label="Email recipients"><div><dt>From</dt><dd>{route.fromName} &lt;{route.from}&gt;</dd></div><div><dt>To</dt><dd>{route.to.join(', ')}</dd></div><div><dt>Reply-to</dt><dd>{route.replyTo}</dd></div><div><dt>Copy (CC)</dt><dd>{route.cc.join(', ')||'None'}</dd></div></dl><p className="h-notice">Purchase order PDF attached · Items and quantities only</p>{route.error&&<div className="h-notice error" role="alert">{route.error}</div>}</>;
}
