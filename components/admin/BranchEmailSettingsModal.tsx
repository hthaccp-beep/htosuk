import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Lock, Mail, X } from 'lucide-react';
import { auth } from '../../firebase-config';
import { useAppStore } from '../../store';
import type { Branch } from '../../types';
import { Modal } from '../Modal';

interface MailboxSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  cc: string[];
}

interface SettingsResponse {
  settings: MailboxSettings | null;
  senderEmail: string;
  cc: string;
}

interface SettingsUpdate {
  branchId: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  cc: string;
}

async function fetchSettings(branchId: string, signal: AbortSignal, update?: SettingsUpdate, forceTokenRefresh = false): Promise<unknown> {
  if (!auth?.currentUser && auth) {
    try {
      if (typeof (auth as any).authStateReady === 'function') {
        await (auth as any).authStateReady();
      } else {
        await new Promise<void>((resolve) => {
          const unsub = auth.onAuthStateChanged(() => {
            unsub();
            resolve();
          });
          setTimeout(resolve, 2000);
        });
      }
    } catch (_) {}
  }
  const user = auth?.currentUser;
  if (!user) throw new Error('Please sign in again to manage branch email settings.');
  let token: string;
  try {
    token = await user.getIdToken(forceTokenRefresh);
  } catch {
    throw new Error('Your sign-in could not be verified. Please sign in again or try when your connection is available.');
  }
  if (signal.aborted) throw new Error('Request cancelled.');
  let response: Response;
  const url = update ? '/api/admin/branch-email' : `/api/admin/branch-email?branchId=${encodeURIComponent(branchId)}`;
  const getHeaders = (authToken: string) => ({
    Authorization: `Bearer ${authToken.trim()}`,
    ...(update ? { 'Content-Type': 'application/json' } : {})
  });

  try {
    response = await fetch(url, {
      method: update ? 'PUT' : 'GET',
      headers: getHeaders(token),
      body: update ? JSON.stringify(update) : undefined,
      cache: 'no-store',
      signal,
    });
  } catch {
    if (signal.aborted) throw new Error('Request cancelled.');
    throw new Error(update
      ? 'The save could not be confirmed. Reopen these settings to check before trying again.'
      : 'Could not load the email settings. Check your connection and try again.');
  }

  // Automatic retry on 401: If token was expired or invalidated, force refresh once and retry
  if (response.status === 401 && auth?.currentUser && !forceTokenRefresh && !signal.aborted) {
    try {
      token = await auth.currentUser.getIdToken(true);
      response = await fetch(url, {
        method: update ? 'PUT' : 'GET',
        headers: getHeaders(token),
        body: update ? JSON.stringify(update) : undefined,
        cache: 'no-store',
        signal,
      });
    } catch {
      // Proceed to normal response handling if retry fetch throws
    }
  }

  let data: unknown;
  const rawText = await response.text();
  try {
    data = JSON.parse(rawText);
  } catch {
    if (!response.ok) {
      if (response.status === 500 && rawText.includes('FUNCTION_INVOCATION_FAILED')) {
        throw new Error('The server email service failed to start (FUNCTION_INVOCATION_FAILED). Please ensure the backend environment variables are configured.');
      }
      throw new Error(`The email settings service returned an error (HTTP ${response.status}). Please try again.`);
    }
    throw new Error('The email settings service returned an unexpected response. Please try again.');
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error.slice(0, 500)
      : response.status === 403 ? 'Only an authorized administrator can manage branch email settings.'
        : `Email settings could not be updated (HTTP ${response.status}). Please try again or contact an administrator.`;
    throw new Error(message);
  }
  return data;
}

async function requestSettings(branchId: string, signal: AbortSignal, update?: SettingsUpdate, forceTokenRefresh = false): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(update
        ? 'The save is taking too long and could not be confirmed. Reopen these settings to check before trying again.'
        : 'Loading email settings took too long. Check your connection and try again.'));
      controller.abort();
    }, 20000);
  });
  try {
    return await Promise.race([fetchSettings(branchId, controller.signal, update, forceTokenRefresh), timeout]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

function parseSettings(value: unknown): SettingsResponse {
  if (!value || typeof value !== 'object') throw new Error('The saved email settings could not be read.');
  const data = value as Partial<SettingsResponse>;
  if (typeof data.senderEmail !== 'string' || typeof data.cc !== 'string' ||
    (data.settings !== null && (!data.settings || typeof data.settings.host !== 'string' ||
      typeof data.settings.user !== 'string' || typeof data.settings.hasPassword !== 'boolean' ||
      typeof data.settings.port !== 'number' || typeof data.settings.secure !== 'boolean' ||
      !Array.isArray(data.settings.cc) || data.settings.cc.some(address => typeof address !== 'string')))) {
    throw new Error('The saved email settings could not be read.');
  }
  return {
    senderEmail: data.senderEmail,
    cc: data.cc,
    settings: data.settings ? {
      host: data.settings.host,
      port: data.settings.port,
      secure: data.settings.secure,
      user: data.settings.user,
      hasPassword: data.settings.hasPassword,
      cc: [...data.settings.cc],
    } : null,
  };
}

export const BranchEmailSettingsModal: React.FC<{ branch: Branch; onClose: () => void }> = ({ branch, onClose }) => {
  const showToast = useAppStore(state => state.showToast);
  const formId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const [saved, setSaved] = useState<MailboxSettings | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(465);
  const [senderEmail, setSenderEmail] = useState('');
  const [copyEmail, setCopyEmail] = useState('info@hareandtortoise.co.uk');
  const [additionalCc, setAdditionalCc] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const close = () => {
    if (savingRef.current) return;
    setPassword('');
    onClose();
  };

  useEffect(() => {
    mounted.current = true;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!savingRef.current) {
          setPassword('');
          onClose();
        }
      }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
      ) || []).filter(element => element.offsetParent !== null && !element.matches(':disabled'));
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const outside = !dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (outside || document.activeElement === last)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyboard);
    return () => {
      mounted.current = false;
      saveRequest.current?.abort();
      document.removeEventListener('keydown', handleKeyboard);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoaded(false);
    setPassword('');
    setError('');
    const forceRefresh = reload > 0;
    requestSettings(branch.id, controller.signal, undefined, forceRefresh)
      .then(parseSettings)
      .then(data => {
        if (controller.signal.aborted) return;
        setSaved(data.settings);
        setHost(data.settings?.host || '');
        setPort(data.settings?.port || 465);
        setSenderEmail(data.senderEmail.trim());
        setCopyEmail(data.cc);
        setAdditionalCc(data.settings?.cc.join(', ') || '');
        setLoaded(true);
        if (data.settings && !((data.settings.port === 465 && data.settings.secure) || (data.settings.port === 587 && !data.settings.secure))) {
          setError('Choose a supported secure connection before saving: port 465 with TLS, or port 587 with STARTTLS.');
        }
      })
      .catch((issue: unknown) => {
        if (controller.signal.aborted) return;
        const message = issue instanceof Error ? issue.message : 'Email settings could not be loaded.';
        setError(message);
        showToast('error', message);
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [branch.id, branch.email, reload, showToast]);

  const hasSingleSender = /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(senderEmail);
  const passwordRequired = !saved?.hasPassword || host.trim().toLowerCase() !== saved.host.trim().toLowerCase() ||
    senderEmail !== saved.user.trim();

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loaded || savingRef.current) return;
    if (!hasSingleSender) {
      setError('Save one valid Branch Email in Branch Details before configuring this mailbox.');
      return;
    }
    if (!host.trim() || /[\s/:\\\x00-\x1f\x7f]/.test(host.trim()) || ![465, 587].includes(port)) {
      setError('Enter the mail provider’s SMTP hostname and choose a secure connection.');
      return;
    }
    if (passwordRequired && !password.trim()) {
      setError('Enter the mailbox password. A new password is required for a new mailbox or a change to its address or SMTP server.');
      return;
    }
    const copyAddresses = additionalCc.trim() ? additionalCc.split(',').map(address => address.trim()) : [];
    const uniqueCopies = new Set(copyAddresses.map(address => address.toLowerCase()).filter(address => address !== copyEmail.toLowerCase()));
    if (uniqueCopies.size > 18 || copyAddresses.some(address => !/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(address))) {
      setError('Enter up to 18 valid additional CC email addresses, separated by commas.');
      return;
    }
    const controller = new AbortController();
    saveRequest.current = controller;
    savingRef.current = true;
    setIsSaving(true);
    setError('');
    try {
      const result = await requestSettings(branch.id, controller.signal, {
        branchId: branch.id,
        host: host.trim(),
        port,
        secure: port === 465,
        user: senderEmail,
        cc: additionalCc.trim(),
        ...(password.trim() ? { password } : {}),
      });
      if (!mounted.current || controller.signal.aborted) return;
      if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true) {
        throw new Error('The email settings save could not be confirmed. Reopen these settings to check.');
      }
      setPassword('');
      showToast('success', `Email settings saved for ${branch.name}.`);
      onClose();
    } catch (issue) {
      if (!mounted.current || controller.signal.aborted) return;
      const message = issue instanceof Error ? issue.message : 'Email settings could not be saved.';
      setError(message);
      showToast('error', message);
    } finally {
      savingRef.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };

  const inputClass = 'w-full min-w-0 rounded-xl border border-gray-300 p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50';

  return (
    <Modal isOpen onClose={close} className="max-w-lg p-4 sm:p-6">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`} aria-busy={isLoading || isSaving} tabIndex={-1}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={`${formId}-title`} className="text-lg font-bold text-gray-900">Branch email settings</h3>
            <p className="mt-1 break-words text-sm text-gray-500">{branch.name}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={close} disabled={isSaving} aria-label="Close email settings" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50"><X size={20} /></button>
        </div>

        {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {isLoading ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm text-gray-600"><Loader2 size={18} className="animate-spin" />Loading saved settings…</p>
        ) : !loaded ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setReload(value => value + 1)}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 transition-colors shadow-sm"
            >
              Try again
            </button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              <p className="break-all"><span className="font-semibold text-gray-800">From and replies: </span>{senderEmail || 'Branch email is missing'}</p>
              <p className="mt-1 break-all"><span className="font-semibold text-gray-800">Order copy (CC): </span>{copyEmail}</p>
              <p className="mt-2 text-xs">To change this mailbox address, save the new Branch Email in Branch Details first, then update its password here.</p>
            </div>
            <fieldset disabled={isSaving} className="min-w-0 space-y-4">
              <div>
                <label htmlFor={`${formId}-user`} className="mb-1 block text-sm font-semibold text-gray-700">Mailbox login</label>
                <input id={`${formId}-user`} type="email" value={senderEmail} readOnly autoComplete="off" className={`${inputClass} bg-gray-50`} />
              </div>
              <div>
                <label htmlFor={`${formId}-host`} className="mb-1 block text-sm font-semibold text-gray-700">SMTP server</label>
                <input id={`${formId}-host`} type="text" required maxLength={253} value={host} onChange={event => setHost(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="smtp.livemail.co.uk" className={inputClass} />
              </div>
              <div>
                <label htmlFor={`${formId}-connection`} className="mb-1 block text-sm font-semibold text-gray-700">Secure connection</label>
                <select id={`${formId}-connection`} value={[465, 587].includes(port) ? port : ''} onChange={event => setPort(Number(event.target.value))} required className={inputClass}>
                  {![465, 587].includes(port) && <option value="">Choose a secure connection</option>}
                  <option value={465}>Port 465 — TLS (SSL)</option>
                  <option value={587}>Port 587 — STARTTLS</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${formId}-cc`} className="mb-1 block text-sm font-semibold text-gray-700">Additional CC addresses</label>
                <textarea id={`${formId}-cc`} rows={2} value={additionalCc} onChange={event => setAdditionalCc(event.target.value)} maxLength={4600} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${formId}-cc-help`} placeholder="person@example.com, team@example.com" className={`${inputClass} resize-y`} />
                <p id={`${formId}-cc-help`} className="mt-1 text-xs text-gray-500">Optional: add up to 18 email addresses, separated by commas. Order emails always copy {copyEmail}. Leave this box blank to remove additional copies.</p>
              </div>
              <div>
                <label htmlFor={`${formId}-password`} className="mb-1 block text-sm font-semibold text-gray-700">{saved?.hasPassword ? 'Replace mailbox password' : 'Mailbox password'}</label>
                <input id={`${formId}-password`} type="password" value={password} onChange={event => setPassword(event.target.value)} required={passwordRequired} autoComplete="new-password" maxLength={4096} aria-describedby={`${formId}-password-help`} className={inputClass} />
                <p id={`${formId}-password-help`} className="mt-1 text-xs text-gray-500">{passwordRequired ? 'Enter the password for this mailbox to save these settings.' : 'A password is already saved and is never shown. Leave this blank to keep it.'}</p>
              </div>
            </fieldset>
            <p className="flex items-start gap-2 text-xs text-gray-500"><Lock size={14} className="mt-0.5 shrink-0" />Passwords are protected on the server. Encrypted connections and valid security certificates are always required.</p>
            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
              <button type="button" onClick={close} disabled={isSaving} className="rounded-xl px-4 py-3 text-sm font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={isSaving || !hasSingleSender} className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{isSaving ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}{isSaving ? 'Saving…' : 'Save email settings'}</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
