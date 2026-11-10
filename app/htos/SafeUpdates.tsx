import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Loader2} from 'lucide-react';
import {useLocation} from 'react-router-dom';
import {useAppStore} from '../../store';
import {pendingWorkCount} from '../../shared/pending-work';
import {updateBlockerCount, updateHold} from '../../shared/update-safety';
import {startSafeUpdates, type UpdateState} from './safe-updates';
import './safe-updates.css';
import release from '../../app-version.json';

export const requestUpdateCheck = () => window.dispatchEvent(new Event('htos-check-update'));

export function SafeUpdates({ready}: {ready: boolean}) {
  const location = useLocation();
  const current = useRef({ready, path: location.pathname, search: location.search});
  current.current = {ready, path: location.pathname, search: location.search};
  const controller = useRef<ReturnType<typeof startSafeUpdates>>();
  const [state, setState] = useState<UpdateState>({available: false, checking: false, applying: false, deferred: false, message: ''});
  const [dismissed, setDismissed] = useState(false);
  const [noticeHost, setNoticeHost] = useState<HTMLElement | null>(null);
  // The sign-in/workspace host can change without a route change.
  useLayoutEffect(() => { const host = document.getElementById('htos-update-notice'); if (host !== noticeHost) setNoticeHost(host); });
  useEffect(() => {
    const root = document.getElementById('root');
    const hold = () => {
      const store = useAppStore.getState();
      const controls = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea')];
      return updateHold({
        ready: current.current.ready, signedIn: !!store.currentUser, path: current.current.path,
        pending: pendingWorkCount(), protectedWork: updateBlockerCount(),
        drafts: Object.keys(store.cart).length > 0 || store.manualCart.length > 0,
        teamListReady: new URLSearchParams(current.current.search).get('tab') === 'users' && !!document.querySelector('[data-update-safe-view="team"]'),
        editorOpen: [...document.querySelectorAll('dialog[open], [role=dialog], [aria-modal=true], [contenteditable=true], [aria-busy=true]')].some(element=>!element.closest('[data-update-ui]')),
        enteredText: controls.some(control => !control.disabled && !control.readOnly && !!control.value),
      });
    };
    controller.current = startSafeUpdates({loadedVersion: release.version, hold, signedIn: () => !!useAppStore.getState().currentUser,
      changed: next => { setState(next); if (next.available || next.applying) setDismissed(false); },
      freeze: active => { if (root) root.inert = active; },
    });
    const check = () => { setDismissed(false); void controller.current?.check(); };
    window.addEventListener('htos-check-update', check);
    return () => { window.removeEventListener('htos-check-update', check); controller.current?.stop(); };
  }, []);
  const busy = !!(state.preparing || state.applying || state.checking);
  const progressLabel = state.reloading ? 'Reloading…' : state.applying ? 'Updating…' : 'Checking…';
  const notice = !dismissed && !state.deferred && (state.available || state.message) ? <aside className="h-safe-update" aria-label="App updates" data-update-ui>
      <div role="status" aria-live={state.blocked ? 'assertive' : 'polite'}><strong>{state.applying ? 'Updating HTOS' : state.preparing ? 'Checking your update' : state.blocked ? 'Update paused — your work is protected' : state.available ? 'A new HTOS update is ready' : 'HTOS updates'}</strong>
        <p>{state.message || 'HTOS updates automatically when this screen is safe and idle. Save unfinished work and close open forms first. You do not need to send an order.'}</p></div>
      <div className="h-safe-update-actions">
        {state.available || state.applying ? <><button type="button" aria-busy={busy} disabled={busy} onClick={() => void controller.current?.apply()}>{busy&&<Loader2 className="h-update-spinner" size={18} aria-hidden="true"/>}{busy ? progressLabel : 'Update now'}</button>
          <button type="button" disabled={!!(state.applying || state.preparing)} title="Hide this notice for 15 minutes" onClick={() => { controller.current?.later(); document.querySelector<HTMLButtonElement>('.h-update-check')?.focus(); }}>Later</button></> :
          <button type="button" disabled={busy} onClick={() => setDismissed(true)}>Close</button>}
      </div>
    </aside> : null;
  return <>
    {noticeHost ? createPortal(notice, noticeHost) : notice}
    {state.applying && createPortal(<div className="h-update-cover" role="status" aria-live="polite" data-update-ui><Loader2 className="h-update-spinner" size={36} aria-hidden="true"/><strong>{state.reloading ? 'Opening updated HTOS…' : 'Updating HTOS…'}</strong><p>{state.message}</p><p>Please wait — there is no need to click again.<br/>Your saved data will stay unchanged.</p></div>, document.body)}
  </>;
}
