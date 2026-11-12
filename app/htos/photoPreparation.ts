import {prepareInvoiceRaster,resizeInvoiceRaster,rotateInvoiceRaster,invoicePhotoBands,type InvoiceRaster} from '../../shared/invoice-photo';
import type {PreparedInvoiceJob,PreparedInvoiceSection} from '../../server/invoice-section-jobs';
export interface PreparedPhoto {plan:PreparedInvoiceJob;previewUrl:string;originalUrl:string;originalBase64:string;warnings:string[];corners:unknown;rotation:number}
const digest=async(value:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('');
function canvas(r:InvoiceRaster){const c=document.createElement('canvas');c.width=r.width;c.height=r.height;c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data),r.width,r.height),0,0);return c;}
/** Browser decoding applies EXIF orientation. Originals and prepared pixels remain separate. */
export async function prepareInvoicePhoto(file:File,quarterTurns=0,retainWhole=false):Promise<PreparedPhoto>{
 if(!['image/jpeg','image/png'].includes(file.type)||file.size>3*1024*1024||file.size===0)throw new Error('Choose a JPEG or PNG up to 3 MB. PDF preparation is separate.');
 const originalBytes=new Uint8Array(await file.arrayBuffer()),documentHash=await digest(originalBytes),bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
 let raster:InvoiceRaster;
 try{if(bitmap.width*bitmap.height>20000000||bitmap.width<32||bitmap.height<32)throw new Error('Use a photo between 32 pixels and 20 megapixels.');const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bitmap,0,0);raster={width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};}finally{bitmap.close();}
 raster=resizeInvoiceRaster(raster);if(quarterTurns)raster=rotateInvoiceRaster(raster,(quarterTurns%4)*90);
 const prepared=retainWhole?{image:raster,corners:null,rotation:0,...invoicePhotoBands(raster),warnings:['Whole photo retained. Check orientation and section boundaries.']}:prepareInvoiceRaster(raster);
 const page=canvas(prepared.image),sections:PreparedInvoiceSection[]=[];
 const encode=async(id:string,kind:PreparedInvoiceSection['kind'],top:number,bottom:number)=>{
  const c=document.createElement('canvas');c.width=page.width;c.height=bottom-top;c.getContext('2d')!.drawImage(page,0,top,page.width,bottom-top,0,0,c.width,c.height);
  const base64=c.toDataURL('image/png').split(',')[1],data=Uint8Array.from(atob(base64),v=>v.charCodeAt(0));if(data.length>3*1024*1024)throw new Error('A prepared section is too large. Use a clearer photo with less background.');
  sections.push({id,kind,page:1,sha256:await digest(data),base64,width:c.width,height:c.height,reservePence:60});
 };
 await encode('header','header',0,page.height);
 for(const [i,band] of prepared.bands.entries())await encode('rows-'+(i+1),'rows',band.top,band.bottom);
 await encode('totals','totals',0,page.height);
 const overlay=canvas(prepared.image),ctx=overlay.getContext('2d')!;ctx.strokeStyle='#b65b12';ctx.lineWidth=Math.max(1,page.width/450);ctx.setLineDash([8,5]);for(const band of prepared.bands.slice(0,-1)){ctx.beginPath();ctx.moveTo(0,band.bottom);ctx.lineTo(page.width,band.bottom);ctx.stroke();}
 let binary='';for(let i=0;i<originalBytes.length;i+=8192)binary+=String.fromCharCode(...originalBytes.subarray(i,i+8192));
 return {plan:{documentHash,revision:'photo-sections-v1',sections,confirmed:false},previewUrl:overlay.toDataURL('image/png'),originalUrl:URL.createObjectURL(file),originalBase64:btoa(binary),warnings:prepared.warnings,corners:prepared.corners,rotation:quarterTurns%4};
}
