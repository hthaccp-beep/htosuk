import type {OrderRecord,Branch,Supplier} from '../types.ts';
import {orderReference} from './order-reference.ts';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

/** Shared by the preview and authoritative server send; quantities come from saved snapshots. */
export function renderPurchaseOrderEmail(order:OrderRecord,branch?:Partial<Branch>,supplier?:Partial<Supplier>) {
  const branchName=order.branchNameSnapshot||branch?.name||'Hare & Tortoise';
  const supplierName=order.supplierNameSnapshot||supplier?.name||'Supplier';
  const contact=branch?.contactPerson||order.orderedByNameSnapshot||branchName;
  const email=branch?.email||branch?.contactEmail||'N/A';
  const account=supplier?.branchAccountCodes?.[order.branchId]||supplier?.globalAccountCode;
  const date=order.deliveryDate?new Date(order.deliveryDate+'T12:00:00Z'):null;
  const delivery=date&&!Number.isNaN(date.getTime())?date.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric',timeZone:'Europe/London'}):'ASAP';
  const items=[...(order.items||[]).map(item=>({name:item.productNameSnapshot,code:item.itemCodeSnapshot,...item})),...(order.manualItems||[]).map(item=>({name:item.description,code:'MISC',...item}))];
  const lines=items.map((item,index)=>{
    const quantities=[item.caseQty>0?`${item.caseQty} ${item.caseUnitSnapshot||'Box'}`:'',item.packQty>0?`${item.packQty} ${item.packUnitSnapshot||'Unit'}`:''].filter(Boolean).join(', ');
    const line=`${index+1}. ${item.code?'['+item.code+'] ':''}${item.name} - ${quantities}`;
    return `<tr><td style="padding:7px 0;border-bottom:1px solid #e3e8dd;overflow-wrap:anywhere;">${escape(line)}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purchase Order ${escape(orderReference(order.id))}</title>
<style>@media screen and (max-width:560px){.po-pad{padding:22px 16px!important}.po-meta{display:block!important;width:100%!important;padding:0!important;border:0!important}.po-meta+.po-meta{padding-top:14px!important}}</style></head>
<body style="margin:0;padding:16px 0;background:#f6f5ef;color:#213b35;font-family:'DM Sans','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:800px;background:#ffffff;border:1px solid #dce3d5;border-radius:12px;"><tr><td class="po-pad" style="padding:32px;">
<div style="text-align:center;margin-bottom:30px;"><h1 style="margin:0;font-size:26px;line-height:1.3;color:#173a31;">Hare &amp; Tortoise</h1><p style="margin:8px 0 0;color:#52695b;">${escape(branchName)}${branch?.address?' | '+escape(branch.address):''}</p></div>
<h2 style="margin:0 0 12px;font-size:19px;color:#173a31;border-bottom:2px solid #7f9a76;padding-bottom:8px;">Purchase Order</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.6;"><tr>
<td class="po-meta" width="50%" valign="top" style="padding-right:16px;overflow-wrap:anywhere;">
<div><strong>Order Number:</strong> ${escape(orderReference(order.id))}</div>
<div><strong>Contact Person:</strong> ${escape(contact)}</div>
<div><strong>Telephone:</strong> ${escape(branch?.contactPhone||'N/A')}</div>
<div><strong>Email:</strong> ${escape(email)}</div></td>
<td class="po-meta" width="50%" valign="top" style="padding-left:16px;border-left:1px solid #e3e8dd;overflow-wrap:anywhere;">
<div><strong>Delivery Date:</strong> ${escape(delivery)}</div>
<div><strong>Supplier:</strong> ${escape(supplierName)}</div>
<div><strong>Supplier Contact:</strong> ${escape([supplier?.contactName,supplier?.contactPhone].filter(Boolean).join(' | ')||'N/A')}</div>
${account?`<div><strong>Account No:</strong> ${escape(account)}</div>`:''}</td></tr></table>
<h2 style="margin:28px 0 10px;font-size:19px;color:#173a31;">Order Details</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.6;">${lines}</table>
${order.comments?`<div style="margin-top:22px;padding:14px 16px;background:#f2f5ec;border:1px solid #dce3d5;border-radius:6px;"><strong>Special Comments:</strong><div style="white-space:pre-wrap;overflow-wrap:anywhere;">${escape(order.comments)}</div></div>`:''}
<div style="margin-top:32px;border-top:1px solid #dce3d5;padding-top:14px;font-size:12px;color:#52695b;"><p style="margin:0 0 6px;">For any queries regarding this order, please contact the issuing branch directly using the details above.</p><p style="margin:0;">Please note: Do not send correspondence to info@hareandtortoise.co.uk as this is a generic system email.</p></div>
</td></tr></table></td></tr></table></body></html>`;
}
