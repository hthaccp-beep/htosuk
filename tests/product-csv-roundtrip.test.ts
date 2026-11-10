import test from 'node:test';
import assert from 'node:assert/strict';
import {generateProductCSV} from '../utils/csvHelpers.ts';
import {parseSupplierCatalogCSV,planSupplierCatalogImport} from '../utils/supplierCatalogImport.ts';
import {productCSVEditable,productCSVExtra,productCSVTechnical} from '../shared/product-csv.ts';
import {bulkProductValue} from '../shared/product-editor.ts';
import {applyOwnerProductPrices} from '../server/owner-product-prices.ts';
import {planProductChanges} from '../server/product-workbench-service.ts';
import {productFingerprint} from '../shared/product-workbench.ts';
import type {Product,Branch,Category} from '../types.ts';
const branches=[{id:'b1',code:'HT1',name:'One',active:true},{id:'b2',code:'HT2',name:'Two',active:false}] as Branch[];
const categories=[{id:'c',name:'Food',supplierId:'s',active:true,displayOrder:1}] as Category[];
const p:Product={id:'p',itemCode:'0007',name:'Rice, "best"\n大米',chineseName:'米',supplierId:'s',categoryId:'c',displayOrder:1000,cataloguePosition:2,active:true,allowedBranchIds:['b1'],packSize:'6x2kg',casePrice:0,packPrice:undefined,vatRate:.2,unitType:'CASE_ONLY',caseUnitName:'Carton',packUnitName:'Bag',minParLevel:0,targetParLevel:5};
const plan=(csv:string,products:Product[]=[p])=>planSupplierCatalogImport({rows:parseSupplierCatalogCSV(csv),products,categories,branches,supplierId:'s',newId:()=>crypto.randomUUID()});
test('editable fields come first, human positions replace legacy ranks and IDs come last',()=>{
 assert.deepEqual(generateProductCSV([p],categories,branches).split('\n')[0].split(','),[...productCSVEditable,'HT1','HT2',...productCSVExtra.filter(k=>!['CataloguePosition','BranchScope','SupplierID'].includes(k)),...productCSVTechnical]);
});
test('export and reimport preserve every product field, multiline names, zero and unknown prices',()=>{
 const csv=generateProductCSV([p],categories,branches);const row=parseSupplierCatalogCSV(csv)[0];
 assert.equal(row.PriceBox,'0');assert.equal(row.PriceUnit,'');assert.equal(row.HT2,'No');assert.equal(row.ItemCode,'0007');
 assert.equal(plan(csv).unchanged,1);assert.equal(plan(csv).updates.length,0);
 assert.equal(row.SupplierID,'s');
});

test('missing category links roundtrip unchanged, including previous placeholder exports',()=>{
 for(const categoryId of ['',undefined,'deleted-category']){
  const product={...p,categoryId} as Product;
  const before=structuredClone(product);
  const csv=generateProductCSV([product],categories,branches);
  assert.equal(parseSupplierCatalogCSV(csv)[0].Category,'');
  for(const rows of [parseSupplierCatalogCSV(csv),[{SystemID:p.id,Category:'Uncategorized'}],[{SystemID:p.id,Category:'Uncategorised'}]]){
   const result=planSupplierCatalogImport({rows,products:[product],categories,branches,supplierId:'s',newId:()=>{throw new Error('Unchanged file must not allocate an ID');}});
   assert.equal(result.unchanged,1);assert.deepEqual(result.updates,[]);assert.deepEqual(result.categories,[]);
  }
  assert.deepEqual(product,before);
 }
});

test('equal category names retain saved IDs; intentional category edits still work',()=>{
 const duplicateCategories=[{...categories[0],id:'global',supplierId:undefined},...categories];
 const run=(rows:Record<string,string>[],products=[p])=>planSupplierCatalogImport({rows,products,categories:duplicateCategories,branches,supplierId:'s',newId:()=> 'new-category'});
 const unchanged=run(parseSupplierCatalogCSV(generateProductCSV([p],duplicateCategories,branches)));
 assert.equal(unchanged.unchanged,1);assert.deepEqual(unchanged.updates,[]);
 const changed=run([{SystemID:p.id,Category:'Frozen'}]);
 assert.equal(changed.categories[0].name,'Frozen');assert.equal(changed.updates[0].changes.categoryId,'new-category');
 const assigned=run([{SystemID:p.id,CategoryID:'global'}],[{...p,categoryId:''}]);
 assert.equal(assigned.updates[0].changes.categoryId,'global');
 const named={...categories[0],name:'Uncategorized'};
 const product={...p,categoryId:named.id};
 assert.equal(planSupplierCatalogImport({rows:parseSupplierCatalogCSV(generateProductCSV([product],[named],branches)),products:[product],categories:[named],branches,supplierId:'s',newId:()=>''}).unchanged,1);
});

test('blank supplier marker inherits the chosen supplier; foreign markers still fail',()=>{
 assert.throws(()=>plan('SystemID,ItemCode,Name,SupplierID\n,new,New item,other'),/SupplierID does not match/);
 const inherited=plan('SystemID,ItemCode,Name,SupplierID\n,new,New item,');
 assert.equal(inherited.creates[0].supplierId,'s');
 assert.equal(plan('SystemID,ItemCode,Name\n,new,New item').creates.length,1);
});
test('selected current branches do not become all present and future branches',()=>{
 const selected={...p,allowedBranchIds:['b1','b2']};
 assert.equal(plan(generateProductCSV([selected],categories,branches),[selected]).unchanged,1);
});
test('formula-safe export roundtrips original text without executing it',()=>{
 const formula={...p,name:'=something',itemCode:'+007',caseUnitName:'@Carton'};
 const csv=generateProductCSV([formula],categories,branches);assert.ok(csv.includes("'=something"));
 assert.equal(plan(csv,[formula]).unchanged,1);
});
test('older bulk exports remain readable including category IDs and positions',()=>{
 const result=plan('SystemID,CategoryID,PriceBox,AllowedBranchIds,Position\np,c,15,b2,3');
 assert.deepEqual(result.updates[0].changes,{casePrice:15,cataloguePosition:3,allowedBranchIds:['b2']});
});
test('new field changes are validated and not silently ignored',()=>{
 const result=plan('SystemID,VATRate,UnitType,CaseUnitName,PackUnitName,MinParLevel,TargetParLevel,CataloguePosition\np,0.05,DUAL,Box,Each,2,10,1');
 assert.equal(result.updates[0].changes.vatRate,.05);assert.equal(result.updates[0].changes.targetParLevel,10);
 for(const [field,value] of [['VATRate','20'],['UnitType','GUESS'],['CataloguePosition','1.5'],['TargetParLevel','-1'],['WrongPriceColumn','4']])assert.throws(()=>plan(`SystemID,${field}\np,${value}`));
 assert.equal(plan('systemid,pricebox\np,12').updates[0].changes.casePrice,12);
});
test('batch values accept zero, inactive and decimal prices; reject unsupported or invalid values',()=>{
 assert.equal(bulkProductValue('casePrice','0'),0);assert.equal(bulkProductValue('active','false'),false);assert.equal(bulkProductValue('packPrice','12.50'),12.5);
 for(const [field,value] of [['name','Duplicate name'],['casePrice',''],['casePrice','-1'],['vatRate','20'],['active','maybe']])assert.throws(()=>bulkProductValue(field,value));
});
test('owner bulk prices are immediate with history; non-owner prices remain pending',()=>{
 for(const role of ['CREATOR','GM']){
  const user={id:'u',active:true,role};const body={supplierId:'s',requestId:'r',rows:[{id:p.id,expected:productFingerprint(p),values:{casePrice:12,packPrice:0}}]};
  const changes=planProductChanges(user,{},body,[p],categories,branches.map(b=>b.id));
  const history=applyOwnerProductPrices(user,body,[p],changes);
  if(role==='CREATOR'){assert.equal(changes.updates[0].changes.casePrice,12);assert.equal(changes.updates[0].changes.packPrice,0);assert.equal(history[0].previousCasePrice,0);assert.equal(history[0].newCasePrice,12);assert.equal(changes.notices.length,0);}
  else{assert.equal(history.length,0);assert.equal(changes.updates.length,0);assert.equal(changes.notices[0].status,'PENDING');}
 }
 assert.equal(p.casePrice,0);
});
