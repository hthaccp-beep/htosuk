import React,{useState} from 'react';
import {useAppStore} from '../../store';
import {Button,Field,Panel,api,useAction} from './ui';

export function ConfigurationRestore(){
 const user=useAppStore(s=>s.currentUser),action=useAction();
 const [batches,setBatches]=useState<any[]>([]),[preview,setPreview]=useState<any[]>([]),[filename,setFilename]=useState(''),[progress,setProgress]=useState(''),[confirmed,setConfirmed]=useState(false);
 if(user?.role!=='CREATOR')return null;
 const load=async(file:File)=>{
  setBatches([]);setPreview([]);setConfirmed(false);setProgress('');
  if(file.size>80*1024*1024)throw new Error('Use a backup smaller than 80 MB.');
  const json=JSON.parse(await file.text()),data=json.data||json;
  const next:any[]=[];
  for(const collection of ['branches','suppliers','categories','products','roles']){
   if(data[collection]!==undefined&&!Array.isArray(data[collection]))throw new Error(`Invalid ${collection} list.`);
   const records=data[collection]||[];if(new Set(records.map((r:any)=>r.id)).size!==records.length)throw new Error(`Duplicate IDs in ${collection}.`);
   for(let i=0;i<records.length;i+=100)next.push({collection,records:records.slice(i,i+100)});
  }
  const settings=json.settings||{...(data.rolePermissions?{role_permissions:{map:data.rolePermissions}}:{}),...(data.emailConfig?{email_config:data.emailConfig}:{}),...(data.priceMonitoringSettings?{price_monitoring:data.priceMonitoringSettings}:{})};
  for(const id of ['role_permissions','price_monitoring','email_config'])if(settings[id])next.push({collection:'settings',records:[{...settings[id],id}]});
  if(!next.length)throw new Error('No supported configuration records found.');
  setBatches(next);setFilename(file.name);
 };
 const inspect=()=>action.run(async()=>{setPreview([]);setConfirmed(false);const results=[];for(let i=0;i<batches.length;i++){setProgress(`Checking batch ${i+1} of ${batches.length}`);results.push(await api('/api/admin/workspace',{action:'restore-preview',...batches[i]}));}setPreview(results);setProgress('Preview complete. No changes made.');},'');
 const restore=()=>action.run(async()=>{
  if(!confirmed||preview.length!==batches.length)throw new Error('Preview and confirm the backup first.');
  const plans=preview;setPreview([]);setConfirmed(false);
  for(let i=0;i<batches.length;i++){setProgress(`Restoring batch ${i+1} of ${batches.length}. Completed batches: ${i}.`);const r=await api('/api/admin/workspace',{action:'restore-commit',...batches[i],expected:plans[i].expected});if(r.auditWarning)useAppStore.getState().showToast('warning',r.auditWarning);}
  setProgress('Configuration restored.');setBatches([]);
 },'Configuration restored successfully.');
 return <Panel title="Restore configuration" subtitle="Owner only · Preview and confirm before applying">
  <div className="h-settings-body">
   <p>Restore branches, suppliers, categories, products, roles and operating settings from a JSON backup.</p>
   <p className="h-restore-warning">Matching IDs will be updated. Records missing from the backup are kept. Download a current backup before continuing.</p>
   <p className="h-muted">This does not overwrite orders, team accounts, passwords or mailbox credentials.</p>
   <Field label="Choose a JSON backup"><input type="file" accept=".json,application/json" disabled={action.busy} onChange={e=>{const file=e.target.files?.[0];if(file)void action.run(()=>load(file),'File checked. Preview the changes before applying.');e.target.value='';}}/></Field>
   {batches.length>0&&<><p>{filename} · {batches.reduce((sum,b)=>sum+b.records.length,0)} configuration records</p><Button variant="secondary" busy={action.busy} onClick={inspect}>Preview configuration restore</Button></>}
   {preview.length>0&&<><p>{preview.reduce((n,p)=>n+p.create,0)} new records · {preview.reduce((n,p)=>n+p.update,0)} existing records to update</p><label className="h-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I have downloaded a current backup and want to apply these configuration changes, including any role permissions.</label><Button disabled={!confirmed} busy={action.busy} onClick={restore}>Confirm configuration restore</Button></>}
   {progress&&<p role="status" className="h-muted">{progress}</p>}{action.feedback}
   <details className="h-settings-details"><summary>If a restore is interrupted</summary><p>Each batch is checked for changes since preview. Completed batches remain saved if interrupted. Preview again to continue.</p></details>
  </div>
 </Panel>;
}
