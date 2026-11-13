/** Identify prepared raster bytes; never trust a filename or browser MIME label. */
export function preparedImageInfo(bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&String.fromCharCode(...bytes.subarray(12,16))==='IHDR'){
  return {mime:'image/png' as const,width:view.getUint32(16),height:view.getUint32(20)};
 }
 if(bytes.length<20||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new Error('Prepared image must be a complete PNG or JPEG.');
 let offset=2;
 while(offset+4<=bytes.length){
  if(bytes[offset++]!==255)break;
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];
  if(marker===218||marker===217)break;
  if(marker===1||marker>=208&&marker<=215)continue;
  if(offset+2>bytes.length)break;
  const length=view.getUint16(offset);
  if(length<2||offset+length>bytes.length)break;
  if([192,193,194].includes(marker)){
   if(length<8||bytes[offset+2]!==8)break;
   const components=bytes[offset+7];
   if(![1,3,4].includes(components)||length!==8+3*components)break;
   return {mime:'image/jpeg' as const,width:view.getUint16(offset+5),height:view.getUint16(offset+3)};
  }
  offset+=length;
 }
 throw new Error('Prepared image dimensions could not be verified.');
}
