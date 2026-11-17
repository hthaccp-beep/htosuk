import {loadInvoiceSummaries} from './loadInvoiceSummaries';
import React,{useEffect,useState} from 'react';
import {useCheckWorkflow} from './CheckWorkflow';
import type {InvoiceReceiptSummary} from '../../shared/invoice-receipt-summary';
import type {OrderRecord} from '../../types';
import {historyInvoiceStatus} from './historyInvoiceStatus';
import {Tag} from './ui';
export function useInvoiceUploadSummaries(orderIds:string[],paused:boolean){
 const request=useCheckWorkflow(),[attempt,setAttempt]=useState(0);
 const [state,setState]=useState<{key:string;summaries:Record<string,InvoiceReceiptSummary>;loading:boolean;failed:boolean;completed:number}>({key:'',summaries:{},loading:false,failed:false,completed:0});
 const idsKey=JSON.stringify([...new Set(orderIds)]);
 useEffect(()=>{
  if(paused)return;
  const controller=new AbortController(),ids:string[]=JSON.parse(idsKey);
  setState({key:idsKey,summaries:{},loading:ids.length>0,failed:false,completed:0});
  loadInvoiceSummaries(request,ids,controller.signal,progress=>{
   if(!controller.signal.aborted)setState({key:idsKey,...progress,loading:progress.completed<ids.length,failed:false});
  }).catch(()=>{
   if(!controller.signal.aborted)setState(previous=>({...previous,loading:false,failed:true}));
  });
  return()=>controller.abort();
 },[request,idsKey,paused,attempt]);
 const current:Omit<typeof state,'key'>=state.key===idsKey?state:{summaries:{},loading:orderIds.length>0,failed:false,completed:0};
 return {...current,total:orderIds.length,retry:()=>setAttempt(value=>value+1)};
}
export function InvoiceUploadStatus({order,summary,enabled,loading}:{order:OrderRecord;summary?:InvoiceReceiptSummary;enabled:boolean;loading:boolean}){
 const status=historyInvoiceStatus(order,summary,enabled,loading);
 return <span className="h-history-invoice-status"><Tag tone={status.tone}>{status.label}</Tag>{status.detail&&<small>{status.detail}</small>}</span>;
}
