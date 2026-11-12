export type UpdateState = {available: boolean; checking: boolean; applying: boolean; preparing?: boolean; reloading?: boolean; blocked?: boolean; deferred: boolean; message: string};
type Options = {
  loadedVersion: string;
  hold: () => string;
  signedIn: () => boolean;
  changed: (state: UpdateState) => void;
  freeze: (active: boolean) => void;
  reload?: () => void;
};

const CHECK_INTERVAL = 60_000;
const UPDATE_RECEIPT = 'htos-update-target';

/** One controller for the entire tab. Static assets only; no Firebase or business APIs. */
export function startSafeUpdates(options: Options) {
  let registration: ServiceWorkerRegistration | undefined;
  let stopped = false, lastCheck = 0, lastActivity = Date.now(), laterUntil = 0, attemptAfter = 0;
  let applyingWorker: ServiceWorker | null = null, token = '';
  let discovery = 0;
  let manualRequested = false;
  let confirmAfterDownload = false;
  const versions = new WeakMap<ServiceWorker, string>();
  let latestVersion = '';
  let versionRequest: AbortController | undefined;
  const readRelease = async () => {
    const abort = new AbortController();
    versionRequest = abort;
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await fetch('/app-version.json', {cache: 'no-store', credentials: 'same-origin', signal: abort.signal});
      const value = response.ok ? await response.json() : null;
      if (!value || typeof value.version !== 'string' || !value.version.trim() || value.version.length > 64) throw new Error('invalid release');
      return value.version as string;
    } finally { clearTimeout(timer); if (versionRequest === abort) versionRequest = undefined; }
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let confirmationTimeout: ReturnType<typeof setTimeout> | undefined;
  let state: UpdateState = {available: false, checking: false, applying: false, deferred: false, message: ''};
  const publish = (patch: Partial<UpdateState>) => {
    if (!stopped) {
      const clearPause = patch.message === '' || patch.checking || patch.preparing || patch.applying || patch.available === false;
      state = {...state, ...(clearPause ? {blocked: false} : {}), ...patch};
      options.changed(state);
    }
  };
  const confirmCurrent = () => {
    if (stopped || latestVersion !== options.loadedVersion || registration?.installing) return;
    confirmAfterDownload = false;
    const message = `Your app is up to date — version ${options.loadedVersion}.`;
    clearTimeout(confirmationTimeout);
    publish({available: false, deferred: false, message});
    confirmationTimeout = setTimeout(() => {
      // A newer update or warning must not be dismissed by an earlier confirmation.
      if (!state.available && !state.checking && !state.applying && state.message === message) publish({message: ''});
    }, 5000);
  };
  const discover = async () => {
    if (state.reloading) return;
    const sequence = ++discovery;
    const waiting = registration?.waiting;
    if (!waiting) {
      if (!state.applying) publish({available: false, message: latestVersion && latestVersion !== options.loadedVersion ? 'A new version is being prepared. Keep working while it downloads.' : ''});
      if (confirmAfterDownload && !registration?.installing && !state.applying) confirmCurrent();
      return;
    }
    let version = versions.get(waiting);
    if (!version) {
      version = await new Promise<string | undefined>(resolve => {
        const channel = new MessageChannel();
        const done = (value?: string) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value); };
        const timer = setTimeout(() => done(), 1500);
        channel.port1.onmessage = event => done(typeof event.data?.version === 'string' ? event.data.version : undefined);
        try { waiting.postMessage({type: 'HTOS_RELEASE'}, [channel.port2]); } catch { done(); }
      });
      if (version) versions.set(waiting, version);
    }
    if (stopped || state.reloading || sequence !== discovery || registration?.waiting !== waiting) return;
    // The loaded app, published release and downloaded worker are separate facts.
    // Never activate stale/unknown code or mistake a stalled download for success.
    if (latestVersion === options.loadedVersion) {
      if (confirmAfterDownload && !registration?.installing) confirmCurrent();
      else publish({available: false, deferred: false, message: ''});
    } else if (version && version === latestVersion) { confirmAfterDownload = false; publish({available: true}); }
    else publish({available: false, message: 'The downloaded update is not yet verified. Keep working; HTOS will check again.'});
  };
  const thaw = (message: string) => {
    clearTimeout(timeout); applyingWorker = null; options.freeze(false);
    attemptAfter = Date.now() + 60_000;
    publish({applying: false, preparing: false, reloading: false, blocked: true, message});
  };
  const watch = (worker: ServiceWorker | null) => {
    worker?.addEventListener('statechange', () => {
      if (stopped) return;
      void discover();
      if (worker.state === 'redundant') { confirmAfterDownload = false; publish({message: 'The update could not finish downloading. Your work is unchanged. Check again when connected.'}); }
    });
  };
  const connect = async () => {
    if (!('serviceWorker' in navigator)) throw new Error('unsupported');
    if (!registration) {
      registration = await navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'});
      if (stopped) return;
      registration.addEventListener('updatefound', () => watch(registration?.installing || null));
      watch(registration.installing); await discover();
    }
  };
  const check = async (manual = false) => {
    if (stopped || state.applying || state.preparing) return;
    if (state.checking) {
      if (manual) { manualRequested = true; publish({deferred: false, message: 'Checking for updates…'}); }
      return;
    }
    if (!manual && Date.now() - lastCheck < CHECK_INTERVAL) return;
    if (manual) publish({deferred: false});
    lastCheck = Date.now();
    if (!navigator.onLine) { publish({message: 'You’re offline. Updates will be checked after reconnecting.'}); return; }
    publish({checking: true, ...(manual ? {message: 'Checking for updates…'} : {})});
    try {
      latestVersion = await readRelease();
      if (stopped) return;
      await connect();
      if (stopped) return;
      await registration?.update();
      if (stopped) return;
      await discover();
      if ((manual || manualRequested) && state.available) publish({message: 'An update is ready.'});
      else if ((manual || manualRequested) && registration?.installing) { confirmAfterDownload = true; publish({message: 'Downloading an update. Keep working while it finishes.'}); }
      else if (manual || manualRequested) confirmCurrent();
      // Only this tab's successful activation writes this receipt; no form data.
      try {
        const receipt = JSON.parse(sessionStorage.getItem(UPDATE_RECEIPT) || 'null');
        if (receipt?.version === options.loadedVersion && latestVersion === options.loadedVersion) {
          sessionStorage.removeItem(UPDATE_RECEIPT);
          if (Date.now() - receipt.at >= 0 && Date.now() - receipt.at < 300_000) confirmCurrent();
        }
      } catch { /* Storage can be disabled; updating must still work. */ }
    } catch {
      latestVersion = '';
      confirmAfterDownload = false;
      publish({message: 'Updates could not be checked. Keep working and try again when connected.'});
    } finally { manualRequested = false; publish({checking: false}); }
  };
  const apply = async () => {
    if (stopped || state.applying || state.preparing || state.checking || !state.available || !registration?.waiting) return;
    // Lock the button synchronously, before even the first worker lookup awaits.
    publish({preparing: true, message: 'Checking it is safe to update…'});
    try {
    await discover();
    if (!state.available && !stopped) { confirmCurrent(); return; }
    if (stopped || state.applying || !state.available || !registration?.waiting) return;
    const hold = options.hold();
    if (hold) { publish({blocked: true, message: hold}); return; }
    if (!navigator.onLine) { publish({message: 'Reconnect before updating. Your work is unchanged.'}); return; }
    const waiting = registration.waiting;
    // Freeze first, and re-check after the bounded connection probe. No interactions
    // or submissions can race with activation; failed attempts always release the UI.
    options.freeze(true); publish({applying: true, message: 'Preparing the update…'});
    try {
      const publishedVersion = await readRelease();
      if (stopped) return;
      if (versions.get(waiting) !== publishedVersion || publishedVersion === options.loadedVersion) {
        latestVersion = publishedVersion;
        thaw('The published update changed. Your work is unchanged. Check for updates again.');
        await discover();
        return;
      }
      const currentHold = options.hold();
      if (currentHold || registration.waiting !== waiting) { thaw(currentHold || 'The update changed. Please check again.'); return; }
      token = crypto.randomUUID(); applyingWorker = waiting;
      timeout = setTimeout(() => thaw('The update is taking longer than expected. Keep working and try again.'), 15_000);
      publish({message: 'Checking other HTOS tabs and applying the update…'});
      waiting.postMessage({type: 'HTOS_SAFE_ACTIVATE', token});
    } catch { thaw('The update could not connect. Your work is unchanged. Try again when connected.'); }
    } finally { publish({preparing: false}); }
  };
  const message = (event: MessageEvent) => {
    if (event.source === applyingWorker && event.data?.token === token && event.data?.type === 'HTOS_UPDATE_HELD')
      thaw('Save your work in other HTOS tabs, then close those tabs to finish this update.');
  };
  const controller = () => {
    if (!applyingWorker || stopped) { void discover(); return; }
    // An unexpected newly started operation must never be interrupted.
    const hold = options.hold();
    if (hold) { thaw(hold); return; }
    clearTimeout(timeout); applyingWorker = null;
    try { sessionStorage.setItem(UPDATE_RECEIPT, JSON.stringify({version: latestVersion, at: Date.now()})); } catch { /* Optional success receipt only. */ }
    // Keep the progress cover and interaction lock until the new page opens.
    publish({available: false, applying: true, reloading: true, deferred: false, message: 'Update ready. Reloading HTOS…'});
    timeout = setTimeout(() => thaw('Reloading did not finish. Your work is unchanged. Save any unfinished work before refreshing the page.'), 15_000);
    try { (options.reload || (() => window.location.reload()))(); }
    catch { thaw('Reloading did not finish. Your work is unchanged. Save any unfinished work before refreshing the page.'); }
  };
  const activity = (event: Event) => {
    if (state.applying) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    lastActivity = Date.now();
  };
  const visible = () => { if (document.visibilityState === 'visible') { lastActivity = Date.now(); void check(); } };
  const online = () => { lastCheck = 0; void check(); };
  const tick = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (state.deferred && Date.now() >= laterUntil) publish({deferred: false, message: ''});
    if (Date.now() - lastCheck >= CHECK_INTERVAL) void check();
    const idleFor = options.signedIn() ? 60_000 : 10_000;
    if (navigator.onLine && state.available && !state.applying && !state.checking && Date.now() >= Math.max(laterUntil, attemptAfter) && Date.now() - lastActivity >= idleFor && !options.hold()) void apply();
  }, 1000);
  for (const name of ['pointerdown', 'keydown', 'input', 'change', 'submit', 'click']) document.addEventListener(name, activity, true);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', online);
  navigator.serviceWorker?.addEventListener('message', message);
  navigator.serviceWorker?.addEventListener('controllerchange', controller);
  void check();
  return {
    check: () => check(true), apply,
    later: () => { if(state.applying || state.preparing)return; laterUntil = Date.now() + 15 * 60_000; publish({deferred: true, message: ''}); },
    stop: () => {
      stopped = true; versionRequest?.abort(); clearInterval(tick); clearTimeout(timeout); clearTimeout(confirmationTimeout); options.freeze(false);
      for (const name of ['pointerdown', 'keydown', 'input', 'change', 'submit', 'click']) document.removeEventListener(name, activity, true);
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', online);
      navigator.serviceWorker?.removeEventListener('message', message);
      navigator.serviceWorker?.removeEventListener('controllerchange', controller);
    },
  };
}
