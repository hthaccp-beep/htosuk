import test from 'node:test';
import assert from 'node:assert/strict';
import type {OrderRecord} from '../types';
import {historySuppliers,matchesHistoryFilters} from '../app/htos/historyFilters';

const order:OrderRecord={id:'ABCD1234-rest',branchId:'b1',supplierId:'s1',branchNameSnapshot:'Hare & Tortoise – Ealing',supplierNameSnapshot:'Atariya',status:'PLACED',orderedByUserId:'sample',orderedByNameSnapshot:'Sample user',createdAt:'2026-11-05T10:00:00Z',deliveryDate:'2026-11-06',emailTo:'',items:[],manualItems:[]};
const defaults={branchId:'',supplierId:'',status:'ALL',search:''};
test('supplier, branch, status and search combine without changing records',()=>{
 const before=JSON.stringify(order);
 assert(matchesHistoryFilters(order,{...defaults,branchId:'b1',supplierId:'s1',status:'OPEN',search:'  EALING  '}));
 for(const mismatch of [{branchId:'b2'},{supplierId:'s2'},{status:'DRAFT'},{search:'rice'}]) assert(!matchesHistoryFilters(order,{...defaults,...mismatch}));
 assert.equal(JSON.stringify(order),before);
});
test('references match with or without #, ignoring case and outer spaces',()=>{
 for(const search of ['ABCD1234',' #abcd1234 ','atariya']) assert(matchesHistoryFilters(order,{...defaults,search}));
 assert(!matchesHistoryFilters(order,{...defaults,search:'#atariya'}));
});
test('archived orders remain excluded unless explicitly requested',()=>{
 const archived={...order,archived:true};
 assert(!matchesHistoryFilters(archived,defaults));
 assert(!matchesHistoryFilters(archived,{...defaults,status:'PLACED'}));
 assert(matchesHistoryFilters(archived,{...defaults,status:'ARCHIVED',supplierId:'s1'}));
});
test('placed includes processed; awaiting receipt excludes processed',()=>{
 const processed={...order,receivedStatus:'PROCESSED'} as OrderRecord;
 assert(matchesHistoryFilters(processed,{...defaults,status:'PLACED'}));
 assert(matchesHistoryFilters(processed,{...defaults,status:'PROCESSED'}));
 assert(!matchesHistoryFilters(processed,{...defaults,status:'OPEN'}));
});
test('supplier choices use only loaded history and retain historical suppliers',()=>{
 const orders=[order,{...order,id:'two'},{...order,id:'three',supplierId:'retired',supplierNameSnapshot:'Former supplier',archived:true}];
 const before=JSON.stringify(orders);
 assert.deepEqual(historySuppliers(orders),[{id:'s1',name:'Atariya'},{id:'retired',name:'Former supplier'}]);
 assert.deepEqual(historySuppliers([]),[]);
 assert.equal(JSON.stringify(orders),before);
});
