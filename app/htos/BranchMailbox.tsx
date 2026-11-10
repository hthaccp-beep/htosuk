import {databaseErrorMessage} from '../../shared/database-errors';
import {reportDatabaseError} from '../../hooks/databaseStatus';
import React, { useEffect, useState } from 'react';
import type { Branch } from '../../types';
import { auth } from '../../firebase-config';
import { Button, Field, Modal, useAction } from './ui';

type Settings={host:string;port:number;secure:boolean;user:string;hasPassword:boolean;cc:string[];accountsCc?:string[]};
async function mailboxRequest(branchId:string,signal?:AbortSignal,body?:unknown) {
  if(!auth.currentUser)throw new Error('Please sign in again.');
  const token=await auth.currentUser.getIdToken();
  const response=await fetch('/api/admin/branch-email'+(body?'':`?branchId=${encodeURIComponent(branchId)}`),{
    method:body?'PUT':'GET',cache:'no-store',signal,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){reportDatabaseError(result);throw new Error(databaseErrorMessage(result,result.error||'Branch email settings could not be loaded.'));}
  return result;
}
export function BranchMailbox({branch,onClose}:{branch:Branch;onClose:()=>void}) {
  const action=useAction();
  const [loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[saved,setSaved]=useState<Settings|null>(null),[reload,setReload]=useState(0);
  const [host,setHost]=useState(''),[port,setPort]=useState(465),[password,setPassword]=useState(''),[cc,setCc]=useState(''),[requiredCc,setRequiredCc]=useState(''),[accountsCc,setAccountsCc]=useState('');
  useEffect(()=>{const abort=new AbortController();setLoading(true);setLoaded(false);action.setError('');
    mailboxRequest(branch.id,abort.signal).then(data=>{if(abort.signal.aborted)return;setSaved(data.settings);setHost(data.settings?.host||'');setPort(data.settings?.port||465);setCc(data.settings?.cc.join(', ')||'');setRequiredCc(data.cc);setAccountsCc(data.settings?.accountsCc?.join(', ')||'');setLoaded(true);}).catch(error=>{if(!abort.signal.aborted)action.setError(error.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[branch.id,reload]);
  const needsPassword=!saved?.hasPassword||host.trim().toLowerCase()!==saved.host.toLowerCase()||branch.email!==saved.user;
  return <Modal title={`Branch email · ${branch.name}`} onClose={()=>{if(!action.busy){setPassword('');onClose();}}} wide>
    <p className="h-muted">Orders use this branch’s name and email address. Supplier replies return to the same mailbox. Change the name or email under Branches.</p>
    {loading?<p role="status">Loading mailbox settings…</p>:<form onSubmit={event=>{event.preventDefault();void action.run(async()=>{if(!loaded)throw new Error('Load the mailbox settings before saving.');const result=await mailboxRequest(branch.id,undefined,{branchId:branch.id,host:host.trim(),port,secure:port===465,user:branch.email?.trim(),cc,accountsCc,...(password?{password}:{})});setSaved(result.settings);setPassword('');},'Branch mailbox settings saved securely.');}}>
      <div className="h-form-grid"><Field label="Sender name" hint="Taken from the branch name."><input value={branch.name} readOnly/></Field><Field label="From & reply-to email" hint="Taken from the branch email. Replies go to this mailbox."><input value={branch.email||''} readOnly/></Field><Field label="SMTP server" hint="The outgoing mail server supplied by your email provider."><input required disabled={!loaded||action.busy} value={host} placeholder="smtp.your-provider.com" onChange={e=>setHost(e.target.value)}/></Field><Field label="Secure connection"><select disabled={!loaded||action.busy} value={port} onChange={e=>setPort(Number(e.target.value))}><option value={465}>TLS · port 465</option><option value={587}>STARTTLS · port 587</option></select></Field><Field label={needsPassword?'Mailbox password':'New password (leave blank to keep saved password)'} hint="Saved encrypted; never included in exports or displayed again."><input type="password" autoComplete="new-password" disabled={!loaded||action.busy} required={needsPassword} value={password} onChange={e=>setPassword(e.target.value)}/></Field><Field label="Additional CC recipients (optional)" hint="Extra copies for this branch. Separate complete email addresses with commas; no comma after the last address."><input placeholder="manager@example.com, accounts@example.com" disabled={!loaded||action.busy} value={cc} onChange={e=>setCc(e.target.value)}/></Field><Field label="Accounts CC for credit requests" hint="Required before sending a delivery issue or credit request. Separate accounts addresses with commas. These copies are additional to the branch and office copies."><input disabled={!loaded||action.busy} value={accountsCc} placeholder="Your accounts team email" onChange={e=>setAccountsCc(e.target.value)}/></Field><Field label="Automatic office copy" hint="Always included by HTOS. Add extra recipients in the optional CC field, not here."><input readOnly value={requiredCc}/></Field></div>
      <p className="h-muted">This branch ({branch.email||'email not set'}) also receives an automatic copy. You do not need to add the branch or office address again.</p><div className="h-notice">Saving configures this mailbox. Order sending also requires the HTOS email service to be enabled; no test email is sent by this form.</div>
      <div className="h-dialog-foot">{!loaded&&<Button type="button" variant="secondary" onClick={()=>setReload(value=>value+1)}>Retry loading</Button>}<Button type="button" variant="secondary" disabled={action.busy} onClick={onClose}>Close</Button><Button type="submit" busy={action.busy} disabled={!loaded}>Save mailbox settings</Button></div>
    </form>}{action.feedback}
  </Modal>;
}
