import {createHash} from 'node:crypto';
import type {Product,Category} from '../types.ts';
import {productFields,productFingerprint} from '../shared/product-workbench.ts';
import {parseStrictPrice} from './price-change-service.ts';
import {checkUserActionPermission} from './order-authorization.ts';
import {hasSupplierScope} from '../shared/order-scope.ts';
import {applyOwnerProductPrices} from './owner-product-prices.ts';

// Retire catalogue entries; historical order snapshots and permanent IDs are retained.
export async function removeSelectedProducts(db:any,uid:string,body:any){
 const validId=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
 if(!validId(body.supplierId)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(body.requestId))throw new Error('Invalid product removal request.');
 if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>450)throw new Error('Select 1–450 products to delete at a time.');
 if(body.rows.some((row:any)=>!row||!validId(row.id)||typeof row.expected!=='string'||row.expected.length>20000))throw new Error('Invalid product selection. Reload and select the products again.');
 const rows=body.rows.map((row:any)=>({id:row.id,expected:row.expected})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
 if(new Set(rows.map((row:any)=>row.id)).size!==rows.length)throw new Error('A product is selected more than once.');
 const payloadHash=createHash('sha256').update(JSON.stringify({action:'product-remove',supplierId:body.supplierId,rows})).digest('hex');
 return db.runTransaction(async(tx:any)=>{
  const [profile,roles]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions'))]);
  const user={...profile.data(),id:uid};
  if(!checkUserActionPermission(user,'manage_products',roles.data()?.map)||!hasSupplierScope(user,body.supplierId))throw new Error('You cannot delete this supplier’s products.');
  const receiptRef=db.collection('_product_operations').doc('remove_'+body.requestId),receipt=await tx.get(receiptRef);
  if(receipt.exists){const saved=receipt.data();if(saved.userId!==uid||saved.payloadHash!==payloadHash)throw new Error('This deletion reference was already used for a different selection.');return saved.result;}
  // Read only the selected documents; no catalogue, category, branch or order scans.
  const docs=await Promise.all(rows.map((row:any)=>tx.get(db.collection('products').doc(row.id))));
  const products=docs.map((doc:any)=>({...doc.data(),id:doc.id}));
  products.forEach((product:any,index:number)=>{
   if(!docs[index].exists||product.supplierId!==body.supplierId)throw new Error('A selected product is missing or belongs to another supplier. Reload and select again.');
   if(productFingerprint(product)!==rows[index].expected)throw new Error(`${product.name} changed after you selected it. Reload and review again.`);
  });
  const timestamp=new Date().toISOString();
  const remaining=products.filter((product:any)=>!product.removedAt);
  remaining.forEach((product:any)=>tx.update(db.collection('products').doc(product.id),{active:false,removedAt:timestamp}));
  const result={success:true,removed:remaining.length,removedAt:timestamp,productIds:products.map((p:any)=>p.id)};
  tx.create(receiptRef,{userId:uid,supplierId:body.supplierId,payloadHash,result,timestamp});
  tx.create(db.collection('_audit_logs').doc('remove_'+body.requestId),{userId:uid,userName:user.displayName||'',entityType:'PRODUCT',entityId:body.supplierId,action:'PRODUCT_BULK_REMOVE',timestamp,details:{products:remaining.map((p:any)=>({id:p.id,name:p.name,wasActive:p.active!==false})),removed:remaining.length}});
  return result;
 },{maxAttempts:1});
}

export function planProductChanges(user:any,roles:any,body:any,products:Product[],categories:Category[],branchIds:string[],policy:{keepExistingDuplicateCodes?:boolean}={}){
 if(!checkUserActionPermission(user,'manage_products',roles)||!hasSupplierScope(user,body.supplierId))throw new Error('You cannot edit this supplier’s products.');
 if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>240)throw new Error('Review 1–240 products per save.');
 if(new Set(body.rows.map((r:any)=>r.id)).size!==body.rows.length)throw new Error('A product is selected more than once.');
 const now=new Date().toISOString();const updates:{id:string;changes:any;before:any}[]=[];const notices:any[]=[];
 const sequence=body.sequence;
 if(sequence!==undefined&&(!Array.isArray(sequence)||sequence.length!==body.rows.length||new Set(sequence).size!==sequence.length||sequence.some((id:any)=>!body.rows.some((r:any)=>r.id===id))))throw new Error('Invalid product sequence.');
 if(sequence&&products.some(p=>p.supplierId===body.supplierId&&!p.removedAt&&!sequence.includes(p.id)))throw new Error('The supplier catalogue changed or is incomplete. Reload all products before rearranging them.');
 for(const row of body.rows){
  const old=products.find(p=>p.id===row.id&&p.supplierId===body.supplierId);
  if(!old)throw new Error('An item is missing or belongs to another supplier. New products need a separate manual review.');
  if(old.removedAt)throw new Error(`${old.name} was deleted from the catalogue. Reload and review again.`);
  if(row.expected!==productFingerprint(old))throw new Error(`${old.name} changed after you opened it. Reload and review again.`);
  const changes:any={};
  for(const key of productFields){
   if(key==='casePrice'||key==='packPrice'||!Object.hasOwn(row.values,key))continue;
   let value=row.values[key];
   if(['name','chineseName','itemCode','categoryId','packSize','caseUnitName','packUnitName','unitType'].includes(key)){
    if(typeof value!=='string'||value.length>300)throw new Error(`Invalid ${key} for ${old.name}.`);value=value.trim();
    if(key==='name'&&!value)throw new Error('Product names cannot be blank.');
    if(key==='categoryId'&&!categories.some(c=>c.id===value&&(!c.supplierId||c.supplierId===old.supplierId)))throw new Error('Choose a category belonging to this supplier.');
    if(key==='unitType'&&!['DUAL','CASE_ONLY','PACK_ONLY'].includes(value))throw new Error('Choose a valid ordering unit.');
   }else if(key==='allowedBranchIds'){
    if(!Array.isArray(value)||value.some(id=>!branchIds.includes(id)))throw new Error('Choose valid branches.');value=[...new Set(value)];
   }else if(key==='active'){if(typeof value!=='boolean')throw new Error('Active must be Yes or No.');}
   else {if(typeof value!=='number'||!Number.isFinite(value)||value<0||(key==='vatRate'&&value>1))throw new Error(`Invalid ${key}.`);}
   if(JSON.stringify(value)!==JSON.stringify(old[key]))changes[key]=value;
  }
  if(sequence){changes.cataloguePosition=sequence.indexOf(old.id)+1;changes.displayOrder=changes.cataloguePosition;}
  const casePrice=parseStrictPrice(row.values.casePrice,'Case price'),packPrice=parseStrictPrice(row.values.packPrice,'Unit price');
  if((casePrice!==undefined&&casePrice!==old.casePrice)||(packPrice!==undefined&&packPrice!==old.packPrice)){
   const notice:any={id:`pcn_${body.requestId}_${old.id}`,productId:old.id,productName:changes.name||old.name,itemCode:changes.itemCode??old.itemCode??'',supplierId:old.supplierId,supplierName:body.supplierName||old.supplierId,invoiceNumber:body.reference||'Reviewed product update',invoiceDate:now.slice(0,10),detectedDate:now,effectiveDate:now.slice(0,10),status:'PENDING',uploadedByUserId:user.id,uploadedByUserName:user.displayName||user.id};
   if(old.casePrice!==undefined)notice.oldCasePrice=old.casePrice;
   if(old.packPrice!==undefined)notice.oldPackPrice=old.packPrice;
   if(casePrice!==undefined)notice.newCasePrice=casePrice;else if(old.casePrice!==undefined)notice.newCasePrice=old.casePrice;
   if(packPrice!==undefined)notice.newPackPrice=packPrice;else if(old.packPrice!==undefined)notice.newPackPrice=old.packPrice;
   notices.push(notice);
  }
  if(Object.keys(changes).length)updates.push({id:old.id,changes,before:Object.fromEntries(Object.keys(changes).map(k=>[k,(old as any)[k]??null]))});
 }
 const codes=new Map<string,Product>();
 for(const product of products.filter(p=>p.supplierId===body.supplierId)){
  const p={...product,...updates.find(u=>u.id===product.id)?.changes};const code=p.itemCode?.trim().toUpperCase();
  if(p.active===false)continue; // Retired catalogue records retain historical codes; active codes remain unique.
  const previous=code?codes.get(code):undefined;
  if(previous&&(!policy.keepExistingDuplicateCodes||product.itemCode?.trim().toUpperCase()!==code||previous.itemCode?.trim().toUpperCase()!==code))throw new Error(`Duplicate supplier code: ${code}.`);
  if(code)codes.set(code,product);
 }
 return {updates,notices};
}

export async function saveProductWorkbench(db:any,uid:string,body:any){
 if(typeof body.supplierId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(body.supplierId)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(body.requestId))throw new Error('Invalid product update request.');
 const payloadHash=createHash('sha256').update(JSON.stringify({supplierId:body.supplierId,rows:body.rows,sequence:body.sequence,reference:body.reference})).digest('hex');
 return db.runTransaction(async(tx:any)=>{
  const [profile,roles]=await Promise.all([
   tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions'))]);
  const user={...profile.data(),id:uid};
  if(!checkUserActionPermission(user,'view_prices',roles.data()?.map)||!checkUserActionPermission(user,'manage_products',roles.data()?.map)||!hasSupplierScope(user,body.supplierId))throw new Error('Product editing is not available to your account.');
  const receipt=await tx.get(db.collection('_product_operations').doc(body.requestId));
  if(receipt.exists){if(receipt.data().userId!==uid||receipt.data().supplierId!==body.supplierId||receipt.data().payloadHash!==payloadHash)throw new Error('This save reference was already used for different changes. Reload and save again.');return receipt.data().result;}
  const [supplier,products,categories,branches]=await Promise.all([
   tx.get(db.collection('suppliers').doc(body.supplierId)),tx.get(db.collection('products').where('supplierId','==',body.supplierId)),tx.get(db.collection('categories')),tx.get(db.collection('branches'))]);
  if(!supplier.exists)throw new Error('Supplier not found.');
  const plan=planProductChanges(user,roles.data()?.map,{...body,supplierName:supplier.data().name},products.docs.map((d:any)=>({...d.data(),id:d.id})),categories.docs.map((d:any)=>({...d.data(),id:d.id})),branches.docs.map((d:any)=>d.id));
  const priceHistory=applyOwnerProductPrices(user,{...body,supplierName:supplier.data().name},products.docs.map((d:any)=>({...d.data(),id:d.id})),plan);
  if(plan.updates.length+plan.notices.length+priceHistory.length+2>490)throw new Error('Save a smaller selection of products.');
  for(const u of plan.updates)tx.update(db.collection('products').doc(u.id),u.changes);
  for(const n of plan.notices)tx.create(db.collection('price_change_notices').doc(n.id),n);
  for(const h of priceHistory)tx.create(db.collection('price_history').doc(h.id),h);
  const result={updated:plan.updates.length,proposed:plan.notices.length,pricesApplied:priceHistory.length,immediatePrices:user.role==='CREATOR'};
  tx.create(db.collection('_product_operations').doc(body.requestId),{userId:uid,supplierId:body.supplierId,payloadHash,result,timestamp:new Date().toISOString()});
  tx.create(db.collection('_audit_logs').doc(body.requestId),{id:body.requestId,userId:uid,userName:user.displayName||'',entityType:'PRODUCT',entityId:body.supplierId,action:'PRODUCT_BULK_REVIEW',timestamp:new Date().toISOString(),details:{updates:plan.updates,priceProposals:plan.notices.map(n=>n.id)}});
  return result;
 },{maxAttempts:1});
}
