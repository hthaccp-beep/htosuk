import { jsPDF } from 'jspdf';
import { pdfFonts } from './pdfFonts.ts';

export const pdfForest:[number,number,number]=[23,58,49];
export const pdfInk:[number,number,number]=[33,59,53];
export const pdfMuted:[number,number,number]=[82,105,91];

/** Embed HTOS's typeface so downloads and email attachments work offline. */
export function createHtosPdf():jsPDF {
  const doc=new jsPDF({unit:'mm',format:'a4'});
  for(const [style,data] of Object.entries(pdfFonts)){
    doc.addFileToVFS(`DMSans-${style}.ttf`,data);
    doc.addFont(`DMSans-${style}.ttf`,'DMSans',style);
  }
  const setFont=doc.setFont.bind(doc);
  doc.setFont=((name:string,style='normal',weight?:number|string)=>setFont(name.toLowerCase()==='helvetica'?'DMSans':name,style==='italic'?'normal':style,weight)) as typeof doc.setFont;
  doc.setFont('DMSans','normal');
  doc.setTextColor(...pdfInk);
  doc.setDrawColor(...pdfForest);
  return doc;
}
