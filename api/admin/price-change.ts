import {validCalendarDate} from '../../shared/calendar-date.ts';
import type {Request,Response} from 'express';
import {executePriceChangeOperation,PriceOperationError,parseStrictPrice,type AuthContext} from '../../server/price-change-service.ts';
import {adminAuth,adminDb} from '../firebase-admin.ts';
import {checkUserActionPermission} from '../../server/order-authorization.ts';
import {hasSupplierScope} from '../../shared/order-scope.ts';
export async function priceChangeApiHandler(req:Request,res:Response):Promise<void>{
 res.setHeader('Cache-Control','no-store');if(req.method!=='POST'){res.status(405).json({error:'POST required.'});return;}
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token){res.status(401).json({error:'Please sign in.'});return;}
 let uid:string;try{uid=(await adminAuth.verifyIdToken(token,true)).uid;}catch{res.status(401).json({error:'Please sign in again.'});return;}
 const body=req.body;
 if(!body||!['PROPOSE_NOTICE','APPROVE_NOTICE','ACTIVATE_SCHEDULED'].includes(body.action)){res.status(400).json({error:'Submit prices for review before approving them in Price desk.'});return;}
 if(typeof body.supplierId!=='string'||!body.supplierId||body.supplierId.includes('/')||(body.noticeId&&(!/^[\w-]{1,220}$/.test(body.noticeId)))){res.status(400).json({error:'Invalid supplier or notice.'});return;}
 try{
  const result=await adminDb.runTransaction(async tx=>{
   const noticeId=body.noticeId||`pcn_${crypto.randomUUID()}`;
   const [profile,roleDoc,noticeDoc]=await Promise.all([tx.get(adminDb.collection('users').doc(uid)),tx.get(adminDb.collection('settings').doc('role_permissions')),tx.get(adminDb.collection('price_change_notices').doc(noticeId))]);
   const user={...profile.data(),id:uid} as any,roles=roleDoc.data()?.map;
   const proposing=body.action==='PROPOSE_NOTICE';
   const allowed=proposing?(checkUserActionPermission(user,'manage_products',roles)||checkUserActionPermission(user,'scan_invoices',roles)):checkUserActionPermission(user,'approve_price_changes',roles);
   if(!allowed||!hasSupplierScope(user,body.supplierId))throw new PriceOperationError(403,'You cannot change this supplier’s prices.');
   const notice=noticeDoc.exists?{...noticeDoc.data(),id:noticeId} as any:null;
   if(proposing&&(!Array.isArray(body.items)||body.items.length!==1))throw new PriceOperationError(400,'Submit one reviewed product per proposal.');
   const productId=proposing?body.items[0].productId:notice?.productId;
   if(typeof productId!=='string'||!productId||productId.includes('/'))throw new PriceOperationError(400,'Choose an existing product.');
   const productDoc=await tx.get(adminDb.collection('products').doc(productId));const product=productDoc.exists?{...productDoc.data(),id:productId} as any:null;
   if(!product||product.supplierId!==body.supplierId||(!proposing&&notice?.supplierId!==body.supplierId))throw new PriceOperationError(400,'Product and supplier do not match.');
   const today=new Date().toISOString().slice(0,10);
   let payload={...body,noticeId};
   if(proposing){
    const a=parseStrictPrice(body.items[0].newCasePrice),b=parseStrictPrice(body.items[0].newPackPrice);
    if(a===undefined&&b===undefined)throw new PriceOperationError(400,'Enter at least one price.');
    if(notice){if(notice.uploadedByUserId===uid&&notice.productId===productId&&notice.newCasePrice===(a??product.casePrice)&&notice.newPackPrice===(b??product.packPrice))return {success:true,message:'Already submitted.'};throw new PriceOperationError(409,'This proposal already exists.');}
   }else{
    if(notice?.activatedAt)return {success:true,message:'Already activated.'};
    if(body.action==='APPROVE_NOTICE'&&notice.status!=='PENDING')throw new PriceOperationError(409,'This notice is no longer awaiting approval.');
    if(body.action==='ACTIVATE_SCHEDULED'){if(notice.status!=='APPROVED'||notice.effectiveDate>today)throw new PriceOperationError(409,'This approved price is not due yet.');payload.effectiveDate=notice.effectiveDate;}
    if(notice.oldCasePrice!==product.casePrice||notice.oldPackPrice!==product.packPrice)throw new PriceOperationError(409,'The current price changed after this proposal. Reject it and submit a fresh review.');
   }
   if(payload.effectiveDate&&!validCalendarDate(payload.effectiveDate))throw new PriceOperationError(400,'Enter a valid effective date.');
   const auth:AuthContext={id:uid,displayName:user.displayName,role:user.role,active:user.active===true,permissions:['approve_price_changes']};
   return executePriceChangeOperation(auth,payload,{
    getProduct:async()=>product,
    saveProduct:async p=>{const prices:any={};if(p.casePrice!==undefined)prices.casePrice=p.casePrice;if(p.packPrice!==undefined)prices.packPrice=p.packPrice;tx.update(productDoc.ref,prices);},
    createPriceHistory:async h=>{tx.create(adminDb.collection('price_history').doc(h.id),h);},
    getNotice:async()=>notice,
    createNotice:async n=>{tx.create(noticeDoc.ref,n);},
    updateNotice:async(_id,updates)=>{tx.update(noticeDoc.ref,{...updates,...((payload.effectiveDate||today)<=today?{activatedAt:new Date().toISOString()}:{})});},
   });
  });res.status(200).json(result);
 }catch(e){res.status(e instanceof PriceOperationError?e.status:503).json({error:e instanceof PriceOperationError?e.message:'Price update could not be saved. Please retry.'});}
}
export default priceChangeApiHandler;
