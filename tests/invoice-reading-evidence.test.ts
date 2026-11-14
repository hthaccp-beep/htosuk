import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseEvidenceReading} from '../server/invoice-reading-evidence.ts';
import {readInvoiceDocuments} from '../server/invoice-reader.ts';
import {matchInvoiceExtraction} from '../shared/invoice-extraction.ts';
import {extractionCase} from './fixtures/invoice-extraction.ts';
import {evidenceFixture} from './fixtures/invoice-reading-evidence.ts';

test('customer number is preserved without inventing a branch from supplier or other sheet',()=>{
 const v=evidenceFixture();v.identityBlocks[1].location=null;v.identityBlocks[1].locationKind='NONE';
 v.identityBlocks.push({page:1,role:'OTHER',name:'Other sheet',location:'Unrelated Town',locationKind:'UNLABELLED',roleEvidence:'Background sheet outside the invoice'});
 v.invoice.customerName='Other sheet';v.invoice.branch='Supplier Road';
 const {draft}=parseEvidenceReading(v);assert.equal(draft.customerName,'Sample Restaurant 7');assert.equal(draft.branch,null);assert.equal(draft.supplier,v.invoice.supplier);
});
test('customer identity can vary; explicit recipient location is retained without supplier-specific mapping',()=>{
 for(const [name,branch] of [['Sample Buyer 2','North depot'],['Different Customer','South kitchen']]){
  const v=evidenceFixture();v.identityBlocks[1].name=name;v.identityBlocks[1].location=branch;
  const {draft}=parseEvidenceReading(v);assert.equal(draft.customerName,name);assert.equal(draft.branch,branch);
 }
});
test('unlabelled locations, unsupported roles and conflicting delivery locations stay unknown',()=>{
 const v=evidenceFixture();v.identityBlocks[1].locationKind='UNLABELLED';assert.equal(parseEvidenceReading(v).draft.branch,null);
 v.identityBlocks[1].locationKind='DELIVERY';v.identityBlocks[1].roleEvidence=null;assert.equal(parseEvidenceReading(v).draft.customerName,null);assert.equal(parseEvidenceReading(v).draft.branch,null);
 v.identityBlocks[1].roleEvidence='Deliver to';v.identityBlocks.push({...v.identityBlocks[1],location:'Second destination'});assert.equal(parseEvidenceReading(v).draft.branch,null);
});
test('delivery location takes precedence over billing, but a shared supplier location is flagged',()=>{
 const v=evidenceFixture();v.identityBlocks.push({...v.identityBlocks[1],location:'Head office',locationKind:'BILLING'});
 assert.equal(parseEvidenceReading(v).draft.branch,v.invoice.branch);
 v.identityBlocks[0].location=v.invoice.branch;assert.equal(parseEvidenceReading(v).draft.branch,null);
});
test('shifted or uncertain row evidence blocks matching even if arithmetic and totals agree',()=>{
 const v=evidenceFixture();v.rowWitnesses[0].description='Neighbouring blank catalogue product';v.rowWitnesses[1].alignment='UNCERTAIN';
 const {draft}=parseEvidenceReading(v);assert.equal(draft.rows[0].description,v.invoice.rows[0].description);assert.ok(draft.rows[0].uncertain.length);assert.ok(draft.rows[1].uncertain.length);
 const c=extractionCase();const matched=matchInvoiceExtraction(c,c.documents[0].id,draft);assert.equal(matched.rows[0].mayUseFigures,false);assert.equal(matched.rows[1].mayUseFigures,false);
});
test('missing, duplicated or foreign row witnesses reject the whole response',()=>{
 const missing=evidenceFixture();missing.rowWitnesses.pop();assert.throws(()=>parseEvidenceReading(missing),/evidence/);
 const duplicate=evidenceFixture();duplicate.rowWitnesses[1]={...duplicate.rowWitnesses[0]};assert.throws(()=>parseEvidenceReading(duplicate),/evidence/);
 const foreign=evidenceFixture();foreign.rowWitnesses[1].row=999;assert.throws(()=>parseEvidenceReading(foreign),/evidence/);
});
test('repeated products and zero rows remain separate, while neighbouring blank labels never become billed rows',()=>{
 const v=evidenceFixture();v.invoice.rows[1]={...v.invoice.rows[0],row:2,quantity:0,netAmount:0};v.rowWitnesses[1]={...v.rowWitnesses[0],row:2};
 v.rowWitnesses[0].nextPrintedLabel='Unordered blank catalogue item';
 const {draft}=parseEvidenceReading(v);assert.equal(draft.rows.length,v.invoice.rows.length);assert.equal(draft.rows[1].quantity,0);assert.equal(draft.rows[0].description,draft.rows[1].description);assert.equal(draft.rows.some(r=>r.description==='Unordered blank catalogue item'),false);
});
test('malformed and excessive evidence fails closed',()=>{
 for(const mutate of [(v:any)=>v.identityBlocks[0].role='GUESSED',(v:any)=>v.rowWitnesses[0].page=0,(v:any)=>v.identityBlocks[0].roleEvidence='x'.repeat(1001),(v:any)=>v.identityBlocks=Array(33).fill(v.identityBlocks[0])]){
  const v=evidenceFixture();mutate(v);assert.throws(()=>parseEvidenceReading(v),/evidence/);
 }
});
test('blank catalogue neighbours require review even when AI wrongly calls the layout TABLE and all witnesses CLEAR',()=>{
 const v=evidenceFixture();Object.assign(v.invoice,{layout:'TABLE'});v.rowWitnesses[0].previousPrintedLabel='Blank product above';v.rowWitnesses[0].nextPrintedLabel='Blank product below';
 const {draft}=parseEvidenceReading(v);assert.ok(draft.rows.every(r=>r.uncertain.some(w=>w.includes('catalogue gaps'))));
 assert.equal(draft.rows.length,v.invoice.rows.length);assert.equal(draft.net,v.invoice.net);
 const c=extractionCase();assert.ok(matchInvoiceExtraction(c,c.documents[0].id,draft).rows.every(r=>!r.mayUseFigures));
});
test('image request uses original detail and evidence schema; malformed evidence retains usage without retry',async()=>{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6d1sAAAAASUVORK5CYII=','base64');
 const doc={id:'synthetic-image',name:'dot.png',mime:'image/png',base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
 let calls=0;await assert.rejects(()=>readInvoiceDocuments([doc],{apiKey:'sk-test',fetch:async(_url,init)=>{
  calls++;const body=JSON.parse(init!.body as string);assert.equal(body.input[0].content[1].detail,'original');assert.equal(body.text.format.schema.properties.rowWitnesses.type,'array');assert.equal(body.tools,undefined);assert.equal(body.store,false);
  const v=evidenceFixture();v.rowWitnesses.pop();return new Response(JSON.stringify({status:'completed',usage:{input_tokens:1,output_tokens:1},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(v)}]}]}));
 }}),(e:any)=>e.usage?.inputTokens===1);assert.equal(calls,1);
});
