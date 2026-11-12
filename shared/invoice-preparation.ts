import type {PreparedInvoiceJob} from '../server/invoice-section-jobs.ts';

export const preparationPartLength=500000;
export const preparationRevision='photo-sections-v1';
export interface PreparationSection {id:string;kind:'header'|'rows'|'totals';page:number;sha256:string;width:number;height:number;length:number;parts:number}
export interface PreparationManifest {documentHash:string;revision:string;confirmed:true;sections:PreparationSection[]}
export function preparationManifest(plan:PreparedInvoiceJob):PreparationManifest {
 return {documentHash:plan.documentHash,revision:preparationRevision,confirmed:true,sections:plan.sections.map(s=>({id:s.id,kind:s.kind,page:s.page,sha256:s.sha256,width:s.width,height:s.height,length:s.base64.length,parts:Math.ceil(s.base64.length/preparationPartLength)}))};
}
/** Bounded uploads, no automatic retries. Repeating explicitly reuses stored parts. */
export async function uploadInvoicePreparation(request:(body:any)=>Promise<any>,identity:{caseId:string;documentId:string;expectedVersion:number},plan:PreparedInvoiceJob,progress?:(saved:number,total:number)=>void){
 const start=await request({action:'invoice-case-preparation-start',...identity,manifest:preparationManifest(plan)});
 if(!start)throw new Error('Preparation was not saved.');
 if(start.ready)return start;
 const total=plan.sections.reduce((n,s)=>n+Math.ceil(s.base64.length/preparationPartLength),0),received=new Set<string>(start.received||[]);let saved=received.size;
 progress?.(saved,total);
 for(const s of plan.sections)for(let i=0;i<Math.ceil(s.base64.length/preparationPartLength);i++){
  if(received.has(s.id+':'+i))continue;
  const result=await request({action:'invoice-case-preparation-part',...identity,preparationId:start.preparationId,sectionId:s.id,index:i,base64:s.base64.slice(i*preparationPartLength,(i+1)*preparationPartLength)});
  if(!result)throw new Error('Upload stopped. Saved parts are retained; choose Save again to continue.');
  progress?.(++saved,total);
 }
 const complete=await request({action:'invoice-case-preparation-complete',...identity,preparationId:start.preparationId});
 if(!complete?.ready)throw new Error('Preparation could not be confirmed. No reading was started.');
 return complete;
}
