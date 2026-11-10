// Synthetic UI checks. Production configuration is replaced and network calls are blocked.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..').replaceAll('\\','/');
const output=path.resolve(root,'../../work/order-history-filters-2026-11-05');
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.HTOS_PLAYWRIGHT_MODULE||path.resolve(root,'../../work/audit-deps/node_modules/playwright'));
await mkdir(output,{recursive:true});
await writeFile(output+'/index.html',`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'"><title>HTOS order controls · Offline sample</title><div id="root"></div><script type="module" src="${root}/tests/ui-preview.tsx"></script>`);
await build({root:output,resolve:{alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom'}},configFile:false,envDir:output,publicDir:false,logLevel:'warn',plugins:[react(),{name:'isolate-order-controls',enforce:'pre',resolveId(id){if(/(?:^|\/)firebase-config(?:\.ts)?$/.test(id))return '\0offline-config';},async load(id){if(id==='\0offline-config')return 'export const auth=null,db=null,configurationError=null,firebaseConfig={};';if(id===root+'/tests/ui-preview.tsx')return (await readFile(id,'utf8')).replace('const previewContent=',`const fixtureOrders=[
 {...sampleOrder,id:'ABCD1234-open',branchId:'qa-b',branchNameSnapshot:'Hare & Tortoise – Ealing',supplierId:'qa-s',supplierNameSnapshot:'Sample Atariya',status:'PLACED',emailStatus:'SENT',createdAt:'2026-11-05T10:00:00Z'},
 {...sampleOrder,id:'EFGH5678-processed',branchId:'qa-b2',branchNameSnapshot:'Sample Putney',supplierId:'qa-s',supplierNameSnapshot:'Sample Atariya',status:'PLACED',receivedStatus:'PROCESSED',createdAt:'2026-11-05T09:00:00Z'},
 {...sampleOrder,id:'IJKL1234-draft',supplierId:'qa-other',supplierNameSnapshot:'Sample Pantry',status:'DRAFT',createdAt:'2026-11-04T09:00:00Z'},
 {...sampleOrder,id:'MNOP1234-cancelled',supplierId:'qa-other',supplierNameSnapshot:'Sample Pantry',status:'CANCELLED',createdAt:'2026-11-04T08:00:00Z'},
 {...sampleOrder,id:'QRST1234-archived',supplierId:'qa-retired',supplierNameSnapshot:'Former supplier',status:'CANCELLED',archived:true,createdAt:'2026-11-03T08:00:00Z'}];
previewStore.setState({orders:fixtureOrders,branches:[{...branch,name:'Hare & Tortoise – Ealing'},{...branch,id:'qa-b2',name:'Sample Putney'}]});
window.__historyFixture={snapshot:()=>JSON.stringify({orders:previewStore.getState().orders,products:previewStore.getState().products})};
const previewContent=`);}}],build:{outDir:output+'/dist',emptyOutDir:true,rollupOptions:{input:output+'/index.html'}}});
const server=createServer(async(req,res)=>{try{let file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(file==='favicon.ico'){res.writeHead(204).end();return;}const full=path.join(file.startsWith('fonts/')?root+'/public':output+'/dist',file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html');res.end(await readFile(full));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,results=[];let browser;
try {
 for(const engine of ['chromium','webkit']) {
  browser=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',hasTouch:true});
  const external=[],errors=[];
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base||u.pathname.startsWith('/api/')){external.push(u.href);return route.abort();}return route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-05T12:00:00Z'));
  await page.goto(base+'/#/orders');
  const count=page.locator('.h-history-filter-summary .h-order-count');
  const expectCount=async text=>{await page.waitForFunction(t=>document.querySelector('.h-history-filter-summary .h-order-count')?.textContent===t,text);};
  await expectCount('4 orders');
  const before=await page.evaluate(()=>window.__historyFixture.snapshot());
  assert.equal(await page.getByLabel('Supplier',{exact:true}).locator('option').count(),4);
  await page.getByLabel('Supplier',{exact:true}).selectOption('qa-s');await expectCount('2 orders');
  await page.getByLabel('Order status',{exact:true}).selectOption('OPEN');await expectCount('1 order');
  await page.getByLabel('Ordering branch filter').selectOption('qa-b2');await expectCount('0 orders');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expectCount('4 orders');
  assert.equal(await page.getByLabel('Ordering branch filter').inputValue(),'');
  assert.equal(await page.getByLabel('Supplier',{exact:true}).inputValue(),'');
  for(const query of [' #abcd1234 ','EALING']){await page.getByLabel('Search orders',{exact:true}).fill(query);await expectCount('1 order');}
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByLabel('Order status',{exact:true}).selectOption('ARCHIVED');await expectCount('1 order');
  await page.getByLabel('Supplier',{exact:true}).selectOption('qa-retired');await expectCount('1 order');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.locator('.h-history-filter-guide summary').click();
  assert.match(await page.locator('.h-history-filter-guide').innerText(),/does not confirm the supplier has read/);
  await page.locator('.h-history-filter-guide summary').click();
  for(const size of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844},{width:320,height:844},{width:932,height:430}]) {
   await page.setViewportSize(size);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');
   if(size.width<=620) {
    assert(await page.locator('.h-mobile-history').isVisible());
    assert(!await page.getByLabel('Supplier',{exact:true}).isVisible());
    await page.getByRole('button',{name:/^Filters/}).click();
    assert(await page.getByLabel('Supplier',{exact:true}).isVisible());
    assert(await page.getByLabel('Supplier',{exact:true}).evaluate(e=>e.getBoundingClientRect().height>=44));
    await page.getByLabel('Supplier',{exact:true}).selectOption('qa-other');await expectCount('2 orders');
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    await page.screenshot({path:output+'/'+engine+'-filters-'+size.width+'.png'});
    await page.getByRole('button',{name:/^Filters/}).click();
   }
   if(size.width===1440||size.width===390) await page.screenshot({path:output+'/'+engine+'-history-'+size.width+'.png'});
  }
  assert.equal(await page.evaluate(()=>window.__historyFixture.snapshot()),before);
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  results.push(engine+': combined filters, clear, references, archive, help, five viewport sizes, mobile day groups and unchanged sample records passed');
  await context.close();await browser.close();browser=null;
 }
 await writeFile(output+'/browser-results.json',JSON.stringify({passed:true,results,firebaseReads:0,firebaseWrites:0,externalRequests:0},null,2));console.log(results.join('\n'));
}finally {await browser?.close();server.close();}
