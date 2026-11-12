import React from 'react';
import type {ExtractedInvoice,ExtractedInvoiceRow} from '../../shared/invoice-extraction';

/** Original document facts remain separate from HTOS order identity and approved figures. */
export function InvoiceDraftFacts({draft}:{draft:ExtractedInvoice}){
 const currency=draft.currency||'(currency unknown)';
 return <div className="ic-step-note">
  <p>Printed customer: {draft.customerName||'unknown'} · Branch: {draft.branch||'unknown'}</p>
  <p>Customer order references: {draft.orderReferences.join(', ')||'none read'} · Supplier order references: {draft.supplierOrderReferences?.join(', ')||'none read'}</p>
  {(draft.linkedInvoiceReference||draft.linkedInvoiceDate)&&<p>Linked invoice: {draft.linkedInvoiceReference||'unknown'} · Invoice date: {draft.linkedInvoiceDate||'unknown'} · Delivery-note date: {draft.date||'unknown'}</p>}
  {draft.netBeforeAdjustment!=null&&<p>Printed net before adjustment: {draft.netBeforeAdjustment.toFixed(2)} {currency} · Adjustment: {draft.adjustment==null?'unknown':draft.adjustment.toFixed(2)} · Payable net: {draft.net==null?'unknown':draft.net.toFixed(2)}</p>}
 </div>;
}
export function InvoiceRowFacts({row}:{row:ExtractedInvoiceRow}){
 if(row.orderedQuantity==null&&row.weightQuantity==null&&!row.priceUnit)return null;
 return <p className="ic-step-note">
  {row.orderedQuantity!=null&&<>Printed ordered quantity: {row.orderedQuantity} {row.unit||'(unit unknown)'}. </>}
  {row.weightQuantity!=null&&<>Separate printed weight: {row.weightQuantity} {row.weightUnit||'(unit unknown)'}. </>}
  {row.priceUnit&&<>Price unit: {row.priceUnit}. </>}
  {row.weightQuantity!=null&&<>Weight scope: unconfirmed. {!row.priceUnit&&<>Price basis: unconfirmed. </>}Quantity and weight are not converted automatically.</>}
 </p>;
}
