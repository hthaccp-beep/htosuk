// Offline real-component regression. Supply HTOS_PLAYWRIGHT_MODULE if Playwright is not installed locally.
import {build, transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from 'tailwindcss';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile, copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.HTOS_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(import.meta.dirname,'..').replaceAll('\\','/');
const output=path.resolve(root,'../../work/supplier-save-2026-11-02/existing');
await mkdir(output,{recursive:true});
await writeFile(output+'/index.html',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'"></head><body style="margin:0"><div id="root"></div><script type="module" src="fixture:entry"></script></body></html>`);
await mkdir(output+'/dist/fonts',{recursive:true});
const modules={
 'fixture:config':`export const auth=null;`,
 'fixture:store':`export const sample={id:'sample',name:'Sample supplier',email:'sample@example.invalid',allBranches:false,availableBranchIds:['b1'],active:true,deliverySchedules:{},branchAccountCodes:{}};
 window.__qa={saves:[],fail:false,delay:false,toasts:[]};
 const save=async draft=>{window.__qa.saves.push(structuredClone(draft));if(window.__qa.delay)await new Promise(resolve=>window.__qa.release=resolve);if(window.__qa.fail)throw new Error('Sample save failed. Please try again.');};
 const state={suppliers:[sample],branches:[{id:'b2',code:'HT2',name:'Hare & Tortoise – Ealing',displayOrder:2},{id:'b1',code:'HT1',name:'Hare & Tortoise – Bloomsbury',displayOrder:1},{id:'b3',code:'HT3',name:'Hare & Tortoise – Kensington High Street sample branch with a longer name',displayOrder:3}],departments:[],products:[],categories:[],currentUser:{id:'sample-owner',role:'CREATOR',active:true},addSupplier:save,updateSupplier:save,deleteSupplier:()=>{throw new Error('Unexpected delete');},reorderSupplier:()=>{throw new Error('Unexpected reorder');},showToast:(...args)=>window.__qa.toasts.push(args)};
 export const useAppStore=()=>state;export const can=()=>true;window.__source=state;
 globalThis.fetch=()=>{throw new Error('Network disabled');};`,
 'fixture:products':`export const useSupplierProducts=()=>({ready:false,error:null});`,
 'fixture:entry':`import {SignOutConfirmation} from '${root}/app/htos/SignOutConfirmation.tsx';import {useAction} from '${root}/app/htos/ui.tsx';import {beginPendingWork,pendingWorkCount} from '${root}/shared/pending-work.ts';import '${root}/app/htos/htos.css';import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import {AdminSuppliers} from '${root}/components/admin/AdminSuppliers.tsx';import {Modal} from '${root}/components/Modal.tsx';import '${root}/app/htos/admin.css';
 function Demo(){const [other,setOther]=React.useState(false),[signOut,setSignOut]=React.useState(false);const action=useAction();window.__run=action.run;window.__pending=pendingWorkCount;window.__begin=beginPendingWork;return <HashRouter><section className="h-app"><button onClick={()=>setSignOut(true)}>Sign out test</button>{signOut&&<SignOutConfirmation onClose={()=>setSignOut(false)} onSignOut={async()=>{window.__qa.logouts=(window.__qa.logouts||0)+1;if(window.__qa.logoutDelay)await new Promise(resolve=>window.__qa.finishLogout=resolve);if(window.__qa.logoutFail)throw new Error('Sample logout failed');}}/>}{action.feedback}</section><main className="h-admin" style={{padding:16}}><p>Offline sample only</p><AdminSuppliers/><button onClick={()=>setOther(true)}>Other modal</button><Modal isOpen={other} onClose={()=>setOther(false)} labelledBy="other-title" className="max-w-md p-6"><h3 id="other-title">Other modal</h3><button onClick={()=>setOther(false)}>Close other modal</button></Modal></main></HashRouter>;}createRoot(document.getElementById('root')).render(<Demo/>);`
};
await build({root:output,configFile:false,envDir:output,logLevel:'error',css:{postcss:{plugins:[tailwind({...require(root+'/tailwind.config.cjs'),content:[root+'/components/admin/AdminSuppliers.tsx',root+'/components/{Modal,ConfirmModal}.tsx']})]}},resolve:{alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom','react-router-dom':root+'/node_modules/react-router-dom'}},plugins:[react(),{name:'isolated-supplier-editor',enforce:'pre',resolveId(source){if(source in modules)return '\0'+source;if(/(?:^|\/)store(?:\.ts)?$/.test(source))return '\0fixture:store';if(source.endsWith('/useSupplierProducts'))return '\0fixture:products';if(/(?:^|\/)firebase-config(?:\.ts)?$/.test(source))return '\0fixture:config';if(/firebase/.test(source))throw new Error('Firebase must not be bundled');},async load(id){if(id.startsWith('\0fixture:'))return (await transformWithEsbuild(modules[id.slice(1)],'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;}}],build:{outDir:output+'/dist',emptyOutDir:true,rollupOptions:{input:output+'/index.html'}}});
await mkdir(output+'/dist/fonts',{recursive:true});await copyFile(root+'/public/fonts/dm-sans-latin.woff2',output+'/dist/fonts/dm-sans-latin.woff2');
const server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,'dist',file)));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const external=[],errors=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);
 const source=await page.evaluate(()=>JSON.stringify(window.__source));
 const editor=page.getByRole('dialog',{name:'Supplier details',exact:true});
 const open=async()=>{await page.getByRole('button',{name:'Edit supplier Sample supplier',exact:true}).click();await editor.waitFor();};
 const outside=()=>page.mouse.click(2,2);
 await open();await outside();assert.equal(await editor.count(),1);
 await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});
 await open();await page.getByLabel('Supplier name',{exact:true}).fill('Sample edited supplier');await outside();assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Sample edited supplier');
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('alertdialog').waitFor();await outside();assert.equal(await page.getByRole('alertdialog').count(),1);
 await page.getByRole('button',{name:'Keep editing'}).click();assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Sample edited supplier');
 await page.getByRole('button',{name:'Close supplier details'}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();await editor.waitFor({state:'hidden'});
 await open();assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Sample supplier');
 // Save failure keeps the complete draft; one pending request cannot be submitted again or dismissed.
 await page.getByLabel('Supplier name',{exact:true}).fill('Sample saved supplier');
 await page.getByRole('navigation',{name:'Supplier sections'}).getByRole('button',{name:'Branches',exact:true}).click();await page.locator('.supplier-branch-row').filter({hasText:'Bloomsbury'}).locator('summary').click();
 await page.getByLabel('Account code for Hare & Tortoise – Bloomsbury',{exact:true}).fill('SAMPLE-01');
 await page.locator('.supplier-branch-row').filter({hasText:'Ealing'}).locator('summary').click();
 await page.getByLabel('Delivery instructions for Hare & Tortoise – Ealing',{exact:true}).fill('Monday');
 await page.getByLabel('Allow orders from Hare & Tortoise – Ealing',{exact:true}).check();await page.getByRole('navigation',{name:'Supplier sections'}).getByRole('button',{name:'Details',exact:true}).click();
 await page.evaluate(()=>{window.__qa.fail=true;window.__qa.delay=true;document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 assert.equal(await page.evaluate(()=>window.__qa.saves.length),1);
 assert.equal(await page.getByRole('button',{name:'Close supplier details'}).isDisabled(),true);
 await outside();await page.keyboard.press('Escape');assert.equal(await editor.count(),1);
 await page.evaluate(()=>window.__qa.release());await page.getByRole('alert').waitFor();
 assert.match(await page.getByRole('alert').innerText(),/Your edits are still here/);
 assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Sample saved supplier');
 await page.evaluate(()=>{window.__qa.fail=false;window.__qa.delay=false;});
 await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByText('Supplier saved. You can keep editing.',{exact:true}).waitFor();assert.equal(await editor.count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});
 const saved=await page.evaluate(()=>window.__qa.saves.at(-1));assert.equal(saved.name,'Sample saved supplier');assert.equal(saved.branchAccountCodes.b1,'SAMPLE-01');assert.equal(saved.deliverySchedules.b2,'Monday');assert.deepEqual(saved.availableBranchIds,['b1','b2']);
 await open();await page.getByLabel('Supplier name',{exact:true}).fill('Escaped edit');await page.keyboard.press('Escape');assert.equal(await page.getByRole('alertdialog').count(),0);await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('alertdialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Escaped edit');await page.getByLabel('Supplier name',{exact:true}).fill('Sample supplier');await page.keyboard.press('Escape');assert.equal(await editor.count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Add Supplier',exact:true}).click();await page.getByLabel('Supplier name',{exact:true}).fill('New sample');await outside();assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'New sample');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();
 // Both shared modal families now ignore accidental backdrop clicks.
 await page.getByRole('button',{name:'Other modal',exact:true}).click();await page.getByRole('dialog',{name:'Other modal'}).waitFor();await outside();assert.equal(await page.getByRole('dialog',{name:'Other modal'}).count(),1);await page.getByRole('button',{name:'Close other modal'}).click();await page.getByRole('dialog',{name:'Other modal'}).waitFor({state:'hidden'});
 await open();
 await page.getByRole('navigation',{name:'Supplier sections'}).getByRole('button',{name:'Branches',exact:true}).click();const branchList=page.getByLabel('Serviced branches');
 assert.deepEqual(await branchList.locator('summary strong').allTextContents(),['Hare & Tortoise – Bloomsbury','Hare & Tortoise – Ealing','Hare & Tortoise – Kensington High Street sample branch with a longer name']);
 for(const [name,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}],['narrow',{width:320,height:720}]]){
   await page.setViewportSize(size);await branchList.scrollIntoViewIfNeeded();
   const boxes=await branchList.locator('summary').evaluateAll(labels=>labels.map(label=>{const text=label.querySelector('span');return {client:label.clientWidth,scroll:label.scrollWidth,textClient:text.clientWidth,textScroll:text.scrollWidth,whiteSpace:getComputedStyle(text).whiteSpace,textOverflow:getComputedStyle(text).textOverflow};}));
   for(const box of boxes){assert.ok(box.scroll<=box.client+1);assert.ok(box.textScroll<=box.textClient+1);assert.equal(box.whiteSpace,'normal');assert.notEqual(box.textOverflow,'ellipsis');}
   assert.equal(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   await page.screenshot({path:output+'/'+name+'.png'});
 }
 await page.getByRole('button',{name:'Close supplier details'}).click();
 await page.setViewportSize({width:1440,height:1000});
 const signOut=page.getByRole('dialog',{name:'Sign out of HTOS?',exact:true});
 await page.getByRole('button',{name:'Sign out test'}).click();await signOut.waitFor();assert.match(await signOut.innerText(),/Any unsaved changes will be lost/);await outside();assert.equal(await signOut.count(),1);await page.getByRole('button',{name:'Keep working',exact:true}).click();assert.equal(await page.evaluate(()=>window.__qa.logouts||0),0);
 await page.getByRole('button',{name:'Sign out test'}).click();await page.keyboard.press('Escape');await signOut.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__qa.logouts||0),0);
 // Actual useAction lifecycle must release the sign-out lock on failure and success.
 await page.evaluate(()=>{void window.__run(()=>new Promise((resolve,reject)=>{window.__qa.failTask=reject;window.__qa.finishTask=resolve;}));});
 assert.equal(await page.evaluate(()=>window.__pending()),1);
 await page.getByRole('button',{name:'Sign out test'}).click();await signOut.getByRole('status').waitFor();assert.equal(await signOut.getByRole('button',{name:'Sign out',exact:true}).isDisabled(),true);
 await page.screenshot({path:output+'/signout-pending-desktop.png'});
 await page.evaluate(()=>window.__qa.failTask(new Error('Sample process failed')));await page.waitForFunction(()=>window.__pending()===0);assert.equal(await signOut.getByRole('button',{name:'Sign out',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'Keep working',exact:true}).click();await page.evaluate(()=>window.__run(async()=>{},'Sample saved'));assert.equal(await page.evaluate(()=>window.__pending()),0);
 await page.getByRole('button',{name:'Sign out test'}).click();await page.evaluate(()=>{window.__qa.logoutDelay=true;window.__qa.logoutFail=true;});await signOut.getByRole('button',{name:'Sign out',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Keep working',exact:true}).isDisabled(),true);await outside();await page.keyboard.press('Escape');assert.equal(await signOut.count(),1);assert.equal(await page.evaluate(()=>window.__qa.logouts),1);await page.evaluate(()=>window.__qa.finishLogout());await signOut.getByRole('alert').waitFor();assert.match(await signOut.getByRole('alert').innerText(),/could not finish/);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/signout-mobile.png'});assert.equal(await signOut.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
 await page.evaluate(()=>{window.__qa.logoutDelay=false;window.__qa.logoutFail=false;});await signOut.getByRole('button',{name:'Sign out',exact:true}).click();await signOut.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__qa.logouts),2);
 assert.equal(await page.evaluate(()=>JSON.stringify(window.__source)),source);
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 const result={passed:true,checks:['outside clicks preserve add/edit drafts','Cancel/Close/Escape guard unsaved changes','Keep editing preserves draft; discard resets it','reverting a change closes without a warning','failed saves retain fields','duplicate submission and close while saving blocked','successful sample save carries branch values','shared modals ignore outside clicks','saved branch ordering and full labels at 1440/390/320px','no source record mutation','sign-out requires explicit confirmation; Cancel and Escape keep session','processing blocks sign-out and unlocks on completion/failure','sign-out failure remains visible; pending sign-out cannot be repeated'],firebaseReads:0,firebaseWrites:0,externalRequests:external.length,versionChanged:false};
 await writeFile(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
