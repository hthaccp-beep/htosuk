import type {InvoiceCase} from './invoice-case.ts';

export type CreditPeriod = 'daily' | 'weekly';
export interface CreditReportRow {
  id:string; caseId:string; date:string; branch:string; supplier:string; invoice:string;
  reference:string; items:string[]; netPence?:number; status:string; approvedAt?:string;
}
const validPence=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function londonDate(value:string):string {
  const date=new Date(value);
  if(!value||!Number.isFinite(date.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
}
export function creditReportPeriod(date:string,mode:CreditPeriod){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const d=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)return null;
  if(mode==='weekly')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  const from=d.toISOString().slice(0,10);
  if(mode==='weekly')d.setUTCDate(d.getUTCDate()+6);
  return {from,to:d.toISOString().slice(0,10)};
}
/** Read-only projection. No invoice totals, price changes or approval commands. */
export function creditNoteReport(records:InvoiceCase[],period:{from:string;to:string}){
  const notes:CreditReportRow[]=[],undated:CreditReportRow[]=[],followUps:CreditReportRow[]=[];
  const unique=new Map<string,InvoiceCase>();
  for(const r of records)if(!unique.has(r.id)||unique.get(r.id)!.version<r.version)unique.set(r.id,r);
  for(const r of unique.values()){
    const base={caseId:r.id,branch:r.branchName,supplier:r.supplierName,invoice:r.invoiceReference||'Reference not confirmed'};
    const names=(ids:string[])=>[...new Set(ids.map(id=>r.lines.find(l=>l.id===id)?.name||'Item to confirm'))];
    const seen=new Set<string>();
    for(const n of r.credits){
      if(seen.has(n.id))continue;seen.add(n.id);
      const doc=r.documents.find(d=>d.id===n.documentId&&d.kind==='CREDIT');
      const date=londonDate(doc?.uploadedAt||'');
      const netPence=n.lines.length&&n.lines.every(l=>validPence(l.netPence))?n.lines.reduce((sum,l)=>sum+l.netPence,0):undefined;
      const row:CreditReportRow={...base,id:r.id+':'+n.id,date,reference:n.reference||'Reference not confirmed',items:names(n.lines.map(l=>l.lineId)),netPence,status:n.status==='APPROVED'?'Credit approved':'Needs Accounts review',approvedAt:n.approvedAt};
      if(!date)undated.push(row);else if(date>=period.from&&date<=period.to)notes.push(row);
    }
    // Uploaded notes not yet entered into the credit form must not disappear.
    for(const doc of r.documents.filter(d=>d.kind==='CREDIT'&&!r.credits.some(n=>n.documentId===d.id))){
      if(seen.has(doc.id))continue;seen.add(doc.id);
      const row:CreditReportRow={...base,id:r.id+':document:'+doc.id,date:londonDate(doc.uploadedAt),reference:doc.name,items:[],status:'Details to enter'};
      if(!row.date)undated.push(row);else if(row.date>=period.from&&row.date<=period.to)notes.push(row);
    }
    if(r.claim){
      const pending=r.claim.lines.filter(l=>![l.netPence,l.creditedPence,l.replacementPence].every(validPence)||l.netPence-l.creditedPence-l.replacementPence!==0);
      if(pending.length){
        const known=pending.every(l=>[l.netPence,l.creditedPence,l.replacementPence].every(validPence)&&l.netPence>=l.creditedPence+l.replacementPence);
        followUps.push({...base,id:r.id+':claim',date:londonDate(r.claim.sentAt||''),reference:r.claim.id,items:names(pending.map(l=>l.lineId)),netPence:known?pending.reduce((s,l)=>s+l.netPence-l.creditedPence-l.replacementPence,0):undefined,status:r.status==='HOLD'?'On hold':r.claim.state==='SENT'?'Awaiting credit / replacement':r.claim.state==='UNCERTAIN'?'Claim delivery to confirm':r.claim.state==='SENDING'?'Claim sending':'Claim not sent'});
      }
    }
  }
  return {notes:notes.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)),undated,followUps};
}
