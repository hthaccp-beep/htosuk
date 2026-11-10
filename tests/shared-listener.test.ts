import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedListeners,type ListenerEnvironment} from '../shared/shared-listener.ts';

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function platform(){
 const buses=new Map<string,Set<any>>(),queues=new Map<string,any[]>(),held=new Set<string>();
 const drain=(name:string)=>{
  if(held.has(name))return;const queue=queues.get(name)||[];let item=queue.shift();
  while(item?.signal.aborted){item.reject({name:'AbortError'});item=queue.shift();}if(!item)return;
  held.add(name);Promise.resolve().then(item.run).then(item.resolve,item.reject).finally(()=>{held.delete(name);drain(name);});
 };
 const env:ListenerEnvironment={channel(name){const group=buses.get(name)||new Set();buses.set(name,group);const channel:any={onmessage:null,postMessage(data:any){for(const other of group)if(other!==channel)queueMicrotask(()=>{if(group.has(other))other.onmessage?.({data:structuredClone(data)});});},close(){group.delete(channel);}};group.add(channel);return channel;},lock(name,signal,run){return new Promise((resolve,reject)=>{const list=queues.get(name)||[];queues.set(name,list);list.push({signal,run,resolve,reject});drain(name);});}};
 return {env,held,buses};
}
function source(){let reads=0,stops=0;const active=new Set<any>();return {get reads(){return reads;},get stops(){return stops;},start(next:any,error:any){reads++;const sink={next,error};active.add(sink);next([{id:'p',price:10}]);return()=>{stops++;active.delete(sink);};},update(value:any){for(const sink of active)sink.next(value);},fail(value:any){for(const sink of active)sink.error(value);}};}

test('same-tab subscribers share one source and release after the final consumer',()=>{
 const subscribe=createSharedListeners(),s=source(),a:any[]=[],b:any[]=[];
 const stopA=subscribe('user/query',s.start,v=>a.push(v),assert.fail),stopB=subscribe('user/query',s.start,v=>b.push(v),assert.fail);
 assert.equal(s.reads,1);assert.deepEqual(a,b);stopA();assert.equal(s.stops,0);s.update([{id:'p',price:12}]);assert.equal(b.length,2);stopB();assert.equal(s.stops,1);
});
test('sixteen same-user tabs use one live source and all receive updates',async()=>{
 const p=platform(),s=source(),values:any[][]=Array.from({length:16},()=>[]);
 const stops=values.map(out=>createSharedListeners(p.env)('user/branches',s.start,v=>out.push(v),assert.fail));await flush();
 assert.equal(s.reads,1);for(const out of values)assert.equal(out.length,1);
 s.update([{id:'branch',name:'Updated'}]);await flush();for(const out of values)assert.equal(out.at(-1)[0].name,'Updated');
 stops.forEach(stop=>stop());await flush();assert.equal(s.stops,1);assert.equal(p.held.size,0);
});
test('late follower receives current data without another Firebase query',async()=>{
 const p=platform(),s=source();const a=createSharedListeners(p.env),b=createSharedListeners(p.env);
 const stopA=a('u/products',s.start,()=>{},assert.fail);await flush();s.update([{price:20}]);const values:any[]=[];
 const stopB=b('u/products',s.start,v=>values.push(v),assert.fail);await flush();assert.equal(values.at(-1)[0].price,20);assert.equal(s.reads,1);stopA();stopB();await flush();
});
test('closing the owner transfers ownership once and preserves live updates',async()=>{
 const p=platform(),s=source(),values:any[]=[];const a=createSharedListeners(p.env),b=createSharedListeners(p.env);
 const stopA=a('u/orders',s.start,()=>{},assert.fail),stopB=b('u/orders',s.start,v=>values.push(v),assert.fail);await flush();stopA();await flush();
 assert.equal(s.reads,2);assert.equal(s.stops,1);s.update([{id:'new-order'}]);await flush();assert.equal(values.at(-1)[0].id,'new-order');stopB();await flush();
});
test('a closed follower never starts a queued source or receives late data',async()=>{
 const p=platform(),s=source();let followerCalls=0;
 const stopA=createSharedListeners(p.env)('u/orders',s.start,()=>{},assert.fail);await flush();
 const stopB=createSharedListeners(p.env)('u/orders',s.start,()=>followerCalls++,assert.fail);stopB();await flush();stopA();await flush();
 assert.equal(s.reads,1);assert.equal(followerCalls,0);
});
test('users, scopes and query keys never share business data',async()=>{
 const p=platform(),s=source();const stops=['u1/a/products','u1/b/products','u2/a/products','u1/a/orders'].map(key=>createSharedListeners(p.env)(key,s.start,()=>{},assert.fail));await flush();assert.equal(s.reads,4);stops.forEach(stop=>stop());await flush();
});
test('quota errors propagate once to followers without reconnect loops',async()=>{
 const p=platform(),s=source(),errors:any[]=[];const stops=[0,1].map(()=>createSharedListeners(p.env)('u/products',s.start,()=>{},e=>errors.push(e)));await flush();
 s.fail({code:'resource-exhausted',message:'Quota exceeded'});await flush();assert.equal(errors.length,2);assert.equal(s.reads,1);assert.ok(errors.every(e=>e.code==='resource-exhausted'));
 stops.forEach(stop=>stop());await flush();
});
test('restricted browser capabilities fall back to an ordinary live listener',async()=>{
 const p=platform(),s=source(),env={...p.env,lock:async()=>{throw new Error('Unavailable');}};
 const stop=createSharedListeners(env)('u/products',s.start,()=>{},assert.fail);await flush();assert.equal(s.reads,1);stop();assert.equal(s.stops,1);
});
