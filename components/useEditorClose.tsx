import React, {useEffect, useRef, useState} from 'react';
import {ConfirmModal} from './ConfirmModal';
import {beginPendingWork} from '../shared/pending-work';
import {useUpdateProtection} from '../hooks/useUpdateProtection';

/** Protect local editor drafts. Successful saves close directly through the caller. */
export function useEditorClose(value: unknown | null, busy: boolean, close: () => void) {
  const baseline = useRef<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const snapshot = value === null ? null : JSON.stringify(value);
  if (snapshot === null) baseline.current = null;
  else if (baseline.current === null) baseline.current = snapshot;
  const dirty = snapshot !== null && baseline.current !== snapshot;
  useUpdateProtection(dirty || busy);
  useEffect(() => { if (busy) return beginPendingWork(); }, [busy]);
  useEffect(() => { if (snapshot === null) setConfirm(false); }, [snapshot === null]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  const requestClose = () => { if (busy) return; if (dirty) setConfirm(true); else close(); };
  const confirmation = <ConfirmModal isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={() => {if (!busy) {setConfirm(false);close();}}} title="Discard unsaved changes?" message="Your changes have not been saved. Keep editing to finish, or discard these changes." confirmText="Discard changes" cancelText="Keep editing" loading={busy} persistent={busy}/>;
  return {requestClose, confirmation};
}
