import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {readSupplierFileData} from '../shared/supplier-file-reader.ts';
const noScan=async()=>{throw new Error('Spreadsheet must not call scanner');};
test('Excel XLSX, legacy XLS and CSV read locally with leading-zero codes and no scanner calls',async()=>{
 const rows=[{ItemCode:'001',Name:'Rice, premium',PriceBox:0,PriceUnit:2.5},{ItemCode:'002',Name:'Noodles',PriceBox:12,PriceUnit:''}];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'Prices');
 for(const bookType of ['xlsx','biff8','csv'] as const){const bytes=XLSX.write(book,{type:'buffer',bookType});const file=new File([bytes],`Prices.${bookType==='biff8'?'xls':bookType}`);const result=await readSupplierFileData(file,noScan);assert.equal(result.scanned,false);assert.equal(result.rows[0].ItemCode,'001');assert.equal(result.rows[0].PriceBox,'0');assert.equal(result.rows[0].PriceUnit,'2.5');assert.equal(result.rows[1].PriceUnit,'');}
});
test('ambiguous worksheets, duplicate CSV columns, malformed rows and oversize files reject',async()=>{
 const book=XLSX.utils.book_new();for(const sheet of ['One','Two'])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Code'],['001']]),sheet);
 await assert.rejects(readSupplierFileData(new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'two.xlsx'),noScan),/separate workbook/);
 await assert.rejects(readSupplierFileData(new File(['Code,Code\n001,002'],'bad.csv'),noScan),/Duplicate/);
 await assert.rejects(readSupplierFileData(new File(['Code,Price\n001,2,3'],'bad.csv'),noScan),/Cannot read/);
 await assert.rejects(readSupplierFileData(new File([new Uint8Array(3*1024*1024+1)],'large.pdf'),noScan),/3 MB/);
});
test('PDF and photos use injected scanner and retain uncertainty, source metadata and null prices',async()=>{
 for(const [ext,mime] of [['pdf','application/pdf'],['jpg','image/jpeg'],['png','image/png'],['webp','image/webp']]){
  let calls=0;const result=await readSupplierFileData(new File(['synthetic'],`Price.${ext}`),async(file,received)=>{calls++;assert.equal(received,mime);return {supplierName:'Supplier',currency:'GBP',invoiceNumber:'P-10',invoiceDate:'2026-10-17',notes:'Check rotated text',extractedItems:[{itemCode:'001',casePrice:null,unitPrice:12,unitTypeDetected:'CASE',notes:'Unclear digit'}]};});
  assert.equal(calls,1);assert.equal(result.scanned,true);assert.equal(result.supplierName,'Supplier');assert.equal(result.invoiceNumber,'P-10');assert.equal(result.notes,'Check rotated text');assert.equal(result.rows[0].casePrice,null);assert.equal(result.rows[0].notes,'Unclear digit');
 }
});
test('scanner failures, foreign currencies and malformed responses never become empty successful imports',async()=>{
 const file=new File(['test'],'price.pdf');await assert.rejects(readSupplierFileData(file,async()=>{throw new Error('Service unavailable');}),/Service unavailable/);
 await assert.rejects(readSupplierFileData(file,async()=>({currency:'EUR',lineItems:[]})),/different currency/);
 await assert.rejects(readSupplierFileData(file,async()=>({lineItems:'not a list'})),/valid item list/);
 await assert.rejects(readSupplierFileData(new File(['test'],'price.exe'),noScan),/Supported files/);
});
