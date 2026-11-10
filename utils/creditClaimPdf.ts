import type { jsPDF } from 'jspdf';
import { createHtosPdf } from './pdfTheme.ts';
import autoTable from 'jspdf-autotable';
import type { CreditNoteClaim, Branch, Supplier } from '../types.ts';

/**
 * Generates an official Hare & Tortoise Credit Claim Note PDF.
 * Used to dispute shortages, price discrepancies, and damaged items directly with suppliers.
 */
export function generateCreditClaimPdf(
  claim: CreditNoteClaim,
  branch?: Branch,
  supplier?: Supplier
): { doc: jsPDF; base64: string; fileName: string } {
  const doc = createHtosPdf();

  const primaryColor: [number, number, number] = [23, 58, 49]; // Deep crimson/burgundy
  const darkTextColor: [number, number, number] = [33, 59, 53];
  const mutedTextColor: [number, number, number] = [82, 105, 91];

  // Header Banner
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 210, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('HARE & TORTOISE', 14, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('SUPPLIER CREDIT CLAIM NOTICE', 196, 15, { align: 'right' });

  // Claim Meta Grid
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Claim Reference: ${claim.cnRef}`, 14, 35);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...mutedTextColor);
  doc.text(`Claim Date: ${new Date(claim.claimDate).toLocaleDateString('en-GB')}`, 14, 41);
  if (claim.invoiceNumber) {
    doc.text(`Supplier Invoice No: ${claim.invoiceNumber}`, 14, 46);
  }
  if (claim.invoiceDate) {
    doc.text(`Invoice Date: ${claim.invoiceDate}`, 14, 51);
  }

  // Branch & Supplier Details
  const startY = 58;
  doc.setFillColor(245, 245, 239);
  doc.rect(14, startY, 86, 26, 'F');
  doc.rect(110, startY, 86, 26, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.setFontSize(9);
  doc.text('CLAIMING BRANCH:', 18, startY + 6);
  doc.text('SUPPLIER:', 114, startY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...darkTextColor);
  doc.text(branch?.name || 'Hare & Tortoise Branch', 18, startY + 12);
  doc.setTextColor(...mutedTextColor);
  doc.text(branch?.address || branch?.contactEmail || 'Accounts Department', 18, startY + 17);
  doc.text(`Email: ${claim.branchCcEmail || branch?.email || 'accounts@hareandtortoise.co.uk'}`, 18, startY + 22);

  doc.setTextColor(...darkTextColor);
  doc.text(supplier?.name || 'Supplier Accounts', 114, startY + 12);
  doc.setTextColor(...mutedTextColor);
  doc.text(`Recipient: ${claim.supplierEmail || supplier?.email || 'N/A'}`, 114, startY + 17);
  doc.text('Attention: Credit & Disputes Department', 114, startY + 22);

  // Table of Claim Items
  const tableRows = claim.items.map((item, index) => {
    return [
      (index + 1).toString(),
      item.itemCode || '—',
      item.description,
      item.issueType.replace('_', ' '),
      item.orderedQtyStr,
      item.deliveredQtyStr,
      `£${item.expectedPrice.toFixed(2)}`,
      `£${item.invoicedPrice.toFixed(2)}`,
      `£${item.claimAmount.toFixed(2)}`,
    ];
  });

  const tableOptions = {
    startY: 90,
    head: [[
      '#',
      'Code',
      'Item Description',
      'Issue Type',
      'Ordered',
      'Delivered',
      'Expected',
      'Invoiced',
      'Claim (£)'
    ]],
    body: tableRows,
    theme: 'striped' as const,
    headStyles: {
      cellPadding: {top:2.5,bottom:2.5,left:1,right:1},
      fillColor: primaryColor,
      textColor: [255, 255, 255] as [number, number, number],
      fontSize: 8,
      fontStyle: 'bold' as const,
      halign: 'center' as const,
    },
    styles: {
      font: 'DMSans',
      fontSize: 8,
      cellPadding: 2.5,
      valign: 'middle' as const,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' as const },
      1: { cellWidth: 18 },
      2: { cellWidth: 'auto' as const },
      3: { cellWidth: 24, halign: 'center' as const },
      4: { cellWidth: 16, halign: 'center' as const },
      5: { cellWidth: 16, halign: 'center' as const },
      6: { cellWidth: 18, halign: 'right' as const },
      7: { cellWidth: 18, halign: 'right' as const },
      8: { cellWidth: 20, halign: 'right' as const, fontStyle: 'bold' as const },
    },
  };

  const runAutoTable = (typeof autoTable === 'function' ? autoTable : (autoTable as any)?.default) || (doc as any).autoTable;
  if (typeof runAutoTable === 'function') {
    runAutoTable(doc, tableOptions);
  } else if (typeof (doc as any).autoTable === 'function') {
    (doc as any).autoTable(tableOptions);
  }

  const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY : 140;

  // Total Claim Box
  if(finalY>240)doc.addPage();
  const totalBoxY = finalY>240?20:finalY+8;
  doc.setFillColor(229, 237, 222); // Soft red/pink alert background
  doc.rect(130, totalBoxY, 66, 20, 'F');
  doc.setDrawColor(...primaryColor);
  doc.rect(130, totalBoxY, 66, 20, 'D');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...darkTextColor);
  doc.text('TOTAL CLAIM VALUE:', 134, totalBoxY + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...primaryColor);
  doc.text(`£${claim.totalClaimAmount.toFixed(2)}`, 192, totalBoxY + 15, { align: 'right' });

  // Notes & Instructions
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...darkTextColor);
  doc.text('Notice to Supplier Accounts:', 14, totalBoxY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...mutedTextColor);
  doc.text(doc.splitTextToSize([
    'Please issue a formal Credit Note referencing the Claim Reference above and deduct',
    'this amount from the corresponding monthly statement. If you require further clarification',
    'or proof of delivery photos, reply directly to this notice.',
  ].join(' '),108), 14, totalBoxY + 12);

  if (claim.notes) {
    doc.setFont('helvetica', 'italic');
    let y=totalBoxY+32;
    for(const line of doc.splitTextToSize(`Branch Notes: ${claim.notes}`,180)){
      if(y>272){doc.addPage();y=20;}
      doc.text(line,14,y);y+=4;
    }
  }

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(114, 128, 120);
  doc.text(
    `Hare & Tortoise Group • ${branch?.name || 'Head Office'} • Generated ${new Date().toISOString()}`,
    105,
    285,
    { align: 'center' }
  );

  for(const photo of claim.evidence||[]){
    doc.addPage();doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor(...primaryColor);doc.text('Damage evidence · '+claim.cnRef,14,20);
    const props=doc.getImageProperties(photo.dataUrl),scale=Math.min(180/props.width,180/props.height);doc.addImage(photo.dataUrl,'JPEG',14,32,props.width*scale,props.height*scale);
    const item=claim.items.find(i=>i.id===photo.lineId)?.description||photo.lineId;
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(doc.splitTextToSize(item+' · '+(photo.caption||'Photograph supplied with the invoice review.'),180),14,224);
  }
  const pdfOutput = doc.output('datauristring');
  const base64 = pdfOutput.split(',')[1] || '';
  const fileName = `Credit_Claim_${claim.cnRef}_${branch?.code || 'HT'}.pdf`;

  return { doc, base64, fileName };
}
