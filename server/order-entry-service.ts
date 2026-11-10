import {orderWithoutPrices} from '../shared/price-visibility.ts';
import {createHash} from 'node:crypto';
import {orderMinimum} from '../shared/order-minimum.ts';
import {checkUserActionPermission} from './order-authorization.ts';
import {hasBranchScope,hasSupplierScope} from '../shared/order-scope.ts';
import {validateOrderLines} from '../shared/order-entry.ts';
import {validateDeliveryDate} from '../utils/deliveryScheduler.ts';
import {isSupplierAvailableAtBranch} from '../utils/accessControl.ts';
import {getCaseUnitLabel,getPackUnitLabel,isCaseQtyAllowed,isPackQtyAllowed} from '../types.ts';

const id = (value:any) => typeof value==='string' && /^[\w-]{1,128}$/.test(value);
const digest = (value:any) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function authorizeOrderEntry(user:any, order:any, existing:any, roles:any) {
  if (!user?.active || !hasBranchScope(user,order.branchId) || !hasSupplierScope(user,order.supplierId)) throw new Error('This branch or supplier is outside your ordering access.');
  if (!['DRAFT','PLACED'].includes(order.status)) throw new Error('Choose draft or placed status.');
  if (!checkUserActionPermission(user,existing?'edit_drafts':'create_orders',roles) || (order.status==='PLACED'&&!checkUserActionPermission(user,'submit_orders',roles))) throw new Error('Your role cannot save this order.');
  if (existing) {
    if (existing.status!=='DRAFT') throw new Error('This order has already been placed. Open it from the order book.');
    if (!['CREATOR','GM','MANAGER'].includes(user.role) && existing.orderedByUserId!==user.id) throw new Error('You cannot edit another user’s draft.');
    if (['id','branchId','supplierId','orderedByUserId','createdAt'].some(k=>order[k]!==existing[k])) throw new Error('The draft identity cannot be changed.');
  } else if (order.orderedByUserId!==user.id) throw new Error('You cannot create an order for another user.');
}

/** Save and validate atomically. Repeated identical requests reuse the same order ID. */
export async function saveOrderEntry(db:any, uid:string, body:any, now = new Date()) {
  const input=body.order;
  if (!input || !id(input.id) || !id(input.branchId) || !id(input.supplierId)) throw new Error('Invalid order references.');
  if (!['create','edit'].includes(body.mode)) throw new Error('Invalid order action.');
  if (!Array.isArray(input.items)||input.items.length>500||!Array.isArray(input.manualItems)||input.manualItems.length>5) throw new Error('Invalid order items.');
  if (typeof input.comments!=='string'||input.comments.length>3000) throw new Error('Order notes must be at most 3,000 characters.');
  validateOrderLines(input.items,input.manualItems);
  const fingerprint=digest(input);
  return db.runTransaction(async(tx:any)=>{
    const ref=db.collection('orders').doc(input.id);
    const [profile,permissions,saved,branchDoc,supplierDoc]=await Promise.all([
      tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions')),tx.get(ref),
      tx.get(db.collection('branches').doc(input.branchId)),tx.get(db.collection('suppliers').doc(input.supplierId))]);
    const user={...profile.data(),id:uid},existing=saved.data(),branch=branchDoc.data(),supplier={...supplierDoc.data(),id:input.supplierId};
    if (!user.active || !hasBranchScope(user,input.branchId) || !hasSupplierScope(user,input.supplierId)) throw new Error('Your ordering access has changed.');
    const visible=(value:any)=>checkUserActionPermission(user,'view_prices',permissions.data()?.map)?value:orderWithoutPrices(value);
    if(existing?._entryFingerprint===fingerprint&&existing._entrySavedBy===uid) return {success:true,order:visible(existing)};
    if(body.mode==='create'&&existing) throw new Error('This order is already saved. Open it from the order book.');
    if(body.mode==='edit'&&!existing) throw new Error('This draft no longer exists.');
    authorizeOrderEntry(user,input,existing,permissions.data()?.map);
    if(existing&&(existing._entryRevision||0)!==(body.expectedRevision||0)) throw new Error('This draft changed. Reopen it before saving.');
    if(branch?.active!==true || supplier.active!==true || !isSupplierAvailableAtBranch(supplier as any,input.branchId)) throw new Error('The branch or supplier is no longer available.');
    const delivery=validateDeliveryDate(input.deliveryDate,supplier as any,input.branchId,now);
    if(!delivery.valid) throw new Error(delivery.error);
    const ids=input.items.map((i:any)=>i.productId);
    if(ids.some((v:any)=>!id(v)) || new Set(ids).size!==ids.length || new Set(input.manualItems.map((m:any)=>m.id)).size!==input.manualItems.length) throw new Error('Invalid or duplicate order items.');
    const products=await Promise.all(ids.map((pid:string)=>tx.get(db.collection('products').doc(pid))));
    const items=input.items.map((line:any,index:number)=>{
      const product=products[index].data();
      if(!product?.active || product.supplierId!==input.supplierId || (product.allowedBranchIds?.length&&!product.allowedBranchIds.includes(input.branchId))) throw new Error('An item is no longer available for this order.');
      if((line.caseQty&&!isCaseQtyAllowed(product))||(line.packQty&&!isPackQtyAllowed(product))) throw new Error('An item quantity uses an unavailable unit.');
      const previous=existing?.items?.find((i:any)=>i.productId===line.productId);
      const source=previous || {productNameSnapshot:product.name,chineseNameSnapshot:product.chineseName,itemCodeSnapshot:product.itemCode,casePriceSnapshot:product.casePrice,packPriceSnapshot:product.packPrice,caseUnitSnapshot:getCaseUnitLabel(product),packUnitSnapshot:getPackUnitLabel(product),vatRate:product.vatRate||0};
      if(!previous&&checkUserActionPermission(user,'view_prices',permissions.data()?.map)&&['casePriceSnapshot','packPriceSnapshot','vatRate'].some(k=>(line[k]||0)!==(source[k]||0))) throw new Error('Catalogue prices changed. Reopen the order and review it again.');
      return {productId:line.productId,productNameSnapshot:source.productNameSnapshot,chineseNameSnapshot:source.chineseNameSnapshot,itemCodeSnapshot:source.itemCodeSnapshot,casePriceSnapshot:source.casePriceSnapshot,packPriceSnapshot:source.packPriceSnapshot,caseUnitSnapshot:source.caseUnitSnapshot,packUnitSnapshot:source.packUnitSnapshot,vatRate:source.vatRate||0,caseQty:line.caseQty,packQty:line.packQty};
    });
    const manualItems=input.manualItems.map((m:any)=>{
      if(!id(m.id)||m.description.trim().length>200) throw new Error('Custom item names must be at most 200 characters.');
      return {id:m.id,description:m.description.trim(),caseQty:m.caseQty,packQty:m.packQty,pricingStatus:'UNPRICED'};
    });
    const order=JSON.parse(JSON.stringify({id:input.id,branchId:input.branchId,branchNameSnapshot:branch.name,supplierId:input.supplierId,supplierNameSnapshot:supplier.name,orderedByUserId:existing?.orderedByUserId||uid,orderedByNameSnapshot:existing?.orderedByNameSnapshot||user.displayName,createdAt:existing?.createdAt||now.toISOString(),deliveryDate:input.deliveryDate,items,manualItems,comments:input.comments,emailTo:supplier.email||'',status:input.status,emailStatus:'SKIPPED',receivedStatus:'NEW',_entryRevision:(existing?._entryRevision||0)+1,_entryFingerprint:fingerprint,_entrySavedBy:uid}));
    order.minimumOrderCheck=orderMinimum(supplier,input.branchId,items,manualItems);
    tx.set(ref,order);
    return {success:true,order:visible(order)};
  });
}
