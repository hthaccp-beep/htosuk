import {auth} from '../firebase-config';
import {coalescePending} from '../shared/pending-request';
import {readApiResponse} from '../shared/api-response';
import {isDatabaseQuotaError} from '../shared/database-errors';

export async function readProtectedRecords(request:Record<string,unknown>):Promise<any[]> {
  const account=auth.currentUser;
  if(!account)throw new Error('Please sign in again.');
  return coalescePending(JSON.stringify(['secure-read',account.uid,request]),async()=>{
    const token=await account.getIdToken(),records:any[]=[];let cursor:string|undefined;
    do {
      const response=await fetch('/api/admin/workspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'data-read',...request,cursor})});
      const page=await readApiResponse(response,'data-read');
      records.push(...page.records);cursor=page.cursor||undefined;
    }while(cursor);
    return records;
  });
}

// No polling: refresh on entry, return to the tab, reconnect, or a completed action.
export function subscribeProtectedRecords(request:Record<string,unknown>,next:(records:any[])=>void,error:(error:unknown)=>void) {
  let disposed=false,running=false,queued=false,quotaBlocked=false;
  const refresh=async()=>{
    if(disposed||running||quotaBlocked)return;
    running=true;
    try{const records=await readProtectedRecords(request);if(!disposed)next(records);}
    catch(e){quotaBlocked=isDatabaseQuotaError(e);if(!disposed)error(e);}
    finally{
      running=false;
      const followUp=queued;queued=false;
      if(followUp&&!disposed&&!quotaBlocked)void refresh();
    }
  };
  // A save/reconnect can invalidate a response already in flight. Collapse a
  // burst to one follow-up; ordinary focus events must not multiply reads.
  const changed=()=>{if(disposed||quotaBlocked)return;if(running)queued=true;else void refresh();};
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  const online=()=>{if(document.visibilityState==='visible')changed();};
  void refresh();window.addEventListener('focus',visible);window.addEventListener('online',online);window.addEventListener('htos-data-changed',changed);
  return()=>{disposed=true;queued=false;window.removeEventListener('focus',visible);window.removeEventListener('online',online);window.removeEventListener('htos-data-changed',changed);};
}
