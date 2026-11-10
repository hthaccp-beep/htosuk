import {orderReference} from '../shared/order-reference.ts';
import type { OrderRecord } from '../types.ts';
import { createHtosPdf,pdfForest,pdfInk,pdfMuted } from './pdfTheme.ts';
import {validCalendarDate} from '../shared/calendar-date.ts';

/** Emphasised order summary; existing three-column item geometry is preserved. */
export function generatePackingSlipPDF(order:OrderRecord,receiverName:string):string {
  const doc=createHtosPdf(),px=25.4/96;
  // Original @page 10mm, body 8px margin and 40px padding.
  const left=10+48*px,right=210-left,width=right-left,gap=40*px,col=(width-2*gap)/3;
  const items=[...order.items.map(i=>({name:i.productNameSnapshot,qty:quantity(i)})),...(order.manualItems||[]).map(i=>({name:i.description+' (Manual)',qty:quantity(i)}))];
  function quantity(i:{caseQty:number;packQty:number}){return [i.caseQty>0?`${i.caseQty} Box`:'',i.packQty>0?`${i.packQty} Pack`:''].filter(Boolean).join(' ');}
  const date=new Date(order.createdAt),bottom=297-left;
  let y=left;
  const header=()=>{
    doc.setTextColor(...pdfForest);doc.setFont('DMSans','black');doc.setFontSize(17);
    doc.text('PACKING SLIP',left,y+7);
    doc.setFont('DMSans','bold');doc.setFontSize(12);
    doc.text('ORDER #'+orderReference(order.id),right,y+7,{align:'right'});
    y+=7+20*px;
    doc.setDrawColor(...pdfForest);doc.setLineWidth(3*px);doc.line(left,y,right,y);
    y+=5;
    const panelGap=4,branchWidth=(width-panelGap)*.53,deliveryX=left+branchWidth+panelGap;
    const delivery=validCalendarDate(order.deliveryDate)
      ?new Date(order.deliveryDate+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'})
      :order.deliveryDate||'ASAP';
    const panels=[{label:'ORDERING BRANCH',value:order.branchNameSnapshot,x:left,w:branchWidth},
      {label:'DELIVERY DATE',value:delivery,x:deliveryX,w:right-deliveryX}];
    doc.setFont('DMSans','bold');doc.setFontSize(17);
    const wrapped=panels.map(panel=>({...panel,lines:doc.splitTextToSize(panel.value,panel.w-10) as string[]}));
    const lineHeight=17*25.4/72*1.15,panelHeight=16+Math.max(...wrapped.map(panel=>panel.lines.length))*lineHeight;
    for(const panel of wrapped){
      doc.setFillColor(239,243,232);doc.setDrawColor(192,207,187);doc.setLineWidth(.25);
      doc.roundedRect(panel.x,y,panel.w,panelHeight,2,2,'FD');
      doc.setTextColor(...pdfMuted);doc.setFontSize(8.5);doc.text(panel.label,panel.x+5,y+7);
      doc.setTextColor(...pdfForest);doc.setFontSize(17);doc.text(panel.lines,panel.x+5,y+15,{lineHeightFactor:1.15});
    }
    y+=panelHeight+6;
    const metadata=[{label:'ORDERED BY',value:order.orderedByNameSnapshot,x:left,w:branchWidth},
      {label:'ORDER PLACED',value:date.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'}),x:deliveryX,w:right-deliveryX}];
    let metadataHeight=0;
    for(const field of metadata){
      doc.setFont('DMSans','bold');doc.setFontSize(8);doc.setTextColor(...pdfMuted);doc.text(field.label,field.x,y);
      doc.setFont('DMSans','normal');doc.setFontSize(10);doc.setTextColor(...pdfInk);
      const lines=doc.splitTextToSize(field.value,field.w) as string[];
      doc.text(lines,field.x,y+5,{lineHeightFactor:1.2});
      metadataHeight=Math.max(metadataHeight,5+lines.length*10*25.4/72*1.2);
    }
    y+=metadataHeight+3;
    doc.setDrawColor(192,207,187);doc.setLineWidth(px);doc.line(left,y,right,y);
    y+=30*px;
  };
  header();
  for(let start=0;start<items.length;start+=3){
    doc.setFontSize(8.25);
    const row=items.slice(start,start+3).map(item=>{doc.setFont('DMSans','bold');const qw=doc.getTextWidth(item.qty);return {...item,lines:doc.splitTextToSize(item.name,Math.max(col-qw-10*px,15)) as string[],qw};});
    const height=Math.max(...row.map(i=>i.lines.length))*11*1.2*px;
    if(y+height+2*px>bottom){doc.addPage();y=left;}
    row.forEach((item,index)=>{
      const x=left+index*(col+gap);doc.setFont('DMSans','bold');doc.setTextColor(...pdfInk);doc.text(item.lines,x,y+height-.5-(item.lines.length-1)*11*1.2*px,{lineHeightFactor:1.2});
      doc.text(item.qty,x+col,y+height-.5,{align:'right'});
      doc.setLineDashPattern([px,px],0);doc.setDrawColor(114,128,120);doc.setLineWidth(px);doc.line(x,y+height+2*px,x+col,y+height+2*px);doc.setLineDashPattern([],0);
    });
    y+=height+2*px+15*px;
  }
  y+=40*px;
  if(y+10>bottom){doc.addPage();y=left;}
  doc.setDrawColor(228,232,223);doc.setLineWidth(px);doc.line(left,y,right,y);
  doc.setFont('DMSans','normal');doc.setFontSize(7.5);doc.setTextColor(...pdfMuted);
  doc.text(`Internal Use Only - ${order.branchNameSnapshot} to ${receiverName}`,105,y+10*px+2,{align:'center',maxWidth:width});
  return doc.output('datauristring').split(',')[1];
}
