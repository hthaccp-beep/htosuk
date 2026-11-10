import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emailState,sendAndRecordOrderEmail} from '../app/htos/communicationState.ts';
import type {OrderRecord} from '../types.ts';
const order={status:'PLACED',emailStatus:'SKIPPED',emailRetryCount:2} as OrderRecord;
test('saved and draft orders are not falsely reported as emailed',()=>{
  assert.equal(emailState(order).label,'Email not sent');
  assert.equal(emailState({...order,status:'DRAFT',emailStatus:'SENT'}).label,'Draft');
  assert.equal(emailState({...order,emailStatus:'SENT'}).label,'Email sent');
});
test('confirmed acceptance clears prior errors and saves its time once',async()=>{
  const patches:Partial<OrderRecord>[]=[];let sends=0;
  await sendAndRecordOrderEmail(order,async()=>{sends++;return new Response('{}');},async p=>patches.push(p));
  assert.equal(sends,1);assert.equal(patches.length,1);assert.equal(patches[0].emailStatus,'SENT');assert.equal(patches[0].emailError,'');assert.ok(patches[0].emailSentAt);
});
for(const [status,expected] of [[502,'UNCERTAIN'],[503,'FAILED'],[403,'FAILED']] as const)test(`HTTP ${status} records ${expected} and never success`,async()=>{
  const patches:Partial<OrderRecord>[]=[];
  await assert.rejects(()=>sendAndRecordOrderEmail(order,async()=>new Response('{}',{status}),async p=>patches.push(p)));
  assert.equal(patches.length,1);assert.equal(patches[0].emailStatus,expected);assert.equal(patches[0].emailRetryCount,3);
});
test('connection loss is uncertain and does not automatically retry',async()=>{
  let sends=0;const patches:Partial<OrderRecord>[]=[];
  await assert.rejects(()=>sendAndRecordOrderEmail(order,async()=>{sends++;throw new TypeError('Network lost');},async p=>patches.push(p)));
  assert.equal(sends,1);assert.equal(patches[0].emailStatus,'UNCERTAIN');
});
test('accepted email with failed status save never becomes a failed email or resends',async()=>{
  let sends=0,saves=0;
  await assert.rejects(()=>sendAndRecordOrderEmail(order,async()=>{sends++;return new Response('{}');},async()=>{saves++;throw new Error('Offline');}),/mail server accepted/);
  assert.equal(sends,1);assert.equal(saves,1);
});
