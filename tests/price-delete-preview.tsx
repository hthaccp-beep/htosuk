import React from 'react';
import {useAppStore} from '../store';
import {PriceDesk} from '../app/htos/PriceDesk';
import {PriceRecordDeleteContext} from '../app/htos/PriceRecordDelete';
import {priceRecordFingerprint} from '../shared/price-record-removal';
let seeded=false;
export function PriceDeletePreview(){
 if(!seeded){
  seeded=true;
  const store=useAppStore.getState();
  store.setPriceChangeNotices(['PENDING','APPROVED','REJECTED'].map((status,i)=>({id:'notice-'+i,productId:'qa-p',productName:'Sample product '+(i+1),supplierId:'qa-s',supplierName:'Sample supplier',oldCasePrice:12,newCasePrice:15,oldPackPrice:2,newPackPrice:2.5,invoiceNumber:'SAMPLE-'+i,invoiceDate:'2026-10-30',detectedDate:'2026-10-30',status,uploadedByUserId:'qa-owner',uploadedByUserName:'Test owner',...(status==='APPROVED'?{activatedAt:'2026-10-30T10:00:00Z',effectiveDate:'2026-10-30'}:{})})) as any);
  store.setPriceHistory([{id:'history-1',productId:'qa-p',productName:'Sample product 2',supplierId:'qa-s',supplierName:'Sample supplier',previousCasePrice:12,newCasePrice:15,effectiveDate:'2026-10-30',invoiceRef:'SAMPLE-1',approvedByUserId:'qa-owner',approvedByUserName:'Preview owner'}]);
  (window as any).__priceTest={requests:[],snapshot:()=>{const s=useAppStore.getState();return {products:s.products,orders:s.orders,notices:s.priceChangeNotices,history:s.priceHistory};}};
 }
 const request=async(body:any)=>{
  (window as any).__priceTest.requests.push(structuredClone(body));
  await new Promise(r=>setTimeout(r,450));
  if(new URLSearchParams(location.search).get('failure')==='1')throw new Error('Synthetic failure: nothing was deleted. Retry this selection.');
  const state=useAppStore.getState(),records=body.kind==='history'?state.priceHistory:state.priceChangeNotices;
  for(const row of body.rows)if(priceRecordFingerprint(records.find(r=>r.id===row.id))!==row.expected)throw new Error('Record changed. Nothing deleted.');
  return {success:true,deleted:body.rows.length,kind:body.kind};
 };
 return <div className="h-app" style={{padding:24}}><PriceRecordDeleteContext.Provider value={request}><PriceDesk/></PriceRecordDeleteContext.Provider></div>;
}
