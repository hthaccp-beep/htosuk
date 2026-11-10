import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderQuantity, validateBasketQuantities, incomingSupplierIds, checklistHtml, checklistLayout, orderedProductGroups } from '../app/htos/orderingHelpers.ts';
import { captureCurrentPrices } from '../app/htos/orderModel.ts';

test('interleaved CPU catalogue positions produce one section per category and compact V3 print layout',()=>{
  const categories=['Front','Sauce','Sushi','Packing'].map((name,i)=>({id:`c${i}`,name,active:true,displayOrder:i+1})) as any;
  const products=Array.from({length:40},(_,i)=>({id:`p${i}`,name:`Sample ${i+1}`,categoryId:`c${i%4}`,cataloguePosition:i+1,displayOrder:9999})) as any;
  const before=JSON.stringify({products,categories});
  const groups=orderedProductGroups([...products].reverse(),categories);
  assert.deepEqual(groups.map(g=>g.name),['Front','Sauce','Sushi','Packing']);
  for(let cat=0;cat<4;cat++)assert.deepEqual(groups[cat].products.map((p:any)=>p.id),Array.from({length:10},(_,i)=>`p${i*4+cat}`));
  assert.equal(new Set(groups.flatMap(g=>g.products.map(p=>p.id))).size,40);
  const layout=checklistLayout(groups.map(g=>g.products.length));
  assert.equal(layout.columns,3);assert.equal(layout.copies,2);assert.equal(layout.unitHeight,94);
  const html=checklistHtml(products,categories,'CPU sample');
  const firstCopy=html.split('<article class="checklist-unit">')[1].split('</article>')[0];
  assert.deepEqual([...firstCopy.matchAll(/<h2>(.*?)<\/h2>/g)].map(m=>m[1]),groups.map(g=>g.name));
  assert.deepEqual([...firstCopy.matchAll(/class="en">(.*?)<\/strong>/g)].map(m=>m[1]),groups.flatMap(g=>g.products.map(p=>p.name)));
  assert.deepEqual([...firstCopy.matchAll(/class="idx">(\d+)<\/span>/g)].map(m=>Number(m[1])),Array.from({length:40},(_,i)=>i+1));
  assert.equal((firstCopy.match(/class="checks"><span><\/span><span><\/span>/g)||[]).length,40);
  assert.equal(JSON.stringify({products,categories}),before);
});

test('category order wins over catalogue positions; filtering preserves within-category order and all supplied items',()=>{
  const categories=[{id:'second',name:'Second',displayOrder:2,active:true},{id:'first',name:'First',displayOrder:1,active:true},{id:'off',name:'Inactive',displayOrder:0,active:false}] as any;
  const products=[{id:'b',name:'B',categoryId:'second',cataloguePosition:1},{id:'a2',name:'A2',categoryId:'first',cataloguePosition:4},{id:'a1',name:'A1',categoryId:'first',cataloguePosition:2},{id:'off',name:'Old category item',categoryId:'off',cataloguePosition:3},{id:'missing',name:'Missing category item',categoryId:'missing',cataloguePosition:5}] as any;
  const full=orderedProductGroups(products,categories);
  assert.deepEqual(full.map(g=>g.name),['First','Second','Other Items','Other Items']);
  assert.deepEqual(full[0].products.map(p=>p.id),['a1','a2']);
  const subset=products.filter((p:any)=>['b','a2'].includes(p.id));
  assert.deepEqual(orderedProductGroups(subset,categories).flatMap(g=>g.products.map(p=>p.id)),['a2','b']);
  assert.equal(full.flatMap(g=>g.products).length,products.length);
  assert.deepEqual(orderedProductGroups([],categories),[]);
});

test('ordering quantities have the 20-per-field whole-number limit, including pasted values',()=>{
  for(const [value,expected] of [['',0],['21',20],['999999',20],['-2',0],['2.9',2],['NaN',0],['Infinity',0],['20',20],['30',20]] as const)assert.equal(orderQuantity(value),expected);
  validateBasketQuantities([{caseQty:20,packQty:20}] as any,[]);
  for(const quantity of [21,-1,NaN,Infinity,1.5])assert.throws(()=>validateBasketQuantities([{caseQty:quantity,packQty:0}] as any,[]),/0 to 20/);
  assert.throws(()=>validateBasketQuantities([],Array.from({length:6},()=>({caseQty:1,packQty:0})) as any),/5 custom/);
  assert.throws(()=>validateBasketQuantities([],[{caseQty:0,packQty:21}] as any),/0 to 20/);
});
test('incoming orders include only internal suppliers in the chosen authorized branch',()=>{
  const branches=[{id:'a',active:true,actsAsSupplier:true},{id:'b',active:true,actsAsSupplier:true},{id:'shop',active:true,actsAsSupplier:false}] as any;
  const suppliers=[{id:'sa',linkedBranchId:'a'},{id:'sb',linkedBranchId:'b'},{id:'external'}] as any;
  const owner={id:'owner',role:'CREATOR',active:true} as any;
  assert.deepEqual([...incomingSupplierIds(owner,suppliers,branches)].sort(),['a','b','sa','sb']);
  assert.deepEqual([...incomingSupplierIds(owner,suppliers,branches,'b')].sort(),['b','sb']);
  const staff={id:'staff',active:true,role:'STAFF',branchIds:['a'],allBranches:false} as any;
  assert.deepEqual([...incomingSupplierIds(staff,suppliers,branches)].sort(),['a','sa']);
  assert.equal(incomingSupplierIds(staff,suppliers,branches,'b').size,0);
  assert.equal(incomingSupplierIds({...staff,active:false},suppliers,branches).size,0);
});
test('checklist includes uncategorised products and Chinese names while escaping source text',()=>{
  const products=[{id:'p',name:'Oil <img src=x onerror=alert(1)>',chineseName:'芝麻油',categoryId:'c'},{id:'q',name:'Other',categoryId:''}] as any;
  const html=checklistHtml(products,[{id:'c',name:'Dry & sauces'}] as any,'Supplier <script>','Branch','2026-10-12');
  assert.match(html,/芝麻油/);assert.match(html,/Other Items/);assert.match(html,/Other/);assert.match(html,/Dry &amp; sauces/);
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;img/);assert.match(html,/A4 portrait/);
});
test('new orders capture Chinese names along with original prices',()=>{
  const product={id:'p',name:'Sesame oil',chineseName:'芝麻油',casePrice:20,packPrice:2} as any;
  const captured=captureCurrentPrices([{productId:'p',caseQty:2,packQty:3}] as any,[product]);
  assert.equal(captured[0].chineseNameSnapshot,'芝麻油');assert.equal(captured[0].casePriceSnapshot,20);assert.equal(captured[0].caseQty,2);
});

test('checklist preserves the original A4 fit and repeated-copy rules',()=>{
  const normal=checklistLayout([40,4,3,17]);
  assert.equal(normal.columns,3);assert.equal(normal.copies,2);
  assert.ok(normal.unitHeight*2+6<=285);
  assert.equal(checklistLayout([210]).columns,4);
  assert.equal(checklistLayout([210]).copies,1);
  assert.equal(checklistLayout([1000]).copies,1);
  assert.equal(checklistLayout([]).copies,0);
  const categories=[{id:'a',name:'ALL',active:true,displayOrder:1},{id:'b',name:'SALAD',active:true,displayOrder:2},{id:'c',name:'LEAF',active:true,displayOrder:3},{id:'d',name:'HT1',active:true,displayOrder:4}] as any;
  const products=[40,4,3,17].flatMap((n,g)=>Array.from({length:n},(_,i)=>({id:`${g}-${i}`,name:`Item ${g}-${i}`,categoryId:categories[g].id,displayOrder:i}))) as any;
  const html=checklistHtml(products,categories,'Four Seasons');
  assert.equal((html.match(/class="checklist-unit"/g)||[]).length,2);
  assert.equal((html.match(/class="idx"/g)||[]).length,128);
  assert.equal((html.match(/class="cut-line"/g)||[]).length,1);
  assert.equal((html.match(/>64<\/span>/g)||[]).length,2);
  assert.doesNotMatch(html,/https?:\/\//);
});
test('catalogue and checklist sort categories and product codes alike, retaining orphaned items',()=>{
  const categories=[{id:'b',name:'Second',active:true,displayOrder:2},{id:'a',name:'First',active:true,displayOrder:1},{id:'off',name:'Inactive',active:false}] as any;
  const products=[{id:'10',name:'Ten',categoryId:'a',itemCode:'10'},{id:'2',name:'Two',categoryId:'a',itemCode:'2'},{id:'priority',name:'Priority',categoryId:'a',displayOrder:0},{id:'b',name:'Second',categoryId:'b'},{id:'orphan',name:'Oil',categoryId:'off'}] as any;
  const groups=orderedProductGroups(products,categories);
  assert.deepEqual(groups.map(g=>g.name),['First','Second','Other Items']);
  assert.deepEqual(groups[0].products.map(p=>p.id),['priority','2','10']);
  assert.equal(groups[2].products[0].id,'orphan');
  assert.equal(products[0].id,'10');
});
