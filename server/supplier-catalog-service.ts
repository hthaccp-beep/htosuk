import {prepareCatalogueDefaults} from '../shared/catalogue-defaults.ts';
import {catalogueReviewDetails} from '../shared/catalogue-review.ts';
import {createHash} from 'node:crypto';
import {parseSupplierCatalogCSV, planSupplierCatalogImport} from '../utils/supplierCatalogImport.ts';
import {planProductChanges} from './product-workbench-service.ts';
import {productFingerprint} from '../shared/product-workbench.ts';
import {restoreFingerprint} from './configuration-restore-service.ts';
import {checkUserActionPermission} from './order-authorization.ts';
import {hasSupplierScope} from '../shared/order-scope.ts';
import {decodeCSVText} from '../shared/product-csv.ts';
import {validateCatalogueFile} from '../shared/catalogue-file-validation.ts';
import {priceWarnings} from '../shared/supplier-file.ts';
import {resolveCatalogueConflicts,validateCatalogueChoices} from '../shared/catalogue-conflicts.ts';
import {prepareCatalogueReplacement,validateReplacementRows} from '../shared/catalogue-replacement.ts';

export function prepareSupplierCatalog(user:any, roles:any, body:any, products:any[], categories:any[], branches:any[]) {
 if(!checkUserActionPermission(user,'manage_products',roles)||!hasSupplierScope(user,body.supplierId))throw new Error('You cannot import products for this supplier.');
 const replacement=body.mode==='replace-catalogue';
 if(replacement&&(user.role!=='CREATOR'||body.removeMissing!==true))throw new Error('Only the workspace owner can replace a complete supplier catalogue.');
 const input=parseSupplierCatalogCSV(body.csv);
 const sourceProducts=replacement?prepareCatalogueReplacement(input,body.supplierId,products).products:products;
 const resolution=replacement?{rows:input,unresolved:[],reviewedIds:undefined,protectedIds:new Set<string>(),selections:[]}:resolveCatalogueConflicts(input,body.supplierId,products,body.conflictChoices);
 if(resolution.unresolved.length)throw new Error('Choose the correct product for each CSV conflict before continuing.');
 const choicesForNew=['catalogue','replace-catalogue'].includes(body.mode)?prepareCatalogueDefaults(resolution.rows,body.supplierId,sourceProducts,categories,branches,body.newProductDefaults):{rows:resolution.rows,needed:[]};
 if(choicesForNew.needed.length)throw new Error('Choose the missing category and branch availability for new products before saving.');
 const rows=choicesForNew.rows;
 if(body.mode==='prices'&&(body.removeMissing||rows.some(r=>!r.SystemID||Object.keys(r).some(k=>!['SystemID','PriceBox','PriceUnit'].includes(k)))))throw new Error('Price files can only update matched existing products. Missing products must be kept.');
 if(body.mode==='supplier-file'&&(body.removeMissing||rows.some(r=>!r.SystemID||Object.keys(r).some(k=>!['SystemID','Name','PriceBox','PriceUnit'].includes(k)))))throw new Error('Supplier files can only update names and prices of matched existing products.');
 if(rows.length>240)throw new Error('Import up to 240 product rows at a time. Do not use full catalogue mode for a partial file.');
 let sequence=0;
 const plan=planSupplierCatalogImport({rows,supplierId:body.supplierId,products:sourceProducts,categories,branches,reviewedConflictIds:resolution.reviewedIds,allowUncodedCreates:replacement||body.mode==='catalogue',checkUncodedDuplicates:body.mode==='catalogue',useRowOrder:body.useRowOrder===true,appendNew:['catalogue','replace-catalogue'].includes(body.mode),newId:()=>`ci_${body.requestId}_${++sequence}`});
 if(plan.categories.length&&!checkUserActionPermission(user,'manage_categories',roles))throw new Error('You need category management access to add categories.');
 const touched=new Set(rows.map(row=>row.SystemID?.trim()||(!replacement?sourceProducts.find(p=>p.itemCode?.trim().toUpperCase()===decodeCSVText(row.ItemCode||'').trim().toUpperCase())?.id:undefined)));
 const missing=products.filter(p=>p.supplierId===body.supplierId&&p.active!==false&&!touched.has(p.id)&&!resolution.protectedIds.has(p.id));
 const changes=plan.updates.length?planProductChanges(user,roles,{supplierId:body.supplierId,supplierName:body.supplierName,requestId:`ci_${body.requestId}`,rows:plan.updates.map(u=>({id:u.id,expected:productFingerprint(products.find(p=>p.id===u.id)),values:u.changes})),reference:'Supplier catalogue import'},sourceProducts,[...categories,...plan.categories],branches.map(b=>b.id),{keepExistingDuplicateCodes:resolution.selections.length>0}):{updates:[],notices:[]};
 for(const update of plan.updates)for(const field of ['displayOrder','cataloguePosition'] as const)if(update.changes[field]!==undefined){
  let entry=changes.updates.find(u=>u.id===update.id);
  if(!entry){entry={id:update.id,changes:{},before:{}};changes.updates.push(entry);}
  entry.changes[field]=update.changes[field];
  entry.before[field]=products.find(p=>p.id===update.id)[field]??null;
 }
 const priceHistory:any[]=[];
 if(user.role==='CREATOR'){
  for(const notice of changes.notices){
   const original=products.find(p=>p.id===notice.productId);
   let update=changes.updates.find(u=>u.id===notice.productId);
   if(!update){update={id:notice.productId,changes:{},before:{}};changes.updates.push(update);}
   const history:any={id:`ph_${notice.id}`,productId:notice.productId,productName:notice.productName,itemCode:notice.itemCode,supplierId:body.supplierId,supplierName:body.supplierName||body.supplierId,effectiveDate:notice.effectiveDate,detectedDate:notice.detectedDate,approvedAt:notice.detectedDate,approvedByUserId:user.id,approvedByUserName:user.displayName||user.id,status:'ACTIVE',source:['prices','supplier-file'].includes(body.mode)?'OWNER_SUPPLIER_FILE':'OWNER_CSV_IMPORT',changeType:'PRICE_UPDATE',reason:'Owner confirmed supplier file import',fileSource:body.fileSource||{}};
   for(const [field,oldKey,newKey] of [['casePrice','previousCasePrice','newCasePrice'],['packPrice','previousPackPrice','newPackPrice']]){
    if(original[field]!==undefined)history[oldKey]=original[field];
    if(notice[newKey]!==undefined){history[newKey]=notice[newKey];if(notice[newKey]!==original[field]){update.changes[field]=notice[newKey];update.before[field]=original[field]??null;}}
   }
   priceHistory.push(history);
  }
  changes.notices=[];
 }
 const count=plan.categories.length+plan.creates.length+changes.updates.length+changes.notices.length+priceHistory.length+(body.removeMissing?missing.length:0)+2;
 if(count>450)throw new Error(replacement?'This complete catalogue exceeds the safe transaction limit. Nothing was saved. Use bulk editing for partial updates; do not split a replacement file.':'Too many changes for one safe import. Use a smaller update file without removing missing products.');
 return {plan,missing,changes,priceHistory,selections:resolution.selections};
}

export async function supplierCatalogImport(db:any,uid:string,body:any) {
 if(!['catalog-preview','catalog-commit'].includes(body.action)||typeof body.csv!=='string'||body.csv.length>3*1024*1024||![body.supplierId,body.requestId].every(v=>typeof v==='string'&&/^[\w-]{1,60}$/.test(v))||typeof body.removeMissing!=='boolean')throw new Error('Invalid catalogue import request.');
 if(body.mode!==undefined&&!['catalogue','replace-catalogue','prices','supplier-file'].includes(body.mode))throw new Error('Invalid import mode.');
 if(body.useRowOrder!==undefined&&typeof body.useRowOrder!=='boolean')throw new Error('Invalid CSV ordering choice.');
 if((body.useRowOrder||body.newProductDefaults)&&!['catalogue','replace-catalogue'].includes(body.mode))throw new Error('Ordering and new-product choices apply only to catalogue CSV files.');
 if(body.fileSource!==undefined&&(typeof body.fileSource!=='object'||body.fileSource===null||Array.isArray(body.fileSource)||Object.entries(body.fileSource).some(([k,v])=>!['name','reference','date','supplier','currency','notes'].includes(k)||typeof v!=='string'||v.length>2000)))throw new Error('Invalid file details.');
 if(['prices','supplier-file'].includes(body.mode)&&body.action==='catalog-commit'&&body.reviewed!==true)throw new Error('Check the matched items, warnings and GBP prices excluding VAT before confirming.');
 // Reject malformed/oversized files before any database reads. Catalogue
 // validation and fresh permissions still run inside the transaction.
 const inputRows=parseSupplierCatalogCSV(body.csv);
 validateCatalogueFile(inputRows,body.supplierId,undefined,body.mode==='replace-catalogue');
 if(!inputRows.length||inputRows.length>240)throw new Error('Import 1 to 240 product rows at a time. Do not use full catalogue mode for a partial file.');
 const choices=validateCatalogueChoices(body.conflictChoices,inputRows.length);
 if(body.mode==='replace-catalogue'){
  validateReplacementRows(inputRows);
  if(body.removeMissing!==true||choices.length)throw new Error('A replacement uses the complete CSV list and removes omitted active products.');
 }
 if(choices.length&&(['prices','supplier-file'].includes(body.mode)||typeof body.conflictExpected!=='string'||body.conflictExpected.length>128))throw new Error('Invalid CSV conflict review. Select the catalogue CSV again.');
 const payloadHash=createHash('sha256').update(JSON.stringify([body.supplierId,body.csv,body.removeMissing,body.expected,body.mode,body.fileSource,body.reviewed,choices,body.conflictExpected,body.newProductDefaults,body.useRowOrder])).digest('hex');
 return db.runTransaction(async(tx:any)=>{
  // Authorise before reading catalogue data. Recheck on every transaction retry.
  const [profile,roleDoc]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(db.collection('settings').doc('role_permissions'))]);
  const user={...profile.data(),id:uid},roles=roleDoc.data()?.map;
  if(!checkUserActionPermission(user,'manage_products',roles)||!hasSupplierScope(user,body.supplierId))throw new Error('You cannot import products for this supplier.');
  if(!checkUserActionPermission(user,'view_prices',roles))throw new Error('Price access is required for catalogue imports.');
  if(body.mode==='replace-catalogue'&&user.role!=='CREATOR')throw new Error('Only the workspace owner can replace a complete supplier catalogue.');
  const receiptRef=db.collection('_product_operations').doc(`ci_${body.requestId}`);
  const receipt=await tx.get(receiptRef);
  if(receipt.exists){if(receipt.data().userId!==uid||receipt.data().payloadHash!==payloadHash||body.action!=='catalog-commit')throw new Error('This import reference has already been used. Select the file again.');return receipt.data().result;}
  const [supplier,productDocs,categoryDocs,branchDocs]=await Promise.all([tx.get(db.collection('suppliers').doc(body.supplierId)),tx.get(db.collection('products').where('supplierId','==',body.supplierId)),tx.get(db.collection('categories')),tx.get(db.collection('branches'))]);
  if(!supplier.exists)throw new Error('Supplier not found.');
  const records=(snapshot:any):any[]=>snapshot.docs.map((d:any)=>({...d.data(),id:d.id})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
  const products=records(productDocs),categories=records(categoryDocs),branches=records(branchDocs);
  const expected=restoreFingerprint({products,categories,branches,supplier:supplier.data(),immediatePrices:user.role==='CREATOR'});
  if(choices.length&&body.conflictExpected!==expected)throw new Error('The catalogue changed after the product comparison. Cancel and select the CSV again. Nothing was saved.');
  const resolution=body.mode==='replace-catalogue'?{unresolved:[],conflicts:[]}:resolveCatalogueConflicts(inputRows,body.supplierId,products,choices);
  if(resolution.unresolved.length){
   if(body.action==='catalog-preview'&&!['prices','supplier-file'].includes(body.mode))return {status:'conflicts',expected,conflicts:resolution.conflicts};
   throw new Error('Choose the correct product for each CSV conflict before continuing.');
  }
  if(['catalogue','replace-catalogue'].includes(body.mode)){
   const resolved=body.mode==='replace-catalogue'?inputRows:resolveCatalogueConflicts(inputRows,body.supplierId,products,choices).rows;
   const pool=body.mode==='replace-catalogue'?prepareCatalogueReplacement(inputRows,body.supplierId,products).products:products;
   const setup=prepareCatalogueDefaults(resolved,body.supplierId,pool,categories,branches,body.newProductDefaults);
   if(setup.needed.length){
    // Validate the whole file before requesting missing defaults. This plan is
    // discarded: no inferred defaults are ever saved or approved here.
    const checked=body.mode==='replace-catalogue'?undefined:resolveCatalogueConflicts(inputRows,body.supplierId,products,choices).reviewedIds;
    let validationId=0;
    planSupplierCatalogImport({rows:setup.rows,supplierId:body.supplierId,products:pool,categories,branches,reviewedConflictIds:checked,allowUncodedCreates:true,checkUncodedDuplicates:body.mode==='catalogue',newId:()=>`validation_${++validationId}`});
    if(body.action==='catalog-preview')return {status:'details-required',expected,needed:setup.needed};
    throw new Error('Complete the new-product choices and review again. Nothing was saved.');
   }
  }
  const {plan,missing,changes,priceHistory,selections}=prepareSupplierCatalog(user,roles,{...body,supplierName:supplier.data().name},products,categories,branches);
  const summary={added:plan.creates.length,updated:plan.updates.length,proposed:changes.notices.length,pricesApplied:priceHistory.length,immediatePrices:user.role==='CREATOR',removed:body.removeMissing?missing.length:0,unchanged:plan.unchanged};
  const prices=[...plan.updates.map(u=>({before:products.find(p=>p.id===u.id),after:u.changes})),...plan.creates.map(p=>({before:{name:p.name,itemCode:p.itemCode},after:p}))].filter(p=>(['casePrice','packPrice'] as const).some(k=>p.after[k]!==undefined&&p.after[k]!==p.before[k])).map(p=>({name:p.before.name,itemCode:p.before.itemCode||'',before:{casePrice:p.before.casePrice??null,packPrice:p.before.packPrice??null},after:{casePrice:p.after.casePrice??p.before.casePrice??null,packPrice:p.after.packPrice??p.before.packPrice??null},flags:priceWarnings(p.before,p.after)}));
  const matchedItems=body.mode==='supplier-file'?plan.updates.map(u=>{const old=products.find(p=>p.id===u.id);return {id:u.id,fingerprint:productFingerprint(old),itemCode:old.itemCode||'',before:{name:old.name,casePrice:old.casePrice??null,packPrice:old.packPrice??null},after:{name:u.changes.name??old.name,casePrice:u.changes.casePrice??old.casePrice??null,packPrice:u.changes.packPrice??old.packPrice??null},flags:priceWarnings(old,u.changes)};}):undefined;
  if(body.action==='catalog-preview')return {expected,...summary,prices,selections,...(matchedItems?{matchedItems}:{}),missing:missing.map(p=>({id:p.id,name:p.name,itemCode:p.itemCode||''})),details:catalogueReviewDetails(plan,products,categories),orderPreview:plan.orderPreview,unchangedItems:inputRows.filter((_,i)=>!plan.updates.some(u=>plan.rowNumbers?.[u.id]===i+2)&&!plan.creates.some(p=>plan.rowNumbers?.[p.id]===i+2)).map(r=>({name:decodeCSVText(r.Name||products.find(p=>p.id===r.SystemID)?.name||r.ItemCode||'Product')}))};
  if(body.expected!==expected)throw new Error('The catalogue changed after your review. Cancel and select the file again. Nothing was saved.');
  if(body.mode&&prices.some(p=>p.flags.length)&&body.reviewed!==true)throw new Error('Review the price warnings before confirming.');
  if(!plan.categories.length&&!plan.creates.length&&!changes.updates.length&&!changes.notices.length&&!priceHistory.length&&!(body.removeMissing&&missing.length))return summary;
  for(const c of plan.categories)tx.create(db.collection('categories').doc(c.id),c);
  for(const p of plan.creates)tx.create(db.collection('products').doc(p.id),p);
  for(const u of changes.updates)tx.update(db.collection('products').doc(u.id),u.changes);
  for(const n of changes.notices)tx.create(db.collection('price_change_notices').doc(n.id),n);
  for(const h of priceHistory)tx.create(db.collection('price_history').doc(h.id),h);
  // Keep permanent product IDs and all historical orders; hide discontinued items from ordering.
  if(body.removeMissing)for(const p of missing)tx.update(db.collection('products').doc(p.id),{active:false});
  const timestamp=new Date().toISOString();
  tx.create(receiptRef,{userId:uid,payloadHash,result:summary,timestamp});
  tx.create(db.collection('_audit_logs').doc(`ci_${body.requestId}`),{userId:uid,entityType:'PRODUCT',entityId:body.supplierId,action:'SUPPLIER_CATALOG_IMPORT',timestamp,details:{...summary,mode:body.mode||'catalogue',fileSource:body.fileSource||{},reviewed:body.reviewed===true,productChoices:selections,updates:changes.updates,addedIds:plan.creates.map(p=>p.id),removedIds:body.removeMissing?missing.map(p=>p.id):[],priceProposals:changes.notices.map(n=>n.id)}});
  return summary;
 // A quota failure must reach the caller, not trigger Firestore's long
 // RESOURCE_EXHAUSTED backoff and another full catalogue read. Explicit
 // retries retain the receipt/fingerprint checks above.
 },body.action==='catalog-preview'?{readOnly:true}:{maxAttempts:1});
}
