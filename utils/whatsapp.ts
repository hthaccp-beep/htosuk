import {orderReference} from '../shared/order-reference.ts';

import type { OrderRecord, Branch, Product } from '../types.ts';
import { getCaseUnitLabel, getPackUnitLabel } from '../types.ts';

export const cleanPhoneNumber = (phone: string): string => {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // UK Number Handling (Mobiles 07..., Landlines 01/02/03...)
  // If it starts with '0', remove it and add '44'
  if (cleaned.startsWith('0')) {
    cleaned = '44' + cleaned.substring(1);
  } 
  // If user entered '7...' (missing leading 0 for mobile), assume 44 prefix
  else if (cleaned.startsWith('7') && cleaned.length === 10) {
    cleaned = '44' + cleaned;
  }
  // If user entered '2...' (missing leading 0 for landline London), assume 44 prefix
  else if (cleaned.startsWith('2') && cleaned.length === 10) {
    cleaned = '44' + cleaned;
  }
  
  return cleaned;
};

export const generateWhatsAppLink = (
  order: OrderRecord, 
  branch: Branch, 
  mobileNumber: string,
  products?: Product[]
): string => {
  const dateStr = new Date(order.createdAt).toLocaleDateString('en-GB');
  const timeStr = new Date(order.createdAt).toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'});
  const deliveryStr = order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('en-GB') : 'ASAP';
  
  let text = `*NEW ORDER: ${branch.name}*\n`;
  text += `_Date: ${dateStr} ${timeStr}_\n`;
  text += `_Delivery: ${deliveryStr}_\n`;
  text += `_PO Ref: ${orderReference(order.id)}_\n\n`;
  
  text += `*ITEMS:*\n`;
  
  order.items.forEach(item => {
    const product = products?.find(p => p.id === item.productId);
    const caseLabel = item.caseUnitSnapshot || getCaseUnitLabel(product);
    const packLabel = item.packUnitSnapshot || getPackUnitLabel(product);
    const qtyParts = [];
    if (item.caseQty > 0) qtyParts.push(`${item.caseQty} ${caseLabel}`);
    if (item.packQty > 0) qtyParts.push(`${item.packQty} ${packLabel}`);
    
    if (qtyParts.length > 0) {
        text += `- ${qtyParts.join(' + ')} x *${item.productNameSnapshot}*\n`;
    }
  });
  
  if (order.manualItems.length > 0) {
    order.manualItems.forEach(item => {
        const caseLabel = item.caseUnitSnapshot || 'Box';
        const packLabel = item.packUnitSnapshot || 'Pack';
        const qtyParts = [];
        if (item.caseQty > 0) qtyParts.push(`${item.caseQty} ${caseLabel}`);
        if (item.packQty > 0) qtyParts.push(`${item.packQty} ${packLabel}`);
        
        if (qtyParts.length > 0) {
            text += `- ${qtyParts.join(' + ')} x *${item.description}* (Add.)\n`;
        }
    });
  }
  
  if (order.comments) {
    text += `\n*COMMENTS:*\n_${order.comments}_\n`;
  }
  
  text += `\n_Sent via HT Order System_`;
  
  const encodedText = encodeURIComponent(text);
  const number = cleanPhoneNumber(mobileNumber);
  
  return `https://wa.me/${number}?text=${encodedText}`;
};
