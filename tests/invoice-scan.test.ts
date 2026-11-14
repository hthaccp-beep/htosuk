import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareInvoiceScan,defaultScanOptions,wholePageCorners,validateScanCorners,reduceInvoiceShadows,invoiceScanFlags,canSaveInvoiceScan} from '../shared/invoice-scan.ts';
import {preparationManifest,uploadInvoicePreparation} from '../shared/invoice-preparation.ts';
import type {InvoiceRaster} from '../shared/invoice-photo.ts';
const page=(width=800,height=1100,value=255):InvoiceRaster=>{const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;}return {width,height,data};};
const rect=(r:InvoiceRaster,x:number,y:number,w:number,h:number,v:number)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*r.width+xx)*4;r.data[i]=r.data[i+1]=r.data[i+2]=v;}};

test('manual perspective crop, rotation and shadows leave the original byte-for-byte unchanged',()=>{
 const r=page();for(let y=100;y<1000;y+=50)rect(r,100,y,600,5,30);const before=r.data.slice();
 const result=prepareInvoiceScan(r,{...defaultScanOptions,crop:'manual',corners:[{x:.05,y:.05},{x:.94,y:.08},{x:.92,y:.96},{x:.08,y:.94}],angle:-2,shadowReduction:true});
 assert.deepEqual(r.data,before);assert.notEqual(result.image.data,r.data);assert.ok(result.image.width<800);assert.equal(result.bands[0].top,0);assert.equal(result.bands.at(-1)?.bottom,result.image.height);
 for(let i=1;i<result.bands.length;i++)assert.equal(result.bands[i-1].bottom,result.bands[i].top);
 const turned=prepareInvoiceScan(r,{...defaultScanOptions,crop:'whole',quarterTurns:1});assert.equal(turned.image.width,r.height);assert.equal(turned.image.height,r.width);
});
test('unsafe crossed, tiny, reversed and non-finite crops fail before image processing',()=>{
 validateScanCorners(wholePageCorners());
 for(const corners of [[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],wholePageCorners().reverse(),wholePageCorners().map(p=>({x:p.x*.1,y:p.y*.1})),[{x:NaN,y:0},...wholePageCorners().slice(1)]])assert.throws(()=>validateScanCorners(corners));
 assert.throws(()=>prepareInvoiceScan(page(),{...defaultScanOptions,angle:11}));
 assert.throws(()=>prepareInvoiceScan(page(),{...defaultScanOptions,crop:'manual'}));
});
test('shadow reduction lifts paper brightness with capped gain and preserves black ink and source',()=>{
 const r=page(800,1100,150);rect(r,100,100,500,5,0);rect(r,100,200,500,5,25);const before=r.data.slice(),result=reduceInvoiceShadows(r);
 assert.deepEqual(r.data,before);assert.ok(result.data[0]>230);assert.equal(result.data[(102*800+200)*4],0);assert.ok(result.data[(202*800+200)*4]<=43);assert.ok(result.data[(202*800+200)*4]<50);
 assert.ok(invoiceScanFlags(r).some(f=>f.code==='shadow'));assert.ok(!invoiceScanFlags(result).some(f=>f.code==='shadow'));
});
test('blank, small, blurred and clipped samples give actionable warnings without a readability guarantee',()=>{
 assert.ok(invoiceScanFlags(page(300,400)).some(f=>f.code==='small'));assert.ok(invoiceScanFlags(page()).some(f=>f.code==='contrast'));
 const blurred=page();for(let y=40;y<1060;y++)for(let x=40;x<760;x++){const v=180+60*Math.cos(y/12);const i=(y*800+x)*4;blurred.data[i]=blurred.data[i+1]=blurred.data[i+2]=v;}assert.ok(invoiceScanFlags(blurred).some(f=>f.code==='blur'));
 const clipped=page();rect(clipped,0,0,15,1100,20);assert.ok(invoiceScanFlags(clipped).some(f=>f.code==='edge'));
 assert.ok(prepareInvoiceScan(page()).flags.some(f=>f.code==='crop'));
 const sharp=page();for(let y=80;y<1050;y+=40)rect(sharp,60,y,680,5,20);assert.ok(!invoiceScanFlags(sharp).some(f=>f.code==='blur'));
 const localShadow=page();rect(localShadow,40,40,220,1000,140);assert.ok(invoiceScanFlags(localShadow).some(f=>f.code==='shadow'));
});
test('unchecked, unreadable, stale, disabled, busy or already-saved previews cannot be saved',()=>{
 const state={busy:false,disabled:false,changed:false,confirmed:false,readable:true,checked:true,hasPreview:true};assert.equal(canSaveInvoiceScan(state),true);
 for(const key of ['busy','disabled','changed','confirmed'] as const)assert.equal(canSaveInvoiceScan({...state,[key]:true}),false);
 for(const key of ['readable','checked','hasPreview'] as const)assert.equal(canSaveInvoiceScan({...state,[key]:false}),false);
});
test('unconfirmed preparation fails before any storage or AI request',async()=>{
 const plan={documentHash:'a'.repeat(64),revision:'photo-sections-v1',confirmed:false,sections:[]};let calls=0;
 assert.throws(()=>preparationManifest(plan),/Preview and confirm/);
 await assert.rejects(()=>uploadInvoicePreparation(async()=>{calls++;return {};},{caseId:'sample',documentId:'sample',expectedVersion:1},plan),/Preview and confirm/);assert.equal(calls,0);
});
