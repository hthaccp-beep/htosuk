import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditNoteReport,creditReportPeriod,londonDate} from '../shared/credit-note-report.ts';
import {sampleReviewed,sampleStaff} from './fixtures/invoice-workflow.ts';
import {invoiceMemoryStore} from './fixtures/invoice-memory-store.ts';
import {invoiceCaseAction} from '../server/invoice-case-service.ts';

function fixture(){
 const r=sampleReviewed('credit-report-sample'),lineId=r.lines[0].id;
 r.documents.push({id:'credit-doc',kind:'CREDIT',name:'SAMPLE-CN.pdf',mime:'application/pdf',size:100,sha256:'sample',uploadedAt:'2026-11-17T10:00:00Z',uploadedBy:'sample'});
 r.credits=[{id:'note',reference:'SAMPLE-CN',documentId:'credit-doc',invoiceReference:r.invoiceReference,supplierId:r.supplierId,lines:[{lineId,netPence:1800}],vatPence:0,grossPence:1800,verified:true,status:'DRAFT'}];
 r.claim={id:'sample-claim',revision:1,state:'SENT',sentAt:'2026-10-01T10:00:00Z',recipient:'sample@example.test',subject:'Sample',message:'Sample',lines:[{lineId,quantity:2,netPence:3600,creditedPence:0,replacementPence:0,reason:'Missing'}]};
 return r;
}
const period={from:'2026-11-17',to:'2026-11-17'};
test('daily and Monday–Sunday weekly windows validate dates and cross year boundaries',()=>{
 assert.deepEqual(creditReportPeriod('2026-11-17','daily'),period);
 assert.deepEqual(creditReportPeriod('2026-11-22','weekly'),{from:'2026-11-16',to:'2026-11-22'});
 assert.deepEqual(creditReportPeriod('2027-01-01','weekly'),{from:'2026-12-28',to:'2027-01-03'});
 assert.equal(creditReportPeriod('2026-02-30','daily'),null);assert.equal(creditReportPeriod('','weekly'),null);
});
test('UK dates account for summer midnight and winter clock change',()=>{
 assert.equal(londonDate('2026-07-01T23:30:00Z'),'2026-07-02');
 assert.equal(londonDate('2026-10-25T23:30:00Z'),'2026-10-25');assert.equal(londonDate('bad'),'');
});
test('uses upload date, not old invoice date or later approval date',()=>{
 const r=fixture();r.credits[0].approvedAt='2026-11-20T10:00:00Z';r.credits[0].status='APPROVED';
 assert.equal(creditNoteReport([r],period).notes.length,1);
 assert.equal(creditNoteReport([r],{from:'2026-11-20',to:'2026-11-20'}).notes.length,0);
});
test('pending notes do not settle claims; approved credits and replacements are distinct',()=>{
 const r=fixture(),before=structuredClone(r);
 let result=creditNoteReport([r],period);assert.equal(result.followUps[0].netPence,3600);assert.equal(result.notes[0].status,'Needs Accounts review');assert.deepEqual(r,before);
 r.credits[0].status='APPROVED';r.claim!.lines[0].creditedPence=1800;r.claim!.lines[0].replacementPence=900;
 result=creditNoteReport([r],period);assert.equal(result.notes[0].netPence,1800);assert.equal(result.followUps[0].netPence,900);
 r.claim!.lines[0].replacementPence=1800;assert.equal(creditNoteReport([r],period).followUps.length,0);
});
test('deduplicates paginated cases and notes using latest version',()=>{
 const r=fixture(),newer=structuredClone(r);newer.version++;newer.credits.push(structuredClone(newer.credits[0]));newer.credits[0].status='APPROVED';
 const out=creditNoteReport([newer,r,newer],period);assert.equal(out.notes.length,1);assert.equal(out.notes[0].status,'Credit approved');assert.equal(out.followUps.length,1);
});
test('shows documents awaiting entry and undated notes instead of hiding them or inventing zero',()=>{
 const r=fixture();r.documents.push({...r.documents[1],id:'unentered',name:'SAMPLE-NEW.pdf'});
 let out=creditNoteReport([r],period);assert.equal(out.notes.length,2);assert.equal(out.notes.find(n=>n.status==='Details to enter')?.netPence,undefined);
 r.documents=r.documents.filter(d=>d.id!=='credit-doc');(r.credits[0].lines[0] as any).netPence=undefined;
 out=creditNoteReport([r],period);assert.equal(out.undated.length,1);assert.equal(out.undated[0].netPence,undefined);
});
test('unconfirmed or invalid claim balances are flagged, never zero',()=>{
 const r=fixture();r.claim!.lines[0].creditedPence=4000;
 assert.equal(creditNoteReport([r],period).followUps[0].netPence,undefined);
 r.claim!.state='UNCERTAIN';assert.equal(creditNoteReport([r],period).followUps[0].status,'Claim delivery to confirm');
});
test('existing report data endpoint rejects staff without Accounts and price permission before any invoice read',async()=>{
 for(const permissions of [['scan_invoices'],['review_invoices']]){
  const user={...sampleStaff,customPermissions:permissions};
  const memory=invoiceMemoryStore([['users/'+user.id,user],['settings/role_permissions',{map:{}}]]);
  await assert.rejects(()=>invoiceCaseAction(memory.db,user.id,{action:'invoice-case-list'},true),/Accounts review permission/);
  assert.ok(memory.reads.every(p=>!p.startsWith('_invoice_cases')));
 }
});
