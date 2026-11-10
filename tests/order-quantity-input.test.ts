import assert from 'node:assert/strict';
import test from 'node:test';
import {isOrderQuantityText,orderQuantity} from '../app/htos/orderingHelpers';

test('quantity entry rejects exponents, signs, decimals and mixed pasted text',()=>{
  for(const value of ['e','E','1e2','1E1','1e-1','+2','-2','1.5','2,5','12 boxes',' 2','2 ','2\n','2\t','NaN','Infinity','１２']) {
    assert.equal(isOrderQuantityText(value),false,JSON.stringify(value));
  }
});

test('quantity entry supports clearing, replacement and the 20 limit',()=>{
  for(const [text,expected] of [['',0],['0',0],['2',2],['12',12],['20',20],['21',20],['30',20],['999999',20],['02',2]] as const) {
    assert.equal(isOrderQuantityText(text),true);
    assert.equal(orderQuantity(text),expected);
  }
});
