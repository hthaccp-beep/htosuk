import {HELP_IMAGE_LIMIT} from '../../shared/help';
import type {HelpImage} from '../../shared/help';
export async function prepareHelpImage(file:File):Promise<HelpImage>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5_000_000)throw new Error('Choose PNG, JPEG or WebP screenshots up to 5 MB each.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40_000_000)throw new Error('This image is too large. Crop the screenshot first.');
    const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Screenshot processing is unavailable in this browser.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    for(const quality of [0.85,0.7,0.55,0.4]){
      const data=canvas.toDataURL('image/jpeg',quality).split(',')[1];
      if(data&&Math.ceil(data.length*3/4)<=HELP_IMAGE_LIMIT)return {mimeType:'image/jpeg',data};
    }
    throw new Error('The screenshot is too detailed. Crop to the problem area and try again.');
  }catch(error){if(error instanceof Error&&error.name!=='EncodingError')throw error;throw new Error('This screenshot could not be read. Choose another image.');}
  finally{URL.revokeObjectURL(url);}
}
