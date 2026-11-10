import type {InvoiceEvidence} from '../../types';
export async function damagePhoto(file:File,lineId:string):Promise<InvoiceEvidence>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw new Error('Choose a JPG, PNG or WebP photograph under 15 MB.');
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('This photograph could not be opened.'));img.src=url;});
  const canvas=document.createElement('canvas'),scale=Math.min(1,1200/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);
  let dataUrl=canvas.toDataURL('image/jpeg',.75);
  for(let quality=.65;dataUrl.length>120000&&quality>=.25;quality-=.1)dataUrl=canvas.toDataURL('image/jpeg',quality);
  if(dataUrl.length>120000)throw new Error('Crop the photograph to the damage and try again.');
  return {id:crypto.randomUUID(),lineId,fileName:'damage-photo.jpg',dataUrl,caption:''};
 }finally{URL.revokeObjectURL(url);}
}
