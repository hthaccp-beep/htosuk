import {createHash,randomUUID} from 'node:crypto';
import type {Firestore,Transaction} from 'firebase-admin/firestore';
import release from '../app-version.json' with {type:'json'};
import type {HelpAnalysis,HelpImage,HelpIssue} from '../shared/help.ts';
import {HelpError,helpId,text,validateAnalysis,validateProposal,validateReport} from './help-validation.ts';
import {analyseHelp,helpAIAvailable} from './help-analysis.ts';

interface Services {now?:()=>Date; version?:string; aiAvailable?:()=>boolean; analyse?:(issue:HelpIssue,images:HelpImage[])=>Promise<HelpAnalysis>}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const summaryFields=['title','reporterName','createdAt','sortKey','status','version','page','imageCount'];
async function authorise(db:Firestore,tx:Transaction,uid:string,owner:boolean){
  const user=(await tx.get(db.collection('users').doc(uid))).data();
  if(user?.active!==true||owner&&user.role!=='CREATOR')throw new HelpError(owner?'Only the workspace owner can open Issues or approve repairs.':'Please sign in with an active account.',403);
  return user;
}
export async function helpAction(db:Firestore,uid:string,body:any,services:Services={}){
  const now=services.now||(()=>new Date()),version=services.version||release.version,available=services.aiAvailable||helpAIAvailable;
  const action=body?.action;
  if(!['help-submit','help-list','help-get','help-analyse','help-propose','help-approve','help-close'].includes(action))throw new HelpError('Unknown Help action.');
  if(action==='help-submit'){
    const id=helpId(body.id),report=validateReport(body.report),fingerprint=hash(report);
    return db.runTransaction(async tx=>{
      const user=await authorise(db,tx,uid,false),ref=db.collection('help_issues').doc(id),existing=(await tx.get(ref)).data();
      if(existing){if(existing.reporterId!==uid||existing.fingerprint!==fingerprint)throw new HelpError('This report reference was already used. Start a new report.',409);return {id};}
      const date=now(),bucket=date.toISOString().slice(0,13),limitRef=db.collection('help_limits').doc(hash(['reports',uid,bucket])),limit=(await tx.get(limitRef)).data();
      if((limit?.count||0)>=10)throw new HelpError('You have sent ten reports this hour. Please try later.',429);
      const {images,...details}=report;
      tx.create(ref,{...details,id,reporterId:uid,reporterName:String(user.displayName||'HTOS user').slice(0,120),fingerprint,createdAt:date.toISOString(),sortKey:date.toISOString()+'_'+id,status:'new',imageCount:images.length,analysisCount:0});
      if(images.length)tx.create(ref.collection('private').doc('screenshots'),{images});
      tx.set(limitRef,{count:(limit?.count||0)+1,expiresAt:new Date(date.getTime()+86400000)});
      return {id};
    });
  }
  if(action==='help-list')return db.runTransaction(async tx=>{
    await authorise(db,tx,uid,true);
    let query=db.collection('help_issues').orderBy('sortKey','desc').limit(20).select(...summaryFields);
    if(body.cursor!==undefined){if(typeof body.cursor!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[a-f0-9-]{36}$/i.test(body.cursor))throw new HelpError('Invalid inbox page.');query=query.startAfter(body.cursor);}
    const snapshot=await tx.get(query);return {issues:snapshot.docs.map(d=>({...d.data(),id:d.id})),cursor:snapshot.size===20?snapshot.docs.at(-1)!.data().sortKey:null};
  });
  const id=helpId(body.id),ref=db.collection('help_issues').doc(id);
  if(action==='help-get')return db.runTransaction(async tx=>{
    await authorise(db,tx,uid,true);const issue=(await tx.get(ref)).data();if(!issue)throw new HelpError('Report not found.',404);
    const images=issue.imageCount?(await tx.get(ref.collection('private').doc('screenshots'))).data()?.images||[]:[];
    const {fingerprint,reporterId,analysisLock,...safe}=issue;return {issue:safe,images,aiAvailable:available(),currentVersion:version};
  });
  if(action==='help-analyse'){
    const lock=randomUUID();
    const input=await db.runTransaction(async tx=>{
      await authorise(db,tx,uid,true);const issue=(await tx.get(ref)).data() as HelpIssue&{analysisCount?:number;analysisLock?:{until:number}};
      if(!issue)throw new HelpError('Report not found.',404);
      if(!available())throw new HelpError('AI analysis is not enabled. Reports and manual review still work.',503);
      if(!issue.aiConsent)throw new HelpError('The reporter did not consent to AI analysis. Review this report manually.');
      if(issue.status==='closed')throw new HelpError('This issue is closed.');
      const date=now();if(issue.analysisLock&&issue.analysisLock.until>date.getTime())throw new HelpError('Analysis is already running. Wait, then reopen this issue.',409);
      if((issue.analysisCount||0)>=3)throw new HelpError('This report has reached its three-analysis limit. Review it manually.',429);
      const limitRef=db.collection('help_limits').doc(hash(['analysis',uid,date.toISOString().slice(0,10)])),limit=(await tx.get(limitRef)).data();
      if((limit?.count||0)>=10)throw new HelpError('The daily AI limit has been reached. Review reports manually.',429);
      const images=issue.imageCount?(await tx.get(ref.collection('private').doc('screenshots'))).data()?.images||[]:[];
      tx.set(ref,{...issue,analysisCount:(issue.analysisCount||0)+1,analysisLock:{id:lock,until:date.getTime()+180000},analysisError:''});
      tx.set(limitRef,{count:(limit?.count||0)+1,expiresAt:new Date(date.getTime()+172800000)});
      return {issue,images};
    });
    let analysis:HelpAnalysis|undefined;
    try{analysis=validateAnalysis(await (services.analyse||analyseHelp)(input.issue,input.images));}catch{/* Provider details can contain secrets: never return them. */}
    await db.runTransaction(async tx=>{
      await authorise(db,tx,uid,true);const issue=(await tx.get(ref)).data();
      if(!issue||issue.analysisLock?.id!==lock)return;
      tx.set(ref,{...issue,analysisLock:null,...(analysis?{analysis,analysisAt:now().toISOString(),status:issue.status==='new'?'analysed':issue.status}:{analysisError:'AI analysis could not finish. Review manually or retry within the limit.'})});
    });
    if(!analysis)throw new HelpError('AI analysis could not finish. The report is safe; no repair was made.',502);
    return {analysis};
  }
  return db.runTransaction(async tx=>{
    await authorise(db,tx,uid,true);const issue=(await tx.get(ref)).data();if(!issue)throw new HelpError('Report not found.',404);
    if(issue.status==='closed')throw new HelpError('This issue is closed.');
    const at=now().toISOString();
    if(action==='help-propose'){
      if((issue.proposal?.hash||'')!==body.expectedHash)throw new HelpError('The proposal changed. Reopen the issue before continuing.',409);
      const details=validateProposal(body.proposal,version),proposal={...details,hash:hash(details),proposedAt:at};
      // Replacing any proposal invalidates its approval. Preserve an audit copy.
      if(issue.proposal)tx.set(ref.collection('history').doc(randomUUID()),{proposal:issue.proposal,approval:issue.approval||null,replacedAt:at,replacedBy:uid});
      tx.set(ref,{...issue,proposal,approval:null,status:'awaiting_approval'});return {proposal};
    }
    if(action==='help-approve'){
      if(!issue.proposal||issue.proposal.hash!==body.hash)throw new HelpError('The proposal changed. Read the latest proposal before approving.',409);
      validateProposal(issue.proposal,version);
      if(issue.approval?.hash===body.hash)return {approved:true};
      if(body.confirm!==true)throw new HelpError('Confirm this exact repair and target version.');
      tx.set(ref,{...issue,status:'approved',approval:{hash:body.hash,by:uid,at}});return {approved:true};
    }
    if((issue.proposal?.hash||'')!==body.expectedHash)throw new HelpError('The proposal changed. Reopen the issue.',409);
    const reason=text(body.reason,'Reason for closing without a release',1000);
    tx.set(ref,{...issue,status:'closed',closeReason:reason,closedAt:at,closedBy:uid});return {closed:true};
  });
}
