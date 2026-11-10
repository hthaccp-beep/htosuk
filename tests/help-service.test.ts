import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {helpAction} from '../server/help-service.ts';
import {validateImages,validateReport} from '../server/help-validation.ts';
import {laterVersion} from '../shared/help.ts';
import {helpAIAvailable} from '../server/help-analysis.ts';

function fixture(){
  const data=new Map<string,any>(Object.entries({'users/owner':{role:'CREATOR',active:true,displayName:'Sample owner'},'users/staff':{role:'STAFF',active:true,displayName:'Sample colleague'},'users/gm':{role:'GM',active:true},'users/inactive':{role:'CREATOR',active:false},'products/p1':{name:'Unchanged product'},'orders/o1':{items:[{price:25}]}}));
  const reads:string[]=[],writes:string[]=[];let tail=Promise.resolve(),fail=false;
  const snap=(path:string,fields?:string[])=>({id:path.split('/').at(-1),exists:data.has(path),data:()=>{const value=structuredClone(data.get(path));return value&&fields?Object.fromEntries(fields.filter(k=>k in value).map(k=>[k,value[k]])):value;}});
  class Query{sort='';direction='asc';count=1000;cursor='';fields?:string[];constructor(public path:string){}doc(id:string){return doc(this.path+'/'+id);}orderBy(sort:string,direction:string){return Object.assign(new Query(this.path),this,{sort,direction});}limit(count:number){return Object.assign(new Query(this.path),this,{count});}select(...fields:string[]){return Object.assign(new Query(this.path),this,{fields});}startAfter(cursor:string){return Object.assign(new Query(this.path),this,{cursor});}}
  const doc=(path:string):any=>({path,collection:(key:string)=>new Query(path+'/'+key)});
  const db:any={collection:(path:string)=>new Query(path),runTransaction:(fn:any)=>{
    const task=tail.then(async()=>{const pending:{path:string;value:any;create:boolean}[]=[];const result=await fn({get:async(ref:any)=>{
      assert.equal(pending.length,0,'Read before writing');reads.push(ref.path);
      if(!(ref instanceof Query))return snap(ref.path);
      let rows=[...data.keys()].filter(p=>p.startsWith(ref.path+'/')&&p.split('/').length===ref.path.split('/').length+1);
      rows.sort((a,b)=>String(data.get(b)[ref.sort]).localeCompare(String(data.get(a)[ref.sort])));if(ref.cursor)rows=rows.filter(p=>data.get(p)[ref.sort]<ref.cursor);rows=rows.slice(0,ref.count);return {docs:rows.map(p=>snap(p,ref.fields)),size:rows.length};
    },create:(ref:any,value:any)=>pending.push({path:ref.path,value,create:true}),set:(ref:any,value:any)=>pending.push({path:ref.path,value,create:false})});
      if(fail){fail=false;throw new Error('Synthetic write failure');}for(const w of pending)if(w.create&&data.has(w.path))throw new Error('Already exists');for(const w of pending){writes.push(w.path);data.set(w.path,structuredClone(w.value));}return result;
    });tail=task.then(()=>{},()=>{});return task;
  }};
  const analysis={summary:'Synthetic analysis',likelyCause:'Possible interface fault',checks:'Check a sample offline',workaround:'Keep the draft',uncertainty:'No source or logs available'};
  const services={version:'8.49',now:()=>new Date('2026-10-18T23:00:00Z'),aiAvailable:()=>true,analyse:async()=>analysis};
  const call=(body:any,uid='owner',options={})=>helpAction(db,uid,body,{...services,...options}) as Promise<any>;
  const report={title:'Synthetic CSV problem',description:'Sample preview did not open',steps:'Choose a sample CSV',expected:'Preview opens',page:'/settings',version:'8.49',aiConsent:true,reviewed:true,images:[]};
  const submit=async(extra={},uid='staff',id=randomUUID())=>{await call({action:'help-submit',id,report:{...report,...extra}},uid);return id;};
  const proposal={summary:'Fix sample preview',tests:'Offline fixture passed; no real data used',risks:'Rollback to previous release if required',revision:'a'.repeat(40),baseVersion:'8.49',targetVersion:'8.50'};
  return {data,reads,writes,call,submit,report,proposal,analysis,fail:()=>{fail=true;}};
}
test('submission is private, bounded and idempotent; no business records are read or changed',async()=>{
  const f=fixture(),before=structuredClone(f.data),id=randomUUID();const payload={action:'help-submit',id,report:f.report};
  await Promise.all([f.call(payload,'staff'),f.call(payload,'staff')]);assert.equal([...f.data.keys()].filter(k=>/^help_issues\/[^/]+$/.test(k)).length,1);
  await assert.rejects(f.call({...payload,report:{...f.report,title:'Changed'}},'staff'),/already used/);
  await assert.rejects(f.call(payload,'owner'),/already used/);
  assert.deepEqual([...before],[...f.data].filter(([p])=>!p.startsWith('help_')));
  assert.ok(f.reads.every(p=>p.startsWith('users/')||p.startsWith('help_')));assert.ok(f.writes.every(p=>p.startsWith('help_')));
});
test('all inbox, AI and repair actions reject staff, GM and inactive owner',async()=>{
  const f=fixture(),id=await f.submit();for(const uid of ['staff','gm','inactive','missing'])for(const action of ['help-list','help-get','help-analyse','help-propose','help-approve','help-close'])await assert.rejects(f.call({action,id},uid),/Only the workspace owner/);
  await assert.rejects(f.submit({},'inactive'),/active account/);await assert.rejects(f.call({action:'help-publish'}),/Unknown/);
});
test('report validation rejects unsafe page data, missing consent review and invalid images',()=>{
  const f=fixture();assert.throws(()=>validateReport({...f.report,page:'/settings?token=secret'}),/Invalid page/);assert.throws(()=>validateReport({...f.report,reviewed:false}),/Check your report/);assert.throws(()=>validateReport({...f.report,description:'x'.repeat(3001)}),/3000/);
  for(const value of [[{mimeType:'image/svg+xml',data:'PHN2Zz4='}],[{mimeType:'image/png',data:'not-image'}],[{mimeType:'image/png',data:'A'.repeat(300000)}],[{}, {}, {}]])assert.throws(()=>validateImages(value));
});
test('report failure is atomic, retry succeeds, hourly rate limit is enforced',async()=>{
  const f=fixture(),id=randomUUID(),before=structuredClone(f.data);f.fail();await assert.rejects(f.submit({},'staff',id),/Synthetic/);assert.deepEqual(f.data,before);await f.submit({},'staff',id);
  for(let i=0;i<9;i++)await f.submit();await assert.rejects(f.submit(),/ten reports/);await f.submit({},'staff',id);
});
test('inbox pagination returns bounded summaries without descriptions or screenshots',async()=>{
  const f=fixture();for(let i=0;i<25;i++){const id=randomUUID();f.data.set('help_issues/'+id,{id,title:`Sample ${i}`,description:'Private long detail',sortKey:`2026-10-18T22:00:${String(i).padStart(2,'0')}.000Z_${id}`,status:'new',reporterId:'staff',fingerprint:'private'});}
  const first=await f.call({action:'help-list'});assert.equal(first.issues.length,20);assert.equal(first.issues[0].description,undefined);assert.equal(first.issues[0].fingerprint,undefined);assert.ok(first.cursor);
  const second=await f.call({action:'help-list',cursor:first.cursor});assert.equal(second.issues.length,5);assert.equal(second.cursor,null);assert.equal(new Set([...first.issues,...second.issues].map(i=>i.id)).size,25);
  await assert.rejects(f.call({action:'help-list',cursor:'bad'}),/Invalid inbox/);
  const id=await f.submit();const detail=await f.call({action:'help-get',id});assert.equal(detail.issue.reporterId,undefined);assert.equal(detail.issue.fingerprint,undefined);assert.equal(detail.currentVersion,'8.49');assert.deepEqual(detail.images,[]);
});
test('screenshots are stored separately, returned only to the owner, and not included in inbox queries',async()=>{
  const f=fixture(),image={mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
  const id=await f.submit({images:[image]});assert.equal(f.data.get('help_issues/'+id).images,undefined);assert.deepEqual(f.data.get('help_issues/'+id+'/private/screenshots').images,[image]);
  f.reads.length=0;const list=await f.call({action:'help-list'});assert.equal(list.issues[0].imageCount,1);assert.equal(list.issues[0].images,undefined);assert.equal(f.reads.some(p=>p.includes('/private/')),false);
  const detail=await f.call({action:'help-get',id});assert.deepEqual(detail.images,[image]);await assert.rejects(f.call({action:'help-get',id},'staff'),/Only the workspace owner/);
});
test('AI enforces the daily limit across reports and retains reports after invalid provider output',async()=>{
  const f=fixture();for(let i=0;i<4;i++){const id=await f.submit();for(let j=0;j<(i===3?1:3);j++)await f.call({action:'help-analyse',id});}
  const id=await f.submit();await assert.rejects(f.call({action:'help-analyse',id}),/daily AI limit/);
  const g=fixture(),other=await g.submit();await assert.rejects(g.call({action:'help-analyse',id:other},'owner',{analyse:async()=>({summary:'<script>unsafe()</script>'})}),/could not finish/);assert.equal(g.data.get('help_issues/'+other).analysis,undefined);assert.equal(g.data.get('help_issues/'+other).title,g.report.title);
});
test('AI is opt-in and gated; failures are sanitised and no repair is performed',async()=>{
  const f=fixture();let count=0;const options={analyse:async()=>{count++;throw new Error('secret-provider-key');}};
  const noConsent=await f.submit({aiConsent:false});await assert.rejects(f.call({action:'help-analyse',id:noConsent},'owner',options),/did not consent/);assert.equal(count,0);
  const id=await f.submit();await assert.rejects(f.call({action:'help-analyse',id},'owner',{...options,aiAvailable:()=>false}),/not enabled/);assert.equal(count,0);
  await assert.rejects(f.call({action:'help-analyse',id},'owner',options),e=>!String(e).includes('secret-provider')&&/could not finish/.test(String(e)));assert.equal(count,1);assert.equal(f.data.get('help_issues/'+id).analysisLock,null);
  await f.call({action:'help-analyse',id});const detail=await f.call({action:'help-get',id});assert.deepEqual(detail.issue.analysis,f.analysis);assert.equal(detail.issue.status,'analysed');assert.equal(detail.issue.proposal,undefined);
  await f.call({action:'help-analyse',id});await assert.rejects(f.call({action:'help-analyse',id}),/three-analysis/);
});
test('simultaneous AI requests share a lock and owner permission is checked again before saving',async()=>{
  const f=fixture(),id=await f.submit();let finish!:(value:any)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);
  const task=f.call({action:'help-analyse',id},'owner',{analyse:()=>{started();return new Promise(resolve=>finish=resolve);}});await ready;
  await assert.rejects(f.call({action:'help-analyse',id}),/already running/);f.data.set('users/owner',{role:'STAFF',active:true});finish(f.analysis);await assert.rejects(task,/Only the workspace owner/);assert.equal(f.data.get('help_issues/'+id).analysis,undefined);
});
test('repairs need a tested proposal, higher version and exact owner approval; edits invalidate approval',async()=>{
  const f=fixture(),id=await f.submit();await assert.rejects(f.call({action:'help-approve',id,hash:'wrong',confirm:true}),/proposal changed/);
  for(const patch of [{targetVersion:'8.49'},{baseVersion:'8.48'},{tests:''},{revision:'short'}])await assert.rejects(f.call({action:'help-propose',id,expectedHash:'',proposal:{...f.proposal,...patch}}));
  const {proposal}=await f.call({action:'help-propose',id,expectedHash:'',proposal:f.proposal});
  await assert.rejects(f.call({action:'help-approve',id,hash:proposal.hash,confirm:false}),/Confirm/);
  await assert.rejects(f.call({action:'help-approve',id,hash:'stale',confirm:true}),/proposal changed/);
  await f.call({action:'help-approve',id,hash:proposal.hash,confirm:true});assert.equal(f.data.get('help_issues/'+id).status,'approved');
  await f.call({action:'help-approve',id,hash:proposal.hash,confirm:true});
  await f.call({action:'help-propose',id,expectedHash:proposal.hash,proposal:{...f.proposal,summary:'Revised repair'}});assert.equal(f.data.get('help_issues/'+id).approval,null);assert.equal(f.data.get('help_issues/'+id).status,'awaiting_approval');assert.ok([...f.data.keys()].some(k=>k.includes('/history/')));
  await assert.rejects(f.call({action:'help-approve',id,hash:proposal.hash,confirm:true}),/proposal changed/);
});
test('version changes stop stale approval; closing never claims a release',async()=>{
  const f=fixture(),id=await f.submit();const {proposal}=await f.call({action:'help-propose',id,expectedHash:'',proposal:f.proposal});
  await assert.rejects(f.call({action:'help-approve',id,hash:proposal.hash,confirm:true},'owner',{version:'8.50'}),/current base version/);
  await f.call({action:'help-close',id,expectedHash:proposal.hash,reason:'Duplicate report; no release'});assert.equal(f.data.get('help_issues/'+id).status,'closed');await assert.rejects(f.call({action:'help-approve',id,hash:proposal.hash,confirm:true}),/closed/);
  assert.equal(laterVersion('8.50','8.49'),true);assert.equal(laterVersion('8.09','8.49'),false);assert.equal(laterVersion('9.01','8.99'),true);
});
test('help collections are explicitly private and deployed server includes release metadata',()=>{
  const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');assert.match(rules,/match \/help_issues\/\{record=\*\*\} \{ allow read, write: if false;/);assert.match(rules,/match \/help_limits\/\{record=\*\*\} \{ allow read, write: if false;/);
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));assert.match(config.functions['api/**/*.ts'].includeFiles,/app-version.json/);
});
test('real AI adapter is disabled by default and refuses emulator mode',()=>{
  const flag=process.env.HTOS_ENABLE_HELP_AI,mode=process.env.HTOS_MODE;
  try{delete process.env.HTOS_ENABLE_HELP_AI;assert.equal(helpAIAvailable(),false);process.env.HTOS_ENABLE_HELP_AI='true';process.env.HTOS_MODE='emulator';assert.equal(helpAIAvailable(),false);}
  finally{if(flag===undefined)delete process.env.HTOS_ENABLE_HELP_AI;else process.env.HTOS_ENABLE_HELP_AI=flag;if(mode===undefined)delete process.env.HTOS_MODE;else process.env.HTOS_MODE=mode;}
});
