import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupplierCatalogCSV, planSupplierCatalogImport, commitSupplierCatalogImport } from '../utils/supplierCatalogImport.ts';
import type { Product, Category, Branch } from '../types.ts';

const product: Product = {
  id: 'permanent-id', supplierId: 'supplier-a', itemCode: '00123', name: 'Rice',
  categoryId: 'cat', casePrice: 14.7, packPrice: 1.47, vatRate: 0.2,
  unitType: 'DUAL', caseUnitName: 'Case', packUnitName: 'Pack',
  allowedBranchIds: ['branch-a'], active: true, displayOrder: 50,
};
const second: Product = { ...product, id: 'untouched-id', itemCode: 'OTHER', name: 'Other rice' };
const category: Category = { id: 'cat', supplierId: 'supplier-a', name: 'Food', active: true, displayOrder: 1 };
const branches: Branch[] = [
  { id: 'branch-a', code: 'A', name: 'Branch A', active: true },
  { id: 'branch-b', code: 'B', name: 'Branch B', active: true },
] as Branch[];
const plan = (rows: Record<string, string>[], overrides = {}) => {
  let seq = 0;
  return planSupplierCatalogImport({rows, supplierId:'supplier-a', products:[product, second], categories:[category], branches, newId:()=>`generated-${++seq}`, ...overrides});
};

test('supplier-code match preserves permanent ID and absent catalogue products', () => {
  const result = plan([{ ItemCode:'00123', PriceBox:'16' }]);
  assert.deepEqual(result.updates, [{id:product.id, changes:{casePrice:16}}]);
  assert.equal(result.untouched, 1);
  assert.equal(result.creates.length, 0);
  assert.equal(product.casePrice, 14.7);
});

test('missing or empty fields do not erase existing prices, availability, names or metadata', () => {
  const result = plan([{SystemID:product.id, Name:'', ItemCode:'', PriceBox:'16', PriceUnit:'', Active:'', A:'', B:''}]);
  const merged = {...product, ...result.updates[0].changes};
  assert.equal(merged.packPrice, 1.47);
  assert.equal(merged.vatRate, 0.2);
  assert.equal(merged.caseUnitName, 'Case');
  assert.equal(merged.name, 'Rice');
  assert.equal(merged.active, true);
  assert.deepEqual(merged.allowedBranchIds, ['branch-a']);
});

test('explicit zero price is different from an absent price', () => {
  assert.deepEqual(plan([{ItemCode:'00123', PriceBox:'0'}]).updates[0].changes, {casePrice:0});
});

test('foreign and unknown SystemIDs cannot overwrite or move a product', () => {
  const foreign = {...product, id:'foreign', supplierId:'supplier-b'};
  for (const id of ['foreign', 'not-found']) {
    assert.throws(()=>plan([{SystemID:id, Name:'Replacement', PriceBox:'9'}], {products:[product, foreign]}), /does not belong/);
  }
});

test('the same supplier code in another supplier does not match that product', () => {
  const result=plan([{ItemCode:'00123', Name:'New rice'}], {products:[{...product, supplierId:'supplier-b'}]});
  assert.equal(result.updates.length, 0);
  assert.equal(result.creates[0].supplierId, 'supplier-a');
  assert.notEqual(result.creates[0].id, product.id);
});

test('duplicate input codes or repeated SystemIDs reject the entire plan', () => {
  assert.throws(()=>plan([{ItemCode:'NEW',Name:'One'},{ItemCode:'new',Name:'Two'}]), /duplicate ItemCode/);
  assert.throws(()=>plan([{SystemID:product.id,PriceBox:'15'},{SystemID:product.id,PriceBox:'17'}]), /more than once/);
});

test('ambiguous catalogue codes require a reviewed identity', () => {
  assert.throws(()=>plan([{ItemCode:'00123', PriceBox:'17'}],{products:[product,{...product,id:'duplicate'}]}), /duplicate catalogue code/);
});

test('code change cannot take another product code', () => {
  assert.throws(()=>plan([{SystemID:product.id,ItemCode:'OTHER'}]), /already belongs/);
});

test('new products require a name and code and receive their own ID', () => {
  assert.throws(()=>plan([{Name:'Unnamed identity'}]), /SystemID or ItemCode/);
  assert.throws(()=>plan([{ItemCode:'NEW'}]), /new products require/);
  const result=plan([{ItemCode:'0009',Name:'New rice',PriceBox:'18',Category:'New category'}]);
  assert.equal(result.creates[0].itemCode, '0009');
  assert.equal(result.creates[0].categoryId, result.categories[0].id);
  assert.equal(result.creates[0].packPrice, undefined);
  assert.equal(result.creates[0].active, true);
});

test('unchanged re-import creates no additional products or writes', () => {
  const result=plan([{ItemCode:'00123',Name:'Rice',PriceBox:'14.70'}]);
  assert.equal(result.unchanged, 1);
  assert.equal(result.creates.length+result.updates.length+result.categories.length, 0);
});

test('invalid numbers reject the file instead of silently setting zero', () => {
  for (const price of ['-2','NaN','Infinity','1,23','12x','1.2.3']) {
    assert.throws(()=>plan([{ItemCode:'00123',PriceBox:price}]), /non-negative number/);
  }
  assert.equal(plan([{ItemCode:'00123',PriceBox:'£1,234.50'}]).updates[0].changes.casePrice, 1234.5);
});

test('partial branch instructions and all-No active product are rejected', () => {
  assert.throws(()=>plan([{ItemCode:'00123', A:'Yes'}]), /every active branch/);
  assert.throws(()=>plan([{ItemCode:'00123', A:'No',B:'No'}]), /select (?:a|at least one) branch/);
  assert.deepEqual(plan([{ItemCode:'00123',A:'No',B:'Yes'}]).updates[0].changes.allowedBranchIds, ['branch-b']);
});

test('oversized imports are rejected before any commit', () => {
  const rows=Array.from({length:451},(_,i)=>({ItemCode:`new-${i}`,Name:`Product ${i}`}));
  assert.throws(()=>plan(rows), /exceeds 450/);
});

test('a bad final row cannot return a partly validated import', () => {
  assert.throws(()=>plan([{ItemCode:'NEW',Name:'New item',Category:'New category'},{SystemID:product.id,PriceBox:'bad'}]), /Row 3/);
  assert.equal(product.casePrice,14.7);
});

test('CSV reads quoted multiline names, commas, escaped quotes, BOM and leading-zero codes', () => {
  const rows=parseSupplierCatalogCSV('\uFEFFItemCode,Name,PriceBox\r\n00123,"Rice, \\"Premium\\"\nLarge",14.70'.replace(/\\"/g,'""'));
  assert.equal(rows.length,1);
  assert.equal(rows[0].ItemCode,'00123');
  assert.equal(rows[0].Name,'Rice, "Premium"\nLarge');
  assert.equal(rows[0].PriceBox,'14.70');
});

test('CSV rejects wrong row width, duplicate headings and malformed quotes', () => {
  for(const csv of ['ItemCode,Name\nABC,Name,Extra','ItemCode,ItemCode\nABC,DEF','ItemCode,Name\nABC,"Unclosed']) {
    assert.throws(()=>parseSupplierCatalogCSV(csv));
  }
});

test('all writes including categories are committed exactly once without a delete path', async () => {
  const result=plan([{ItemCode:'00123',PriceBox:'16'},{ItemCode:'NEW',Name:'New item',Category:'New category'}]);
  const calls:string[]=[];
  await commitSupplierCatalogImport(result,{
    createCategory:()=>{calls.push('category')},createProduct:()=>{calls.push('create')},
    updateProduct:id=>{calls.push(`update:${id}`)},commit:async()=>{calls.push('commit')},
  });
  assert.deepEqual(calls,['category','create',`update:${product.id}`,'commit']);
});

test('commit failure propagates and retry uses the same IDs', async () => {
  const result=plan([{ItemCode:'NEW',Name:'New product'}]);
  const ids:string[]=[];
  const writer={createCategory:()=>{},createProduct:(p:Product)=>{ids.push(p.id)},updateProduct:()=>{},commit:async()=>{throw new Error('Rejected batch')}};
  await assert.rejects(commitSupplierCatalogImport(result,writer), /Rejected batch/);
  await commitSupplierCatalogImport(result,{...writer,commit:async()=>{}});
  assert.equal(ids[0],ids[1]);
});
