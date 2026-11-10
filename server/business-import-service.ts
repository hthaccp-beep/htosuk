import { IMPORT_COLLECTIONS, IMPORT_BATCH_SIZE, validateImportRecord, sameImportRecord, isImportOwner, type ImportCollection, type ImportRecord } from '../shared/business-import.ts';
export class ImportError extends Error {
  status:number;
  constructor(status:number,message:string){super(message);this.status=status;}
}
export async function runBusinessImport(input:any, actor:string, deps:{
  transaction:<T>(work:(tx:{profile:()=>Promise<any>;get:(collection:ImportCollection,id:string)=>Promise<ImportRecord|undefined>;create:(collection:ImportCollection,data:ImportRecord)=>void})=>Promise<T>)=>Promise<T>;
}) {
  if(!input||!IMPORT_COLLECTIONS.includes(input.collection)||!['preview','commit'].includes(input.action)||!Array.isArray(input.records)||!input.records.length||input.records.length>IMPORT_BATCH_SIZE)throw new ImportError(400,'Invalid import batch.');
  let records:ImportRecord[];
  try{records=input.records.map((record:unknown)=>validateImportRecord(input.collection,record));}catch(e){throw new ImportError(400,(e as Error).message);}
  if(new Set(records.map(r=>r.id)).size!==records.length)throw new ImportError(400,'Duplicate IDs in batch.');
  return deps.transaction(async tx=>{
    if(!actor||!isImportOwner(await tx.profile()))throw new ImportError(403,'Only the active HTOS workspace owner can import business data.');
    const existing=await Promise.all(records.map(r=>tx.get(input.collection,r.id)));
    const conflicts=records.filter((r,i)=>existing[i]&&!sameImportRecord(r,existing[i])).map(r=>r.id);
    const fresh=records.filter((_,i)=>!existing[i]);
    if(input.action==='commit'&&conflicts.length)throw new ImportError(409,`Existing ${input.collection} records differ. Nothing in this batch was changed. Review the import again.`);
    if(input.action==='commit')for(const record of fresh)tx.create(input.collection,record);
    return {collection:input.collection,created:input.action==='commit'?fresh.length:0,newCount:fresh.length,unchanged:records.length-fresh.length-conflicts.length,conflicts};
  });
}
