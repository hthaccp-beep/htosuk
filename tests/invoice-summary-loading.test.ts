import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceSummaries,type SummaryProgress} from '../app/htos/loadInvoiceSummaries';
import {invoiceCaseAction} from '../server/invoice-case-service';
import {invoiceMemoryStore} from './fixtures/invoice-memory-store';
import {sampleOrder,sampleStaff} from './fixtures/invoice-workflow';
import {historyInvoiceStatus} from '../app/htos/historyInvoiceStatus';

const summary=(id:string)=>({id,receipt:'NOT_REPORTED' as const,status:null,documents:0});
const ids=Array.from({length:45},(_,i)=>'order-'+i);

test('statuses arrive progressively in bounded batches, preserving visible order and deduplicating',async()=>{
 const batches:string[][]=[],progress:SummaryProgress[]=[];
 await loadInvoiceSummaries(async body=>{
  if(batches.length)assert.equal(progress.length,batches.length,'previous batch published before next read');
  batches.push(body.orderIds);return {summaries:body.orderIds.map(summary)};
 },[...ids,ids[0]],new AbortController().signal,p=>progress.push(p));
 assert.deepEqual(batches.map(b=>b.length),[20,20,5]);
 assert.deepEqual(batches.flat(),ids);assert.deepEqual(progress.map(p=>p.completed),[20,40,45]);
 assert.equal(Object.keys(progress[0].summaries).length,20);
 assert.equal(historyInvoiceStatus(sampleOrder,summary(sampleOrder.id),true,true).label,'Not uploaded');
});

test('stuck batch times out, cancels its transport and retains completed statuses without retries',async()=>{
 const progress:SummaryProgress[]=[];let calls=0,lastSignal:AbortSignal|undefined;
 await assert.rejects(loadInvoiceSummaries(async (body,options)=>{
  calls++;lastSignal=options?.signal;
  if(calls===1)return {summaries:body.orderIds.map(summary)};
  return new Promise(()=>{});
 },ids,new AbortController().signal,p=>progress.push(p),15),/timed out/);
 assert.equal(calls,2);assert.equal(lastSignal?.aborted,true);
 assert.equal(progress.length,1);assert.equal(progress[0].completed,20);
 assert.equal(historyInvoiceStatus(sampleOrder,undefined,true,false).label,'Status unavailable');
});

test('changing filters cancels in-flight reads and ignores a late response',async()=>{
 const controller=new AbortController();let resolve:any,transport:AbortSignal|undefined,calls=0;
 const progress:SummaryProgress[]=[];
 const pending=loadInvoiceSummaries((body,options)=>{calls++;transport=options?.signal;return new Promise(r=>resolve=r);},ids,controller.signal,p=>progress.push(p));
 controller.abort();await assert.rejects(pending,{name:'AbortError'});
 resolve({summaries:ids.slice(0,20).map(summary)});await Promise.resolve();
 assert.equal(transport?.aborted,true);assert.equal(calls,1);assert.equal(progress.length,0);
});

test('already cancelled and empty lists make no requests; invalid responses cannot populate other orders',async()=>{
 let calls=0;const request=async()=>{calls++;return {summaries:[summary('foreign')]};};
 const controller=new AbortController();controller.abort();
 await assert.rejects(loadInvoiceSummaries(request,ids,controller.signal,()=>{}),{name:'AbortError'});
 await loadInvoiceSummaries(request,[],new AbortController().signal,()=>{});assert.equal(calls,0);
 await assert.rejects(loadInvoiceSummaries(request,ids,new AbortController().signal,()=>assert.fail('invalid progress')),/could not be read/);
 assert.equal(calls,1);
});

test('server uses at most five concurrent reads, preserves order and changes no records',async()=>{
 const wanted=ids.slice(0,12);
 const f=invoiceMemoryStore([['users/'+sampleStaff.id,sampleStaff],['settings/role_permissions',{map:{}}],...wanted.map(id=>['orders/'+id,{...sampleOrder,id}] as [string,any])]);
 const before=JSON.stringify([...f.data]);let active=0,peak=0;
 const db={...f.db,collection:(name:string)=>({doc:(id:string)=>({get:async()=>{
  active++;peak=Math.max(peak,active);
  try{await new Promise(r=>setTimeout(r,1));return await f.db.collection(name).doc(id).get();}finally{active--;}
 }})})};
 const result=await invoiceCaseAction(db,sampleStaff.id,{action:'invoice-case-receipt-summaries',orderIds:wanted},true);
 assert.equal(peak,5);assert.deepEqual(result.summaries.map((s:any)=>s.id),wanted);
 assert.equal(f.reads.filter(p=>p.startsWith('orders/')).length,12);
 assert.equal(f.reads.filter(p=>p.startsWith('_invoice_cases/')).length,12);
 assert.equal(JSON.stringify([...f.data]),before);
});

test('parallel batch never reads a foreign order’s private case or starts a later batch after denial',async()=>{
 const wanted=ids.slice(0,12);
 const f=invoiceMemoryStore([['users/'+sampleStaff.id,sampleStaff],['settings/role_permissions',{map:{}}],...wanted.map((id,i)=>['orders/'+id,{...sampleOrder,id,...(i===2?{branchId:'foreign'}:{})}] as [string,any])]);
 await assert.rejects(invoiceCaseAction(f.db,sampleStaff.id,{action:'invoice-case-receipt-summaries',orderIds:wanted},true),/access/);
 assert.ok(!f.reads.includes('_invoice_cases/'+wanted[2]));assert.ok(!f.reads.includes('orders/'+wanted[5]));
});
