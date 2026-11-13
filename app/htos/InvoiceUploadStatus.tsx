import React,{useEffect,useState} from 'react';
import {useCheckWorkflow} from './CheckWorkflow';
import type {InvoiceReceiptSummary} from '../../shared/invoice-receipt-summary';
import type {OrderRecord} from '../../types';
import {historyInvoiceStatus} from './historyInvoiceStatus';
import {Tag} from './ui';
export function useInvoiceUploadSummaries(orderIds:string[],paused:boolean):{summaries:Record<string,InvoiceReceiptSummary>;loading:boolean;failed:boolean}{
 const request=useCheckWorkflow(),[state,setState]=useState<{key:string;summaries:Record<string,InvoiceReceiptSummary>;loading:boolean;failed:boolean}>({key:'',summaries:{},loading:false,failed:false});
 const idsKey=JSON.stringify([...new Set(orderIds)].sort());
 useEffect(()=>{if(paused)return;let active=true;
  setState({key:idsKey,summaries:{},loading:orderIds.length>0,failed:false});
  (async()=>{const ids:string[]=JSON.parse(idsKey),next:Record<string,InvoiceReceiptSummary>={};
   for(let start=0;start<ids.length;start+=100){if(!active)return;const result=await request({action:'invoice-case-receipt-summaries',orderIds:ids.slice(start,start+100)});for(const summary of result.summaries)next[summary.id]=summary;}
   if(active)setState({key:idsKey,summaries:next,loading:false,failed:false});
  })().catch(()=>{if(active)setState({key:idsKey,summaries:{},loading:false,failed:true});});
  return()=>{active=false;};
 },[request,idsKey,paused]);
 return state.key===idsKey?state:{summaries:{},loading:orderIds.length>0,failed:false};
}
export function InvoiceUploadStatus({order,summary,enabled,loading}:{order:OrderRecord;summary?:InvoiceReceiptSummary;enabled:boolean;loading:boolean}){
 const status=historyInvoiceStatus(order,summary,enabled,loading);
 return <span className="h-history-invoice-status"><Tag tone={status.tone}>{status.label}</Tag>{status.detail&&<small>{status.detail}</small>}</span>;
}
