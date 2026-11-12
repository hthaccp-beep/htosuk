/** Deterministic image preparation only. Never reconstructs text or replaces the original. */
export interface InvoiceRaster {width:number;height:number;data:Uint8ClampedArray}
export interface PhotoPoint {x:number;y:number}
export interface PhotoPreparation {image:InvoiceRaster;corners:PhotoPoint[]|null;rotation:number;bands:{top:number;bottom:number}[];warnings:string[]}
function validate(r:InvoiceRaster){if(!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<32||r.height<32||r.width*r.height>20000000||r.data.length!==r.width*r.height*4)throw new Error('Choose a readable photo up to 20 megapixels.');}
const grey=(r:InvoiceRaster,x:number,y:number)=>{const i=(y*r.width+x)*4;return r.data[i+3]<128?255:(r.data[i]*299+r.data[i+1]*587+r.data[i+2]*114)/1000;};
const distance=(a:PhotoPoint,b:PhotoPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
function sample(r:InvoiceRaster,x:number,y:number,out:Uint8ClampedArray,i:number){
 if(x<0||y<0||x>r.width-1||y>r.height-1){out[i]=out[i+1]=out[i+2]=out[i+3]=255;return;}
 const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,r.width-1),y1=Math.min(y0+1,r.height-1),fx=x-x0,fy=y-y0;
 for(let c=0;c<3;c++)out[i+c]=(r.data[(y0*r.width+x0)*4+c]*(1-fx)+r.data[(y0*r.width+x1)*4+c]*fx)*(1-fy)+(r.data[(y1*r.width+x0)*4+c]*(1-fx)+r.data[(y1*r.width+x1)*4+c]*fx)*fy;
 out[i+3]=255;
}
export function resizeInvoiceRaster(r:InvoiceRaster,maxSide=2400):InvoiceRaster{
 validate(r);if(!Number.isInteger(maxSide)||maxSide<64||maxSide>3000)throw new Error('Invalid preparation size.');
 const scale=Math.min(1,maxSide/Math.max(r.width,r.height)),width=Math.max(32,Math.round(r.width*scale)),height=Math.max(32,Math.round(r.height*scale)),data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)sample(r,x*(r.width-1)/(width-1),y*(r.height-1)/(height-1),data,(y*width+x)*4);
 return {width,height,data};
}
/** Detect a single separated light page. Uncertain/clipped boundaries retain the whole photo. */
export function detectInvoicePage(r:InvoiceRaster):PhotoPoint[]|null{
 validate(r);const small=resizeInvoiceRaster(r,360),w=small.width,h=small.height,seen=new Uint8Array(w*h);let largest:number[]=[],secondSize=0;
 for(let start=0;start<w*h;start++){
  if(seen[start]||grey(small,start%w,Math.floor(start/w))<220)continue;
  const queue=[start];seen[start]=1;
  for(let k=0;k<queue.length;k++){
   const n=queue[k],x=n%w,y=Math.floor(n/w);
   for(const next of [x>0?n-1:-1,x<w-1?n+1:-1,y>0?n-w:-1,y<h-1?n+w:-1])if(next>=0&&!seen[next]&&grey(small,next%w,Math.floor(next/w))>=220){seen[next]=1;queue.push(next);}
  }
  if(queue.length>largest.length){secondSize=largest.length;largest=queue;}else secondSize=Math.max(secondSize,queue.length);
 }
 if(largest.length<w*h*.25||secondSize>largest.length*.15||largest.some(n=>n%w<=1||n%w>=w-2||Math.floor(n/w)<=1||Math.floor(n/w)>=h-2))return null;
 const pts=largest.map(n=>({x:n%w,y:Math.floor(n/w)}));
 const extreme=(score:(p:PhotoPoint)=>number)=>pts.reduce((a,b)=>score(b)<score(a)?b:a);
 const corners=[extreme(p=>p.x+p.y),extreme(p=>p.y-p.x),extreme(p=>-p.x-p.y),extreme(p=>p.x-p.y)];
 const area=Math.abs(corners.reduce((s,p,i)=>s+p.x*corners[(i+1)%4].y-p.y*corners[(i+1)%4].x,0))/2;
 if(area<w*h*.25||largest.length/area<.72||corners.some((p,i)=>distance(p,corners[(i+1)%4])<Math.min(w,h)*.2))return null;
 // Include a small outside margin rather than clipping text near a detected edge.
 const cx=corners.reduce((s,p)=>s+p.x,0)/4,cy=corners.reduce((s,p)=>s+p.y,0)/4;
 return corners.map(p=>({x:Math.max(0,Math.min(r.width-1,(cx+(p.x-cx)*1.025)*(r.width-1)/(w-1))),y:Math.max(0,Math.min(r.height-1,(cy+(p.y-cy)*1.025)*(r.height-1)/(h-1)))}));
}
export function rectifyInvoicePage(r:InvoiceRaster,p:PhotoPoint[]):InvoiceRaster{
 validate(r);if(p.length!==4||p.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<0||v.y<0||v.x>=r.width||v.y>=r.height))throw new Error('Invalid page corners.');
 const width=Math.max(32,Math.round(Math.max(distance(p[0],p[1]),distance(p[3],p[2])))),height=Math.max(32,Math.round(Math.max(distance(p[0],p[3]),distance(p[1],p[2]))));
 if(width*height>20000000)throw new Error('Prepared page is too large.');
 const dx1=p[1].x-p[2].x,dx2=p[3].x-p[2].x,sx=p[0].x-p[1].x+p[2].x-p[3].x,dy1=p[1].y-p[2].y,dy2=p[3].y-p[2].y,sy=p[0].y-p[1].y+p[2].y-p[3].y,den=dx1*dy2-dx2*dy1;
 if(Math.abs(den)<1)throw new Error('Page corners are too close together.');
 const g=(sx*dy2-dx2*sy)/den,h=(dx1*sy-sx*dy1)/den,a=p[1].x-p[0].x+g*p[1].x,b=p[3].x-p[0].x+h*p[3].x,d=p[1].y-p[0].y+g*p[1].y,e=p[3].y-p[0].y+h*p[3].y;
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const u=x/(width-1),v=y/(height-1),z=g*u+h*v+1;if(!Number.isFinite(z)||Math.abs(z)<.01)throw new Error('Invalid perspective.');sample(r,(a*u+b*v+p[0].x)/z,(d*u+e*v+p[0].y)/z,data,(y*width+x)*4);}
 return resizeInvoiceRaster({width,height,data});
}
export function rotateInvoiceRaster(r:InvoiceRaster,degrees:number):InvoiceRaster{
 validate(r);if(!Number.isFinite(degrees)||Math.abs(degrees)>360)throw new Error('Invalid rotation.');
 const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),width=Math.ceil(Math.abs(r.width*c)+Math.abs(r.height*s)-1e-8),height=Math.ceil(Math.abs(r.height*c)+Math.abs(r.width*s)-1e-8),data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=x-(width-1)/2,dy=y-(height-1)/2;sample(r,c*dx+s*dy+(r.width-1)/2,-s*dx+c*dy+(r.height-1)/2,data,(y*width+x)*4);}
 return {width,height,data};
}
export function invoicePhotoBands(r:InvoiceRaster):{bands:{top:number;bottom:number}[];warnings:string[]}{
 validate(r);const ink=new Uint32Array(r.height),margin=Math.ceil(r.width*.025);
 for(let y=0;y<r.height;y++)for(let x=margin;x<r.width-margin;x+=2)if(grey(r,x,y)<170)ink[y]++;
 const bands:{top:number;bottom:number}[]=[],warnings:string[]=[];const count=Math.max(1,Math.ceil(r.height/520));let top=0;
 for(let part=1;part<count;part++){
  const target=Math.round(r.height*part/count);let cut=target,best=Infinity;
  for(let y=Math.max(top+40,target-70);y<Math.min(r.height-40,target+70);y++){
   let score=0;for(let j=-2;j<=2;j++)score+=ink[y+j];
   if(score<best){best=score;cut=y;}
  }
  if(best>Math.max(3,r.width*.015))warnings.push('A section boundary may cross text. Check the preview or retain the whole page.');
  bands.push({top,bottom:cut});top=cut;
 }
 bands.push({top,bottom:r.height});return {bands,warnings:[...new Set(warnings)]};
}
export function prepareInvoiceRaster(original:InvoiceRaster):PhotoPreparation{
 validate(original);const scaled=resizeInvoiceRaster(original),corners=detectInvoicePage(scaled),image=corners?rectifyInvoicePage(scaled,corners):scaled;
 const sections=invoicePhotoBands(image);
 return {image,corners,rotation:0,bands:sections.bands,warnings:[...(corners?[]:['Page edges are unclear or clipped; the whole photo has been retained.']),...sections.warnings,'Check orientation, every item row and totals. Curved pages, blur and hidden text cannot be repaired automatically.']};
}
