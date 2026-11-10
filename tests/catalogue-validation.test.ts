import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogueValidationError,catalogueErrorPayload} from '../shared/catalogue-errors.ts';
import {collectCatalogueFileIssues,validateCatalogueFile} from '../shared/catalogue-file-validation.ts';
import {parseSupplierCatalogCSV,planSupplierCatalogImport} from '../utils/supplierCatalogImport.ts';
import {readApiResponse} from '../shared/api-response.ts';
import {readSupplierFileData} from '../shared/supplier-file-reader.ts';
const branches:any[]=[{id:'a',code:'A',name:'Branch A',active:true},{id:'b',code:'B',name:'Branch B',active:true}];
const categories:any[]=[{id:'c',supplierId:'s',name:'Food',active:true}];
const products:any[]=[{id:'p',supplierId:'s',name:'Rice',itemCode:'001',categoryId:'c',active:true}];
const plan=(rows:Record<string,string>[])=>planSupplierCatalogImport({rows,supplierId:'s',products,categories,branches,newId:()=>crypto.randomUUID(),allowUncodedCreates:true});

test('collects independent errors on the same row and every later row in one check',()=>{
 const issues=collectCatalogueFileIssues([
  {SystemID:'p',SupplierID:'foreign',PriceBox:'bad',PriceUnit:'-1',VATRate:'20',Active:'maybe',UnitType:'BOX',CataloguePosition:'0',BranchScope:'ALL',A:'Yes',B:'No'},
  {SystemID:'p',SupplierID:'another',PriceBox:'NaN',Active:'??',BranchScope:'WRONG',A:'??',B:'Yes'}
 ],'s',branches);
 assert.equal(issues.length,14);
 assert.equal(issues.filter(i=>i.row===2).length,8);
 assert.equal(issues.filter(i=>i.row===3).length,6);
 assert.ok(issues.some(i=>i.field==='BranchScope'&&i.message.includes('SELECTED')));
});

test('file errors reject without planning; blanks and explicit zero retain existing meanings',()=>{
 assert.throws(()=>validateCatalogueFile([{Name:'New',PriceBox:'bad'},{Name:'Other',Active:'wrong'}],'s'),e=>e instanceof CatalogueValidationError&&e.stage==='file'&&e.issues.length===2);
 assert.deepEqual(collectCatalogueFileIssues([{Name:'New',PriceBox:'0',PriceUnit:'',SupplierID:'',Active:'FALSE',BranchScope:'SELECTED',A:'No',B:'Yes'}],'s',branches),[]);
 assert.deepEqual(collectCatalogueFileIssues([{SystemID:'one',ItemCode:'DUP'},{SystemID:'two',ItemCode:'DUP'}],'s',branches),[]);
});

test('catalogue errors include all bad identities alongside independent cell and category errors',()=>{
 const before=JSON.stringify({products,categories,branches});
 assert.throws(()=>plan([
  {SystemID:'unknown',PriceBox:'bad',PriceUnit:'bad',CategoryID:'wrong',BranchScope:'ALL',A:'No',B:'Yes'},
  {SystemID:'foreign',Active:'bad'},
  {SystemID:'p',PriceBox:'12'}
 ]),e=>{
  assert.ok(e instanceof CatalogueValidationError);
  assert.ok(e.issues.some(i=>i.row===2&&i.message.includes('SystemID does not belong')));
  assert.ok(e.issues.some(i=>i.row===3&&i.message.includes('SystemID does not belong')));
  assert.ok(e.issues.some(i=>i.row===2&&i.message.includes('CategoryID')));
  assert.ok(e.issues.some(i=>i.row===2&&i.message.includes('PriceUnit')));
  assert.equal(e.stage,'catalogue');return true;
 });
 assert.equal(JSON.stringify({products,categories,branches}),before);
});

test('all malformed column counts are reported; no usable rows are returned',async()=>{
 const csv='SystemID,ItemCode,Name\np,001\nq,002,Noodles,extra\nr,003,Rice';
 assert.throws(()=>parseSupplierCatalogCSV(csv),e=>e instanceof CatalogueValidationError&&e.stage==='structure'&&e.issues.length===2&&e.issues[0].row===2&&e.issues[1].row===3);
 await assert.rejects(readSupplierFileData(new File([csv],'synthetic.csv'),async()=>{throw new Error('No scanner');}),e=>e instanceof CatalogueValidationError&&e.issues.length===2&&e.issues[0].row===2&&e.issues[1].row===3);
});

test('structured validation errors survive the actual API response reader',async()=>{
 const error=new CatalogueValidationError([{row:2,field:'PriceBox',message:'Row 2: invalid price'},{row:9,field:'Active',message:'Row 9: use Yes or No'}],'file');
 await assert.rejects(readApiResponse(Response.json({error:error.message,...catalogueErrorPayload(error)},{status:400}),'catalog-preview'),e=>e instanceof CatalogueValidationError&&e.issues.length===2&&e.stage==='file');
 await assert.rejects(readApiResponse(Response.json({error:'Invalid file',code:'CATALOGUE_VALIDATION',issues:[{message:17}],stage:'file'},{status:400}),'catalog-preview'),/Invalid file/);
});

test('all replacement omissions, duplicate IDs/codes and independent cell errors are listed',()=>{
 const issues=collectCatalogueFileIssues([{SystemID:'p',ItemCode:'001',Name:'',Active:'',PriceBox:'bad'},{SystemID:'p',ItemCode:'001',Name:'Rice',Active:'wrong',PriceUnit:'bad'}],'s',branches,true);
 for(const field of ['Name / Active','SystemID','ItemCode','Active','PriceBox','PriceUnit'])assert.ok(issues.some(i=>i.field===field),field);
});

test('the complete 240-row limit is checked without truncating the issue list',()=>{
 const rows=Array.from({length:240},(_,i)=>({ItemCode:`NEW-${i}`,Name:`Product ${i}`,PriceBox:'bad',Active:'maybe'}));
 assert.throws(()=>validateCatalogueFile(rows,'s'),e=>e instanceof CatalogueValidationError&&e.issues.length===480&&e.issues[0].row===2&&e.issues.at(-1)?.row===241);
});

test('existing editor text limits report every changed field alongside other errors',()=>{
 assert.throws(()=>plan([{SystemID:'p',Name:'n'.repeat(301),ChineseName:'c'.repeat(301),PackSize:'p'.repeat(301),PriceBox:'bad'}]),e=>{
  assert.ok(e instanceof CatalogueValidationError);
  for(const field of ['Name','ChineseName','PackSize'])assert.ok(e.issues.some(i=>i.field===field));
  assert.ok(e.issues.some(i=>i.message.includes('PriceBox')));return true;
 });
});
