import test from 'node:test';
import assert from 'node:assert/strict';
import {generateProductCSV} from '../utils/csvHelpers.ts';
import {parseSupplierCatalogCSV,planSupplierCatalogImport} from '../utils/supplierCatalogImport.ts';
import {productSequence} from '../shared/product-workbench.ts';
import {prepareCatalogueDefaults} from '../shared/catalogue-defaults.ts';
import {orderedProductGroups,checklistHtml} from '../app/htos/orderingHelpers.ts';
import type {Product,Category,Branch} from '../types.ts';

const categories=[{id:'c',supplierId:'s',name:'Food',active:true,displayOrder:1},{id:'d',supplierId:'s',name:'Drinks',active:true,displayOrder:2}] as Category[];
const branches=[{id:'b1',code:'HT1',name:'Bloomsbury',active:true},{id:'b2',code:'HT2',name:'Ealing',active:true}] as Branch[];
const products=[
 {id:'random-z',supplierId:'s',name:'Rice',itemCode:'001',categoryId:'c',displayOrder:1000,active:true,allowedBranchIds:['b2','b1']},
 {id:'random-a',supplierId:'s',name:'Noodles',itemCode:'002',categoryId:'c',displayOrder:9999,active:false,allowedBranchIds:[],casePrice:0},
 {id:'random-m',supplierId:'s',name:'Water',itemCode:'003',categoryId:'d',displayOrder:9999,active:true,allowedBranchIds:[]},
] as Product[];
const plan=(rows:Record<string,string>[],options={})=>{let id=0;return planSupplierCatalogImport({rows,products,categories,branches,supplierId:'s',allowUncodedCreates:true,appendNew:true,newId:()=>`new-${++id}`,...options});};
const applied=(p:ReturnType<typeof plan>)=>[...products.map(old=>({...old,...p.updates.find(u=>u.id===old.id)?.changes})),...p.creates];

test('human positions are 1..N; arbitrary IDs and tied 9999 ranks roundtrip without mutation',()=>{
 const before=structuredClone(products),csv=generateProductCSV(products,categories,branches),rows=parseSupplierCatalogCSV(csv);
 assert.deepEqual(rows.map(r=>r.Position),['1','2','3']);
 assert.deepEqual(rows.map(r=>r.SystemID),products.map(p=>p.id));
 assert.ok(!Object.hasOwn(rows[0],'DisplayOrder'));assert.ok(!Object.hasOwn(rows[0],'CataloguePosition'));
 assert.equal(rows[0].BranchScope,'SELECTED');assert.equal(rows[0].HT1,'Yes');
 assert.equal(rows[2].PriceBox,'');assert.equal(rows[1].PriceBox,'0');
 const p=plan(rows);assert.equal(p.unchanged,3);assert.deepEqual(p.updates,[]);assert.deepEqual(p.creates,[]);assert.deepEqual(products,before);
});

test('partial file positions rearrange only by explicit position, retaining omitted products',()=>{
 const p=plan([{CSVVersion:'2',SystemID:'random-m',Position:'1'}]);
 const sorted=productSequence(applied(p),categories);
 assert.deepEqual(sorted.map(p=>p.id),['random-m','random-z','random-a']);
 assert.deepEqual(sorted.map(p=>p.displayOrder),[1,2,3]);
 assert.deepEqual(p.orderPreview?.map(p=>p.inFile),[true,false,false]);
 assert.equal(applied(p).find(p=>p.id==='random-a')?.active,false);
});

test('moving spreadsheet rows does nothing unless Use CSV row order is chosen',()=>{
 const rows=parseSupplierCatalogCSV(generateProductCSV(products,categories,branches)).reverse();
 assert.equal(plan(rows).updates.length,0);
 const p=plan(rows,{useRowOrder:true});
 assert.deepEqual(productSequence(applied(p),categories).map(p=>p.id),[...products].reverse().map(p=>p.id));
});

test('CSV row order ignores legacy ranks and retains omitted products in their existing order',()=>{
 const p=plan([{SystemID:'random-m',DisplayOrder:'9999',CataloguePosition:'40'}],{useRowOrder:true});
 assert.deepEqual(productSequence(applied(p),categories).map(p=>p.id),['random-m','random-z','random-a']);
 assert.equal(applied(p).find(p=>p.id==='random-m')?.cataloguePosition,1);
});

test('duplicate and out-of-range positions are reported together without changing input',()=>{
 const before=structuredClone(products);
 assert.throws(()=>plan([{CSVVersion:'2',SystemID:'random-z',Position:'2'},{CSVVersion:'2',SystemID:'random-a',Position:'2'},{CSVVersion:'2',SystemID:'random-m',Position:'8'}]),(e:any)=>e.issues.length===2);
 assert.deepEqual(products,before);
});

test('new blank position appends and an unchanged full export after saving is a no-op',()=>{
 const p=plan([{CSVVersion:'2',Name:'Tea',Category:'Drinks',BranchScope:'ALL',Position:''}]);
 const saved=applied(p),sorted=productSequence(saved,categories);
 assert.deepEqual(sorted.map(p=>p.name),['Rice','Noodles','Water','Tea']);
 assert.equal(sorted[3].casePrice,undefined);assert.equal(sorted[3].packPrice,undefined);
 assert.equal(sorted[3].cataloguePosition,4);
 const again=plan(parseSupplierCatalogCSV(generateProductCSV(saved,categories,branches)),{products:saved});
 assert.equal(again.unchanged,4);assert.deepEqual(again.updates,[]);assert.deepEqual(again.creates,[]);
});

test('category edits preserve saved catalogue positions while order/checklist keep categories together',()=>{
 const rows=parseSupplierCatalogCSV(generateProductCSV(products,categories,branches));rows[0].Category='Drinks';
 const p=plan(rows),saved=applied(p);
 assert.equal(saved[0].categoryId,'d');
 assert.deepEqual(productSequence(saved,categories).map(p=>p.id),products.map(p=>p.id));
 assert.deepEqual(orderedProductGroups(saved,categories).flatMap(g=>g.products.map(p=>p.id)),['random-a','random-z','random-m']);
 const html=checklistHtml(saved,categories,'Example');
 assert.ok(html.indexOf('Noodles')<html.indexOf('Rice'));assert.ok(html.indexOf('Rice')<html.indexOf('Water'));
});

test('missing new category and branch choices are listed; defaults never override existing/supplied values',()=>{
 const rows:Record<string,string>[]=[{SystemID:'random-z',Name:'Changed'},{Name:'New tea'},{Name:'New fish',Category:'Food',BranchScope:'SELECTED',HT1:'No',HT2:'Yes'}];
 const required=prepareCatalogueDefaults(rows,'s',products,categories,branches);
 assert.deepEqual(required.needed,[{row:3,name:'New tea',category:true,branches:true}]);
 const resolved=prepareCatalogueDefaults(rows,'s',products,categories,branches,{categoryId:'d',branchScope:'SELECTED',branchIds:['b1']});
 assert.deepEqual(resolved.needed,[]);assert.deepEqual(resolved.rows[0],rows[0]);assert.deepEqual(resolved.rows[2],rows[2]);
 assert.equal(resolved.rows[1].CategoryID,'d');assert.equal(resolved.rows[1].HT1,'Yes');assert.equal(resolved.rows[1].HT2,'No');
 const p=plan(resolved.rows);assert.equal(p.creates[0].categoryId,'d');assert.deepEqual(p.creates[0].allowedBranchIds,['b1']);
 assert.deepEqual(p.updates.find(u=>u.id==='random-z')?.changes.allowedBranchIds,undefined);
});

test('invalid category/branch defaults never broaden access; names never establish product identity',()=>{
 for(const defaults of [{categoryId:'foreign'},{branchScope:'SELECTED' as const,branchIds:[]},{branchScope:'SELECTED' as const,branchIds:['foreign']}])assert.throws(()=>prepareCatalogueDefaults([{Name:'New'}],'s',products,categories,branches,defaults));
 assert.equal(prepareCatalogueDefaults([{Name:'Rice'}],'s',products,categories,branches).needed.length,1);
 assert.equal(prepareCatalogueDefaults([{ItemCode:'001',Name:'New name'}],'s',products,categories,branches).needed.length,0);
});

test('missing saved order and availability fields export and reimport unchanged',()=>{
 const legacy={...products[0],displayOrder:undefined,cataloguePosition:undefined,allowedBranchIds:undefined} as unknown as Product;
 const p=plan(parseSupplierCatalogCSV(generateProductCSV([legacy],categories,branches)),{products:[legacy]});
 assert.deepEqual(p.updates,[]);assert.equal(p.unchanged,1);
});


test('SELECTED with no branches cannot silently become all branches even for inactive rows',()=>{
 const rows:Record<string,string>[]=[{CSVVersion:'2',SystemID:'random-a',BranchScope:'SELECTED',Active:'FALSE',HT1:'No',HT2:'No'},{CSVVersion:'2',SystemID:'random-a',BranchScope:'SELECTED',AllowedBranchIds:'*'}];
 for(const row of rows)assert.throws(()=>plan([row]),/select at least one branch/);
});
