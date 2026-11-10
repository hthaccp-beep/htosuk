import React from 'react';
import type {OrderMinimumCheck} from '../../shared/order-minimum';
import {money} from './ui';
import './order-minimum.css';

export function BasketTotal({check,showPrices=true,compact=false}:{check:OrderMinimumCheck;showPrices?:boolean;compact?:boolean}) {
  return <div className={compact?'h-basket-total compact':'h-basket-total'} aria-label="Basket value">
    {!showPrices&&<small>Prices and supplier minimum are checked when the order is saved.</small>}
    {showPrices&&<strong>{check.unpricedItems?'Known subtotal':'Basket total'} {money(check.subtotal)} <small>excl. VAT</small></strong>}
    {showPrices&&check.unpricedItems>0&&<small>{check.unpricedItems} item(s) need prices; not fully included.</small>}
    {showPrices&&check.minimum>0&&<small>{showPrices?`Supplier minimum ${money(check.minimum)} excl. VAT`:'Supplier minimum applies'} · {check.needsFollowUp?'Below minimum':'Minimum met'}</small>}
    {showPrices&&check.needsFollowUp&&<span className="h-minimum-warning" role="status">{showPrices?`${money(check.shortfall)} below minimum${check.unpricedItems?' on known prices':''}. `:''}You can send this order. Manager / GM follow-up will be flagged in Order History.</span>}
  </div>;
}
export function MinimumFollowUp({check,showPrices=false,compact=false}:{check?:OrderMinimumCheck;showPrices?:boolean;compact?:boolean}) {
  if(!check?.needsFollowUp)return null;
  if(compact)return <span className="h-minimum-flag" role="note" title="Minimum order needs Manager / GM follow-up. Open the order for details." aria-label="Minimum order needs Manager or GM follow-up">Minimum follow-up</span>;
  return <div className="h-minimum-warning" role="note"><strong>Minimum order · Manager / GM follow-up</strong><small>{check.unpricedItems?'Minimum not confirmed: some prices are missing.':'Order placed below the supplier minimum.'}{showPrices&&` Known value ${money(check.subtotal)} / minimum ${money(check.minimum)} excl. VAT. Shortfall ${money(check.shortfall)}.`} Contact the supplier to confirm acceptance.</small></div>;
}
