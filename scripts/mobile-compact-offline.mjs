// Real UI with synthetic in-memory records; no Firebase configuration or API access.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..').replaceAll('\\','/');
const output=path.resolve(root,'../../work/mobile-compact-2026-11-02');
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.HTOS_PLAYWRIGHT_MODULE||path.resolve(root,'../../work/audit-deps/node_modules/playwright'));
await mkdir(output,{recursive:true});
await writeFile(output+'/index.html',`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'"><title>HTOS mobile review · Sample data only</title></head><body><div id="root"></div><script type="module" src="${root}/tests/ui-preview.tsx"></script></body></html>`);
await build({root:output,resolve:{alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom'}},configFile:false,envDir:output,publicDir:false,logLevel:'warn',plugins:[react(),{name:'isolate-mobile-preview',enforce:'pre',resolveId(id){if(/(?:^|\/)firebase-config(?:\.ts)?$/.test(id))return '\0offline-config';},async load(id){if(id==='\0offline-config')return 'export const auth=null,db=null,configurationError=null,firebaseConfig={};';if(id===root+'/tests/ui-preview.tsx'){let source=await readFile(id,'utf8');return source.replace('const previewContent=',`previewStore.setState(s=>({branches:s.branches.map(b=>({...b,name:b.id==='qa-b'?'Example restaurant – Kensington':'Example restaurant – Bloomsbury'})),suppliers:s.suppliers.map(v=>({...v,name:'Example Foods International (Sample supplier)'})),orders:s.orders.map(o=>({...o,branchNameSnapshot:'Example restaurant – Kensington',supplierNameSnapshot:'Example Foods International (Sample supplier)',emailStatus:o.status==='PLACED'?'SENT':o.emailStatus}))}));
if(new URLSearchParams(location.search).has('daily')) previewStore.setState(s=>{
 const names=['Kensington','Ealing','Putney','Bloomsbury','Chiswick','Battersea'];
 const suppliers=['T&S Enterprise (Atariya)','Harro Foods','CPU','JFC International INC','Example Foods International (Sample supplier)','Example Drinks'];
 const template=s.orders.find(o=>o.status==='PLACED');
 return {branches:names.map((name,i)=>({...s.branches[0],id:'daily-branch-'+i,name:'Hare & Tortoise – '+name})),orders:Array.from({length:38},(_,i)=>({...template,id:'daily-order-'+i,branchId:'daily-branch-'+Math.floor(i%36/6),branchNameSnapshot:'Hare & Tortoise – '+names[Math.floor(i%36/6)],supplierNameSnapshot:suppliers[i%6],createdAt:i<36?'2026-11-02T'+String(20-Math.floor(i/6)).padStart(2,'0')+':'+String(50-i%6).padStart(2,'0')+':00Z':'2026-11-01T19:00:00Z',deliveryDate:'2026-11-03',emailStatus:'SENT',receivedStatus:undefined}))};
});
window.__mobileFixture={snapshot:()=>JSON.stringify({orders:previewStore.getState().orders,products:previewStore.getState().products}),setUser:user=>previewStore.setState({currentUser:user}),user:previewStore.getState().currentUser};
const previewContent=`);}}}],build:{outDir:output+'/dist',emptyOutDir:true,rollupOptions:{input:output+'/index.html'}}});
const server=createServer(async(req,res)=>{try{let file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(file==='favicon.ico'){res.writeHead(204).end();return;}if(file.endsWith('index.html'))file='index.html';const full=path.join(file.startsWith('fonts/')?root+'/public':output+'/dist',file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html');res.end(await readFile(full));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const results=[],metrics=[];let browser;
try{
 for(const engine of ['chromium','webkit']){
  browser=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',hasTouch:true});
  const external=[],errors=[];
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base||u.pathname.startsWith('/api/')){external.push(u.href);return route.abort();}return route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
  const fits=async(label)=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),engine+': '+label+' overflow');
  const shot=async(name)=>page.screenshot({path:output+'/'+engine+'-'+name+'.png',animations:'disabled'});
  await page.goto(base+'/?daily=1&ordering=1#/orders');await page.locator('.h-mobile-history').waitFor();
  const before=await page.evaluate(()=>window.__mobileFixture.snapshot());
  for(const width of [320,375,390,414,430]){
   await page.setViewportSize({width,height:844});await fits('history '+width);
   assert.equal(await page.locator('.h-desktop-history').isVisible(),false);
   assert.equal(await page.locator('.h-history-day').count(),2);
   assert.equal(await page.locator('.h-history-day').first().locator('.h-mobile-history-order').count(),36);
   assert.equal(await page.locator('.h-history-day-toggle').nth(1).getAttribute('aria-expanded'),'false');
   assert(await page.locator('.h-mobile-history-order strong').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
   metrics.push({engine,screen:'history',width,...await page.locator('.h-mobile-history-order>summary').first().evaluate(e=>({rowHeight:e.getBoundingClientRect().height}))});
  }
  await page.setViewportSize({width:390,height:844});await shot('history');
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByLabel('Ordering branch filter',{exact:true}).selectOption('daily-branch-2');assert.equal(await page.locator('.h-mobile-history-order').count(),6);
  await page.getByLabel('Ordering branch filter',{exact:true}).selectOption('');
  await page.getByLabel('Order status',{exact:true}).selectOption('PLACED');
  await page.getByLabel('Search orders',{exact:true}).fill('nothing matches');await page.getByText('No matching orders',{exact:true}).waitFor();
  await page.getByLabel('Search orders',{exact:true}).fill('');
  await page.getByRole('button',{name:/Filters/}).click();
  await page.locator('.h-history-day-toggle').first().click();assert.equal(await page.locator('.h-mobile-history-order').first().isVisible(),false);
  await page.locator('.h-history-day-toggle').first().click();
  await page.locator('.h-history-day-toggle').nth(1).click();assert.equal(await page.locator('.h-history-day').nth(1).locator('.h-mobile-history-order:visible').count(),2);
  await page.locator('.h-history-day-toggle').nth(1).click();
  await page.locator('.h-mobile-history-order>summary').first().click();
  const expanded=page.locator('.h-mobile-history-order[open]').first();
  assert((await expanded.locator('.h-history-actions .h-button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44}))).every(Boolean));
  await expanded.locator('.h-history-actions button').first().click();await page.getByRole('dialog').waitFor();await fits('order details');await shot('history-detail');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expanded.getByRole('button',{name:/Cancel order /}).click();await page.getByRole('button',{name:'Keep order',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__mobileFixture.snapshot()),before);
  results.push(engine+': 38-order fixture, five phone widths, day grouping, filters, expand/collapse, details and safe cancellation passed');

  await page.goto(base+'/?ordering=1#/new-order');await page.getByRole('dialog').waitFor();
  await page.getByLabel(/^1 · Ordering branch/).selectOption('qa-b');
  await page.getByLabel(/^2 · Supplier/).selectOption('qa-s');
  const date=page.getByLabel(/^3 · Delivery date/);
  assert.equal(await date.evaluate(e=>e.tagName),'SELECT');
  const dates=await date.locator('option').evaluateAll(es=>es.map(e=>e.value).filter(Boolean));
  assert(dates.length>0);assert(dates.every(d=>d>='2026-11-03'&&d<='2026-11-09'));assert(!dates.includes('2026-11-10'));
  await date.selectOption('2026-11-04');await shot('date-options');
  await page.getByRole('button',{name:'Confirm & choose products',exact:true}).click();await page.locator('.h-order-card').first().waitFor();
  for(const width of [320,375,390,414,430]){
   await page.setViewportSize({width,height:844});await fits('products '+width);
   assert.equal(await page.locator('.h-order-details-bar').evaluate(e=>getComputedStyle(e).position),'static');
   assert.equal(await page.locator('.h-basket-dock').evaluate(e=>getComputedStyle(e).position),'static');
   assert(await page.locator('.h-product-description strong').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
   assert(await page.locator('.h-quantity input').first().evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44}));
   metrics.push({engine,screen:'products',width,...await page.locator('.h-order-card').first().evaluate(e=>({rowHeight:e.getBoundingClientRect().height}))});
  }
  await page.setViewportSize({width:390,height:844});await shot('products-top');
  await page.getByLabel('Search products',{exact:true}).fill('noodles');await page.waitForFunction(()=>document.querySelectorAll('.h-order-card').length===8);assert.equal(await page.locator('.h-order-card').count(),8);
  await page.getByLabel('Search products',{exact:true}).fill('');
  await page.getByRole('button',{name:'Filters and checklist',exact:true}).click();await page.getByLabel('Product category',{exact:true}).selectOption({index:1});
  await page.getByRole('button',{name:'Checklist',exact:true}).click();await page.getByTitle('Order checklist preview').waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByLabel('Product category',{exact:true}).selectOption('');await page.getByRole('button',{name:'Filters and checklist',exact:true}).click();
  const qty=page.getByLabel('Sample rice Box quantity',{exact:true}).first();
  await qty.fill('31');await qty.blur();assert.equal(await qty.inputValue(),'30');
  await qty.fill('3');await qty.blur();await page.getByLabel('Sample rice Unit quantity',{exact:true}).first().fill('2');await qty.focus();
  assert.match(await page.locator('.h-basket-total').innerText(),/60\.00/);
  await page.locator('.h-order-card').first().scrollIntoViewIfNeeded();await shot('products-list');
  for(const size of [{width:844,height:390},{width:932,height:430}]){
   await page.setViewportSize(size);await fits('landscape');assert.equal(await qty.inputValue(),'3');
   assert.equal(await page.locator('.h-order-details-bar').evaluate(e=>getComputedStyle(e).position),'static');
   assert.equal(await page.locator('.h-basket-dock').evaluate(e=>getComputedStyle(e).position),'static');
   assert.equal(await page.locator('.h-product-grid').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);
   await page.locator('.h-order-card').first().scrollIntoViewIfNeeded();await shot('landscape-'+size.width);
   await page.getByRole('button',{name:'Edit',exact:true}).click();await date.waitFor();await fits('landscape setup');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Close navigation',exact:true}).first().click();assert.equal(await qty.inputValue(),'3');
  await page.getByRole('button',{name:/Add custom item/}).click();await page.getByLabel('Custom item 1 description',{exact:true}).fill('Sample custom item');await page.getByLabel('Custom item 1 units',{exact:true}).fill('1');
  await page.getByRole('button',{name:/Review order ·/}).click();await page.getByLabel(/^Note to supplier/).fill('Synthetic mobile note');await shot('review');
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await qty.inputValue(),'3');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(window.__mobileFixture.snapshot()).orders.some(o=>o.comments==='Synthetic mobile note'&&o.status==='DRAFT'));
  const draft=await page.evaluate(()=>JSON.parse(window.__mobileFixture.snapshot()).orders.find(o=>o.comments==='Synthetic mobile note'));
  assert.equal(draft.items[0].caseQty,3);assert.equal(draft.items[0].packQty,2);assert.equal(draft.manualItems[0].description,'Sample custom item');
  // Reopen within the same in-memory session (no page navigation resets the fixture).
  await page.getByRole('link',{name:'Edit draft',exact:true}).click();await date.waitFor();
  await page.getByRole('button',{name:'Confirm & choose products',exact:true}).click();assert.equal(await qty.inputValue(),'3');
  await page.getByRole('button',{name:/Review order ·/}).click();assert.equal(await page.getByLabel(/^Note to supplier/).inputValue(),'Synthetic mobile note');
  await page.getByRole('checkbox',{name:/I have checked/}).check();await page.getByRole('button',{name:/Confirm details & review email/}).click();
  await page.getByRole('button',{name:'Confirm & Send',exact:true}).click();await page.getByRole('button',{name:'View saved order',exact:true}).waitFor();
  const placed=await page.evaluate(id=>JSON.parse(window.__mobileFixture.snapshot()).orders.filter(o=>o.id===id),draft.id);assert.equal(placed.length,1);assert.equal(placed[0].status,'PLACED');assert.equal(placed[0].emailStatus,'SENT');
  results.push(engine+': branch/supplier/date setup, search, category, checklist, quantities/£60 total, custom item, rotation, draft/reopen, review and synthetic submission passed');
  for(const route of ['/','/deliveries','/checks']){
   await page.goto(base+'/?orders=1#'+route);await page.locator('#main-content').waitFor();await page.waitForTimeout(200);
   for(const width of [320,375,390,414,430]){await page.setViewportSize({width,height:844});await fits(route+' '+width)}
   await page.setViewportSize({width:390,height:844});await shot(route==='/'?'overview':route.slice(1));
  }
  results.push(engine+': Overview, Incoming and Checks responsive layout passed at all five widths');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await context.close();await browser.close();browser=null;
 }
 await writeFile(output+'/compact-results.json',JSON.stringify({passed:true,results,metrics,firebaseReads:0,firebaseWrites:0,externalRequests:0},null,2));console.log(results.join('\n'));
}finally{await browser?.close();server.close();}




