import React from 'react';
import {isOrderQuantityText,MAX_ORDER_QUANTITY} from './orderingHelpers';

/** Text avoids number inputs retaining invalid exponent text while exposing an empty value. */
export function OrderQuantityInput({label,value,onChange}:{label:string;value:number;onChange:(value:string)=>void}) {
  return <input aria-label={label} type="text" inputMode="numeric" pattern="[0-9]*"
    title={`Whole numbers from 0 to ${MAX_ORDER_QUANTITY}`} autoComplete="off" spellCheck={false}
    value={value||''} placeholder="0" onFocus={event=>event.target.select()}
    onChange={event=>{
      const text=event.target.value;
      // Reject the complete edit: never turn pasted 1e2 or 1.5 into a different quantity.
      if(isOrderQuantityText(text))onChange(text);
    }}/>
}
