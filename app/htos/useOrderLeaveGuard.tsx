import {useCallback, useEffect, useRef} from 'react';
import {useBlocker} from 'react-router-dom';
import {Button, Modal} from './ui';
import {useUpdateProtection} from '../../hooks/useUpdateProtection';

export function useOrderLeaveGuard(dirty:boolean, busy:boolean) {
  useUpdateProtection(dirty || busy);
  const released=useRef(false);
  const blocker=useBlocker(useCallback(()=>!released.current&&(dirty||busy),[dirty,busy]));
  useEffect(()=>{
    if(!dirty&&!busy)return;
    const warn=(event:BeforeUnloadEvent)=>{if(!released.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty,busy]);
  return {
    saved:()=>{released.current=true;},
    dialog:blocker.state==='blocked'?<Modal title={busy?'Your order is still processing':'Leave this unsaved order?'} onClose={()=>blocker.reset()}>
      <p>{busy?'Wait for the result before leaving this page.':'Your selected items and supplier note have not been saved. Keep working to save a draft, or discard this unsaved order.'}</p>
      <div className="h-dialog-foot"><Button autoFocus variant="secondary" onClick={()=>blocker.reset()}>Keep working</Button>
        {!busy&&<Button onClick={()=>blocker.proceed()}>Discard and leave</Button>}</div>
    </Modal>:null
  };
}
