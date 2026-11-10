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
const phase=process.env.HTOS_CAPTURE_PHASE||'before';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage();await page.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
 for(const route of ['orders','new-order','deliveries','checks','settings?tab=users']){
 await page.goto(base+'/?ordering=1&orders=1#/'+route);await page.locator('.h-page-loading').waitFor({state:'hidden'});await page.waitForTimeout(500);await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:output+'/'+phase+'-desktop-'+route.split('?')[0]+'.png',animations:'disabled'});
 }
 await page.goto(base+'/?ordering=1#/new-order?draft=qa-draft');await page.getByRole('dialog').waitFor();
 await page.getByLabel('3 · Delivery date',{exact:true}).fill('2026-11-04');
 await page.screenshot({path:output+'/'+phase+'-desktop-date.png',animations:'disabled'});
 await page.getByRole('button',{name:'Confirm & choose products',exact:true}).click();await page.locator('.h-order-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:output+'/'+phase+'-desktop-products.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/'+phase+'-mobile-products.png',animations:'disabled'});
 await page.goto(base+'/?ordering=1&daily=1#/orders');await page.locator('.h-mobile-history').waitFor();await page.screenshot({path:output+'/'+phase+'-mobile-history.png',animations:'disabled'});
 console.log('Captured '+phase+' baseline');
}finally{await browser.close();server.close();}
