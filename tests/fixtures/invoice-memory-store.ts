/** Isolated Firestore-shaped store for offline tests/preview. No Firebase initialisation. */
export function invoiceMemoryStore(initial:Iterable<[string,any]>,persist?:(entries:[string,any][])=>void){
 const data=new Map<string,any>(structuredClone([...initial])),reads:string[]=[];let serial=Promise.resolve();
 const snap=(path:string)=>{reads.push(path);return {exists:data.has(path),data:()=>structuredClone(data.get(path))};};
 const doc=(path:string):any=>({path,get:async()=>snap(path),collection:(n:string)=>coll(path+'/'+n)});
 const coll=(path:string):any=>({doc:(id:string)=>doc(path+'/'+id)});
 const db={collection:coll,runTransaction:async(fn:any)=>{
  const p=serial.then(async()=>{const writes:[string,any][]=[];const result=await fn({get:async(r:any)=>{if(writes.length)throw Error('Transaction reads must precede writes.');return snap(r.path);},set:(r:any,v:any)=>writes.push([r.path,structuredClone(v)])});
   if(writes.length){const next=new Map(data);for(const [p,v] of writes)next.set(p,v);persist?.([...next]);for(const [p,v] of writes)data.set(p,v);}return result;
  });serial=p.then(()=>undefined,()=>undefined);return p;
 }};
 return {db,data,reads};
}
