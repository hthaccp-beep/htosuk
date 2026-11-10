import assert from 'node:assert/strict';
import {config} from 'dotenv';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,signInWithCustomToken,signOut} from 'firebase/auth';
import {getAdmin} from '../api/firebase-admin.ts';
import {validateCloudSetup} from '../server/htos-runtime.ts';
config({path:'.env.cloud.local',quiet:true});assert.equal(validateCloudSetup(process.env).projectId,'htos-a00f0');
const admin=getAdmin(),uid='ouWm46D2wHg3cPfzaoJy0qBfIyE2';
const app=initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY,projectId:'htos-a00f0',authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN},'release-readiness');
const auth=getAuth(app);
try{
 await signInWithCustomToken(auth,await admin.auth.createCustomToken(uid));
 const token=await auth.currentUser!.getIdToken();
 const call=async(body:any)=>{const r=await fetch('https://htos-ten.vercel.app/api/admin/workspace',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const status=await call({action:'status'});assert.equal(status.status,200);console.log('Live workspace API: ready. Email enabled:',status.data.email);
 const branches=(await admin.db.collection('branches').get()).docs.filter(d=>d.data().active===true);
 const suppliers=(await admin.db.collection('suppliers').get()).docs.filter(d=>d.data().active===true);
 const branch=branches.find(d=>String(d.data().name).includes('Putney'))||branches[0];
 if(branch&&suppliers[0]){
  const route=await call({action:'order-email-preview',branchId:branch.id,supplierId:suppliers[0].id});
  console.log('Ordering email readiness:',route.status,route.data.ready===true?'ready':route.data.error||'not ready');
 }
 // Invalid request proves the deployed order endpoint is present without creating a record.
 const invalid=await call({action:'order-save',mode:'create',order:{}});assert.equal(invalid.status,400);assert.match(invalid.data.error,/Invalid order references/);
 console.log('Live validated order endpoint: ready. No orders created; no emails sent.');
}catch(e:any){console.error('Readiness check failed:',e.message);process.exitCode=1;}
finally{await signOut(auth);await deleteApp(app);}
