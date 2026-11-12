import {invoiceExtractionSchema,parseInvoiceExtraction,type ExtractedInvoice} from '../shared/invoice-extraction.ts';

/** Provider-only evidence contract. Existing stored invoice drafts keep their original schema. */
export interface IdentityBlock {
 page:number; role:'SUPPLIER'|'CUSTOMER'|'OTHER'|'UNKNOWN'; name:string|null;
 location:string|null; locationKind:'DELIVERY'|'BILLING'|'BRANCH'|'UNLABELLED'|'NONE';
 roleEvidence:string|null;
}
export interface RowWitness {
 page:number; row:number; description:string; previousPrintedLabel:string|null;
 nextPrintedLabel:string|null; alignment:'CLEAR'|'UNCERTAIN';
}
export interface ReadingEvidence {identityBlocks:IdentityBlock[]; rowWitnesses:RowWitness[]}
const text={type:['string','null']};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const invoiceReadingSchema=object({
 identityBlocks:{type:'array',items:object({page:{type:'integer'},role:{type:'string',enum:['SUPPLIER','CUSTOMER','OTHER','UNKNOWN']},name:text,location:text,locationKind:{type:'string',enum:['DELIVERY','BILLING','BRANCH','UNLABELLED','NONE']},roleEvidence:text})},
 rowWitnesses:{type:'array',items:object({page:{type:'integer'},row:{type:'integer'},description:{type:'string'},previousPrintedLabel:text,nextPrintedLabel:text,alignment:{type:'string',enum:['CLEAR','UNCERTAIN']}})},
 invoice:invoiceExtractionSchema,
});
const norm=(s:string|null|undefined)=>(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const fail=():never=>{throw Error('Invoice reading evidence is invalid or incomplete. No figures applied.');};
function bounded(v:unknown,nullable=true):string|null {
 if(v===null&&nullable)return null;
 if(typeof v!=='string'||v.length>1000)return fail();
 return v.trim();
}
function integer(v:unknown,max:number):number {if(!Number.isInteger(v)||Number(v)<1||Number(v)>max)return fail();return Number(v);}
function unique(values:(string|null)[]):string|null {
 const valid=values.filter((v):v is string=>!!v?.trim());
 return valid.length&&new Set(valid.map(norm)).size===1?valid[0]:null;
}

/** Consistency checks, not proof that AI saw correctly. Human review remains mandatory. */
export function parseEvidenceReading(raw:unknown):{draft:ExtractedInvoice;evidence:ReadingEvidence} {
 const v=raw as Record<string,unknown>;
 if(!v||!Array.isArray(v.identityBlocks)||v.identityBlocks.length>32||!Array.isArray(v.rowWitnesses)||v.rowWitnesses.length>400)return fail();
 const identityBlocks=v.identityBlocks.map((raw:any):IdentityBlock=>{
  if(!raw||!['SUPPLIER','CUSTOMER','OTHER','UNKNOWN'].includes(raw.role)||!['DELIVERY','BILLING','BRANCH','UNLABELLED','NONE'].includes(raw.locationKind))return fail();
  return {page:integer(raw.page,100),role:raw.role,name:bounded(raw.name),location:bounded(raw.location),locationKind:raw.locationKind,roleEvidence:bounded(raw.roleEvidence)};
 });
 const rowWitnesses=v.rowWitnesses.map((raw:any):RowWitness=>{
  if(!raw||!['CLEAR','UNCERTAIN'].includes(raw.alignment))return fail();
  return {page:integer(raw.page,100),row:integer(raw.row,1000),description:bounded(raw.description,false) as string,previousPrintedLabel:bounded(raw.previousPrintedLabel),nextPrintedLabel:bounded(raw.nextPrintedLabel),alignment:raw.alignment};
 });
 const draft=parseInvoiceExtraction(v.invoice),keys=new Set(rowWitnesses.map(r=>`${r.page}:${r.row}`));
 if(keys.size!==rowWitnesses.length||rowWitnesses.length!==draft.rows.length||draft.rows.some(r=>!keys.has(`${r.page}:${r.row}`)))return fail();
 // Do not let an AI TABLE classification override evidence of gaps in a catalogue.
 // This is a conservative review flag, not a guessed correction to any product or amount.
 const billedLabels=new Set(draft.rows.map(r=>`${r.page}:${norm(r.description)}`));
 const unbilledNeighbours=rowWitnesses.some(w=>!!w.previousPrintedLabel&&!!w.nextPrintedLabel&&!billedLabels.has(`${w.page}:${norm(w.previousPrintedLabel)}`)&&!billedLabels.has(`${w.page}:${norm(w.nextPrintedLabel)}`));
 const alignmentReview='Unbilled neighbouring product labels indicate possible catalogue gaps; manually check row alignment before using figures.';
 if(unbilledNeighbours)draft.warnings.push(alignmentReview);
 const supported=(role:IdentityBlock['role'])=>identityBlocks.filter(b=>b.role===role&&!!b.roleEvidence);
 const supplier=unique(supported('SUPPLIER').map(b=>b.name));
 const customers=supported('CUSTOMER');
 const customerName=unique(customers.map(b=>b.name));
 const deliveries=customers.filter(b=>b.locationKind==='DELIVERY'||b.locationKind==='BRANCH');
 const locations=deliveries.length?deliveries:customers.filter(b=>b.locationKind==='BILLING');
 let branch=unique(locations.map(b=>b.location));
 // A supplier/other block cannot supply a missing customer location. Conflicts stay unknown.
 if(branch&&identityBlocks.some(b=>b.role!=='CUSTOMER'&&norm(b.location)===norm(branch))){branch=null;draft.warnings.push('Location occurs in a non-customer block; confirm the customer branch manually.');}
 for(const [field,value] of [['supplier',supplier],['customerName',customerName],['branch',branch]] as const){
  if(norm(draft[field])!==norm(value))draft.warnings.push(`${field} differs from its supporting document block; unsupported identity was withheld or replaced by the evidence draft. Review the original.`);
  draft[field]=value;
 }
 if(!branch)draft.warnings.push('Customer branch is not established by an explicit customer delivery, billing or branch location. No location inferred from supplier address or customer number.');
 draft.rows=draft.rows.map(r=>{
  const w=rowWitnesses.find(w=>w.page===r.page&&w.row===r.row)!;
  const unsupported=w.alignment!=='CLEAR'||norm(w.description)!==norm(r.description)||!w.description;
  const additional=[...(unsupported?['Product label / amount alignment is not supported by a clear, consistent row witness. Check the original row.']:[]),...(unbilledNeighbours?[alignmentReview]:[])];
  return additional.length?{...r,uncertain:[...new Set([...r.uncertain,...additional])]}:r;
 });
 return {draft,evidence:{identityBlocks,rowWitnesses}};
}
