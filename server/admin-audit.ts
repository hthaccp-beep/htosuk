import {getAdmin} from '../api/firebase-admin.ts';
import {createAuditLogEntry} from './audit-log-service.ts';
import type {AuditLogEntry} from '../types.ts';

// Called only after a server mutation has succeeded. Never store request bodies or credentials.
export async function recordAdminEvent(req:any,entityType:AuditLogEntry['entityType'],entityId:string,action:string){
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token)return;
 const {auth,db}=getAdmin();const identity=await auth.verifyIdToken(token,true);
 const user=(await db.collection('users').doc(identity.uid).get()).data();
 if(user?.active!==true)return;
 const event=createAuditLogEntry({userId:identity.uid,userEmail:user.username||'',userName:user.displayName||'',entityType,entityId,action,details:{}});
 await db.collection('_audit_logs').doc(event.id).create(JSON.parse(JSON.stringify(event)));
}

export function auditSuccessfulResponse(req:any,res:any,type:AuditLogEntry['entityType']){
 const send=res.json.bind(res);
 res.json=(body:any)=>{
  if(req.method!=='POST'||res.statusCode<200||res.statusCode>=300||body?.error)return send(body);
  const id=body?.user?.id||body?.uid||body?.id||req.body?.data?.id||req.body?.branchId||'workspace';
  return recordAdminEvent(req,type,String(id),`${type}_${req.body?.action||'UPDATE'}`)
   .then(()=>send(body)).catch(()=>send({...body,auditWarning:'The change succeeded, but its audit event could not be recorded.'}));
 };
}
