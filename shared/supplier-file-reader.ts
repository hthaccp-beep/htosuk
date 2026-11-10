import Papa from 'papaparse';
import {CatalogueValidationError} from './catalogue-errors.ts';
export type SupplierScan=(file:File,mime:string)=>Promise<any>;
export async function readSupplierFileData(file:File,scan:SupplierScan){
 if(file.size>3*1024*1024)throw new Error('Choose a file under 3 MB.');
 if(/\.(csv|xlsx|xls)$/i.test(file.name)){
  let text:string;
  if(/\.csv$/i.test(file.name))text=await file.text();
  else {const XLSX=await import('xlsx');const book=XLSX.read(await file.arrayBuffer(),{cellDates:false,sheetRows:2002});if(book.SheetNames.length!==1)throw new Error('Save the required worksheet as a separate workbook or CSV before uploading.');text=XLSX.utils.sheet_to_csv(book.Sheets[book.SheetNames[0]]);}
  const parsed=Papa.parse<Record<string,string>>(text.replace(/^\uFEFF/,''),{header:true,skipEmptyLines:'greedy'});
  const structureIssues=Object.entries(parsed.meta.renamedHeaders||{}).map(([,original])=>({row:1,message:`Duplicate column heading: ${original}. Give each column a unique name.`}));
  const parseIssues=parsed.errors.map(error=>({...(error.row!==undefined?{row:error.row+(error.type==='FieldMismatch'?2:1)}:{}),message:`Cannot read the table: ${error.message}. Fix the file structure before checking product values.`}));
  if(structureIssues.length||parseIssues.length)throw new CatalogueValidationError([...structureIssues,...parseIssues],'structure');
  if(!parsed.data.length||parsed.data.length>2000)throw new Error('Upload between 1 and 2,000 product rows.');
  return {rows:parsed.data,invoiceNumber:'',invoiceDate:'',supplierName:'',currency:'',notes:'',scanned:false};
 }
 const ext=file.name.split('.').pop()?.toLowerCase()||'';
 const mime=file.type||({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'} as Record<string,string>)[ext];
 if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(mime))throw new Error('Supported files: CSV, Excel, PDF, JPG, PNG and WebP.');
 const result=await scan(file,mime);
 if(result.currency&&String(result.currency).toUpperCase()!=='GBP')throw new Error('This document uses a different currency. Review GBP prices manually.');
 const rows=result.extractedItems||result.lineItems||[];
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('The document reader did not return a valid item list. Try a clearer file.');
 return {rows,invoiceNumber:result.invoiceNumber||'',invoiceDate:result.invoiceDate||'',supplierName:result.supplierName||'',currency:result.currency||'',notes:typeof result.notes==='string'?result.notes:JSON.stringify(result.notes||''),scanned:true};
}
