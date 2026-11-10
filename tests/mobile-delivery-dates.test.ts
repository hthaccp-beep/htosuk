import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileDeliveryDates} from '../app/htos/mobileDeliveryDates.ts';
import {validateDeliveryDate} from '../utils/deliveryScheduler.ts';
import type {Supplier} from '../types.ts';

const supplier:Supplier={id:'sample',name:'Sample',email:'sample@example.invalid',active:true,
 deliveryRules:{default:[0,1,2,3,4,5,6]},deliverySchedules:{default:'Order by 10pm for Next Day Delivery.'}};
test('phone offers tomorrow through day seven, not today or day eight',()=>{
 const now=new Date('2026-11-02T12:00:00Z');
 const dates=mobileDeliveryDates(supplier,'branch',now);
 assert.deepEqual(dates.map(d=>d.value),['2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09']);
 assert.match(dates[0].label,/Tue.*3.*Nov/);
 assert.equal(validateDeliveryDate('2026-11-10',supplier,'branch',now).valid,false);
});
test('branch delivery days and a passed cutoff are respected',()=>{
 const restricted={...supplier,deliveryRules:{default:[0,1,2,3,4,5,6],branch:[2,4]},deliverySchedules:{default:'Order by 10pm',branch:'Order by 5pm for Next Day Delivery.'}};
 assert.deepEqual(mobileDeliveryDates(restricted,'branch',new Date('2026-11-02T16:00:00Z')).map(d=>d.value),['2026-11-03','2026-11-05']);
 assert.deepEqual(mobileDeliveryDates(restricted,'branch',new Date('2026-11-02T18:00:00Z')).map(d=>d.value),['2026-11-05']);
 // A date chosen before the cutoff must still fail submission after it passes.
 assert.equal(validateDeliveryDate('2026-11-03',restricted,'branch',new Date('2026-11-02T18:00:00Z')).valid,false);
});
test('bank holidays and London date boundaries are respected',()=>{
 const christmas=mobileDeliveryDates(supplier,'branch',new Date('2026-12-24T12:00:00Z')).map(d=>d.value);
 assert(!christmas.includes('2026-12-25'));assert(!christmas.includes('2026-12-28'));
 const summer=mobileDeliveryDates(supplier,'branch',new Date('2026-07-01T23:30:00Z'));
 assert.equal(summer[0].value,'2026-07-03');assert.equal(summer.at(-1)?.value,'2026-07-09');
});
