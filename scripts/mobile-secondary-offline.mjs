// Uses the isolated build produced by mobile-compact-offline.mjs. No production services.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),output=path.resolve(root,'../../work/mobile-compact-2026-11-02');
const {chromium,webkit}=createRequire(import.meta.url)(process.env.HTOS_PLAYWRIGHT_MODULE);
const server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(file==='favicon.ico'){res.writeHead(204).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html');res.end(await readFile(path.join(file.startsWith('fonts/')?root+'/public':output+'/dist',file)));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,results=[];let browser;
try{
 for(const engine of ['chromium','webkit']){
  browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'}),external=[],errors=[];
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base||u.pathname.startsWith('/api/')){external.push(u.href);return r.abort();}return r.continue();});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
  const fits=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(base+'/#/');await page.getByRole('button',{name:'Help',exact:true}).click();
  await page.getByLabel('Short summary',{exact:true}).fill('Sample report');await page.getByLabel('What happened?',{exact:true}).fill('Offline mobile form check');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.getByLabel('Short summary',{exact:true}).inputValue(),'Sample report');
  for(const size of [{width:320,height:568},{width:390,height:400},{width:844,height:390}]){await page.setViewportSize(size);await page.getByLabel('What happened?',{exact:true}).focus();await page.getByRole('button',{name:'Cancel',exact:true}).scrollIntoViewIfNeeded();await fits();}
  await page.screenshot({path:output+'/'+engine+'-help-landscape.png'});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard and close',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Keep working',exact:true}).click();
  results.push(engine+': Help retains unsent text, explicit discard works; short viewport/landscape controls reachable; sign-out cancellation passed');

  await page.goto(base+'/#/deliveries');await page.getByRole('button',{name:'Process order',exact:true}).click();
  const send=page.getByLabel('Sample rice: Box to send',{exact:true});await send.fill('8');await send.blur();assert.equal(await page.getByRole('button',{name:'Confirm dispatch',exact:true}).isEnabled(),false);
  await page.getByLabel('Sample rice: shortage reason',{exact:true}).selectOption({index:1});
  for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(size);await fits();await page.getByRole('button',{name:'Confirm dispatch',exact:true}).scrollIntoViewIfNeeded();}
  await page.screenshot({path:output+'/'+engine+'-dispatch.png'});await page.getByRole('button',{name:'Confirm dispatch',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(window.__mobileFixture.snapshot()).orders.find(o=>o.id==='qa-review').receivedStatus==='PROCESSED');
  assert.equal(await page.evaluate(()=>JSON.parse(window.__mobileFixture.snapshot()).orders.find(o=>o.id==='qa-review').items[0].sentCaseQty),8);
  results.push(engine+': synthetic incoming dispatch, shortage validation and saved quantities passed');

  await page.setViewportSize({width:390,height:844});await page.goto(base+'/#/checks');await page.getByRole('button',{name:'Open check',exact:true}).click();
  await page.getByLabel('Document reference',{exact:true}).fill('TEST-ONLY');await page.getByLabel('Sample rice deliveredCaseQty',{exact:true}).fill('10');await page.getByLabel('Sample rice deliveredPackQty',{exact:true}).fill('0');await page.getByLabel('Check notes / extra items',{exact:true}).fill('Synthetic mobile note');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.getByLabel('Document reference',{exact:true}).inputValue(),'TEST-ONLY');
  for(const size of [{width:320,height:568},{width:390,height:400},{width:844,height:390}]){await page.setViewportSize(size);await fits();await page.getByRole('button',{name:'Save draft',exact:true}).scrollIntoViewIfNeeded();}
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('button',{name:'Open check',exact:true}).click();assert.equal(await page.getByLabel('Document reference',{exact:true}).inputValue(),'TEST-ONLY');await page.screenshot({path:output+'/'+engine+'-check-reopened.png'}); await writeFile(output+'/'+engine+'-check-debug.txt',await page.locator('body').innerText()); assert.equal(await page.locator('label.h-field').filter({hasText:'Check notes / extra items'}).locator('textarea').inputValue(),'Synthetic mobile note');
  await page.getByLabel('Reviewed Sample rice',{exact:true}).check();await page.getByRole('button',{name:'Confirm check',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(window.__mobileFixture.snapshot()).orders.find(o=>o.id==='qa-review').deliveryCheck?.draft===false);
  results.push(engine+': manual delivery check, unsaved-close protection, draft/reopen and confirmed synthetic receipt passed');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);await context.close();await browser.close();browser=null;
 }
 await writeFile(output+'/secondary-results.json',JSON.stringify({passed:true,results,firebaseReads:0,externalRequests:0},null,2));console.log(results.join('\n'));
}finally{await browser?.close();server.close();}

