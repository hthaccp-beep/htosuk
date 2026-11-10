import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueReviewDetails,assertSupplierReviewUnchanged} from '../shared/catalogue-review.ts';
import {productFingerprint} from '../shared/product-workbench.ts';
import type {Product} from '../types.ts';

const rice={id:'p1',supplierId:'s',itemCode:'A10',name:'Rice',packSize:'10kg',casePrice:20,packPrice:undefined,active:true,categoryId:'c',allowedBranchIds:[],displayOrder:1} as Product;

test('review resolves saved and planned category names without exposing internal IDs',()=>{
 const category={id:'planned-id',name:'Frozen food',supplierId:'s',active:true,displayOrder:1};
 const plan={categories:[category],creates:[],updates:[{id:rice.id,changes:{categoryId:category.id}}],unchanged:0,untouched:0};
 const categories=[{...category,id:'c',name:'Dry goods'}];
 const [detail]=catalogueReviewDetails(plan,[rice],categories);
 assert.deepEqual(detail.categoryLabels,{before:'Dry goods',after:'Frozen food'});
 assert.equal(detail.after.categoryId,'planned-id');
 const [missing]=catalogueReviewDetails(plan,[{...rice,categoryId:'deleted-id'}],categories);
 assert.deepEqual(missing.categoryLabels,{before:'Category unavailable',after:'Frozen food'});
});
test('single review shows exact before/after names, packs, zero prices and natural code order',()=>{
 const created={...rice,id:'p2',itemCode:'A2',name:'Noodles',casePrice:4};
 const before=structuredClone(rice);
 const rows=catalogueReviewDetails({categories:[],creates:[created],updates:[{id:'p1',changes:{name:'Rice new',packSize:'20kg',casePrice:0}}],unchanged:0,untouched:0},[rice]);
 assert.deepEqual(rows.map(r=>r.itemCode),['A10','A2']);
 assert.equal(rows[0].before.name,'Rice');assert.equal(rows[0].after.name,'Rice new');
 assert.equal(rows[0].before.packSize,'10kg');assert.equal(rows[0].after.packSize,'20kg');
 assert.equal(rows[0].after.casePrice,0);assert.equal(rows[0].after.packPrice,undefined);
 assert.ok(rows[0].flags.some(f=>f.includes('£0.00')));assert.deepEqual(rice,before);
});
test('supplier review rejects changed price, pack, name, missing or extra results before committing',()=>{
 const item={id:rice.id,fingerprint:productFingerprint(rice)};
 assert.doesNotThrow(()=>assertSupplierReviewUnchanged([item],[rice]));
 for(const change of [{casePrice:21},{packSize:'5kg'},{name:'Other rice'}]){
  assert.throws(()=>assertSupplierReviewUnchanged([{...item,fingerprint:productFingerprint({...rice,...change})}],[rice]),/Nothing was saved/);
 }
 for(const items of [[],[item,item],[{id:'other',fingerprint:item.fingerprint}],[{id:rice.id}]])assert.throws(()=>assertSupplierReviewUnchanged(items,[rice]),/changed since/);
});
