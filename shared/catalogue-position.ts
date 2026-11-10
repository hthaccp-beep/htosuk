import type {Product,Category} from '../types.ts';
import type {CatalogImportPlan} from '../utils/supplierCatalogImport.ts';
import {productSequence} from './product-workbench.ts';
import {CatalogueValidationError,type CatalogueIssue} from './catalogue-errors.ts';

/** Dense CSV positions describe the displayed sequence, not stored legacy ranks.
 * Only an actual rearrangement/addition normalises saved ranks. Exporting never does. */
export function applyCataloguePositions(plan:CatalogImportPlan,products:Product[],categories:Category[],rows:Record<string,string>[],useRowOrder=false){
 const baseline=productSequence(products,categories);
 const originalIds=baseline.map(p=>p.id);
 const initial=[...originalIds,...plan.creates.map(p=>p.id)];
 const rowIds=Object.entries(plan.rowNumbers||{}).sort((a,b)=>a[1]-b[1]);
 const issues:CatalogueIssue[]=[];
 const requested=new Map<string,number>(),seen=new Map<number,number>();
 for(const [id,rowNumber] of rowIds){
  const row=rows[rowNumber-2];
  if(row.CSVVersion!=='2'||!row.Position?.trim()||useRowOrder)continue;
  const position=Number(row.Position);
  if(!Number.isInteger(position)||position<1||position>initial.length){issues.push({row:rowNumber,field:'Position',message:`Row ${rowNumber}: Position must be a whole number from 1 to ${initial.length}.`});continue;}
  if(seen.has(position))issues.push({row:rowNumber,field:'Position',message:`Rows ${seen.get(position)} and ${rowNumber}: Position ${position} is repeated. Give each row a different position, or choose Use CSV row order.`});
  seen.set(position,rowNumber);requested.set(id,position);
 }
 if(issues.length)throw new CatalogueValidationError(issues);
 let next=[...initial];
 if(useRowOrder){const fileIds=rowIds.map(([id])=>id),included=new Set(fileIds);next=[...fileIds,...initial.filter(id=>!included.has(id))];}
 else if(requested.size){
  // Place specified rows in their exact slots; fill gaps with the untouched
  // sequence. A partial file never drops or alphabetises omitted products.
  const slots:Array<string|undefined>=Array(initial.length).fill(undefined);
  for(const [id,position] of requested)slots[position-1]=id;
  const remaining=initial.filter(id=>!requested.has(id));let index=0;
  next=slots.map(id=>id??remaining[index++]);
 }
 const projected=productSequence([...products.map(p=>({...p,...plan.updates.find(u=>u.id===p.id)?.changes})),...plan.creates],categories).map(p=>p.id);
 const changed=next.some((id,index)=>id!==projected[index])||next.length!==originalIds.length||next.some((id,index)=>id!==originalIds[index]);
 plan.orderPreview=next.map((id,index)=>({id,name:plan.creates.find(p=>p.id===id)?.name||products.find(p=>p.id===id)?.name||id,before:originalIds.includes(id)?originalIds.indexOf(id)+1:null,after:index+1,inFile:!!plan.rowNumbers?.[id]}));
 if(!changed)return;
 for(const [index,id] of next.entries()){
  const created=plan.creates.find(p=>p.id===id);
  if(created){created.cataloguePosition=index+1;created.displayOrder=index+1;continue;}
  const old=products.find(p=>p.id===id)!;
  if(old.cataloguePosition===index+1&&old.displayOrder===index+1)continue;
  let update=plan.updates.find(p=>p.id===id);
  if(!update){update={id,changes:{}};plan.updates.push(update);if(plan.rowNumbers?.[id])plan.unchanged--;}
  Object.assign(update.changes,{cataloguePosition:index+1,displayOrder:index+1});
 }
}
