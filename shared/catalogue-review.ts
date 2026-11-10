import type {Category,Product} from '../types';
import type {CatalogImportPlan} from '../utils/supplierCatalogImport';
import {productFingerprint} from './product-workbench.ts';
import {priceWarnings} from './supplier-file.ts';

/** Build the review from the same validated plan that will be committed. No extra reads. */
export function catalogueReviewDetails(plan:CatalogImportPlan,products:Product[],categories:Category[]=[]){
 const categoryNames=new Map([...categories,...plan.categories].map(category=>[category.id,category.name]));
 const categoryLabel=(id:string|undefined)=>id?(categoryNames.get(id)||'Category unavailable'):'Not set';
 const changes=[...plan.creates.map(product=>({id:product.id,action:'Add',before:{} as Partial<Product>,after:product,fields:Object.keys(product).filter(k=>!['id','supplierId'].includes(k))})),...plan.updates.map(update=>{
  const before=products.find(p=>p.id===update.id)!;
  return {id:update.id,action:'Update',before,after:{...before,...update.changes},fields:Object.keys(update.changes)};
 })];
 return changes.map(change=>({...change,positionLabels:plan.orderPreview?.find(p=>p.id===change.id),categoryLabels:{before:categoryLabel(change.before.categoryId),after:categoryLabel(change.after.categoryId)},rowNumber:plan.rowNumbers?.[change.id],name:change.after.name,itemCode:change.after.itemCode||'',flags:[...priceWarnings(change.before,Object.fromEntries(change.fields.map(field=>[field,change.after[field as keyof Product]]))),...(!change.after.itemCode?['No supplier code supplied. HTOS Product ID identifies this item.']:[]),...(change.action==='Add'&&change.after.casePrice===undefined&&change.after.packPrice===undefined?['Prices not supplied. They remain unknown, not £0.']:[]),...(change.action==='Add'&&products.some(p=>!p.removedAt&&p.supplierId===change.after.supplierId&&p.name.trim().toLowerCase()===change.after.name.trim().toLowerCase())?['A product with this name already exists. Check the code and pack before adding another.']:[])]}))
  .sort((a,b)=>(plan.orderPreview?(a.positionLabels?.after??Infinity)-(b.positionLabels?.after??Infinity):0)||Number(a.action==='Add')-Number(b.action==='Add')||a.itemCode.localeCompare(b.itemCode,'en-GB',{numeric:true,sensitivity:'base'})||a.name.localeCompare(b.name));
}

/** A single-screen supplier review must still match the freshly validated server snapshot. */
export function assertSupplierReviewUnchanged(items:{id:string;fingerprint?:string}[],reviewed:Product[]){
 if(items.length!==reviewed.length||new Set(items.map(i=>i.id)).size!==reviewed.length||items.some(item=>{
  const product=reviewed.find(p=>p.id===item.id);
  return !product||item.fingerprint!==productFingerprint(product);
 }))throw new Error('A selected product changed since you opened this file. Nothing was saved. Cancel and upload the file again to review its current details.');
}
