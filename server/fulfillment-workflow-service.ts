import {checkUserActionPermission} from './order-authorization.ts';
import {supplierDispatchAccess} from '../shared/dispatch-access.ts';

export function prepareFulfillment(order:any, changes:any) {
  if(order.status!=='PLACED')throw new Error('Only placed orders can be processed.');
  const allowed=['items','manualItems','receivedStatus','fulfillmentStatus','processedAt','fulfillmentNotes'];
  if(!changes||Object.keys(changes).some(k=>!allowed.includes(k)))throw new Error('Only dispatch quantities and notes can be changed.');
  const copyLines=(original:any[],proposed:any[],idKey:string)=>{
    if(!Array.isArray(proposed)||proposed.length!==original.length)throw new Error('Every ordered item must be retained.');
    return original.map((item,i)=>{
      const next=proposed[i];
      if(!next||next[idKey]!==item[idKey]||Object.keys({...item,...next}).some(k=>!['sentCaseQty','sentPackQty','shortageReason'].includes(k)&&JSON.stringify(item[k])!==JSON.stringify(next[k])))throw new Error('Ordered items and historical prices cannot be changed.');
      for(const [key,max] of [['sentCaseQty',item.caseQty],['sentPackQty',item.packQty]] as const){
        if(typeof next[key]!=='number'||!Number.isFinite(next[key])||next[key]<0||next[key]>max)throw new Error('Dispatch quantities must be between zero and the ordered quantity.');
      }
      if(next.shortageReason!=null&&(typeof next.shortageReason!=='string'||next.shortageReason.length>1000))throw new Error('Shortage notes must be at most 1,000 characters.');
      return {...item,sentCaseQty:next.sentCaseQty,sentPackQty:next.sentPackQty,...(next.shortageReason!==undefined?{shortageReason:next.shortageReason}:{})};
    });
  };
  const items=copyLines(order.items||[],changes.items,'productId'),manualItems=copyLines(order.manualItems||[],changes.manualItems,'id');
  const all=[...items,...manualItems];
  const ordered=all.reduce((s,l)=>s+l.caseQty+l.packQty,0),sent=all.reduce((s,l)=>s+l.sentCaseQty+l.sentPackQty,0);
  if(changes.fulfillmentNotes!=null&&(typeof changes.fulfillmentNotes!=='string'||changes.fulfillmentNotes.length>3000))throw new Error('Delivery notes must be at most 3,000 characters.');
  return {items,manualItems,receivedStatus:'PROCESSED',fulfillmentStatus:ordered>0&&sent===0?'UNFULFILLED':sent<ordered?'PARTIAL':'FULFILLED',processedAt:new Date().toISOString(),...(changes.fulfillmentNotes!==undefined?{fulfillmentNotes:changes.fulfillmentNotes}:{})};
}

export async function saveFulfillment(db:any,uid:string,body:any){
  if(typeof body.orderId!=='string'||!/^[\w-]{1,128}$/.test(body.orderId))throw new Error('Invalid order.');
  return db.runTransaction(async(tx:any)=>{
    const ref=db.collection('orders').doc(body.orderId);
    const [profile,roles,snapshot]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions')),tx.get(ref)]);
    const user={...profile.data(),id:uid},order=snapshot.data();
    if(!order||!checkUserActionPermission(user,'view_received_orders',roles.data()?.map))throw new Error('You cannot process this order.');
    const supplier=(await tx.get(db.collection('suppliers').doc(order.supplierId))).data();
    const branchId=supplier?.linkedBranchId || (!supplier ? order.supplierId : '');
    const branch=branchId?(await tx.get(db.collection('branches').doc(branchId))).data():undefined;
    const access=supplierDispatchAccess(user,order,supplier?[{...supplier,id:order.supplierId}]:[],branch?[{...branch,id:branchId}]:[]);
    if(!access.allowed)throw new Error(access.reason);
    if((order.processedAt||'')!==(body.expectedProcessedAt||''))throw new Error('Dispatch details changed. Reopen this order before saving.');
    const updates=prepareFulfillment(order,body.updates);
    tx.update(ref,updates);
    const audit=db.collection('_audit_logs').doc();
    tx.create(audit,{id:audit.id,userId:uid,entityType:'ORDER',entityId:body.orderId,action:'ORDER_FULFILLMENT',timestamp:updates.processedAt,details:{status:updates.fulfillmentStatus}});
    return {success:true};
  });
}
