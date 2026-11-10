// Isolated local database only. No production configuration or credentials.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {helpAction} from '../server/help-service.ts';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8087')throw new Error('Use the isolated Help emulator on 127.0.0.1:8087.');
process.env.METADATA_SERVER_DETECTION='none';
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const project='demo-htos-help',app=initializeApp({projectId:project},'help-test'),db=getFirestore(app),uid='help-owner-'+randomUUID(),id=randomUUID();
const base=`http://127.0.0.1:8087/v1/projects/${project}/databases/(default)/documents`;
const token=(user:string)=>[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({iss:`https://securetoken.google.com/${project}`,aud:project,sub:user,user_id:user,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}})).toString('base64url'),''].join('.');
const options={version:'8.49',aiAvailable:()=>false};
try{
  await db.collection('users').doc(uid).set({role:'CREATOR',active:true,displayName:'Synthetic owner'});
  const report={title:'Emulator report',description:'Synthetic test only',steps:'',expected:'',page:'/settings',version:'8.49',reviewed:true,aiConsent:false,images:[{mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}]};
  await Promise.all([helpAction(db,uid,{action:'help-submit',id,report},options),helpAction(db,uid,{action:'help-submit',id,report},options)]);
  const list:any=await helpAction(db,uid,{action:'help-list'},options);assert.equal(list.issues.filter((i:any)=>i.id===id).length,1);assert.equal(list.issues[0].images,undefined);
  const detail:any=await helpAction(db,uid,{action:'help-get',id},options);assert.equal(detail.images.length,1);assert.equal(detail.aiAvailable,false);
  let denials=0;
  for(const path of [`help_issues/${id}`,`help_issues/${id}/private/screenshots`,`help_limits/test`])for(const method of ['GET','PATCH']){
    const response=await fetch(base+'/'+path,{method,headers:{authorization:'Bearer '+token(uid),'content-type':'application/json'},...(method==='PATCH'?{body:JSON.stringify({fields:{status:{stringValue:'approved'}}})}:{})});assert.equal(response.status,403,await response.text());denials++;
  }
  const proposed:any=await helpAction(db,uid,{action:'help-propose',id,expectedHash:'',proposal:{summary:'Synthetic fix',tests:'Offline test evidence',risks:'Synthetic rollback',revision:'b'.repeat(40),baseVersion:'8.49',targetVersion:'8.50'}},options);
  await helpAction(db,uid,{action:'help-approve',id,hash:proposed.proposal.hash,confirm:true},options);
  assert.equal((await db.collection('help_issues').doc(id).get()).data()?.status,'approved');
  console.log(JSON.stringify({passed:true,checks:['real emulator transactions and concurrent idempotence','bounded inbox and private screenshot retrieval','owner approval transaction'],directClientDenials:denials,productionReads:0,productionWrites:0}));
}finally{await db.recursiveDelete(db.collection('help_issues').doc(id));await db.collection('users').doc(uid).delete();await db.terminate();await deleteApp(app);}
