import {config} from 'dotenv';
import {readFile,writeFile} from 'node:fs/promises';
import {getApps} from 'firebase-admin/app';
import {getSecurityRules} from 'firebase-admin/security-rules';
import {getAdmin} from '../api/firebase-admin.ts';
import {validateCloudSetup} from '../server/htos-runtime.ts';
config({path:'.env.cloud.local',quiet:true});
if(validateCloudSetup(process.env).projectId!=='htos-a00f0')throw new Error('Wrong project.');
getAdmin();const app=getApps().find(a=>a.options.projectId==='htos-a00f0')!;
const rules=getSecurityRules(app);
try{
 const before=await rules.getFirestoreRuleset();
 await writeFile('../../work/8.02-rules-before.json',JSON.stringify({name:before.name,source:before.source},null,2));
 if(process.argv.includes('--publish')){
  const source=await readFile('firestore.rules','utf8');
  const released=await rules.releaseFirestoreRulesetFromSource(source);
  const live=await rules.getFirestoreRuleset();
  if(live.name!==released.name||live.source[0].content!==source)throw new Error('Rules verification failed.');
  console.log('Published and verified HTOS order rules.');
 }else console.log('Read-only check passed; prior HTOS rules backed up.');
}catch(e:any){console.error('Rules operation failed:',e.code||e.name,e.message);process.exitCode=1;}
