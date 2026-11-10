import {createHash} from 'node:crypto';
import {validateImportRecord} from '../shared/business-import.ts';
import {AVAILABLE_PERMISSIONS} from '../constants.ts';

export const RESTORE_COLLECTIONS=['branches','suppliers','categories','products','roles','settings'] as const;
export function restoreFingerprint(value:unknown):string {
 const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 return createHash('sha256').update(JSON.stringify(stable(value??null))).digest('hex');
}
export function validateRestoreRecord(collection:string,record:any):any{
 if(!RESTORE_COLLECTIONS.includes(collection as any))throw new Error('This collection cannot be restored here.');
 if(!record||typeof record.id!=='string'||!record.id.trim()||record.id.includes('/')||record.id.length>500||['__proto__','constructor','prototype'].includes(record.id))throw new Error('A valid record ID is required.');
 if(['branches','suppliers','categories','products'].includes(collection))return validateImportRecord(collection as any,record);
 const permissions=new Set(AVAILABLE_PERMISSIONS.map(p=>p.id));
 if(collection==='roles'){
  if(typeof record.name!=='string'||!record.name.trim())throw new Error('Role name required.');
  return {id:record.id,name:record.name,description:typeof record.description==='string'?record.description:'',isSystem:['CREATOR','GM','MANAGER','STAFF'].includes(record.id)};
 }
 if(record.id==='role_permissions'){
  if(!record.map||typeof record.map!=='object'||Array.isArray(record.map))throw new Error('Invalid role permissions.');
  for(const [key,values] of Object.entries(record.map))if(['__proto__','constructor','prototype'].includes(key)||!Array.isArray(values)||values.some(p=>!permissions.has(p as any)))throw new Error('Unknown action permission in backup.');
  return {id:record.id,map:record.map};
 }
 if(record.id==='email_config'){
  const out:any={id:record.id};for(const key of ['fromName','fromEmail','replyTo'])if(typeof record[key]==='string')out[key]=record[key];return out;
 }
 if(record.id==='price_monitoring'){
  const out:any={id:record.id};
  for(const [key,value] of Object.entries(record)){if(key==='id')continue;if(['__proto__','constructor','prototype'].includes(key)||typeof value!=='boolean'&&!(typeof value==='number'&&Number.isFinite(value)&&value>=0)&&typeof value!=='string')throw new Error('Invalid price setting.');out[key]=value;}
  return out;
 }
 throw new Error('Unknown settings record.');
}
