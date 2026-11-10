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
const {chromium}=createRequire('C:/Users/allan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const root=path.resolve(import.meta.dirname,'..').replaceAll('\\','/');
const output=path.resolve(root,'../../work/supplier-save-2026-11-02');
await mkdir(output,{recursive:true});
await writeFile(output+'/index.html',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'"></head><body style="margin:0"><div id="root"></div><script type="module" src="fixture:entry"></script></body></html>`);
await mkdir(output+'/dist/fonts',{recursive:true});
const modules={
 'fixture:config':`export const auth=null;`,
 'fixture:store':`export const sample={id:'sample',name:'Sample supplier',email:'sample@example.invalid',allBranches:false,availableBranchIds:['b1'],active:true,minimumOrderAmount:100,globalAccountCode:'GROUP-01',branchMinimumOrderAmounts:{b2:0},deliveryRules:{b1:[1,3]},deliverySchedules:{default:'Order by 10 pm',b2:'Friday delivery'},branchAccountCodes:{b2:'EAL-02'},contactEmail:'preserve@example.invalid',departmentIds:['kitchen'],allDepartments:false};
 window.__qa={saves:[],fail:false,delay:false,toasts:[],operations:[]};
 const save=async draft=>{window.__qa.saves.push(structuredClone(draft));if(window.__qa.delay)await new Promise(resolve=>window.__qa.release=resolve);if(window.__qa.fail)throw new Error('Sample save failed. Please try again.');};
 const state={suppliers:[sample],branches:[{id:'b2',code:'HT2',name:'Hare & Tortoise – Ealing',displayOrder:2},{id:'b1',code:'HT1',name:'Hare & Tortoise – Bloomsbury',displayOrder:1},{id:'b3',code:'HT3',name:'Hare & Tortoise – Kensington High Street sample branch with a longer name',displayOrder:3},{id:'b4',code:'HT4',name:'Hare & Tortoise – Putney',displayOrder:4},{id:'b5',code:'HT5',name:'Hare & Tortoise – Aldgate East',displayOrder:5},{id:'b6',code:'HT6',name:'Hare & Tortoise – Chiswick',displayOrder:6},{id:'b7',code:'HT7',name:'Hare & Tortoise – Battersea',displayOrder:7},{id:'cpu',code:'CPU',name:'Hare & Tortoise – CPU',displayOrder:8,actsAsSupplier:true}],departments:[],products:[],categories:[],currentUser:{id:'sample-owner',role:'CREATOR',active:true},addSupplier:draft=>{window.__qa.operations.push('add');return save(draft);},updateSupplier:draft=>{window.__qa.operations.push('update');return save(draft);},deleteSupplier:()=>{throw new Error('Unexpected delete');},reorderSupplier:()=>{throw new Error('Unexpected reorder');},showToast:(...args)=>window.__qa.toasts.push(args)};
 export const useAppStore=()=>state;export const can=()=>true;window.__source=state;
 globalThis.fetch=()=>{throw new Error('Network disabled');};`,
 'fixture:products':`export const useSupplierProducts=()=>({ready:false,error:null});`,
 'fixture:entry':`import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import {AdminSuppliers} from '${root}/components/admin/AdminSuppliers.tsx';import '${root}/app/htos/htos.css';import '${root}/app/htos/design5.css';import '${root}/app/htos/admin.css';import '${root}/app/htos/settings-polish.css';
 createRoot(document.getElementById('root')).render(<HashRouter><main className="h-admin" style={{padding:24}}><p style={{marginBottom:16}}>Offline preview · Sample suppliers only · Nothing is saved to HTOS</p><AdminSuppliers/></main></HashRouter>);`
};
await build({root:output,configFile:false,envDir:output,logLevel:'error',css:{postcss:{plugins:[tailwind({...require(root+'/tailwind.config.cjs'),content:[root+'/components/admin/{AdminSuppliers,SupplierDetailsFields}.tsx',root+'/components/{Modal,ConfirmModal}.tsx']})]}},resolve:{alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom','react-router-dom':root+'/node_modules/react-router-dom'}},plugins:[react(),{name:'isolated-supplier-editor',enforce:'pre',resolveId(source){if(source in modules)return '\0'+source;if(/(?:^|\/)store(?:\.ts)?$/.test(source))return '\0fixture:store';if(source.endsWith('/useSupplierProducts'))return '\0fixture:products';if(/(?:^|\/)firebase-config(?:\.ts)?$/.test(source))return '\0fixture:config';if(/firebase/.test(source))throw new Error('Firebase must not be bundled');},async load(id){if(id.startsWith('\0fixture:'))return (await transformWithEsbuild(modules[id.slice(1)],'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;}}],build:{outDir:output+'/dist',emptyOutDir:true,rollupOptions:{input:output+'/index.html'}}});
await mkdir(output+'/dist/fonts',{recursive:true});await copyFile(root+'/public/fonts/dm-sans-latin.woff2',output+'/dist/fonts/dm-sans-latin.woff2');
const server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,'dist',file)));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const checks=[];
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
 const nav=async name=>page.getByRole('navigation',{name:'Supplier sections'}).getByRole('button',{name,exact:true}).click();
 const branch=name=>page.locator('.supplier-branch-row').filter({has:page.locator('summary strong',{hasText:name})});
 const expand=async name=>{const row=branch(name);if(!await row.locator('details').evaluate(el=>el.open))await row.locator('summary').click();return row;};
 const discard=async()=>{await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();};

 // Reproduce deleting the zero, then saving repeatedly without dismissing the editor.
 await open();await nav('Ordering');
 const minimum=page.getByLabel('Default minimum order amount');
 await minimum.fill('0');await minimum.press('End');await minimum.press('Backspace');
 assert.equal(await minimum.inputValue(),'');
 await minimum.pressSequentially('150');assert.equal(await minimum.inputValue(),'150');
 const saveAndStay=async()=>{await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByText('Supplier saved. You can keep editing.',{exact:true}).waitFor();assert.equal(await editor.count(),1);};
 await saveAndStay();assert.equal(await minimum.inputValue(),'150');assert.equal(await page.evaluate(()=>window.__qa.saves.at(-1).minimumOrderAmount),150);
 assert.equal(await page.getByRole('button',{name:'Ordering',exact:true}).getAttribute('aria-pressed'),'true');
 await page.keyboard.press('Escape');await page.mouse.click(2,2);assert.equal(await editor.count(),1);
 await minimum.fill('');await nav('Branches');await nav('Ordering');assert.equal(await minimum.inputValue(),'');
 await saveAndStay();assert.equal(await page.evaluate(()=>window.__qa.saves.at(-1).minimumOrderAmount),0);assert.equal(await minimum.inputValue(),'0');
 await minimum.fill('150.25');await saveAndStay();assert.equal(await page.evaluate(()=>window.__qa.saves.at(-1).minimumOrderAmount),150.25);
 await minimum.fill('200');await page.getByText('Unsaved changes',{exact:true}).waitFor();assert.equal(await page.getByText('Supplier saved. You can keep editing.',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Keep editing'}).click();await nav('Ordering');assert.equal(await minimum.inputValue(),'200');
 await minimum.fill('150.25');await page.getByText('No unsaved changes',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close supplier details'}).click();await editor.waitFor({state:'hidden'});
 checks.push('Zero can be deleted and replaced; empty defaults save as zero; decimals preserved; successful saves retain the current section and reset the dirty baseline');
 await page.getByRole('button',{name:'Add Supplier',exact:true}).click();await page.getByLabel('Supplier name',{exact:true}).fill('New repeat-save sample');await saveAndStay();
 const createdId=await page.evaluate(()=>window.__qa.saves.at(-1).id);
 await page.getByLabel('Contact Name',{exact:true}).fill('Updated contact');await saveAndStay();
 assert.equal(await page.evaluate(()=>window.__qa.saves.at(-1).id),createdId);assert.deepEqual(await page.evaluate(()=>window.__qa.operations.slice(-2)),['add','update']);
 await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});
 checks.push('A newly saved supplier stays open and subsequent saves update the same ID, even before the supplier list refreshes');
 await page.evaluate(()=>{window.__qa.saves=[];window.__qa.operations=[];});
 await open();assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Sample supplier');
 await page.mouse.click(2,2);assert.equal(await editor.count(),1);
 await page.getByLabel('Supplier name',{exact:true}).fill('Edited sample');await nav('Ordering');await nav('Branches');await nav('Details');assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Edited sample');
 await page.getByRole('button',{name:'Close supplier details'}).click();await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Keep editing'}).click();assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Edited sample');
 checks.push('Section changes and outside clicks retain unsaved edits; close requires confirmation');
 await discard();await open();assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Sample supplier');
 await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByText('Supplier saved. You can keep editing.',{exact:true}).waitFor();assert.equal(await editor.count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>window.__qa.saves.at(-1)),await page.evaluate(()=>window.__source.suppliers[0]));
 checks.push('Unedited save preserves every stored field, including unshown department/contact fields');
 await open();await nav('Branches');assert.equal(await page.locator('.supplier-branch-row').count(),8);
 const names=await page.locator('.supplier-branch-row summary strong').allTextContents();assert.match(names[0],/Bloomsbury/);assert.match(names[1],/Ealing/);
 assert.match(await branch('Bloomsbury').innerText(),/£100.00/);assert.match(await branch('Ealing').innerText(),/£0.00/);
 await expand('Bloomsbury');const min=page.getByLabel('Minimum order for Hare & Tortoise – Bloomsbury',{exact:true});assert.equal(await min.inputValue(),'');assert.match(await min.getAttribute('placeholder'),/Default: £100.00/);
 await min.fill('0');await nav('Details');await nav('Branches');assert.equal(await min.inputValue(),'0');await min.fill('');
 await page.getByLabel('Account code for Hare & Tortoise – Bloomsbury').fill('BL-01');
 await page.getByLabel('Delivery instructions for Hare & Tortoise – Bloomsbury').fill('Tuesday delivery');
 await page.getByLabel('Mon delivery for Hare & Tortoise – Bloomsbury').uncheck();await page.getByLabel('Tue delivery for Hare & Tortoise – Bloomsbury').check();
 await page.getByLabel('Allow orders from Hare & Tortoise – Ealing').check();
 await nav('Ordering');await page.getByLabel('Default minimum order amount').fill('125');await page.getByLabel('Global Account Code').fill('GROUP-02');
 await nav('Details');await page.getByLabel('Supplier name',{exact:true}).fill('Updated sample');await page.getByLabel('Order Email(s)',{exact:true}).fill('one@example.invalid, two@example.invalid');
 await page.evaluate(()=>{window.__qa.fail=true;window.__qa.delay=true;document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 assert.equal(await page.evaluate(()=>window.__qa.saves.length),2);
 assert.equal(await page.getByRole('button',{name:'Close supplier details'}).isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await editor.count(),1);
 await page.evaluate(()=>window.__qa.release());await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/Your edits are still here/);assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Updated sample');
 await page.evaluate(()=>{window.__qa.fail=false;window.__qa.delay=false;});await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByText('Supplier saved. You can keep editing.',{exact:true}).waitFor();assert.equal(await editor.count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});
 const saved=await page.evaluate(()=>window.__qa.saves.at(-1));assert.equal(saved.minimumOrderAmount,125);assert.equal(saved.branchMinimumOrderAmounts.b1,undefined);assert.equal(saved.branchMinimumOrderAmounts.b2,0);assert.equal(saved.branchAccountCodes.b1,'BL-01');assert.equal(saved.branchAccountCodes.b2,'EAL-02');assert.equal(saved.deliverySchedules.b1,'Tuesday delivery');assert.deepEqual(saved.deliveryRules.b1,[3,2]);assert.deepEqual(saved.availableBranchIds,['b1','b2']);assert.equal(saved.email,'one@example.invalid, two@example.invalid');assert.equal(saved.contactEmail,'preserve@example.invalid');assert.equal(saved.globalAccountCode,'GROUP-02');
 checks.push('Blank inherits, explicit zero retained; branch codes, delivery days, instructions and access saved together','Save failure retains draft; duplicate submission and dismissal while saving blocked','Shared ordering of all eight branches, no source record mutation');
 await open();await nav('Ordering');await page.getByLabel('Preferred Method',{exact:true}).selectOption('WHATSAPP');await nav('Branches');
 const before=await page.evaluate(()=>window.__qa.saves.length);await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByLabel('WhatsApp Number (Required)',{exact:true}).waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.__qa.saves.length),before);await page.getByLabel('WhatsApp Number (Required)',{exact:true}).fill('02000000000');
 await nav('Branches');await expand('Ealing');await page.getByLabel('Minimum order for Hare & Tortoise – Ealing').fill('-1');await branch('Ealing').locator('summary').click();await nav('Details');await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByLabel('Minimum order for Hare & Tortoise – Ealing').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.__qa.saves.length),before);
 checks.push('Validation opens the correct section and branch for missing WhatsApp and invalid minimum');
 await discard();await open();await page.getByLabel('Supplier name',{exact:true}).fill('');await nav('Ordering');await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByLabel('Supplier name',{exact:true}).waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.__qa.saves.length),before);await discard();
 checks.push('Required supplier name cannot be bypassed from a different section');
 await open();await nav('Ordering');await page.getByLabel('Internal supplying branch').selectOption('cpu');await nav('Details');await page.getByLabel('Supplier active',{exact:true}).uncheck();await nav('Branches');await page.getByLabel('Available at all branches',{exact:true}).check();await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByText('Supplier saved. You can keep editing.',{exact:true}).waitFor();assert.equal(await editor.count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});
 const internal=await page.evaluate(()=>window.__qa.saves.at(-1));assert.equal(internal.linkedBranchId,'cpu');assert.equal(internal.active,false);assert.equal(internal.allBranches,true);assert.deepEqual(internal.availableBranchIds,[]);assert.equal(internal.branchAccountCodes.b2,'EAL-02');
 checks.push('Internal supplier, active status and all-branches behaviour retained without clearing overrides');
 await page.getByRole('button',{name:'Add Supplier',exact:true}).click();await page.getByLabel('Supplier name',{exact:true}).fill('New synthetic supplier');await page.getByRole('button',{name:'Save supplier',exact:true}).click();await page.getByText('Supplier saved. You can keep editing.',{exact:true}).waitFor();assert.equal(await editor.count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();await editor.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__qa.saves.at(-1).name),'New synthetic supplier');
 checks.push('Add supplier uses the same form and mock save');
 await open();await page.getByLabel('Supplier name',{exact:true}).fill('Escape sample');await page.keyboard.press('Escape');assert.equal(await page.getByRole('alertdialog').count(),0);await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('alertdialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByLabel('Supplier name',{exact:true}).inputValue(),'Escape sample');await discard();
 checks.push('Escape does not close the editor; explicit close protects drafts; discard restores original values');
 await open();
 for(const [label,size] of [['desktop',{width:1440,height:1000}],['tablet',{width:768,height:1024}],['phone',{width:390,height:844}],['narrow',{width:320,height:720}]]){
  await page.setViewportSize(size);
  for(const section of ['Details','Ordering','Branches']){
   await nav(section);
   if(section==='Branches')await expand('Ealing');
   assert.equal(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   const box=await page.getByRole('button',{name:'Save supplier',exact:true}).boundingBox();assert.ok(box.y>=0&&box.y+box.height<=size.height);
   const overflow=await page.locator('.supplier-fields section:visible').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
   await page.screenshot({path:output+`/${label}-${section.toLowerCase()}.png`});
  }
 }
 checks.push('All three sections fit desktop, tablet, phone and 320px; Save remains visible');
 assert.equal(await page.evaluate(()=>JSON.stringify(window.__source)),source);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 checks.push('Zero external requests, Firebase reads/writes and browser errors');
 await writeFile(output+'/result.json',JSON.stringify({passed:true,checks,firebaseReads:0,firebaseWrites:0,externalRequests:external.length,versionChanged:false},null,2));
 console.log(JSON.stringify({passed:true,checks}));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
