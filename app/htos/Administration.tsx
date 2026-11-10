import React, {lazy, Suspense, useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {can,useAppStore} from '../../store';
import type {Permission,Branch} from '../../types';
import {Heading,Panel,Button,Field,Empty,Tag,api,useAction} from './ui';


const ProductWorkbench=lazy(()=>import('./ProductWorkbench').then(m=>({default:m.ProductWorkbench})));
import {ConfigurationRestore} from './ConfigurationRestore';
import {ToastContainer} from '../../components/Toast';
import './admin.css';
import './settings-polish.css';
import {useDatabaseStatus} from '../../hooks/databaseStatus';

const Users=lazy(()=>import('../../components/admin/AdminUsers').then(m=>({default:m.AdminUsers})));
const Roles=lazy(()=>import('../../components/admin/AdminRoles').then(m=>({default:m.AdminRoles})));
const Branches=lazy(()=>import('../../components/admin/AdminBranches').then(m=>({default:m.AdminBranches})));
const Suppliers=lazy(()=>import('../../components/admin/AdminSuppliers').then(m=>({default:m.AdminSuppliers})));
const Categories=lazy(()=>import('../../components/admin/AdminCategories').then(m=>({default:m.AdminCategories})));
const Products=lazy(()=>import('../../components/admin/AdminProducts').then(m=>({default:m.AdminProducts})));
const Approvals=lazy(()=>import('./Catalogue').then(m=>({default:m.PriceDesk})));
const Prices=lazy(()=>import('../../pages/PriceManagement/PriceSettingsView').then(m=>({default:m.PriceSettingsView})));
const Audit=lazy(()=>import('../../components/admin/AdminAuditLogs').then(m=>({default:m.AdminAuditLogs})));

export const adminSections:{id:string;label:string;group:string;permission:Permission}[]=[
 {id:'users',label:'Team',group:'User',permission:'manage_users'},
 {id:'roles',label:'Roles & access',group:'User',permission:'manage_roles'},
 {id:'branches',label:'Branches',group:'Locations',permission:'manage_branches'},
 {id:'suppliers',label:'Suppliers',group:'Locations',permission:'manage_suppliers'},
 {id:'products',label:'Products',group:'Catalogue',permission:'manage_products'},
 {id:'categories',label:'Categories',group:'Catalogue',permission:'manage_categories'},
 {id:'approvals',label:'Price approvals & history',group:'Catalogue',permission:'view_price_changes'},
 {id:'prices',label:'Price monitoring',group:'Catalogue',permission:'manage_price_monitoring'},
 {id:'email',label:'Service status',group:'System',permission:'manage_email_config'},
 {id:'audit',label:'Audit history',group:'System',permission:'view_audit_logs'},
 {id:'system',label:'Backup & restore',group:'System',permission:'manage_data'},
];
export function Administration(){
 const store=useAppStore(),[params,setParams]=useSearchParams();
 const allowed=adminSections.filter(s=>can(store.currentUser,s.permission));
 const requested=params.get('tab')||allowed[0]?.id;
 const tab=requested==='services'?'email':requested==='import'?'system':requested;
 const current=allowed.find(s=>s.id===tab);
 useEffect(()=>{if(!params.get('tab')&&allowed[0])setParams({tab:allowed[0].id},{replace:true});},[params,allowed[0]?.id,setParams]);
 const groups=[...new Set(allowed.map(s=>s.group))];
 const components:Record<string,React.ReactNode>={users:<Users/>,roles:<Roles/>,branches:<Branches/>,suppliers:<Suppliers/>,categories:<Categories/>,products:<ProductsSection/>,approvals:<Approvals/>,prices:<Prices/>,email:<EmailSettings/>,audit:<AuditHistory/>,system:<BackupSettings/>};
 const focusedEditor=tab==='products'&&params.get('view')==='bulk';
 return <>{!focusedEditor&&<><Heading eyebrow="WORKSPACE SETTINGS" title="Settings">Manage users, branches, suppliers and your catalogue.</Heading>
 <nav className="h-settings-groups" aria-label="Settings groups">{groups.map(group=><button key={group} aria-current={current?.group===group?'page':undefined} className={current?.group===group?'active':''} onClick={()=>setParams({tab:allowed.find(s=>s.group===group)!.id})}>{group}</button>)}</nav>
 <nav className="h-tabs" aria-label="Administration sections">{allowed.filter(s=>s.group===current?.group).map(s=><button key={s.id} aria-current={s.id===tab?'page':undefined} className={s.id===tab?'active':''} onClick={()=>setParams({tab:s.id})}>{s.label}</button>)}</nav></>}
 {current?<Suspense fallback={<p role="status">Loading {current.label.toLowerCase()}…</p>}><div className={['email','system','import','products','approvals'].includes(current.id)?'':'h-admin'} key={current.id}>{components[current.id]}</div></Suspense>:<Empty title="Choose an available settings group"/>}
 <div className="h-admin"><ToastContainer/></div></>;
}
function EmailSettings(){
 const [,setParams]=useSearchParams();
 const [services,setServices]=useState<any>(null),[statusError,setStatusError]=useState('');
 useEffect(()=>{let active=true;api('/api/admin/workspace',{action:'status'}).then(r=>{if(active)setServices(r);}).catch(e=>{if(active)setStatusError(e.message);});return()=>{active=false;};},[]);
 return <div className="h-system-workspace h-service-layout">
  <Panel title="Branch order emails" subtitle="Each branch sends from its own mailbox">
   <div className="h-settings-body"><dl className="h-email-routing">
    <div><dt>Sender name</dt><dd>The ordering branch’s name, shown to the supplier.</dd></div>
    <div><dt>From &amp; reply-to</dt><dd>The ordering branch’s saved email address. Supplier replies return directly to that branch.</dd></div>
    <div><dt>To</dt><dd>The supplier’s saved email address, shown before you confirm and send.</dd></div>
    <div><dt>Automatic copies</dt><dd>The ordering branch and info@hareandtortoise.co.uk receive a copy. Add any other recipients in the branch’s mailbox settings.</dd></div>
   </dl><div className="h-settings-action"><p className="h-muted">Manage sender addresses and mailboxes in each branch’s email settings.</p><Button variant="secondary" onClick={()=>setParams({tab:'branches'})}>Open branch settings</Button></div></div>
  </Panel>
  <Panel title="Service status" subtitle="Configuration check, not a delivery or scanning test">
   <div className="h-settings-body">{statusError?<p className="h-notice error" role="alert">{statusError}</p>:!services?<p role="status">Checking services…</p>:<>
    <section className="h-service-detail"><div className="h-service-heading"><h3>Order email</h3><Tag tone={services.email?'green':'amber'}>{services.email?'Enabled':'Switched off'}</Tag></div><p className="h-muted">Sending requires the email service and a configured mailbox for the ordering branch. Saving mailbox settings does not send a test email.</p></section>
    <section className="h-service-detail"><div className="h-service-heading"><h3>Invoice scanning</h3><Tag tone={services.ocr?'green':'amber'}>{services.ocrStatus||'Status unavailable'}</Tag></div><p className="h-muted">You can enter invoice details manually.</p><details className="h-settings-details"><summary>Scanning setup details</summary><p>{services.ocrDetail}</p></details></section>
   </>}</div>
  </Panel>
 </div>;
}
function AuditHistory(){
 const action=useAction(),[logs,setLogs]=useState<any[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const load=async(older=false)=>{await action.run(async()=>{const result=await api('/api/admin/workspace',{action:'audit',...(older?{cursor}:{})});setLogs(prev=>older?[...prev,...result.logs]:result.logs);setCursor(result.cursor);},'');};
 useEffect(()=>{void load();},[]);
 return <>{action.feedback}<p>Recorded server events. Events before auditing was enabled may not be available.</p><div className="h-detail-actions"><Button variant="secondary" busy={action.busy} onClick={()=>load()}>Refresh</Button>{cursor&&<Button busy={action.busy} onClick={()=>load(true)}>Load older events</Button>}</div><Audit auditLogs={logs}/></>;
}
function BackupSettings(){
 const action=useAction(),user=useAppStore(s=>s.currentUser);
 const backup=()=>action.run(async()=>{const data=await api('/api/admin/workspace',{action:'backup'});const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`HTOS-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'Backup downloaded.');
 return <div className="h-system-workspace">
 <div className="h-backup-layout">
  <Panel title="Download a backup" subtitle="Save a copy before making significant changes">
   <div className="h-settings-body"><p>Download saved business records, including older orders, as a JSON file.</p><dl className="h-backup-scope"><div><dt>Included</dt><dd>Branches, suppliers, categories, products and order history.</dd></div><div><dt>Excluded</dt><dd>Account passwords and private mailbox credentials.</dd></div></dl><p className="h-muted">Keep the downloaded file securely. Downloading does not change your records.</p><Button busy={action.busy} onClick={backup}>Download JSON backup</Button>{action.feedback}</div>
  </Panel>
  <ConfigurationRestore/>
 </div>
 <Panel title="CSV import & export" subtitle="Transfer individual lists separately from a business backup"><div className="h-transfer-list">{([
  ['Users','manage_users',<Users transferOnly/>,'Account passwords are excluded from exports. New accounts need a password column.'],
  ['Branches','manage_branches',<Branches transferOnly/>,'Branch details and ordering locations.'],
  ['Suppliers','manage_suppliers',<Suppliers transferOnly/>,'Supplier details. Product files are under Catalogue → Products → Bulk edit & files.']
 ] as const).filter(([,permission])=>can(user,permission)).map(([label,,controls,description])=><section className="h-transfer-row" key={label}><div><h3>{label}</h3><p>{description}</p></div>{controls}</section>)}</div></Panel></div>;
}

function ProductsSection(){
 const [params,setParams]=useSearchParams();
 const mode=params.get('view')==='bulk'?'bulk':'individual';
 // Supplier choices belong to the current task, never a bookmarked URL.
 useEffect(()=>{if(params.has('supplier'))setParams(prev=>{const next=new URLSearchParams(prev);next.delete('supplier');return next;},{replace:true});},[params,setParams]);
 const setMode=(value:string)=>setParams(prev=>{const next=new URLSearchParams(prev);next.set('view',value);next.delete('supplier');return next;});
 const quotaMessage=useDatabaseStatus(s=>s.quotaMessage);

 return <div className="h-catalogue-workspace">
  {quotaMessage&&<p className="h-notice error" role="alert">Catalogue loading and saving are paused. Keep this page open to retain your file review and edits. Previously loaded products may be out of date.</p>}
  {mode==='individual'?<div className="h-admin"><Products onBulk={()=>setMode('bulk')}/></div>:<ProductWorkbench onIndividual={()=>setMode('individual')}/>}
 </div>;
}
