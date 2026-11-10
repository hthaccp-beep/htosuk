import {renderPurchaseOrderEmail} from '../shared/order-email-template.ts';
import {orderReference} from '../shared/order-reference.ts';

import type { OrderRecord, Branch, Product, Supplier, CreditNoteClaim } from '../types.ts';
import { getCaseUnitLabel, getPackUnitLabel } from '../types.ts';
import { createHtosPdf } from './pdfTheme.ts';
import { generatePackingSlipPDF } from './packingSlipPdf.ts';
import { generateCreditClaimPdf } from './creditClaimPdf.ts';

interface EmailContent {
  subject: string;
  htmlBody: string;
}

// --- HELPER: RESOLVE ACCOUNT CODE ---
// Implements "Waterfall" Resolution:
// 1. Check for specific branch override
// 2. Check for global default
// 3. Return empty string
const resolveAccountCode = (supplier: Supplier | undefined, branchId: string): string => {
  if (!supplier) return '';
  
  // 1. Specific Override
  if (supplier.branchAccountCodes?.[branchId]) {
    return supplier.branchAccountCodes[branchId];
  }
  
  // 2. Global Default
  if (supplier.globalAccountCode) {
    return supplier.globalAccountCode;
  }
  
  return '';
};

// Helper: Format Date
const formatFullDate = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
};

// Robust entity resolvers for offline or missing-catalog scenarios
export const resolveEffectiveBranch = (order: OrderRecord, branch?: Partial<Branch>): Partial<Branch> & { name: string; id: string } => {
  return {
    id: branch?.id || order.branchId || '',
    name: branch?.name || order.branchNameSnapshot || 'Hare & Tortoise',
    address: branch?.address || '',
    contactPerson: branch?.contactPerson || order.orderedByNameSnapshot || branch?.name || order.branchNameSnapshot || 'Branch Staff',
    contactPhone: branch?.contactPhone || 'N/A',
    email: branch?.email || branch?.contactEmail || order.emailTo || 'N/A',
    contactEmail: branch?.contactEmail || branch?.email || order.emailTo || 'N/A',
  };
};

export const resolveEffectiveSupplier = (order: OrderRecord, supplier?: Partial<Supplier>): Partial<Supplier> => {
  return supplier || {
    id: order.supplierId,
    name: order.supplierNameSnapshot,
    email: order.emailTo,
    contactName: '',
    contactPhone: ''
  };
};

// Helper: Format Item Line
// Mode: 'ORDER' (Standard) or 'DELIVERY' (Includes Sent vs Ordered)
export const formatItemLine = (
  index: number, 
  id: string, 
  name: string, 
  caseQty: number, 
  packQty: number,
  mode: 'ORDER' | 'DELIVERY',
  sentCaseQty?: number,
  sentPackQty?: number,
  product?: Product,
  shortageReason?: string,
  caseUnitSnapshot?: string,
  packUnitSnapshot?: string
): string => {
  const parts = [];
  const caseLabel = caseUnitSnapshot?.trim() || getCaseUnitLabel(product);
  const packLabel = packUnitSnapshot?.trim() || getPackUnitLabel(product);
  
  if (mode === 'ORDER') {
      if (caseQty > 0) parts.push(`${caseQty} ${caseLabel}`);
      if (packQty > 0) parts.push(`${packQty} ${packLabel}`);
  } else {
      // DELIVERY MODE: Show Sent, highlight Shortage
      if (caseQty > 0) {
          const sent = sentCaseQty !== undefined ? sentCaseQty : caseQty;
          const diff = caseQty - sent;
          if (diff > 0) {
              const reasonStr = shortageReason ? ` - ${shortageReason}` : '';
              parts.push(`${sent} ${caseLabel} (${diff} OOS${reasonStr})`);
          } else {
              parts.push(`${sent} ${caseLabel}`);
          }
      }
      if (packQty > 0) {
          const sent = sentPackQty !== undefined ? sentPackQty : packQty;
          const diff = packQty - sent;
          if (diff > 0) {
              const reasonStr = shortageReason ? ` - ${shortageReason}` : '';
              parts.push(`${sent} ${packLabel} (${diff} OOS${reasonStr})`);
          } else {
              parts.push(`${sent} ${packLabel}`);
          }
      }
  }
  
  const qtyStr = parts.join(', ');
  
  // Compact Format: 1. [Code] Name - Qty
  const idStr = id && id !== 'MISC' ? `[${id}] ` : (id === 'MISC' ? '[MISC] ' : '');
  
  return `${index}. ${idStr}${name} - ${qtyStr}`;
};

// --- 1. Email HTML Generation ---
export const generateOrderEmailContent = (
  order: OrderRecord, 
  branch?: Partial<Branch>, 
  supplier?: Partial<Supplier>,
  products: Product[] = [],
  mode: 'ORDER' | 'DELIVERY' = 'ORDER'
): EmailContent => {
  const effectiveBranch = resolveEffectiveBranch(order, branch);
  const effectiveSupplier = resolveEffectiveSupplier(order, supplier);
  const deliveryDateFormatted = order.deliveryDate ? formatFullDate(order.deliveryDate) : 'ASAP';
  
  // Resolve Account ID
  const accountCode = resolveAccountCode(effectiveSupplier as Supplier, effectiveBranch.id);
  
  let subject = '';
  if (mode === 'ORDER') {
      subject = `Order PO ${effectiveBranch.name} (Delivery Date: ${order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('en-GB') : 'ASAP'})`;
  } else {
      const isShort = order.fulfillmentStatus === 'PARTIAL';
      subject = `Delivery Note: Order #${orderReference(order.id)} - ${effectiveBranch.name} ${isShort ? '[ITEMS OOS]' : ''}`;
  }

  let lineCount = 1;
  
  const itemLines = [
    ...order.items.map(item => {
      const p = products.find(prod => prod.id === item.productId);
      const itemCode = p?.itemCode || item.itemCodeSnapshot || '';
      
      const lineText = formatItemLine(
        lineCount++, 
        itemCode, 
        item.productNameSnapshot || p?.name || 'Item', 
        item.caseQty, 
        item.packQty,
        mode,
        item.sentCaseQty,
        item.sentPackQty,
        p,
        item.shortageReason,
        item.caseUnitSnapshot || p?.caseUnitName,
        item.packUnitSnapshot || p?.packUnitName
      );

      // Highlight OOS lines in Red for Delivery Note
      const isOOS = mode === 'DELIVERY' && lineText.includes('OOS');
      const style = isOOS ? 'color: #dc2626; font-weight: bold;' : '';

      return `<div style="border-bottom: 1px solid #eee; padding: 4px 0; ${style}">${lineText}</div>`;
    }),
    ...order.manualItems.map(item => {
      return `<div style="border-bottom: 1px solid #eee; padding: 4px 0;">${formatItemLine(
        lineCount++, 
        'MISC', 
        item.description, 
        item.caseQty, 
        item.packQty,
        mode,
        item.sentCaseQty,
        item.sentPackQty,
        undefined,
        item.shortageReason,
        item.caseUnitSnapshot,
        item.packUnitSnapshot
      )}</div>`;
    })
  ].join('');

  const docTitle = mode === 'ORDER' ? 'Purchase Order' : 'Delivery Note';

  // Styles for 2-column layout in Email (HTML)
  const htmlBody = `
    <div style="font-family: 'Arial', sans-serif; color: #000; line-height: 1.5; font-size: 14px; max-width: 800px; margin: 0 auto;">
      
      <!-- 1. Header (Centered) -->
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="margin: 0; font-size: 24px; font-weight: bold;">Hare & Tortoise</h2>
        <div style="font-size: 16px; margin-top: 5px;">${effectiveBranch.name}${effectiveBranch.address ? ` | ${effectiveBranch.address}` : ''}</div>
      </div>

      <!-- 2. Document Info Section (2 Columns) -->
      <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; font-size: 18px; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 5px;">${docTitle}</h3>
        
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="width: 50%; vertical-align: top; padding-right: 10px;">
              <div><strong>Order Number:</strong> ${orderReference(order.id)}</div>
              <div><strong>Contact Person:</strong> ${effectiveBranch.contactPerson || effectiveBranch.name}</div>
              <div><strong>Telephone:</strong> ${effectiveBranch.contactPhone || 'N/A'}</div>
              <div><strong>Email:</strong> ${effectiveBranch.email || 'N/A'}</div>
            </td>
            <td style="width: 50%; vertical-align: top; padding-left: 10px; border-left: 1px solid #eee;">
              <div><strong>Delivery Date:</strong> ${deliveryDateFormatted}</div>
              <div><strong>Supplier:</strong> ${order.supplierNameSnapshot || effectiveSupplier.name || 'Supplier'}</div>
              <div><strong>Supplier Contact:</strong> ${effectiveSupplier.contactName || ''}${effectiveSupplier.contactPhone ? ` | ${effectiveSupplier.contactPhone}` : ''}</div>
              ${accountCode ? `<div><strong>Account No:</strong> ${accountCode}</div>` : ''}
            </td>
          </tr>
        </table>
      </div>

      <!-- 3. Order Details (Text List) -->
      <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; font-size: 18px; font-weight: bold;">Order Details</h3>
        
        <!-- Order Lines -->
        <div style="font-family: 'Arial', sans-serif;">
          ${itemLines}
        </div>
      </div>

      ${(order.fulfillmentNotes || order.comments) ? `
        <div style="margin-top: 20px; padding: 15px; background-color: #f9fafb; border: 1px solid #ddd; border-radius: 4px;">
          <strong>${mode === 'DELIVERY' ? 'Dispatch & Fulfillment Notes:' : 'Special Comments:'}</strong><br/>
          ${order.fulfillmentNotes || order.comments}
        </div>
      ` : ''}

      <!-- 5. Footer -->
      <div style="margin-top: 50px; font-size: 12px; color: #555; border-top: 1px solid #ccc; padding-top: 15px;">
        <p style="margin: 0 0 5px 0;">
          For any queries regarding this order, please contact the issuing branch directly using the details above.
        </p>
        <p style="margin: 0;">
          Please note: Do not send correspondence to info@hareandtortoise.co.uk as this is a generic system email.
        </p>
      </div>
    </div>
  `;

  return { subject, htmlBody: mode === 'ORDER' ? renderPurchaseOrderEmail(order,branch,supplier) : htmlBody };
};

// --- 2. PDF Generation (Async) ---
export const generateOrderPDF = async (
  order: OrderRecord,
  branch?: Partial<Branch>,
  supplier?: Partial<Supplier>,
  products: Product[] = [],
  mode: 'ORDER' | 'DELIVERY' | 'CHECKLIST' = 'ORDER'
): Promise<string> => {
  if(mode==='CHECKLIST')return generatePackingSlipPDF(order,supplier?.name||order.supplierNameSnapshot);
  const effectiveBranch = resolveEffectiveBranch(order, branch);
  const effectiveSupplier = resolveEffectiveSupplier(order, supplier);
  const doc = createHtosPdf();
  
  // Standard Helvetica
  doc.setFont("Helvetica", "normal");

  const deliveryDateFormatted = order.deliveryDate ? formatFullDate(order.deliveryDate) : 'ASAP';
  const docTitle = mode === 'ORDER' ? 'Purchase Order' : 'Delivery Note';
  const accountCode = resolveAccountCode(effectiveSupplier as Supplier, effectiveBranch.id);

  let y = 20; // Cursor Y position
  const lineHeight = 6; // Compact line height

  // --- 1. Header (Centered) ---
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Hare & Tortoise", 105, y, { align: 'center' });
  y += 8;
  
  const addressStr = `${effectiveBranch.name}${effectiveBranch.address ? ` | ${effectiveBranch.address}` : ''}`;
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(11);
  doc.text(addressStr, 105, y, { align: 'center' });
  y += 15;

  // --- 2. Document Info Section (2 Columns) ---
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(14);
  doc.text(docTitle, 14, y);
  y += 2; // Underline offset
  doc.setLineWidth(0.5);
  doc.line(14, y, 200, y); // Underline
  y += 8;

  doc.setFontSize(9); // Smaller font for compact layout
  
  // Left Column (x = 14)
  const leftX = 14;
  
  // Order Number
  let label = "Order Number: ";
  let value = orderReference(order.id);
  doc.setFont("Helvetica", "bold"); doc.text(label, leftX, y);
  doc.setFont("Helvetica", "normal"); doc.text(value, leftX + 25, y);
  
  // Contact Person
  label = "Contact Person: ";
  value = effectiveBranch.contactPerson || effectiveBranch.name;
  doc.setFont("Helvetica", "bold"); doc.text(label, leftX, y + lineHeight);
  doc.setFont("Helvetica", "normal"); doc.text(value, leftX + 26, y + lineHeight);
  
  // Telephone
  label = "Telephone: ";
  value = effectiveBranch.contactPhone || 'N/A';
  doc.setFont("Helvetica", "bold"); doc.text(label, leftX, y + lineHeight * 2);
  doc.setFont("Helvetica", "normal"); doc.text(value, leftX + 20, y + lineHeight * 2);
  
  // Email
  label = "Email: ";
  value = effectiveBranch.email || 'N/A';
  doc.setFont("Helvetica", "bold"); doc.text(label, leftX, y + lineHeight * 3);
  doc.setFont("Helvetica", "normal"); doc.text(value, leftX + 12, y + lineHeight * 3);

  // Right Column (x = 110)
  const rightX = 110;
  
  // Delivery Date
  label = "Delivery Date: ";
  value = deliveryDateFormatted;
  doc.setFont("Helvetica", "bold"); doc.text(label, rightX, y);
  doc.setFont("Helvetica", "normal"); doc.text(value, rightX + 24, y);
  
  // Supplier
  label = "Supplier: ";
  value = order.supplierNameSnapshot || effectiveSupplier.name || 'Supplier';
  doc.setFont("Helvetica", "bold"); doc.text(label, rightX, y + lineHeight);
  doc.setFont("Helvetica", "normal"); doc.text(value, rightX + 16, y + lineHeight);
  
  // Supplier Contact
  label = "Supplier Contact: ";
  const supplierContactStr = `${effectiveSupplier.contactName || ''}${effectiveSupplier.contactPhone ? ` | ${effectiveSupplier.contactPhone}` : ''}`.trim() || 'N/A';
  doc.setFont("Helvetica", "bold"); doc.text(label, rightX, y + lineHeight * 2);
  doc.setFont("Helvetica", "normal"); doc.text(supplierContactStr, rightX + 28, y + lineHeight * 2);

  // Account No (New)
  if (accountCode) {
    label = "Account No: ";
    value = accountCode;
    doc.setFont("Helvetica", "bold"); doc.text(label, rightX, y + lineHeight * 3);
    doc.setFont("Helvetica", "normal"); doc.text(value, rightX + 22, y + lineHeight * 3);
  }

  y += (lineHeight * 3) + 10;

  // --- 3. Order Details Section (2 Column Grid) ---
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Order Details", 14, y);
  y += 6;
  doc.line(14, y, 200, y);
  y += 6;

  doc.setFontSize(9); // Compact item font

  // Grid Setup
  const col1X = 14;
  const col2X = 110;
  const colWidth = 90;
  
  // Merge items
  const allItems = [
    ...order.items.map(i => ({...i, type: 'standard'})),
    ...(order.manualItems||[]).map(i => ({...i, type: 'manual'}))
  ];

  const pdfRows: {lines:string[];isOOS:boolean}[] = [];

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const isRightCol = i % 2 !== 0;
    const currentX = isRightCol ? col2X : col1X;

    // Check page break before starting a ROW (so check on left item)
    // Safe margin from bottom = 20
    if (!isRightCol && y > 270) {
       doc.addPage();
       y = 20;
       doc.setFontSize(9);
    }

    // Prepare Text
    let lineStr = '';
    let isOOS = false;

    if (item.type === 'standard') {
       const stdItem = item as any; // Cast to OrderItem
       const p = products.find(prod => prod.id === stdItem.productId);
       lineStr = formatItemLine(
          i + 1, // Use global index
          stdItem.itemCodeSnapshot || p?.itemCode || '', 
          stdItem.productNameSnapshot || p?.name || 'Item', 
          stdItem.caseQty, 
          stdItem.packQty,
          mode,
          stdItem.sentCaseQty,
          stdItem.sentPackQty,
          p,
          stdItem.shortageReason,
          stdItem.caseUnitSnapshot || p?.caseUnitName,
          stdItem.packUnitSnapshot || p?.packUnitName
       );
       isOOS = mode === 'DELIVERY' && lineStr.includes('OOS');
    } else {
       const manItem = item as any; // Cast to ManualOrderItem
       lineStr = formatItemLine(
          i + 1, // Use global index
          'MISC', 
          manItem.description, 
          manItem.caseQty, 
          manItem.packQty,
          mode,
          manItem.sentCaseQty,
          manItem.sentPackQty,
          undefined,
          manItem.shortageReason,
          manItem.caseUnitSnapshot,
          manItem.packUnitSnapshot
       );
       isOOS = mode === 'DELIVERY' && lineStr.includes('OOS');
    }

    doc.setFont('DMSans',isOOS?'bold':'normal');
    pdfRows.push({lines:doc.splitTextToSize(lineStr,colWidth),isOOS});
  }
  for(let start=0;start<pdfRows.length;start+=2){
    const row=pdfRows.slice(start,start+2),maxLines=Math.max(...row.map(r=>r.lines.length));
    if(y+maxLines*lineHeight>270&&maxLines*lineHeight<=250){doc.addPage();y=20;}
    let offset=0;
    while(offset<maxLines){
      if(y+lineHeight>270){doc.addPage();y=20;}
      const count=Math.min(maxLines-offset,Math.floor((270-y)/lineHeight));
      row.forEach((item,index)=>{doc.setFontSize(9);doc.setFont('DMSans',item.isOOS?'bold':'normal');doc.setTextColor(...(item.isOOS?[157,69,40]:[33,59,53]) as [number,number,number]);doc.text(item.lines.slice(offset,offset+count),index?col2X:col1X,y);});
      y+=count*lineHeight+2;offset+=count;
    }
  }
  doc.setTextColor(33,59,53);

  y += 5;

  // --- Comments / Notes ---
  const notesText = order.fulfillmentNotes || order.comments;
  if (notesText) {
    if (y > 250) { doc.addPage(); y = 20; }
    y += 5;
    
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.text(mode === 'DELIVERY' ? "Dispatch & Fulfillment Notes:" : "Special Comments:", 14, y);
    y += 5;
    
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    const splitComments = doc.splitTextToSize(notesText, 180);
    for(const line of splitComments){if(y>270){doc.addPage();y=20;}doc.text(line,14,y);y+=5;}
    y+=5;
  }

  // --- 5. Footer ---
  y = Math.max(y + 10, 250); // Push to bottom if space allows, else new page
  if (y > 270) { doc.addPage(); y = 260; }
  
  doc.setDrawColor(192,207,187);
  doc.line(14, y, 200, y);
  y += 5;
  
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(82,105,91);
  doc.text("For any queries regarding this order, please contact the issuing branch directly using the details above.", 14, y);
  doc.text("Please note: Do not send correspondence to info@hareandtortoise.co.uk as this is a generic system email.", 14, y + 4);

  // Return base64 string
  const dataUri = doc.output('datauristring');
  return dataUri.split(',')[1];
};

export const generateCreditNoteEmailContent = (
  order: OrderRecord,
  branch: Branch,
  supplier: Supplier | undefined,
  claim: CreditNoteClaim
): EmailContent => {
  const accountCode = resolveAccountCode(supplier, branch.id);
  const subject = `[CREDIT NOTE CLAIM] Ref #${claim.cnRef} - Order #${orderReference(order.id)} - ${branch.name}`;

  const itemRows = claim.items.map((item, idx) => {
    let issueLabel = 'Shortage';
    if (item.issueType === 'PRICE_OVERCHARGE') issueLabel = 'Price Overcharge';
    if (item.issueType === 'DAMAGED') issueLabel = 'Damaged Goods';
    if (item.issueType === 'WRONG_ITEM') issueLabel = 'Incorrect Item';

    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 10px; font-weight: bold;">${idx + 1}. ${item.description}</td>
        <td style="padding: 10px;"><span style="background-color: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold;">${issueLabel}</span></td>
        <td style="padding: 10px; text-align: center; font-family: monospace;">${item.orderedQtyStr || '-'} / ${item.deliveredQtyStr || '-'}</td>
        <td style="padding: 10px; text-align: right; font-family: monospace;">£${item.expectedPrice.toFixed(2)} vs £${item.invoicedPrice.toFixed(2)}</td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: #dc2626; font-family: monospace;">£${item.claimAmount.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  const htmlBody = `
    <div style="font-family: 'Arial', sans-serif; color: #111827; line-height: 1.5; font-size: 14px; max-width: 800px; margin: 0 auto; background-color: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      
      <!-- Header -->
      <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #ef4444;">
        <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">Credit Note Claim Request</h2>
        <div style="font-size: 14px; color: #4b5563; margin-top: 4px;"><strong>${branch.name}</strong> | Hare & Tortoise</div>
      </div>

      <!-- Claim Metadata Block -->
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="width: 50%; vertical-align: top;">
              <div><strong>Claim Ref:</strong> <span style="font-family: monospace; font-weight: bold; color: #991b1b;">${claim.cnRef}</span></div>
              <div><strong>Original Order #:</strong> ${orderReference(order.id)}</div>
              <div><strong>Branch:</strong> ${branch.name} (${branch.code})</div>
              <div><strong>Contact Email:</strong> ${branch.contactEmail || branch.email || 'N/A'}</div>
            </td>
            <td style="width: 50%; vertical-align: top;">
              <div><strong>Claim Date:</strong> ${new Date(claim.claimDate).toLocaleDateString('en-GB')}</div>
              <div><strong>Invoice Number:</strong> ${claim.invoiceNumber || 'N/A'}</div>
              <div><strong>Supplier:</strong> ${order.supplierNameSnapshot}</div>
              ${accountCode ? `<div><strong>Account Code:</strong> ${accountCode}</div>` : ''}
            </td>
          </tr>
        </table>
      </div>

      <p style="margin-bottom: 16px; font-size: 14px;">
        Dear Supplier Accounts Team,
      </p>
      <p style="margin-bottom: 16px; font-size: 14px; color: #374151;">
        Please accept this formal Credit Note claim regarding discrepancies identified during our delivery cross-check for Order <strong>#${orderReference(order.id)}</strong> ${claim.invoiceNumber ? `(Invoice #${claim.invoiceNumber})` : ''}.
      </p>

      <!-- Claim Table -->
      <div style="margin-bottom: 24px; overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
          <thead>
            <tr style="background-color: #f3f4f6; color: #374151; font-weight: bold; text-transform: uppercase;">
              <th style="padding: 10px;">Item Description</th>
              <th style="padding: 10px;">Issue</th>
              <th style="padding: 10px; text-align: center;">Ord / Deliv Qty</th>
              <th style="padding: 10px; text-align: right;">Expected / Invoiced</th>
              <th style="padding: 10px; text-align: right;">Claim Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>
      </div>

      <!-- Summary Total Box -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
        <div style="background-color: #f87171; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-align: right;">
          <span style="font-size: 12px; font-weight: bold; text-transform: uppercase; display: block; opacity: 0.9;">Total Credit Claimed</span>
          <span style="font-size: 22px; font-weight: 900; font-family: monospace;">£${claim.totalClaimAmount.toFixed(2)}</span>
        </div>
      </div>

      ${claim.notes ? `
        <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 24px; font-size: 13px;">
          <strong style="color: #374151;">Branch Manager Notes:</strong>
          <p style="margin: 4px 0 0 0; color: #4b5563; italic;">"${claim.notes}"</p>
        </div>
      ` : ''}

      <p style="font-size: 13px; color: #4b5563;">
        Please confirm receipt of this claim and issue a credit note for <strong>£${claim.totalClaimAmount.toFixed(2)}</strong> to be applied against our account.
      </p>

      <!-- Footer -->
      <div style="margin-top: 32px; font-size: 11px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 12px; text-align: center;">
        <p style="margin: 0;">Hare & Tortoise Branch Ordering & Delivery Verification System</p>
      </div>
    </div>
  `;

  return { subject, htmlBody };
};

// --- 4. Credit Note PDF Generation ---
export const generateCreditNotePDF = async (order:OrderRecord,branch:Branch,supplier:Supplier|undefined,claim:CreditNoteClaim):Promise<string> => generateCreditClaimPdf(claim,branch,supplier).base64;
