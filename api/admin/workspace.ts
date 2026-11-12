import {invoiceCaseAction} from '../../server/invoice-case-service.ts';
import {invoiceEmailAction} from '../../server/invoice-case-email.ts';
import {configuredInvoiceReader} from '../../server/invoice-reader-connection.ts';
import {InvoiceCaseError} from '../../server/invoice-case-validation.ts';
import {removePriceRecords} from '../../server/price-record-removal-service.ts';
import {PriceOperationError} from '../../server/price-change-service.ts';
import {serviceReadiness} from '../../server/service-readiness.ts';
import {secureRead} from '../../server/secure-read-service.ts';
import {OrderAuthorizationError} from '../../server/order-authorization.ts';
import nodemailer from 'nodemailer';
import {helpAction} from '../../server/help-service.ts';
import {HelpError} from '../../server/help-validation.ts';
import {menuAction} from '../../server/menu-service.ts';
import {MenuError} from '../../server/menu-validation.ts';
import {reserveEmailSend} from '../../server/email-rate-limit.ts';
import {saveDeliveryCheck} from '../../server/delivery-check-service.ts';
import {supplierCaseAction} from '../../server/supplier-case-service.ts';
import {databaseErrorMessage,isDatabaseQuotaError} from '../../shared/database-errors.ts';
import {orderEmailRouting} from '../../server/email-service.ts';
import {getBranchEmailAccount} from './branch-email.ts';
import {checkUserActionPermission} from '../../server/order-authorization.ts';
import {hasBranchScope,hasSupplierScope} from '../../shared/order-scope.ts';
import {externalServiceEnabled} from '../../server/htos-runtime.ts';
import {saveOrderEntry} from '../../server/order-entry-service.ts';
import {saveFulfillment} from '../../server/fulfillment-workflow-service.ts';
import type {VercelRequest,VercelResponse} from '@vercel/node';
import {getAdmin} from '../firebase-admin.ts';
import {authorizeWorkspaceAction,safeBackupRecord} from '../../server/workspace-admin-service.ts';
import {restoreFingerprint,validateRestoreRecord} from '../../server/configuration-restore-service.ts';
import {recordAdminEvent} from '../../server/admin-audit.ts';
import {saveProductWorkbench,removeSelectedProducts} from '../../server/product-workbench-service.ts';
import {saveInvoiceReview} from '../../server/invoice-workflow-service.ts';
import {supplierCatalogImport} from '../../server/supplier-catalog-service.ts';
import {catalogueErrorPayload} from '../../shared/catalogue-errors.ts';

export default async function handler(req:VercelRequest,res:VercelResponse){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'POST required.'});
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return res.status(401).json({error:'Please sign in.'});
 try{
  const {auth,db}=getAdmin();let uid:string;
  try{uid=(await auth.verifyIdToken(token,true)).uid;}catch{return res.status(401).json({error:'Please sign in again.'});}
  const action=req.body?.action;
  if(typeof action==='string'&&action.startsWith('invoice-case-')){
   try{
    if(action.startsWith('invoice-case-email-'))return res.status(200).json(await invoiceEmailAction({db,account:getBranchEmailAccount,env:process.env,reserveSend:uid=>reserveEmailSend(db,uid),deliver:async(mail,config)=>{const transport=nodemailer.createTransport(config);try{const result=await transport.sendMail(mail);return {accepted:(result.accepted||[]).map(String),rejected:(result.rejected||[]).map(String)};}finally{transport.close();}}},uid,req.body));
    if(action==='invoice-case-read')throw new InvoiceCaseError('Use the invoice reading endpoint.',400);
    const reader=action==='invoice-case-reading-status'?configuredInvoiceReader(db,process.env,globalThis.fetch):undefined;
    return res.status(200).json(await invoiceCaseAction(db,uid,req.body,process.env.HTOS_ENABLE_INVOICE_CASES==='true',reader));
   }
   catch(e){return res.status(e instanceof InvoiceCaseError?e.status:503).json({error:e instanceof InvoiceCaseError?e.message:databaseErrorMessage(e,'Invoice workflow unavailable. Your edits remain on screen; no automatic retry has been made.')});}
  }
  if(action==='price-record-delete'){
   try{return res.status(200).json(await removePriceRecords(db,uid,req.body));}
   catch(e){return res.status(e instanceof PriceOperationError?e.status:503).json({error:e instanceof PriceOperationError?e.message:'Deletion could not be completed. Retry the same selection.'});}
  }
  if(action==='data-read'){
   try{return res.status(200).json(await secureRead(db,uid,req.body));}
   catch(e){return res.status(e instanceof OrderAuthorizationError?e.status:503).json({error:e instanceof OrderAuthorizationError?e.message:databaseErrorMessage(e,'Records could not be loaded. Please retry.')});}
  }
  if(['case-preview','case-send','case-credit','case-resolve','case-reconcile'].includes(action)){
   const [profile,permissions]=await Promise.all([db.collection('users').doc(uid).get(),db.collection('settings').doc('role_permissions').get()]);
   if(!checkUserActionPermission(profile.data() as any,'view_prices',permissions.data()?.map))return res.status(403).json({error:'Price access is required for this review.'});
  }
  if(typeof action==='string'&&action.startsWith('help-')){
   try{return res.status(200).json(await helpAction(db,uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:e instanceof HelpError?e.status:500).json({error:databaseErrorMessage(e,e instanceof HelpError?e.message:'Help could not complete this request. Your draft is still available. Please retry.')});}
  }
  if(typeof action==='string'&&action.startsWith('menu-')){
   try{return res.status(200).json(await menuAction(db,uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:e instanceof MenuError?e.status:500).json({error:databaseErrorMessage(e,e instanceof MenuError?e.message:'Unable to complete this recipe action. Your edits are still available; please retry.')});}
  }
  if(action==='catalog-preview'||action==='catalog-commit'){
   try{return res.status(200).json(await supplierCatalogImport(db,uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message),...catalogueErrorPayload(e),...(isDatabaseQuotaError(e)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
  }
  if(action==='delivery-check'||['case-preview','case-send','case-credit','case-resolve','case-reconcile'].includes(action)){
   try{return res.status(200).json(action==='delivery-check'?await saveDeliveryCheck(db,uid,req.body):await supplierCaseAction({db,account:getBranchEmailAccount,env:process.env,reserveSend:uid=>reserveEmailSend(db,uid),deliver:async(mail,config)=>{const transport=nodemailer.createTransport(config);try{const result=await transport.sendMail(mail);return {accepted:(result.accepted||[]).map(String),rejected:(result.rejected||[]).map(String)};}finally{transport.close();}}},uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message)});}
  }
  // These services authorize against fresh user/role records inside their transaction.
  if(action==='order-save'){
   try{return res.status(200).json(await saveOrderEntry(db,uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message),...(isDatabaseQuotaError(e)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
  }
  if(action==='fulfillment'){
   try{return res.status(200).json(await saveFulfillment(db,uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message),...(isDatabaseQuotaError(e)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
  }
  if(action==='invoice-review'){
   try{return res.status(200).json(await saveInvoiceReview(db,uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message),...(isDatabaseQuotaError(e)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
  }
  if(action==='product-bulk'||action==='product-remove'){
   try{return res.status(200).json(await (action==='product-remove'?removeSelectedProducts:saveProductWorkbench)(db,uid,req.body));}
   catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message),...(isDatabaseQuotaError(e)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
  }
  const user=(await db.collection('users').doc(uid).get()).data();
  const roles=(await db.collection('settings').doc('role_permissions').get()).data()?.map||{};

  if(action==='order-email-preview'){
   const {branchId,supplierId}=req.body;
   if(![branchId,supplierId].every(v=>typeof v==='string'&&/^[\w-]{1,128}$/.test(v)))return res.status(400).json({error:'Invalid branch or supplier.'});
   if(!checkUserActionPermission(user as any,'submit_orders',roles)||!hasBranchScope(user as any,branchId)||!hasSupplierScope(user as any,supplierId))return res.status(403).json({error:'You cannot send orders for this branch or supplier.'});
   try{
    const [branch,supplier]=await Promise.all([db.collection('branches').doc(branchId).get(),db.collection('suppliers').doc(supplierId).get()]);
    if(branch.data()?.active!==true||supplier.data()?.active!==true)throw new Error('Choose an active branch and supplier.');
    const route=orderEmailRouting(branch.data()!,supplier.data()!,await getBranchEmailAccount(branchId),process.env);
    return res.status(200).json({...route,ready:externalServiceEnabled('EMAIL'),...(!externalServiceEnabled('EMAIL')?{error:'Email sending is disabled. Ask the workspace owner to enable it before confirming this order.'}:{})});
   }catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message),...(isDatabaseQuotaError(e)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
  }
  if(action==='restore-preview'||action==='restore-commit'){
   if(user?.active!==true||user.role!=='CREATOR')return res.status(403).json({error:'Only the workspace owner can restore configuration.'});
   const {collection,records,expected}=req.body;
   if(!Array.isArray(records)||!records.length||records.length>100)return res.status(400).json({error:'Restore up to 100 records per batch.'});
   let validated:any[];
   try{validated=records.map(r=>validateRestoreRecord(collection,r));}catch(e){return res.status(isDatabaseQuotaError(e)?503:400).json({error:databaseErrorMessage(e,(e as Error).message),...(isDatabaseQuotaError(e)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
   if(new Set(validated.map(r=>r.id)).size!==validated.length)return res.status(400).json({error:'Duplicate record IDs.'});
   const result=await db.runTransaction(async tx=>{
    const profile=(await tx.get(db.collection('users').doc(uid))).data();if(profile?.active!==true||profile.role!=='CREATOR')throw new Error('Owner access changed.');
    const docs=await Promise.all(validated.map(r=>tx.get(db.collection(collection).doc(r.id))));
    const versions=docs.map(d=>restoreFingerprint(d.exists?d.data():null));
    if(action==='restore-commit'){
     if(!Array.isArray(expected)||expected.length!==versions.length||versions.some((v,i)=>v!==expected[i]))throw new Error('Records changed after preview. Preview the backup again before restoring.');
     validated.forEach((r,i)=>{const {id,...value}=r;tx.set(docs[i].ref,collection==='settings'?value:r,{merge:true});});
    }
    return {expected:versions,create:docs.filter(d=>!d.exists).length,update:docs.filter(d=>d.exists).length};
   });
   let auditWarning:string|undefined;
   if(action==='restore-commit')try{await recordAdminEvent(req,'SYSTEM',collection,'CONFIGURATION_RESTORE');}catch{auditWarning='Restore succeeded but the audit entry could not be recorded.';}
   return res.status(200).json({...result,...(auditWarning?{auditWarning}:{})});
  }
  if(action==='backup'&&!checkUserActionPermission(user as any,'view_prices',roles))return res.status(403).json({error:'Price access is required for a full backup.'});
  if(!authorizeWorkspaceAction(user,action,roles))return res.status(403).json({error:'This administration action is not available to your account.'});
  if(action==='status')return res.status(200).json(serviceReadiness());
  if(action==='audit'){
   let query=db.collection('_audit_logs').orderBy('timestamp','desc').orderBy('__name__','desc').limit(100);
   if(req.body.cursor){const cursor=JSON.parse(String(req.body.cursor));if(!Array.isArray(cursor)||cursor.length!==2||cursor.some(v=>typeof v!=='string'))return res.status(400).json({error:'Invalid audit cursor.'});query=query.startAfter(...cursor);}
   const records=(await query.get()).docs;
   return res.status(200).json({logs:records.map(d=>{const value={...d.data(),id:d.id} as any;if(!checkUserActionPermission(user as any,'view_prices',roles))delete value.details;return value;}),cursor:records.length===100?JSON.stringify([records.at(-1)!.data().timestamp,records.at(-1)!.id]):null});
  }
  const data:Record<string,any[]>={};
  // Fetch every page, rather than exporting only the recent records loaded by the UI.
  for(const collection of ['branches','suppliers','categories','products','orders','roles','users']){
   data[collection]=[];let cursor:string|undefined;
   for(;;){let query=db.collection(collection).orderBy('__name__').limit(500);if(cursor)query=query.startAfter(cursor);const page=await query.get();data[collection].push(...page.docs.map(d=>safeBackupRecord({...d.data(),id:d.id})));if(page.size<500)break;cursor=page.docs.at(-1)!.id;}
  }
  const settings=(await db.collection('settings').get()).docs;
  const config=Object.fromEntries(settings.filter(d=>['role_permissions','price_monitoring','email_config'].includes(d.id)).map(d=>[d.id,safeBackupRecord(d.data())]));
  return res.status(200).json({type:'htos-full-backup',version:1,timestamp:new Date().toISOString(),data,settings:config});
 }catch(error){return res.status(isDatabaseQuotaError(error)?503:500).json({error:databaseErrorMessage(error,'Unable to load administration data. Please retry.'),...(isDatabaseQuotaError(error)?{code:'DATABASE_QUOTA_EXCEEDED'}:{})});}
}


