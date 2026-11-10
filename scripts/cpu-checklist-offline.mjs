// Actual product picker and print preview with synthetic data and blocked network.
import {build,transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..').replaceAll('\\','/');
const output=path.resolve(root,'../../work/cpu-checklist-repair-2026-11-02');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.HTOS_PLAYWRIGHT_MODULE||path.resolve(root,'../../work/audit-deps/node_modules/playwright'));
await mkdir(output,{recursive:true});
await writeFile(output+'/index.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; form-action \'none\'"></head><body style="margin:0"><div id="root"></div><script type="module" src="fixture:entry"></script></body></html>');
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {ProductPicker} from '${root}/app/htos/OrderBuilderParts.tsx';import '${root}/app/htos/htos.css';import '${root}/app/htos/order-composer.css';import '${root}/app/htos/design5.css';import '${root}/app/htos/responsive.css';
const categories=['Front','Sauce','Sushi','Packing'].map((name,i)=>({id:'c'+i,name,active:true,displayOrder:i+1}));
const products=Array.from({length:40},(_,i)=>({id:'p'+i,name:'Sample '+(i+1),categoryId:'c'+i%4,cataloguePosition:i+1,active:true,allowedBranchIds:[],caseUnitName:'Box',packUnitName:'Unit'}));
window.__source=products;
function Demo(){const [search,setSearch]=React.useState(''),[category,setCategory]=React.useState(''),[items,setItems]=React.useState([]),[manual,setManual]=React.useState([]);return <main className="h-app h-composer h-composer-compact" style={{padding:24}}><h1>Offline CPU checklist sample</h1><p>Sample products only. No live connection.</p><div className="h-order-catalogue"><ProductPicker products={products.filter(p=>p.name.includes(search))} checklistProducts={products} categories={categories} supplierName="CPU sample supplier" branchName="Sample branch" date="2026-11-02" search={search} setSearch={setSearch} category={category} setCategory={setCategory} items={items} manual={manual} setManual={setManual} qty={(p,unit,value)=>setItems(old=>{const prev=old.find(i=>i.productId===p.id)||{productId:p.id,caseQty:0,packQty:0};return [...old.filter(i=>i.productId!==p.id),{...prev,[unit]:Number(value)}];})}/></div></main>;}createRoot(document.getElementById('root')).render(<Demo/>);`;
await build({root:output,configFile:false,envDir:output,logLevel:'error',resolve:{alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom'}},plugins:[react(),{name:'offline-cpu-fixture',enforce:'pre',resolveId(source){if(source==='fixture:entry')return '\0entry';if(/(?:^|\/)firebase-config(?:\.ts)?$/.test(source))return '\0config';if(/firebase/.test(source))throw new Error('Firebase dependency blocked');},async load(id){if(id==='\0config')return 'export const auth=null;';if(id==='\0entry')return (await transformWithEsbuild(entry,'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;}}],build:{outDir:output+'/dist',emptyOutDir:true,rollupOptions:{input:output+'/index.html'}}});
const server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,'dist',file)));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const external=[],errors=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 const before=await page.evaluate(()=>JSON.stringify(window.__source));
 assert.deepEqual(await page.locator('.h-product-group h3').allTextContents(),['Front','Sauce','Sushi','Packing']);
 assert.equal(await page.locator('.h-order-card').count(),40);
 assert.equal(await page.locator('.h-product-grid').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3);
 const names=await page.locator('.h-order-card .h-product-description strong').allTextContents();
 await page.getByLabel('Sample 1 Box quantity',{exact:true}).fill('3');
 await page.getByRole('button',{name:'Checklist',exact:true}).click();
 const frame=page.frameLocator('iframe[title="Order checklist preview"]');
 await frame.locator('.checklist-unit').first().waitFor();
 assert.equal(await frame.locator('.checklist-unit').count(),2);
 assert.deepEqual(await frame.locator('.checklist-unit').first().locator('h2').allTextContents(),['Front','Sauce','Sushi','Packing']);
 assert.deepEqual(await frame.locator('.checklist-unit').first().locator('.en').allTextContents(),names);
 assert.equal(await frame.locator('body').getAttribute('data-columns'),'3');
 assert.equal(await frame.locator('.checklist-unit').first().locator('.checks span').count(),80);
 await page.screenshot({path:output+'/desktop-checklist.png'});
 await frame.locator('body').screenshot({path:output+'/print-sheet.png'});
 await page.getByRole('button',{name:'Close',exact:true}).click();
 assert.equal(await page.getByLabel('Sample 1 Box quantity',{exact:true}).inputValue(),'3');
 await page.getByLabel('Product category',{exact:true}).selectOption('c1');
 assert.equal(await page.locator('.h-order-card').count(),10);
 await page.getByRole('button',{name:'Checklist',exact:true}).click();
 await frame.locator('.checklist-unit').first().waitFor();
 assert.equal(await frame.locator('.checklist-unit').first().locator('.en').count(),40);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByLabel('Product category',{exact:true}).selectOption('');
 for(const width of [820,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.h-product-group').count(),4);await page.screenshot({path:output+'/order-'+width+'.png'});}
 assert.equal(await page.evaluate(()=>JSON.stringify(window.__source)),before);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={passed:true,checks:['One category section each for interleaved catalogue','All 40 products shown once','Desktop ordering grid remains three columns','Screen and print product order match','Three-column A4 layout with two copies','Blank quantity boxes remain blank','Opening and closing checklist retains unfinished quantity','Category filter does not truncate full checklist','Tablet and phone rendering','Synthetic source unchanged; no browser errors or external requests'],firebaseReads:0,firebaseWrites:0};
 await writeFile(output+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}


