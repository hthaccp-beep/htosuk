import {orderReference} from '../../shared/order-reference.ts';
import {databaseErrorMessage} from '../../shared/database-errors';
import {readApiResponse} from '../../shared/api-response';
import {reportDatabaseError,useDatabaseStatus} from '../../hooks/databaseStatus';
import React, { useEffect, useRef, useState, useId } from 'react';
import { X, Loader2, ArrowRight, PackageOpen } from 'lucide-react';
import { auth } from '../../firebase-config';
import type { OrderRecord } from '../../types';
import { calculateOrderTotals } from '../../utils/orderPricing';
import {beginPendingWork} from '../../shared/pending-work';

export const money = (value: number | undefined) => value == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
export const day = (value?: string) => value ? new Date(value).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : 'Not set';
export const today = () => new Date().toLocaleDateString('en-CA');
export const total = (order: OrderRecord) => calculateOrderTotals(order.items, order.manualItems || []).grandTotal;
export const shortId = orderReference;
export const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export async function api(path: string, body: unknown) {
  const action=(body as {action?:string}|null)?.action;
  const quota=useDatabaseStatus.getState().quotaMessage;
  if(quota&&['catalog-preview','catalog-commit','product-bulk'].includes(action||''))throw Object.assign(new Error(quota),{code:'DATABASE_QUOTA_EXCEEDED'});
  if (!auth?.currentUser) throw new Error('Please sign in again.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify(body)});
  try{const result=await readApiResponse(response,(body as {action?:string}|null)?.action);if(typeof window!=='undefined')window.dispatchEvent(new Event('htos-data-changed'));return result;}catch(error){reportDatabaseError(error);throw error;}
}
export function csv(name: string, rows: unknown[][]) {
  const text = rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}
export function Button({children, busy, variant='', ...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & {busy?:boolean;variant?:string}) {
  return <button {...props} aria-busy={busy || undefined} disabled={props.disabled || busy} className={`h-button ${variant} ${props.className || ''}`}>{busy && <Loader2 aria-hidden="true" className="h-spin" size={16}/>} {children}</button>;
}
export function Field({label, children, hint}: {label:string;children:React.ReactNode;hint?:string}) {
  return <label className="h-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Empty({title,children,action}: {title:string;children?:React.ReactNode;action?:React.ReactNode}) {
  return <div className="h-empty"><div className="h-empty-icon"><PackageOpen size={28}/></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Tag({children, tone=''}:{children:React.ReactNode;tone?:string}) {return <span className={`h-tag ${tone}`}>{children}</span>;}
export function Panel({title,subtitle,action,children}:{title:string;subtitle?:string;action?:React.ReactNode;children:React.ReactNode}) {
  return <section className="h-panel"><div className="h-panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
export function Modal({title,children,onClose,wide=false,className='',dismissOnBackdrop=false}:{title:string;children:React.ReactNode;onClose:()=>void;wide?:boolean;className?:string;dismissOnBackdrop?:boolean}) {
  const ref = useRef<HTMLDialogElement>(null), titleId=useId();
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} aria-labelledby={titleId} className={`h-dialog ${wide?'wide':''} ${className}`} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}} onClick={e=>{if(dismissOnBackdrop&&e.target===e.currentTarget)onClose();}}><div className="h-dialog-inner"><header><h2 id={titleId}>{title}</h2><button className="h-icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header>{children}</div></dialog>;
}
export function useAction() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const running=useRef(false);
  const run=async(task:()=>Promise<unknown>,message='Saved successfully.')=>{if(running.current)return false;running.current=true;const finish=beginPendingWork();setBusy(true);setError('');setSuccess('');try{await task();setSuccess(message);return true;}catch(e){reportDatabaseError(e);setError(databaseErrorMessage(e,e instanceof Error?e.message:'Unable to save. Please try again.'));return false;}finally{finish();running.current=false;setBusy(false);}};
  return {busy,error,success,run,setError,feedback:<>{error&&<div className="h-notice error" role="alert">{error}</div>}{success&&<div className="h-notice success" role="status">{success}</div>}</>};
}
export function Heading({title,children,action,scope}:{eyebrow:string;title:string;children?:React.ReactNode;action?:React.ReactNode;scope?:React.ReactNode}) {return <div className="h-heading"><div className="h-heading-copy"><div className="h-heading-title"><h1>{title}</h1>{scope&&<div className="h-heading-scope">{scope}</div>}</div>{children&&<p>{children}</p>}</div>{action}</div>;}
export const Next = () => <ArrowRight size={17}/>;
