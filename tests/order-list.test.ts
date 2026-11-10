import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isOrderInList} from '../shared/order-list.ts';
import type {OrderRecord} from '../types.ts';
test('removed orders only appear in Archived and return as cancelled after restoration',()=>{
 const order={status:'CANCELLED',archived:true} as OrderRecord;
 for(const status of ['ALL','CANCELLED','PLACED','OPEN','PROCESSED'])assert.equal(isOrderInList(order,status),false);
 assert.equal(isOrderInList(order,'ARCHIVED'),true);
 assert.equal(isOrderInList({...order,archived:false},'ALL'),true);
 assert.equal(isOrderInList({...order,archived:false},'CANCELLED'),true);
 assert.equal(isOrderInList({...order,archived:false},'ARCHIVED'),false);
});
test('existing orders remain visible without an archive flag',()=>{
 assert.equal(isOrderInList({status:'DRAFT'} as OrderRecord,'ALL'),true);
 assert.equal(isOrderInList({status:'PLACED'} as OrderRecord,'OPEN'),true);
 assert.equal(isOrderInList({status:'PLACED',receivedStatus:'PROCESSED'} as OrderRecord,'OPEN'),false);
});
