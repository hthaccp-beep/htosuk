/** Keep pixel dimensions; compress only derived copies, never the uploaded original. */
export function encodePreparedCanvas(canvas:Pick<HTMLCanvasElement,'toDataURL'>,maxBytes:number){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>3*1024*1024)throw new Error('Invalid section size limit.');
 for(const [mime,quality] of [['image/png',undefined],['image/jpeg',.92],['image/jpeg',.85],['image/jpeg',.75]] as const){
  const url=canvas.toDataURL(mime,quality);
  if(!url.startsWith(`data:${mime};base64,`))continue;
  const base64=url.slice(url.indexOf(',')+1),bytes=Uint8Array.from(atob(base64),v=>v.charCodeAt(0));
  if(bytes.length>0&&bytes.length<=maxBytes)return {base64,bytes,mime};
 }
 throw new Error('This photo still exceeds the reading limit. Retake it closer to the page, keeping all text visible. Your original is saved.');
}
