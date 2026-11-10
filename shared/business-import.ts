export const IMPORT_COLLECTIONS = ['branches', 'suppliers', 'categories', 'products', 'orders'] as const;
export type ImportCollection = typeof IMPORT_COLLECTIONS[number];
export type ImportRecord = Record<string, any> & { id: string };
export type BusinessExport = Partial<Record<ImportCollection, ImportRecord[]>>;
export const IMPORT_BATCH_SIZE = 75;
const forbidden = /^(password|smtpPass|private_key|accessToken|refreshToken|idToken|apiKey|serviceAccount|credentials)$/i;

function safeValue(value: unknown, depth=0): any {
  if(depth>30) throw new Error('A record is nested too deeply.');
  if(value===null||typeof value==='string'||typeof value==='boolean') return value;
  if(typeof value==='number'&&Number.isFinite(value)) return value;
  if(Array.isArray(value)) return value.map(v=>safeValue(v,depth+1));
  if(value&&typeof value==='object') {
    const result:Record<string,unknown>={};
    for(const [key,item] of Object.entries(value)) {
      if(['__proto__','constructor','prototype'].includes(key)) throw new Error('Invalid record field.');
      if(forbidden.test(key)||item===undefined) continue;
      result[key]=safeValue(item,depth+1);
    }
    return result;
  }
  throw new Error('Records must contain valid JSON values.');
}
export function validateImportRecord(collection: ImportCollection, input:unknown): ImportRecord {
  const value=safeValue(input) as ImportRecord;
  if(!value||Array.isArray(value)||typeof value!=='object') throw new Error('Each record must be an object.');
  if(typeof value.id!=='string'||!value.id.trim()||value.id.includes('/')||value.id.length>500||/^__.*__$/.test(value.id)) throw new Error('A record has an invalid ID.');
  const required=collection==='orders'?['branchId','supplierId','branchNameSnapshot','supplierNameSnapshot','createdAt','orderedByUserId','orderedByNameSnapshot']:['name'];
  for(const key of required) if(typeof value[key]!=='string'||!value[key].trim()) throw new Error(`${collection} / ${value.id}: missing ${key}.`);
  if(collection==='products') {
    if(typeof value.supplierId!=='string'||!value.supplierId.trim()) throw new Error(`${value.name}: a supplier ID is required.`);
    // Legacy catalogues allow an unassigned category. Preserve the source value
    // so retries compare identically and no category is guessed or fabricated.
    if(value.categoryId!=null&&typeof value.categoryId!=='string') throw new Error(`${value.name}: category ID must be text or blank.`);
  }
  if(collection==='orders') {
    if(!['DRAFT','PLACED'].includes(value.status)||!Array.isArray(value.items)) throw new Error(`${value.id}: invalid order status or items.`);
    if(Number.isNaN(Date.parse(value.createdAt))) throw new Error(`${value.id}: invalid order date.`);
    if(value.manualItems!==undefined&&!Array.isArray(value.manualItems)) throw new Error(`${value.id}: invalid custom items.`);
    for(const item of [...value.items,...(value.manualItems||[])]) {
      if(!item||typeof item!=='object'||![item.caseQty,item.packQty].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)) throw new Error(`${value.id}: invalid order quantities.`);
    }
  }
  if(new TextEncoder().encode(JSON.stringify(value)).length>700_000) throw new Error(`${value.id}: record is too large.`);
  return value;
}
export function parseBusinessExport(input:unknown): BusinessExport {
  if(!input||typeof input!=='object') throw new Error('Choose an OrderSystem JSON export.');
  const payload=(input as any).data??input;
  const result:BusinessExport={};let count=0;
  for(const collection of IMPORT_COLLECTIONS) {
    if(payload[collection]===undefined) continue;
    if(!Array.isArray(payload[collection])) throw new Error(`${collection} must be a list of records.`);
    const ids=new Set<string>();
    result[collection]=payload[collection].map((raw:unknown)=>{const record=validateImportRecord(collection,raw);if(ids.has(record.id))throw new Error(`Duplicate ${collection} ID in file: ${record.id}`);ids.add(record.id);return record;});
    count+=result[collection]!.length;
  }
  if(!count) throw new Error('No business records were found in this export.');
  if(count>100_000) throw new Error('Split exports larger than 100,000 records into separate files.');
  return result;
}
export function importBatches(data:BusinessExport) {
  const batches:{collection:ImportCollection;records:ImportRecord[]}[]=[];
  for(const collection of IMPORT_COLLECTIONS) {
    let records:ImportRecord[]=[],size=0;
    for(const record of data[collection]||[]) {
      const bytes=new TextEncoder().encode(JSON.stringify(record)).length;
      if(records.length&&(records.length>=IMPORT_BATCH_SIZE||size+bytes>2_500_000)){batches.push({collection,records});records=[];size=0;}
      records.push(record);size+=bytes;
    }
    if(records.length)batches.push({collection,records});
  }
  return batches;
}
export function sameImportRecord(a:unknown,b:unknown):boolean {
  const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
  return JSON.stringify(sort(safeValue(a)))===JSON.stringify(sort(safeValue(b)));
}
export function isImportOwner(profile:any) {return profile?.active===true&&profile?.role==='CREATOR';}
