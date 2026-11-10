import type { VercelRequest,VercelResponse } from '@vercel/node';
import { getAdmin } from '../firebase-admin.ts';
import { validateOrderUpdate,OrderAuthorizationError,checkUserActionPermission } from '../../server/order-authorization.ts';
import {hasBranchScope,hasSupplierScope} from '../../shared/order-scope.ts';
import {createAuditLogEntry} from '../../server/audit-log-service.ts';
import type { OrderRecord } from '../../types.ts';
export default async function handler(req:VercelRequest,res:VercelResponse){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST required.'});
  if(typeof req.headers.authorization!=='string'||!req.headers.authorization.startsWith('Bearer '))return res.status(401).json({error:'Sign in again.'});
  const body=req.body;
  if(!body||!['cancel','archive','restore'].includes(body.action)||typeof body.orderId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(body.orderId)||Object.keys(body).some(k=>!['action','orderId'].includes(k)))return res.status(400).json({error:'Choose a valid order action.'});
  try{
    const {auth,db}=getAdmin();let identity;
    try{identity=await auth.verifyIdToken(req.headers.authorization.slice(7).trim(),true);}catch{return res.status(401).json({error:'Sign in again.'});}
    await db.runTransaction(async transaction=>{
      const userRef=db.collection('users').doc(identity.uid),orderRef=db.collection('orders').doc(body.orderId);
      const [userDoc,orderDoc,rolesDoc]=await Promise.all([transaction.get(userRef),transaction.get(orderRef),transaction.get(db.collection('settings').doc('role_permissions'))]);
      if(!userDoc.exists||!orderDoc.exists)throw new OrderAuthorizationError(403,'Order unavailable.');
      const current={...orderDoc.data(),id:orderDoc.id} as OrderRecord;
      const user={...userDoc.data(),id:identity.uid} as any;
      if(body.action!=='cancel'){
        if(!checkUserActionPermission(user,'cancel_orders',rolesDoc.data()?.map)||!hasBranchScope(user,current.branchId)||!hasSupplierScope(user,current.supplierId))throw new OrderAuthorizationError(403,'You cannot remove or restore this order.');
        if(current.status!=='CANCELLED')throw new OrderAuthorizationError(409,'Only cancelled orders can be removed from the list or restored.');
        const archived=body.action==='archive';
        if((current.archived===true)===archived)return;
        transaction.update(orderRef,{archived,archivedAt:archived?new Date().toISOString():'',archivedByUserId:archived?identity.uid:''});
        const event=createAuditLogEntry({userId:identity.uid,userEmail:user.username||'',userName:user.displayName||'',entityType:'ORDER',entityId:current.id,branchId:current.branchId,action:archived?'ORDER_ARCHIVED':'ORDER_RESTORED',details:{}});
        transaction.create(db.collection('_audit_logs').doc(event.id),JSON.parse(JSON.stringify(event)));
        return;
      }
      if(current.status!=='PLACED')throw new OrderAuthorizationError(409,'Only placed orders can be cancelled.');
      validateOrderUpdate(user,current,{...current,status:'CANCELLED'});
      transaction.update(orderRef,{status:'CANCELLED',cancelledAt:new Date().toISOString(),cancelledByUserId:identity.uid});
    });
    return res.status(200).json({success:true});
  }catch(error){return res.status(error instanceof OrderAuthorizationError?error.status:503).json({error:error instanceof OrderAuthorizationError?error.message:'The order could not be updated. Try again later.'});}
}
