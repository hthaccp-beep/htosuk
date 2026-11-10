import {deliveryLines,type DeliveryCheck} from '../shared/delivery-check.ts';
import type {OrderRecord,InvoiceEvidence} from '../types.ts';
import {validCalendarDate} from '../shared/calendar-date.ts';
import {checkUserActionPermission} from './order-authorization.ts';
import {hasBranchScope,hasSupplierScope} from '../shared/order-scope.ts';

export function assertCheckAccess(user:any,roles:any,order:OrderRecord,send=false){
 if(!user||!order||(order.status!=='PLACED'&&!(order.status==='CANCELLED'&&order.supplierCase))||!checkUserActionPermission(user,'scan_invoices',roles)||!hasBranchScope(user,order.branchId)||!hasSupplierScope(user,order.supplierId)||(send&&!checkUserActionPermission(user,'submit_orders',roles)))throw new Error('You do not have permission for this order check.');
}
export function safeEvidence(value:any,lineIds:string[]):InvoiceEvidence[]{
 if(!Array.isArray(value)||value.length>2)throw new Error('Attach up to two damage photographs per check.');
 return value.map(e=>{
  if(!e||!lineIds.includes(e.lineId)||typeof e.dataUrl!=='string'||e.dataUrl.length>120000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(e.dataUrl)||!Buffer.from(e.dataUrl.split(',')[1],'base64').subarray(0,3).equals(Buffer.from([255,216,255])))throw new Error('Invalid damage photograph.');
  if(typeof e.id!=='string'||e.id.length>100||typeof e.caption!=='string'||e.caption.length>500)throw new Error('Invalid photograph description.');
  return {id:e.id,lineId:e.lineId,fileName:'damage-photo.jpg',caption:e.caption,dataUrl:e.dataUrl};
 });
}
export function assertRecordSize(order:OrderRecord,changes:any){
 if(Buffer.byteLength(JSON.stringify({...order,...changes}),'utf8')>850000)throw new Error('This order has reached its attachment limit. Keep additional originals in your records and enter their reference.');
}
export function prepareDeliveryCheck(order:OrderRecord,body:any,user:any):DeliveryCheck{
 if(order.status!=='PLACED')throw new Error('Only placed orders can receive a delivery check.');
 if(order.supplierCase?.source==='DELIVERY')throw new Error('This delivery check supports a supplier request and is locked. Record follow-up details in credit tracking.');
 const originals=deliveryLines(order);
 if(!Array.isArray(body.lines)||body.lines.length!==originals.length||new Set(body.lines.map((l:any)=>l.lineId)).size!==originals.length)throw new Error('Check every order item exactly once.');
 if(!validCalendarDate(body.date))throw new Error('Enter a valid delivery-check date.');
 const lines=body.lines.map((input:any)=>{
  const original=originals.find(l=>l.lineId===input.lineId);if(!original)throw new Error('Unknown order item.');
  const line:any={...original,checked:input.checked===true,notes:String(input.notes||'').slice(0,1000)};
  for(const key of ['documentCases','documentUnits','receivedCases','receivedUnits','damagedCases','damagedUnits'])if(input[key]!=null){if(typeof input[key]!=='number'||!Number.isFinite(input[key])||input[key]<0||input[key]>1e7)throw new Error('Use a valid non-negative quantity.');line[key]=input[key];}
  if(!['NONE','WRONG_ITEM','DAMAGED','EXTRA'].includes(input.issue))throw new Error('Choose a valid issue.');line.issue=input.issue;
  if((line.damagedCases||0)>(line.receivedCases||0)||(line.damagedUnits||0)>(line.receivedUnits||0))throw new Error('Damaged or rejected quantities cannot exceed quantities received.');
  if(!body.draft&&(!line.checked||line.receivedCases==null||line.receivedUnits==null))throw new Error('Confirm actual received quantities, including zero, and check each item.');
  if(!body.draft&&line.issue==='WRONG_ITEM'&&!line.notes.trim())throw new Error('Describe the wrong or substituted item.');
  if(!body.draft&&line.issue==='DAMAGED'&&!(line.damagedCases||line.damagedUnits))throw new Error('Enter the damaged or rejected quantity for a damaged item.');
  return line;
 });
 return {version:(order.deliveryCheck?.version||0)+1,reference:String(body.reference||'').slice(0,200),date:body.date,partial:body.partial===true,draft:body.draft===true,notes:String(body.notes||'').slice(0,3000),lines,evidence:safeEvidence(body.evidence||[],originals.map(l=>l.lineId)),checkedBy:user.displayName||user.id,checkedAt:new Date().toISOString()};
}
export async function checkTransaction(db:any,uid:string,orderId:any,operation:(order:OrderRecord,user:any,roles:any)=>any){
 if(typeof orderId!=='string'||!/^[\w-]{1,128}$/.test(orderId))throw new Error('Invalid order.');
 return db.runTransaction(async(tx:any)=>{
  const ref=db.collection('orders').doc(orderId);
  const [profile,roles,record]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions')),tx.get(ref)]);
  const user={...profile.data(),id:uid},order=record.exists?{...record.data(),id:orderId}:undefined;
  assertCheckAccess(user,roles.data()?.map,order as OrderRecord);
  const {changes,result,event}=operation(order as OrderRecord,user,roles.data()?.map);
  if(changes){assertRecordSize(order as OrderRecord,changes);tx.update(ref,changes);const audit=db.collection('_audit_logs').doc();tx.create(audit,{id:audit.id,userId:uid,entityType:'ORDER',entityId:orderId,action:event,timestamp:new Date().toISOString()});}
  return result||{success:true};
 });
}
export async function saveDeliveryCheck(db:any,uid:string,body:any){
 return checkTransaction(db,uid,body.orderId,(order,user)=>{
  if((order.deliveryCheck?.version||0)!==body.expectedVersion)throw new Error('This check changed. Close and reopen it before saving.');
  return {changes:{deliveryCheck:prepareDeliveryCheck(order,body,user)},event:body.draft?'DELIVERY_CHECK_DRAFT':'DELIVERY_CHECK_CONFIRMED'};
 });
}
