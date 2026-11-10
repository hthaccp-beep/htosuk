import {useEffect,useId} from 'react';
import {create} from 'zustand';
type Request={supplierId:string;sourceOrderId:string};
export const useSyncRequests=create<{requests:Record<string,Request>}>(()=>({requests:{}}));
export function useOrderDataRequest(supplierId='',sourceOrderId=''){
 const id=useId();
 useEffect(()=>{
  useSyncRequests.setState(s=>({requests:{...s.requests,[id]:{supplierId,sourceOrderId}}}));
  return()=>useSyncRequests.setState(s=>{const requests={...s.requests};delete requests[id];return {requests};});
 },[id,supplierId,sourceOrderId]);
}
