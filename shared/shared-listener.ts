// Share live subscriptions in memory, within a tab and between supported tabs.
export interface ListenerEnvironment {
 channel(name:string): {postMessage(value:any):void;close():void;onmessage:((event:any)=>void)|null};
 lock(name:string,signal:AbortSignal,run:()=>Promise<void>):Promise<unknown>;
}
type Sink<T>={next:(value:T)=>void;error:(error:any)=>void};
type Start<T>=(next:Sink<T>['next'],error:Sink<T>['error'])=>()=>void;
export function createSharedListeners(environment?:ListenerEnvironment){
 const clientId=crypto.randomUUID();
 const entries=new Map<string,{sinks:Set<Sink<any>>;last?:any;hasValue:boolean;failure?:any;stop:()=>void}>();
 return function subscribe<T>(key:string,start:Start<T>,next:Sink<T>['next'],error:Sink<T>['error']){
  const sink={next,error};let entry=entries.get(key);
  if(entry){entry.sinks.add(sink);if(entry.failure)error(entry.failure);else if(entry.hasValue)next(entry.last);}
  else {
   entry={sinks:new Set([sink]),hasValue:false,stop:()=>{}};entries.set(key,entry);
   const current=entry;let disposed=false,leader=false,stopSource=()=>{},release=()=>{};
   const epoch=crypto.randomUUID();let sequence=0,lastMessage:any;
   let channel:ReturnType<ListenerEnvironment['channel']>|undefined;
   const abort=new AbortController();
   const receive=(message:any)=>{
    if(disposed||(message.target&&message.target!==clientId))return;
    if(lastMessage?.epoch===message.epoch&&lastMessage.sequence>=message.sequence)return;
    lastMessage=message;
    if(message.type==='value'){current.last=message.value;current.hasValue=true;current.failure=undefined;for(const s of current.sinks)s.next(message.value);}
    if(message.type==='error'){current.failure=message.error;for(const s of current.sinks)s.error(message.error);}
   };
   const send=(value:any)=>{const message={...value,epoch,sequence:++sequence};receive(message);channel?.postMessage(message);};
   const startSource=()=>{if(disposed)return;stopSource=start(value=>send({type:'value',value}),err=>send({type:'error',error:{code:err?.code,message:err?.message||'Data could not be loaded.'}}));};
   const fallback=()=>{if(disposed)return;channel?.close();channel=undefined;startSource();};
   current.stop=()=>{disposed=true;abort.abort();stopSource();release();channel?.close();};
   if(environment){
    try{
     channel=environment.channel('htos-live-v1:'+key);
     channel.onmessage=({data})=>{
      if(data?.type==='request'&&leader&&lastMessage)channel?.postMessage({...lastMessage,target:data.clientId});
      else if(!leader&&(data?.type==='value'||data?.type==='error'))receive(data);
     };
     channel.postMessage({type:'request',clientId});
     void environment.lock('htos-live-v1:'+key,abort.signal,async()=>{
      if(disposed)return;
      leader=true;
      const held=new Promise<void>(resolve=>{release=resolve;});
      startSource();await held;leader=false;
     }).catch(err=>{if(err?.name!=='AbortError')fallback();});
    }catch{fallback();}
   }else startSource();
  }
  const current=entry;let stopped=false;
  return ()=>{if(stopped)return;stopped=true;current.sinks.delete(sink);if(!current.sinks.size){current.stop();entries.delete(key);}};
 };
}
