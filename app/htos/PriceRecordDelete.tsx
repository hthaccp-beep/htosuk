import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {useAppStore} from '../../store';
import {PRICE_DELETE_LIMIT, priceRecordFingerprint, type PriceRecordKind} from '../../shared/price-record-removal';
import {api, Button, Modal, useAction} from './ui';

export const PriceRecordDeleteContext = createContext<(body:unknown)=>Promise<any>>(body=>api('/api/admin/workspace',body));
type Row = {id:string;productName:string};
export function usePriceRecordDelete(kind:PriceRecordKind, rows:Row[], tab:string) {
  const store=useAppStore(), request=useContext(PriceRecordDeleteContext), action=useAction();
  const owner=store.currentUser?.active===true&&store.currentUser.role==='CREATOR';
  const [ids,setIds]=useState<string[]>([]), [review,setReview]=useState<{rows:Row[];body:any}|null>(null),[confirmation,setConfirmation]=useState('');
  const busy=useRef(false);
  useEffect(()=>{setIds([]);setReview(null);setConfirmation('');},[tab]);
  const selected=rows.filter(r=>ids.includes(r.id));
  const all=rows.length>0&&rows.every(r=>ids.includes(r.id));
  function prepare(targets:Row[]) {
    setConfirmation('');
    setReview({rows:targets,body:{action:'price-record-delete',kind,requestId:crypto.randomUUID(),confirmation:'DELETE',rows:targets.map(r=>({id:r.id,expected:priceRecordFingerprint(r)}))}});
  }
  async function remove() {
    if(!review||busy.current||confirmation!=='DELETE')return;
    busy.current=true;
    try {await action.run(async()=>{
      const result=await request(review.body);
      if(!result.success||result.deleted!==review.rows.length)throw new Error('Deletion was not confirmed. Retry this selection.');
      const deleted=new Set(review.rows.map(r=>r.id));
      const latest=useAppStore.getState();
      if(kind==='history'){latest.setPriceHistory(latest.priceHistory.filter(r=>!deleted.has(r.id)));if(result.activatedNoticeIds?.length)latest.setPriceChangeNotices(latest.priceChangeNotices.map(n=>result.activatedNoticeIds.includes(n.id)?{...n,activatedAt:result.activatedAt}:n));}
      else latest.setPriceChangeNotices(latest.priceChangeNotices.filter(r=>!deleted.has(r.id)));
      setReview(null);setIds([]);setConfirmation('');
    },`${review.rows.length} ${kind==='history'?'price history records':'price requests'} permanently deleted. Product prices and orders are unchanged.`);
    } finally {busy.current=false;}
  }
  const select=(row:Row)=>owner?<input type="checkbox" aria-label={`Select ${row.productName}`} checked={ids.includes(row.id)} onChange={()=>setIds(prev=>prev.includes(row.id)?prev.filter(id=>id!==row.id):[...prev,row.id])}/>:null;
  const header=owner?<input type="checkbox" aria-label="Select all records in this list" checked={all} onChange={()=>setIds(all?[]:rows.map(r=>r.id))}/>:null;
  const rowAction=(row:Row)=>owner?<Button variant="secondary" disabled={action.busy} onClick={()=>prepare([row])} aria-label={`Delete ${row.productName}`}>Delete</Button>:null;
  const toolbar=owner?<div className="h-detail-actions"><span>{selected.length} selected · {rows.length} in this list</span><Button variant="secondary" disabled={!selected.length||selected.length>PRICE_DELETE_LIMIT||action.busy} onClick={()=>prepare(selected)}>Delete selected</Button><Button variant="secondary" disabled={!rows.length||rows.length>PRICE_DELETE_LIMIT||action.busy} onClick={()=>prepare(rows)}>Delete all in this list</Button>{rows.length>PRICE_DELETE_LIMIT&&<small>Select up to {PRICE_DELETE_LIMIT} records per deletion.</small>}</div>:null;
  const dialog=review&&owner?<Modal title={`Permanently delete ${review.rows.length} ${kind==='history'?'history records':'price requests'}?`} onClose={()=>{if(!busy.current)setReview(null);}}>
    <p>This cannot be undone. {kind==='notices'?'Pending requests and scheduled changes in this selection will be cancelled.':'The selected price history will be erased.'} Products, current prices and past orders will not change.</p>
    <ul style={{maxHeight:180,overflowY:'auto'}}>{review.rows.map(r=><li key={r.id}>{r.productName}</li>)}</ul>
    <label className="h-field"><span>Type DELETE to confirm</span><input autoComplete="off" value={confirmation} disabled={action.busy} onChange={e=>setConfirmation(e.target.value)}/></label>
    {action.error&&<p className="h-notice error" role="alert">{action.error}</p>}
    <div className="h-detail-actions"><Button variant="secondary" disabled={action.busy} onClick={()=>setReview(null)}>Keep records</Button><Button busy={action.busy} disabled={confirmation!=='DELETE'} onClick={remove}>Delete permanently</Button></div>
  </Modal>:null;
  return {owner,header,select,rowAction,toolbar,dialog,feedback:review?null:action.feedback};
}
