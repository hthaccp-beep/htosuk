import { jsPDF } from 'jspdf';

export type DocumentCard={title:string;lines:string[];warning?:boolean};
export type DocumentSpec={title:string;reference:string;fields:[string,string][];cards:DocumentCard[];notes?:string;summary?:string;footer?:string};
const forest:[number,number,number]=[23,58,49],sage:[number,number,number]=[229,237,222],muted:[number,number,number]=[82,105,91];
// All downloadable/emailed order documents use this A4, three-column renderer.
export function renderHtosDocument(spec:DocumentSpec):jsPDF {
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const margin=12,width=186,gap=3,col=(width-gap*2)/3,bottom=277;
  let y=0;
  const unicode=/[^\u0000-\u00ff]/;
  const canvas=typeof document!=='undefined'?document.createElement('canvas'):undefined;
  const context=canvas?.getContext('2d');
  const wrap=(value:string,limit:number,size=8):string[]=>{
    const text=String(value||'').replace(/[\u2010-\u2015]/g,'-');
    doc.setFontSize(size);doc.setFont('helvetica','normal');
    if(!unicode.test(text)||!context)return doc.splitTextToSize(text,limit);
    context.font=`${size*4/3}px Arial, "Microsoft YaHei", sans-serif`;
    const lines:string[]=[];let line='';
    for(const char of text){if(char==='\n'){lines.push(line);line='';continue;}if(line&&context.measureText(line+char).width>limit*96/25.4){lines.push(line);line=char;}else line+=char;}
    if(line)lines.push(line);return lines;
  };
  const text=(line:string,x:number,at:number,size=8,bold=false,color: [number,number,number]=forest)=>{
    doc.setFontSize(size);doc.setFont('helvetica',bold?'bold':'normal');doc.setTextColor(...color);
    if(unicode.test(line)&&canvas&&context){
      const scale=3,font=`${bold?'bold ':''}${size*4/3}px Arial, "Microsoft YaHei", sans-serif`;
      context.font=font;const w=Math.ceil(context.measureText(line).width)+2,h=Math.ceil(size*4/3*1.5);
      canvas.width=w*scale;canvas.height=h*scale;context.scale(scale,scale);context.font=font;context.fillStyle=`rgb(${color.join(',')})`;context.textBaseline='alphabetic';context.fillText(line,0,size*4/3);
      doc.addImage(canvas.toDataURL('image/png'),'PNG',x,at-size*25.4/72,w*25.4/96,h*25.4/96);
    }else doc.text(line,x,at);
  };
  const header=(continuation=false)=>{
    doc.setFillColor(...forest);doc.rect(0,0,210,23,'F');
    text(spec.title,margin,14,16,true,[255,255,255]);
    text('#'+spec.reference,150,14,9,false,[222,234,213]);
    y=31;
    if(continuation){text('CONTINUED',margin,y,8,true,muted);y+=7;}
  };
  const nextPage=()=>{doc.addPage();header(true);};
  const linesBlock=(lines:string[],x:number,size=8)=>{for(const line of lines){if(y+4>bottom)nextPage();text(line,x,y,size);y+=4;}};
  header();
  for(let offset=0;offset<spec.fields.length;offset+=3){
    const row=spec.fields.slice(offset,offset+3).map(([label,value])=>({label,lines:wrap(value,col-6,8)}));
    const height=Math.max(...row.map(f=>f.lines.length))*4+12;
    if(y+height>bottom)nextPage();
    row.forEach((field,index)=>{const x=margin+index*(col+gap);doc.setFillColor(...sage);doc.roundedRect(x,y,col,height,2,2,'F');text(field.label.toUpperCase(),x+3,y+5,6.5,true,muted);field.lines.forEach((line,i)=>text(line,x+3,y+10+i*4));});
    y+=height+3;
  }
  y+=4;text('ITEM DETAILS',margin,y,9,true);y+=5;
  for(let start=0;start<spec.cards.length;start+=3){
    const row=spec.cards.slice(start,start+3).map((card,index)=>({...card,titleLines:wrap(`${start+index+1}. ${card.title}`,col-8,8),bodyLines:card.lines.flatMap(line=>wrap(line,col-6,7.5))}));
    // Split exceptional long descriptions across pages without truncation.
    const content=row.map(card=>[...card.titleLines.map(line=>({line,bold:true})),...card.bodyLines.map(line=>({line,bold:false}))]);
    let lineOffset=0;const maxLines=Math.max(...content.map(lines=>lines.length));
    const lineHeight=3.6;
    if(y+maxLines*lineHeight+6>bottom&&maxLines*lineHeight+6<=bottom-38)nextPage();
    while(lineOffset<maxLines){
      if(y+14>bottom)nextPage();
      const count=Math.min(maxLines-lineOffset,Math.floor((bottom-y-6)/lineHeight));
      const height=count*lineHeight+6;
      row.forEach((card,index)=>{const entries=content[index].slice(lineOffset,lineOffset+count);if(!entries.length)return;const x=margin+index*(col+gap);doc.setDrawColor(192,207,187);doc.setLineWidth(.2);doc.roundedRect(x,y,col,height,1.5,1.5,'S');entries.forEach((entry,i)=>text(entry.line,x+3,y+5+i*lineHeight,entry.bold?8:7.5,entry.bold,card.warning?[157,69,40]:entry.bold?forest:muted));});
      lineOffset+=count;y+=height+3;if(lineOffset<maxLines)nextPage();
    }
  }
  if(spec.summary){y+=3;linesBlock(wrap(spec.summary,width,11),margin,11);y+=4;}
  if(spec.notes){y+=3;if(y+10>bottom)nextPage();text('NOTES',margin,y,8,true);y+=5;linesBlock(wrap(spec.notes,width,8),margin);}
  const pageCount=doc.getNumberOfPages();
  for(let page=1;page<=pageCount;page++){doc.setPage(page);doc.setDrawColor(192,207,187);doc.line(margin,282,198,282);text((spec.footer||'Please contact the ordering branch with any queries.').slice(0,125),margin,287,7,false,muted);text(`${page} / ${pageCount}`,186,292,7,false,muted);}
  return doc;
}
