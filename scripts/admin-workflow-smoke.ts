import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getAdmin} from '../api/firebase-admin.ts';
import handler from '../api/admin/workspace.ts';
import {recordAdminEvent} from '../server/admin-audit.ts';
import userHandler from '../api/admin/users.ts';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9095');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_KEY&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.HTOS_MODE='emulator';process.env.FIREBASE_PROJECT_ID='demo-htos';
const {auth,db}=getAdmin(),id='admin-qa-'+randomUUID(),email=id+'@example.invalid',password=randomUUID();
let token='';
let createdUid='';
async function request(body:any,bearer=token){let status=200,value:any;const res:any={setHeader(){},status(n:number){status=n;return this;},json(data:any){value=data;return this;}};await handler({method:'POST',headers:bearer?{authorization:'Bearer '+bearer}:{},body} as any,res);return {status,value};}
try{
 await auth.createUser({uid:id,email,password});await db.collection('users').doc(id).set({id,username:email,displayName:'QA owner',role:'CREATOR',active:true});
 const signIn=await fetch('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-htos-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});token=(await signIn.json()).idToken;assert.ok(token);
 assert.equal((await request({action:'backup'},'')).status,401);
 const record={id,name:'QA branch',code:'QA',active:true};
 const preview=await request({action:'restore-preview',collection:'branches',records:[record]});assert.equal(preview.status,200);assert.equal(preview.value.create,1);assert.equal((await db.collection('branches').doc(id).get()).exists,false);
 assert.equal((await request({action:'restore-commit',collection:'branches',records:[record],expected:preview.value.expected})).status,200);
 async function account(action:string,data:any){let code=200,value:any;const res:any={statusCode:200,setHeader(){},status(n:number){code=n;this.statusCode=n;return this;},json(body:any){value=body;return this;},end(){}};await userHandler({method:'POST',headers:{authorization:'Bearer '+token},body:{action,data}} as any,res);return {code,value};}
 const created=await account('create',{email:'staff-'+email,password:randomUUID(),displayName:'QA Staff',role:'STAFF',branchId:id,branchIds:[id],active:true,permissionMode:'INHERITED'});
 assert.equal(created.code,200,JSON.stringify(created.value));createdUid=created.value.uid;assert.ok(createdUid);
 assert.equal((await account('update',{id:createdUid,displayName:'QA Renamed Staff'})).code,200);
 assert.equal((await db.collection('users').doc(createdUid).get()).data()?.permissionMode,'INHERITED');
 assert.equal((await account('update',{id:createdUid,active:false})).code,200);
 assert.equal((await auth.getUser(createdUid)).disabled,true);
 assert.equal((await account('update',{id:createdUid,active:true})).code,200);
 assert.equal((await auth.getUser(createdUid)).disabled,false);
 const accountAudit=await db.collection('_audit_logs').where('entityId','==',createdUid).get();assert.ok(accountAudit.size>=4);
 const second=await request({action:'restore-preview',collection:'branches',records:[{...record,name:'Restored branch'}]});
 await db.collection('branches').doc(id).update({name:'Changed concurrently'});
 assert.notEqual((await request({action:'restore-commit',collection:'branches',records:[record],expected:second.value.expected})).status,200);
 assert.equal((await db.collection('branches').doc(id).get()).data()?.name,'Changed concurrently');
 assert.equal((await request({action:'restore-preview',collection:'users',records:[record]})).status,400);
 await db.collection('orders').doc(id).set({id,status:'PLACED',createdAt:'2020-01-01',items:[],password:'should-not-export'});
 const backup=await request({action:'backup'});assert.equal(backup.status,200);assert.equal(backup.value.data.orders.find((o:any)=>o.id===id).createdAt,'2020-01-01');assert.equal(backup.value.data.orders.find((o:any)=>o.id===id).password,undefined);
 await recordAdminEvent({headers:{authorization:'Bearer '+token}},'USER',id,'QA_ACCOUNT_CHECK');
 const audit=await request({action:'audit'});assert.equal(audit.status,200);assert.ok(audit.value.logs.some((e:any)=>e.entityId===id&&e.action==='QA_ACCOUNT_CHECK'));
 await db.collection('users').doc(id).update({role:'STAFF'});
 for(const action of ['backup','audit','restore-preview'])assert.equal((await request({action,collection:'branches',records:[record]})).status,403);
 await db.collection('users').doc(id).update({active:false,role:'CREATOR'});assert.equal((await request({action:'status'})).status,403);
 console.log('PASS: owner-only restore preview/commit, concurrent-change refusal, account-restore denial, complete historic backup, secret scrubbing, real audit history, anonymous/staff/inactive denial.');
}finally{
 for(const collection of ['users','branches','orders'])await db.collection(collection).doc(id).delete();
 const events=await db.collection('_audit_logs').where('userId','==',id).get();for(const event of events.docs)await event.ref.delete();
 if(createdUid){await auth.deleteUser(createdUid).catch(()=>{});await db.collection('users').doc(createdUid).delete();}
 await auth.deleteUser(id).catch(()=>{});await db.terminate();
}
