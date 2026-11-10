import {createSharedListeners} from '../shared/shared-listener.ts';
import {firebaseConfig} from '../firebase-config';
// No persistent business-data cache on shared devices.
const environment=typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'&&navigator.locks ? {
 channel:(name:string)=>new BroadcastChannel(name),
 lock:(name:string,signal:AbortSignal,run:()=>Promise<void>)=>navigator.locks.request(name,{signal},run),
}:undefined;
const subscribe=createSharedListeners(environment);
// Release ownership before a tab is frozen or enters the back/forward cache.
// Restoring that tab reconnects its consumers using the current shared source.
let suspended=false;
const consumers=new Set<{pause:()=>void;resume:()=>void}>();
if(typeof window!=='undefined'){
 const pause=()=>{if(suspended)return;suspended=true;consumers.forEach(c=>c.pause());};
 const resume=()=>{if(!suspended)return;suspended=false;consumers.forEach(c=>c.resume());};
 window.addEventListener('pagehide',pause);
 window.addEventListener('pageshow',resume);
 document.addEventListener('freeze',pause);
 document.addEventListener('resume',resume);
}
export function shareFirestore<T>(scope:string,key:string,start:(next:(value:T)=>void,error:(error:any)=>void)=>()=>void,next:(value:T)=>void,error:(error:any)=>void){
 let stop:(()=>void)|undefined;
 const consumer={pause:()=>{stop?.();stop=undefined;},resume:()=>{if(!stop)stop=subscribe(JSON.stringify([firebaseConfig.projectId,scope,key]),start,next,error);}};
 consumers.add(consumer);if(!suspended)consumer.resume();
 return()=>{consumers.delete(consumer);consumer.pause();};
}
