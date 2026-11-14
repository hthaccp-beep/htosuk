import {detectInvoicePage,rectifyInvoicePage,resizeInvoiceRaster,rotateInvoiceRaster,invoicePhotoBands,type InvoiceRaster,type PhotoPoint} from './invoice-photo.ts';

export interface ScanOptions {quarterTurns:number;angle:number;shadowReduction:boolean;crop:'auto'|'whole'|'manual';corners?:PhotoPoint[]}
export interface ScanFlag {code:string;title:string;action:string}
export const defaultScanOptions:ScanOptions={quarterTurns:0,angle:0,shadowReduction:true,crop:'auto'};
export const wholePageCorners=():PhotoPoint[]=>[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
const luminance=(r:InvoiceRaster,x:number,y:number)=>{const i=(y*r.width+x)*4;return r.data[i+3]<128?255:(r.data[i]*299+r.data[i+1]*587+r.data[i+2]*114)/1000;};

/** Reject crossed, reversed, tiny or collapsed crops before allocating output pixels. */
export function validateScanCorners(points:PhotoPoint[]){
 if(points.length!==4||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))throw new Error('Keep all four corners inside the photo.');
 for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];if((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)<.002)throw new Error('Keep the corners in order around the page; do not cross the crop edges.');}
 const area=points.reduce((n,p,i)=>n+p.x*points[(i+1)%4].y-p.y*points[(i+1)%4].x,0)/2;
 if(area<.08)throw new Error('The crop is too small. Include the whole document, including its heading and totals.');
}

/** Local illumination correction, not text reconstruction. Dark ink stays dark; gain is capped. */
export function reduceInvoiceShadows(source:InvoiceRaster):InvoiceRaster{
 const r=resizeInvoiceRaster(source),cell=64,cols=Math.ceil(r.width/cell),rows=Math.ceil(r.height/cell),background=new Float64Array(cols*rows);
 for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
  const histogram=new Uint32Array(256);let n=0;
  for(let y=gy*cell;y<Math.min(r.height,(gy+1)*cell);y+=2)for(let x=gx*cell;x<Math.min(r.width,(gx+1)*cell);x+=2){histogram[Math.round(luminance(r,x,y))]++;n++;}
  let count=0,value=255;for(let i=0;i<256;i++){count+=histogram[i];if(count>=n*.9){value=i;break;}}background[gy*cols+gx]=value;
 }
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
  const fx=Math.max(0,Math.min(cols-1,x/cell-.5)),fy=Math.max(0,Math.min(rows-1,y/cell-.5)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(cols-1,x0+1),y1=Math.min(rows-1,y0+1),dx=fx-x0,dy=fy-y0;
  const light=(background[y0*cols+x0]*(1-dx)+background[y0*cols+x1]*dx)*(1-dy)+(background[y1*cols+x0]*(1-dx)+background[y1*cols+x1]*dx)*dy;
  const gain=Math.min(1.7,Math.max(1,245/Math.max(1,light))),p=(y*r.width+x)*4;
  for(let c=0;c<3;c++)r.data[p+c]=Math.min(255,r.data[p+c]*gain);
 }
 return r;
}

/** Conservative warnings only. These metrics cannot certify legibility or recognise invoice details. */
export function invoiceScanFlags(r:InvoiceRaster):ScanFlag[]{
 const flags:ScanFlag[]=[],hist=new Uint32Array(256);let n=0,lap=0,ink=0,edgeInk=0,edgeN=0;
 for(let y=2;y<r.height-2;y+=2)for(let x=2;x<r.width-2;x+=2){
  const v=luminance(r,x,y);hist[Math.round(v)]++;n++;if(v<170)ink++;
  const d=4*v-luminance(r,x-1,y)-luminance(r,x+1,y)-luminance(r,x,y-1)-luminance(r,x,y+1);lap+=Math.min(400,d*d);
  if(x<r.width*.015||x>r.width*.985||y<r.height*.015||y>r.height*.985){edgeN++;if(v<120)edgeInk++;}
 }
 const percentile=(q:number)=>{let total=0;for(let i=0;i<256;i++){total+=hist[i];if(total>=n*q)return i;}return 255;};
 if(Math.min(r.width,r.height)<700)flags.push({code:'small',title:'Small image',action:'Zoom in on the smallest figures. Retake closer if they are hard to read.'});
 if(percentile(.98)-percentile(.02)<35)flags.push({code:'contrast',title:'Little visible detail',action:'Check for a blank page, glare or faint text. Retake if any figures are missing.'});
 if(ink/n>.002&&lap/n<6)flags.push({code:'blur',title:'Possible blur',action:'Check product names and decimal points at full size. Blur cannot be repaired here.'});
 const lights:number[]=[];
 for(let gy=0;gy<4;gy++)for(let gx=0;gx<4;gx++){
  const values:number[]=[];for(let y=Math.floor(r.height*(.05+gy*.225));y<r.height*(.05+(gy+1)*.225);y+=8)for(let x=Math.floor(r.width*(.05+gx*.225));x<r.width*(.05+(gx+1)*.225);x+=8)values.push(luminance(r,x,y));
  values.sort((a,b)=>a-b);lights.push(values[Math.floor(values.length*.85)]??255);
 }
 if(percentile(.85)<195||(Math.min(...lights)<195&&Math.max(...lights)-Math.min(...lights)>50))flags.push({code:'shadow',title:'Dark page or shadow',action:'Try Reduce shadows. Retake if text is still covered or unreadable.'});
 if(edgeN&&edgeInk/edgeN>.035)flags.push({code:'edge',title:'Check page edges',action:'Text or a dark border reaches the edge. Widen the crop; include the heading and totals.'});
 return flags;
}

export function prepareInvoiceScan(original:InvoiceRaster,options:ScanOptions=defaultScanOptions){
 if(!Number.isInteger(options.quarterTurns)||!Number.isFinite(options.angle)||Math.abs(options.angle)>10||!['auto','whole','manual'].includes(options.crop))throw new Error('Choose a valid crop and a straightening angle between −10° and 10°.');
 let source=resizeInvoiceRaster(original);const turns=((options.quarterTurns%4)+4)%4;if(turns)source=rotateInvoiceRaster(source,turns*90);
 const detected=options.crop==='auto'?detectInvoicePage(source):null;
 const corners=options.crop==='manual'?options.corners:detected?.map(p=>({x:p.x/(source.width-1),y:p.y/(source.height-1)}));
 if(options.crop==='manual'&&!corners)throw new Error('Choose all four page corners.');
 if(corners)validateScanCorners(corners);
 let image=corners?rectifyInvoicePage(source,corners.map(p=>({x:p.x*(source.width-1),y:p.y*(source.height-1)}))):source;
 const beforeFlags=invoiceScanFlags(image);
 if(options.shadowReduction)image=reduceInvoiceShadows(image);
 const flags=invoiceScanFlags(image);
 // Do not hide a blur warning just because contrast/brightness changed.
 for(const flag of beforeFlags.filter(f=>f.code==='blur'))if(!flags.some(f=>f.code===flag.code))flags.push(flag);
 if(options.crop==='auto'&&!detected)flags.unshift({code:'crop',title:'Page edges need checking',action:'Automatic cropping was unsure. Adjust the four corners or keep the whole photo.'});
 if(options.crop==='auto'&&detected)flags.unshift({code:'crop',title:'Check the suggested crop',action:'Compare with the original. Shadows can hide page edges; widen the crop if any text is missing.'});
 if(options.angle)image=resizeInvoiceRaster(rotateInvoiceRaster(image,options.angle));
 const sections=invoicePhotoBands(image);
 if(sections.warnings.length)flags.push({code:'sections',title:'Check section lines',action:'An orange line may cross text. The full page is retained alongside the sections.'});
 return {source,image,corners:corners||wholePageCorners(),flags,bands:sections.bands};
}

export function canSaveInvoiceScan(state:{busy:boolean;disabled:boolean;changed:boolean;confirmed:boolean;readable:boolean;checked:boolean;hasPreview:boolean}){
 return state.hasPreview&&!state.busy&&!state.disabled&&!state.changed&&!state.confirmed&&state.readable&&state.checked;
}
