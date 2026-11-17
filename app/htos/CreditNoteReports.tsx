import React,{useEffect,useRef,useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {creditNoteReport,creditReportPeriod,londonDate,type CreditReportRow,type CreditPeriod} from '../../shared/credit-note-report';
import {Button,Field,Panel,money,day,api,csv} from './ui';
import './credit-note-reports.css';

type Option={id:string;name:string};
export type CreditReportPage={records:InvoiceCase[];more:boolean;cursor:string|null};
const loadCreditPage=(body:Record<string,string>)=>api('/api/admin/workspace',body,{notifyChange:false}) as Promise<CreditReportPage>;

export function CreditNoteReports({branches,suppliers,loadPage=loadCreditPage,initialDate=londonDate(new Date().toISOString())}:{branches:Option[];suppliers:Option[];loadPage?:(body:Record<string,string>)=>Promise<CreditReportPage>;initialDate?:string}){
  const [mode,setMode]=useState<CreditPeriod>('daily'),[date,setDate]=useState(initialDate),[branch,setBranch]=useState(''),[supplier,setSupplier]=useState('');
  const scope=JSON.stringify([branch,supplier]);
  const [loaded,setLoaded]=useState<{scope:string;records:InvoiceCase[];more:boolean;cursor:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=loaded?.scope===scope?loaded:null;
  const period=creditReportPeriod(date,mode);
  const report=period&&current?creditNoteReport(current.records,period):null;
  async function load(append=false){
    if(running.current)return;running.current=true;setBusy(true);setError('');
    try{
      const result=await loadPage({action:'invoice-case-list',branchId:branch,supplierId:supplier,...(append&&current?{cursor:current.cursor}:{})});
      if(alive.current)setLoaded({scope,records:[...(append&&current?current.records:[]),...result.records],more:result.more,cursor:result.cursor||''});
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Unable to load credits. Try again.');}
    finally{running.current=false;if(alive.current)setBusy(false);}
  }
  function exportReport(){
    if(!report||!period||current?.more||error)return;
    const row=(section:string,r:CreditReportRow)=>[section,r.date,r.branch,r.supplier,r.invoice,r.reference,r.items.join('; '),r.netPence==null?'Not confirmed':(r.netPence/100).toFixed(2),r.status,r.approvedAt||''];
    csv(`HTOS-credit-notes-${period.from}-${period.to}.csv`,[
      ['Credit notes uploaded (Europe/London)',period.from,period.to],
      ['Outstanding follow-ups are current balances, across all dates. Amounts are net GBP.'],
      ['Section','Uploaded / claim sent','Branch','Supplier','Invoice','Credit / claim reference','Items','Net GBP','Status','Approved at'],
      ...report.notes.map(r=>row('Credit notes in period',r)),...report.undated.map(r=>row('Upload date unknown',r)),...report.followUps.map(r=>row('Current follow-up (all dates)',r)),
    ]);
  }
  return <section className="cr-report" aria-label="Credit note reports">
    <h1>Credit notes</h1><p>Daily or weekly credit notes, with outstanding claims below. Saved invoice-workflow records only.</p>
    <div className="cr-filters">
      <Field label="Report"><select value={mode} onChange={e=>setMode(e.target.value as CreditPeriod)}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Field>
      <Field label={mode==='daily'?'Day':'Any day in the week'}><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field>
      <Field label="Branch"><select value={branch} onChange={e=>{setBranch(e.target.value);setError('');}}><option value="">All authorised branches</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Supplier"><select value={supplier} onChange={e=>{setSupplier(e.target.value);setError('');}}><option value="">All authorised suppliers</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Button busy={busy} disabled={!period} onClick={()=>void load()}>{current?'Refresh report':'Load report'}</Button>
    </div>
    {!period&&<p role="alert">Choose a valid date.</p>}
    {error&&<p className="h-notice error" role="alert">{error} {current?'Previously loaded records remain below. Export is paused until a successful load.':''}</p>}
    {!current&&!busy&&<p role="status">Choose your filters, then load the report.</p>}
    {busy&&<p role="status">Loading saved invoice records…</p>}
    {current&&report&&period&&<>
      <div className="cr-result-bar"><p role="status">{day(period.from)}{period.to!==period.from?' – '+day(period.to):''} · {report.notes.length} credit document{report.notes.length===1?'':'s'}{current.more?' · Partial report — more records to load':''}</p><Button variant="secondary" disabled={busy||current.more||!!error} onClick={exportReport}>Export CSV</Button></div>
      {current.more&&<p className="h-notice">This report is incomplete. Load more records before relying on the results. <Button variant="secondary" busy={busy} onClick={()=>void load(true)}>Load more records</Button></p>}
      <Panel title="Credit notes uploaded" subtitle="Grouped by upload date in UK time, not invoice date. Amounts exclude VAT."><CreditRows rows={report.notes} empty="No credit notes uploaded in this period."/></Panel>
      {!!report.undated.length&&<Panel title="Upload date needs checking" subtitle="These documents cannot be assigned to a daily or weekly report."><CreditRows rows={report.undated}/></Panel>}
      <Panel title="Outstanding follow-ups" subtitle="Current unsettled claims across all dates, including older claims. Approved credits and confirmed replacements reduce the balance; pending notes do not."><CreditRows rows={report.followUps} followUp empty="No outstanding claims in the loaded records."/></Panel>
      <p className="cr-footnote">Read-only report. Credit approval and invoice approval are separate. Legacy order claims are not included.</p>
    </>}
  </section>;
}
function CreditRows({rows,followUp=false,empty='No records.'}:{rows:CreditReportRow[];followUp?:boolean;empty?:string}){
  if(!rows.length)return <p className="cr-empty">{empty}</p>;
  return <div className="h-table-wrap"><table className="h-table cr-table"><thead><tr><th>{followUp?'Claim sent':'Uploaded'}</th><th>Branch / supplier</th><th>Invoice / credit</th><th>Items</th><th>{followUp?'Outstanding (net)':'Credit (net)'}</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}>
    <td data-label={followUp?'Claim sent':'Uploaded'}>{r.date?day(r.date):'Date not confirmed'}</td>
    <td data-label="Branch / supplier"><strong>{r.branch}</strong><small>{r.supplier}</small></td>
    <td data-label="Invoice / credit"><strong>{r.invoice}</strong><small>{r.reference}</small></td>
    <td data-label="Items">{r.items.join(', ')||'Items to confirm'}</td>
    <td data-label={followUp?'Outstanding (net)':'Credit (net)'}>{r.netPence==null?'Not confirmed':money(r.netPence/100)}</td>
    <td data-label="Status"><span className={`h-tag ${r.status==='Credit approved'?'success':'warning'}`}>{r.status}</span>{r.approvedAt&&<small>Approved {day(r.approvedAt)}</small>}</td>
  </tr>)}</tbody></table></div>;
}
