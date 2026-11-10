import React, {useRef, useState, useSyncExternalStore} from 'react';
import {Button, Modal} from './ui';
import {pendingWorkCount, subscribePendingWork} from '../../shared/pending-work';

export function SignOutConfirmation({onClose, onSignOut}: {onClose: () => void; onSignOut: () => Promise<void>}) {
  const pending = useSyncExternalStore(subscribePendingWork, pendingWorkCount);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = useRef(false);
  const confirm = async () => {
    if (running.current || pendingWorkCount()) return;
    running.current = true;
    setBusy(true);
    setError('');
    try { await onSignOut(); onClose(); }
    catch { setError('Sign out could not finish. Please try again.'); }
    finally { running.current = false; setBusy(false); }
  };
  return <Modal title="Sign out of HTOS?" onClose={() => {if (!running.current) onClose();}}>
    <p>Any unsaved changes will be lost. Choose Keep working to save your changes or save an order as a draft first.</p>
    <p>Saved records and past orders will stay unchanged.</p>
    {pending > 0 && <p className="h-notice" role="status">A save or process is still running. Please wait for the result before signing out.</p>}
    {error && <p className="h-notice error" role="alert">{error}</p>}
    <div className="h-dialog-foot">
      <Button autoFocus variant="secondary" disabled={busy} onClick={onClose}>Keep working</Button>
      <Button busy={busy} disabled={pending > 0} onClick={() => void confirm()}>Sign out</Button>
    </div>
  </Modal>;
}
