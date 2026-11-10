// Isolated two-release PWA fixture. Actual update UI/controller, guard and Vite
// PWA configuration; synthetic user/work only. Firebase imports fail the build.
import {build, transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.HTOS_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(import.meta.dirname,'..').replaceAll('\\','/');
const folder=path.resolve(root,process.env.HTOS_UPDATE_TEST_OUTPUT || '../../work/safe-updates-2026-10-20');
await mkdir(folder,{recursive:true});
const results=[];
const pass=name=>{results.push(name);console.log('PASS '+name);};
const storeModule=`let state={currentUser:null,cart:{},manualCart:[],users:[{id:'sample-owner',role:'CREATOR',active:true,displayName:'Sample owner',username:'owner@example.invalid'},{id:'sample-staff',role:'STAFF',active:true,displayName:'Sample staff',username:'staff@example.invalid'}],roles:[{id:'CREATOR',name:'Owner'},{id:'STAFF',name:'Staff'}],branches:[],departments:[],suppliers:[],rolePermissions:{},showToast:()=>{},logout:()=>{}}; export const useAppStore=()=>state;useAppStore.getState=()=>state;useAppStore.setState=update=>{state={...state,...(typeof update==='function'?update(state):update)};};export const setUser=()=>state.currentUser={id:'sample-staff',role:'STAFF'};export const setOwner=()=>state.currentUser=state.users[0];export const basket=value=>state.cart=value?{sample:{caseQty:1}}:{};`;
for (const release of ['A','B']) {
  const dir=folder+'/'+release;
  await mkdir(dir+'/public',{recursive:true});
  await copyFile(root+'/public/htos-update-guard.js',dir+'/public/htos-update-guard.js');
  await writeFile(dir+'/public/app-version.json',JSON.stringify({version:release}));
  await writeFile(dir+'/public/htos-release-'+release+'.js',`self.addEventListener('message',event=>{if(event.data?.type==='HTOS_RELEASE')event.ports?.[0]?.postMessage({version:${JSON.stringify(release)}});});`);
  await writeFile(dir+'/index.html','<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline HTOS update test</title></head><body><div id="root"></div><script type="module" src="fixture:entry"></script></body></html>');
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter,useNavigate,useLocation} from 'react-router-dom';import {SafeUpdates,requestUpdateCheck} from '${root}/app/htos/SafeUpdates.tsx';import {useUpdateProtection} from '${root}/hooks/useUpdateProtection.ts';import {beginPendingWork} from '${root}/shared/pending-work.ts';import {setUser,setOwner,basket} from 'fixture:store';import {AdminUsers} from '${root}/components/admin/AdminUsers.tsx';
    function Demo(){const navigate=useNavigate();const location=useLocation();const [nativeOpen,setNativeOpen]=React.useState(false);const [dirty,edit]=React.useState(false),[busy,setBusy]=React.useState(false);const finish=React.useRef(null);useUpdateProtection(dirty);return <><SafeUpdates ready={true}/><main><h1>Release ${release}</h1><p>Offline synthetic data only</p><button onClick={()=>{setUser();navigate('/');}}>Stay signed in</button><button onClick={()=>{setOwner();navigate('/settings?tab=users');}}>Team screen</button><button onClick={()=>navigate('/settings?tab=system')}>System screen</button><button onClick={()=>setNativeOpen(!nativeOpen)}>Toggle native form</button>{nativeOpen&&<dialog open><label>Sample choice<select aria-label="Sample choice"><option>One</option><option>Two</option></select></label></dialog>}{location.pathname==='/settings'&&location.search==='?tab=users'&&<AdminUsers/>}<button onClick={()=>navigate('/new-order')}>Order screen</button><button onClick={()=>navigate('/')}>Overview</button><button onClick={()=>edit(!dirty)}>{dirty?'Save sample work':'Edit sample order or CSV review'}</button><p>{dirty?'Unfinished work':'No unfinished work'}</p><button onClick={()=>{if(busy){finish.current();setBusy(false);}else{finish.current=beginPendingWork();setBusy(true);}}}>{busy?'Finish sample upload':'Start sample upload'}</button><button onClick={()=>basket(true)}>Keep basket</button><button onClick={()=>basket(false)}>Clear sample basket</button><label>Email or form entry<input aria-label="Form entry"/></label><button onClick={requestUpdateCheck}>Check for updates</button></main></>};createRoot(document.getElementById('root')).render(<HashRouter><Demo/></HashRouter>);`;
  await build({root:dir,configFile:false,envDir:dir,logLevel:'error',publicDir:dir+'/public',css:{postcss:{plugins:[]}},
    resolve:{alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom','react-router-dom':root+'/node_modules/react-router-dom'}},
    plugins:[react(),{name:'isolated-updates',enforce:'pre',resolveId(id){if(id==='../../app-version.json')return '\0release';if(id==='fixture:entry')return '\0entry';if(id==='fixture:store'||/(?:^|\/)store$/.test(id))return '\0store';if(/firebase-config$/.test(id))return '\0fake-auth';if(id==='firebase/auth')return '\0fake-signin';if(/firebase/.test(id))throw new Error('Firebase prohibited in offline update test');},async load(id){if(id==='\0fake-auth')return 'export const auth={currentUser:{getIdToken:async()=>"synthetic-token"}};';if(id==='\0fake-signin')return 'export const signInWithEmailAndPassword=async()=>{throw new Error("Sign-in prohibited in offline tests")};';if(id==='\0release')return 'export default '+JSON.stringify({version:release});if(id==='\0store')return storeModule;if(id==='\0entry')return (await transformWithEsbuild(entry,'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;}},VitePWA({registerType:'prompt',injectRegister:false,manifest:false,workbox:{globPatterns:['**/*.{js,css,html}'],navigateFallback:'/index.html',navigateFallbackDenylist:[/^\/app-version\.json$/,/^\/fresh\.html$/],importScripts:['/htos-release-'+release+'.js','/htos-update-guard.js'],skipWaiting:false,clientsClaim:true,cleanupOutdatedCaches:true}})],build:{outDir:dir+'/dist',emptyOutDir:true}});
}
let served='A', rejectProbe=false, rejectDownload=false, probeGate;const requests=[];
const server=createServer(async(req,res)=>{
  requests.push(req.url); const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/app-version.json'&&probeGate)await probeGate;
  if(rejectProbe&&pathname==='/app-version.json'){res.writeHead(503).end();return;}
  if(rejectDownload&&served==='B'&&pathname.startsWith('/assets/')&&pathname.endsWith('.js')){res.writeHead(503).end();return;}
  try{const relative=pathname==='/'||pathname==='/fresh.html'?'index.html':pathname.slice(1);if(relative.includes('..'))throw new Error();const body=await readFile(path.join(folder,served,'dist',relative));res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.json')?'application/json':'text/html');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser; const errors=[],external=[];
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  if(!process.env.HTOS_UPDATE_ONLY_CURRENT && !process.env.HTOS_UPDATE_ONLY_TEAM){
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:900}});
  context.on('request',request=>{if(new URL(request.url()).origin!==base)external.push(request.url());});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.getByRole('button',{name:'Stay signed in',exact:true}).click();
  await page.getByRole('button',{name:'Edit sample order or CSV review'}).click();
  await page.evaluate(()=>{localStorage.setItem('sample-draft','keep exactly');sessionStorage.setItem('sample-form','keep exactly');});
  const other=await context.newPage();await other.goto(base);await other.getByLabel('Form entry').fill('Other tab unfinished form');
  served='B';
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
  await page.getByRole('button',{name:'Update now',exact:true}).waitFor();
  await page.clock.fastForward(61_000);
  assert.equal(await page.getByRole('heading').textContent(),'Release A');
  await page.getByRole('button',{name:'Update now',exact:true}).click();
  await page.getByText('Save or finish your work, then open Overview to update. You do not need to send an order.').waitFor();pass('Unfinished work blocks automatic and explicit updates');
  await page.getByRole('button',{name:'Save sample work',exact:true}).click();
  await page.getByRole('button',{name:'Start sample upload',exact:true}).click();
  await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByText('An action is still processing. Wait for its result before updating.').waitFor();pass('Running submission/upload blocks update');
  await page.getByRole('button',{name:'Finish sample upload',exact:true}).click();
  await page.getByRole('button',{name:'Keep basket',exact:true}).click();
  await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByText('Save or finish your work, then open Overview to update. You do not need to send an order.').waitFor();pass('Persisted basket blocks update');
  await page.getByRole('button',{name:'Clear sample basket',exact:true}).click();
  await page.getByRole('button',{name:'Order screen',exact:true}).click();
  await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByText('Save your work, then return to Overview to update safely.').waitFor();pass('Order route cannot be interrupted even before a quantity is entered');
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await page.getByLabel('Form entry').fill('Unsaved typed text');await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByText('Finish and close the open form or dialogue before updating.').waitFor();pass('Entered form text survives update attempt');
  await page.getByLabel('Form entry').fill('');
  await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByText('Save your work in other HTOS tabs, then close those tabs to finish this update.').waitFor();
  assert.equal(await other.getByLabel('Form entry').inputValue(),'Other tab unfinished form');pass('Second tab prevents activation; its unsaved form stays intact');
  await other.close();
  rejectProbe=true;await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByText('The update could not connect. Your work is unchanged. Try again when connected.').waitFor();assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);pass('Failed connectivity probe releases frozen interface without reload');rejectProbe=false;
  await context.setOffline(true);await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByText('Reconnect before updating. Your work is unchanged.').waitFor();pass('Offline update retains working release');await context.setOffline(false);
  await page.getByRole('button',{name:'Later',exact:true}).click();
  assert.equal(await page.getByRole('complementary',{name:'App updates'}).count(),0);pass('Later immediately hides the whole notice');
  await page.clock.fastForward(301_000);assert.equal(await page.getByRole('heading').textContent(),'Release A');
  assert.equal(await page.getByRole('complementary',{name:'App updates'}).count(),0);pass('Background checks do not reopen a postponed notice or reload');
  await page.getByRole('button',{name:'Order screen',exact:true}).click();await page.getByRole('button',{name:'Overview',exact:true}).click();
  assert.equal(await page.getByRole('complementary',{name:'App updates'}).count(),0);pass('Later stays hidden across navigation');
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.getByRole('button',{name:'Update now',exact:true}).waitFor();pass('Check for updates explicitly reopens the postponed notice');
  await page.getByRole('button',{name:'Later',exact:true}).click();await page.getByRole('button',{name:'Order screen',exact:true}).click();
  await page.clock.fastForward(899_000);assert.equal(await page.getByRole('complementary',{name:'App updates'}).count(),0);
  await page.clock.fastForward(1_000);await page.getByRole('button',{name:'Update now',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading').textContent(),'Release A');pass('Fifteen-minute reminder returns without interrupting the order screen');
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.getByRole('button',{name:'Update now',exact:true}).isVisible());
  await page.screenshot({path:folder+'/update-notice-mobile.png',fullPage:true});pass('Update notice fits phone width and keeps both actions visible');
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:folder+'/update-notice.png',fullPage:true});
  let releaseProbe;probeGate=new Promise(resolve=>{releaseProbe=resolve;});
  const probesBefore=requests.filter(url=>url==='/app-version.json').length;
  await page.getByRole('button',{name:'Update now',exact:true}).click();
  await page.locator('.h-update-cover').waitFor();
  const updating=page.locator('.h-safe-update-actions button').first();
  assert.equal(await updating.textContent(),'Updating…');assert.equal(await updating.isDisabled(),true);
  assert.equal(await updating.getAttribute('aria-busy'),'true');
  assert.equal(await page.locator('#root').evaluate(el=>el.inert),true);
  await updating.evaluate(button=>{for(let i=0;i<10;i++)button.click();});
  assert.equal(requests.filter(url=>url==='/app-version.json').length-probesBefore,1);
  await page.screenshot({path:folder+'/update-progress-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:folder+'/update-progress-mobile.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.h-update-cover .h-update-spinner').evaluate(el=>getComputedStyle(el).animationName),'none');
  pass('Progress stays visible on desktop and mobile, disables repeat clicks and respects reduced motion');
  probeGate=undefined;releaseProbe();
  await page.getByRole('heading',{name:'Release B',exact:true}).waitFor();
  assert.equal(await page.locator('.h-update-cover').count(),0);
  assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);
  assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('sample-draft'),sessionStorage.getItem('sample-form')]),['keep exactly','keep exactly']);pass('Real waiting worker activates/reloads to release B and preserves local/session storage');
  await page.getByText('Your app is up to date — version B.',{exact:true}).waitFor();
  pass('Successful reload confirms the version that actually opened');
  await page.clock.fastForward(6000);
  assert.equal(await page.getByRole('complementary',{name:'App updates'}).count(),0);
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await page.getByText('Your app is up to date — version B.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Update now',exact:true}).count(),0);
  await page.clock.fastForward(5000);
  await page.waitForFunction(()=>!document.querySelector('[data-update-ui]'));
  pass('Manual current-version check shows confirmation without Update now and dismisses after five seconds');
  pass('Successful update clears the notice, including later polling and manual recheck');
  await context.close();
  for(const signedIn of [false,true]){
    served='A';const fresh=await browser.newContext({serviceWorkers:'allow'});const p=await fresh.newPage();await p.clock.install();await p.goto(base);await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
    p.on('pageerror',error=>errors.push(error.message));fresh.on('request',request=>{if(new URL(request.url()).origin!==base)external.push(request.url());});
    if(signedIn)await p.getByRole('button',{name:'Stay signed in',exact:true}).click();
    served='B';await p.clock.fastForward(60_000);await p.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);await p.getByRole('button',{name:'Update now',exact:true}).waitFor();
    await p.clock.fastForward(signedIn?61_000:11_000);await p.getByRole('heading',{name:'Release B',exact:true}).waitFor();pass(signedIn?'Idle signed-in Staff auto-updates without logout':'Untouched sign-in screen auto-updates');await fresh.close();
  }
  served='A';const failed=await browser.newContext({serviceWorkers:'allow'});const fp=await failed.newPage();await fp.clock.install();await fp.goto(base);await fp.evaluate(()=>navigator.serviceWorker.ready);await fp.waitForFunction(()=>!!navigator.serviceWorker.controller);
  failed.on('request',request=>{if(new URL(request.url()).origin!==base)external.push(request.url());});
  await fp.getByLabel('Form entry').fill('Saved password or typed sign-in text');
  served='B';rejectDownload=true;await fp.getByRole('button',{name:'Check for updates',exact:true}).click();
  await fp.getByText('The update could not finish downloading. Your work is unchanged. Check again when connected.').waitFor();
  assert.equal(await fp.getByRole('heading').textContent(),'Release A');assert.equal(await fp.getByLabel('Form entry').inputValue(),'Saved password or typed sign-in text');pass('Incomplete worker download retains current app and entered sign-in text');
  rejectDownload=false;await fp.getByRole('button',{name:'Check for updates',exact:true}).click();await fp.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
  await fp.getByRole('button',{name:'Update now',exact:true}).waitFor();
  await fp.clock.fastForward(11_000);assert.equal(await fp.getByRole('heading').textContent(),'Release A');pass('Automatic sign-in update waits when login fields are filled');
  await fp.getByLabel('Form entry').fill('');await fp.clock.fastForward(11_000);await fp.getByRole('heading',{name:'Release B',exact:true}).waitFor();pass('Failed download can retry and update once the sign-in screen is safe');await failed.close();

  }
  // Actual Team component with mocked account services: no Firebase is imported.
  for(const automatic of [false,true]){
    served='A';const ctx=await browser.newContext({serviceWorkers:'allow'});ctx.on('request',r=>{if(new URL(r.url()).origin!==base)external.push(r.url());});
    const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install();await p.goto(base);await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await p.getByRole('button',{name:'Team screen',exact:true}).click();await p.locator('[data-update-safe-view="team"]').waitFor();
    served='B';await p.getByRole('button',{name:'Check for updates',exact:true}).click();await p.getByRole('button',{name:'Update now',exact:true}).waitFor();
    if(!automatic){
      await p.getByRole('button',{name:'Add User',exact:true}).click();assert.equal(await p.locator('[data-update-safe-view="team"]').count(),0);
      await p.clock.fastForward(61_000);assert.equal(await p.getByRole('heading',{name:'Release A',exact:true}).count(),1);
      // Modal remains open; invoke the same update action without dismissing it.
      await p.getByRole('button',{name:'Update now',exact:true}).evaluate(b=>b.click());
      await p.getByText('Update paused — your work is protected',{exact:true}).waitFor();
      assert.equal(await p.locator('[aria-modal="true"]').count(),1);pass('Untouched actual Add User form blocks automatic/manual reload with visible paused feedback');
      await p.getByLabel('Display Name',{exact:true}).fill('Unfinished sample account');
      await p.getByRole('button',{name:'Update now',exact:true}).evaluate(b=>b.click());
      await p.getByText('Save or finish your work, then open Overview to update. You do not need to send an order.',{exact:true}).waitFor();
      assert.equal(await p.getByLabel('Display Name',{exact:true}).inputValue(),'Unfinished sample account');pass('Actual account form retains unsaved values after an update attempt');
      await p.getByRole('button',{name:'Cancel',exact:true}).click();await p.getByRole('button',{name:'Discard changes',exact:true}).click();await p.locator('[data-update-safe-view="team"]').waitFor();
      const handle=p.locator('[data-rfd-drag-handle-draggable-id="sample-staff"]');await handle.focus();await handle.press('Space');
      await p.waitForFunction(()=>!document.querySelector('[data-update-safe-view="team"]'));
      await p.clock.fastForward(61_000);assert.equal(await p.getByRole('heading',{name:'Release A',exact:true}).count(),1);
      await handle.press('Escape');await p.locator('[data-update-safe-view="team"]').waitFor();pass('Active user rearrangement blocks automatic reload; cancelling restores safe state');
      await p.getByRole('button',{name:'Toggle native form',exact:true}).click();await p.getByLabel('Sample choice').selectOption('Two');
      await p.getByRole('button',{name:'Update now',exact:true}).click();await p.getByText('Finish and close the open form or dialogue before updating.',{exact:true}).waitFor();
      assert.equal(await p.getByLabel('Sample choice').inputValue(),'Two');pass('Native select-only dialogue is protected without typed text');
      await p.getByRole('button',{name:'Toggle native form',exact:true}).click();
      await p.getByRole('button',{name:'System screen',exact:true}).click();await p.getByRole('button',{name:'Update now',exact:true}).click();await p.getByText('Save your work, then return to Overview to update safely.',{exact:true}).waitFor();pass('Unreviewed Settings screens remain protected');
      await p.getByRole('button',{name:'Team screen',exact:true}).click();
      // Hold an actual account request entirely in memory, after its confirmation closes.
      await p.evaluate(()=>{const original=window.fetch;window.fetch=(input,init)=>String(input)==='/api/admin/users'?new Promise(resolve=>{window.finishSampleRequest=()=>resolve(new Response(JSON.stringify({success:true}),{status:200}));}):original(input,init);});
      await p.getByTitle('Delete user',{exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
      await p.waitForFunction(()=>!!window.finishSampleRequest);await p.getByRole('button',{name:'Update now',exact:true}).click();await p.getByText('An action is still processing. Wait for its result before updating.',{exact:true}).waitFor();
      assert.equal(await p.getByRole('heading',{name:'Release A',exact:true}).count(),1);pass('Actual account request stays protected after confirmation closes, without any network request');
      await p.evaluate(()=>window.finishSampleRequest());
      await p.screenshot({path:folder+'/team-update-paused.png',fullPage:true});
      await p.getByRole('button',{name:'Update now',exact:true}).click();
    }else await p.clock.fastForward(61_000);
    await p.getByRole('heading',{name:'Release B',exact:true}).waitFor();assert.equal(new URL(p.url()).hash,'#/settings?tab=users');
    assert.equal(await p.getByRole('button',{name:'Update now',exact:true}).count(),0);pass(automatic?'Untouched Team list auto-updates after safe idle and retains the page':'Team list updates directly after work finishes and clears notice');await ctx.close();
  }
  if(!process.env.HTOS_UPDATE_ONLY_TEAM){
  // Reproduce current HTML with an older controlling worker and another dirty tab.
  served='A';const mixed=await browser.newContext({serviceWorkers:'allow'});
  mixed.on('request',request=>{if(new URL(request.url()).origin!==base)external.push(request.url());});
  const old=await mixed.newPage();await old.goto(base);await old.evaluate(()=>navigator.serviceWorker.ready);await old.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await old.getByLabel('Form entry').fill('Unfinished order in older tab');
  served='B';const current=await mixed.newPage();current.on('pageerror',error=>errors.push(error.message));await current.clock.install();await current.goto(base+'/fresh.html');
  await current.getByRole('heading',{name:'Release B',exact:true}).waitFor();
  await current.getByLabel('Form entry').fill('Unfinished form in current tab');
  await current.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
  await current.getByRole('button',{name:'Check for updates',exact:true}).click();
  await current.getByText('Your app is up to date — version B.',{exact:true}).waitFor();
  assert.equal(await current.locator('#root').evaluate(el=>el.inert),false);
  await current.screenshot({path:folder+'/current-confirmation.png',fullPage:true});
  await current.clock.fastForward(5000);
  await current.waitForFunction(()=>!document.querySelector('[data-update-ui]'));
  await current.getByRole('button',{name:'Check for updates',exact:true}).click();
  await current.getByText('Your app is up to date — version B.',{exact:true}).waitFor();
  await current.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await current.getByRole('complementary',{name:'App updates'}).count(),0);
  pass('Current-version confirmation can also be closed without disturbing either unfinished form');
  await current.clock.fastForward(901_000);
  assert.equal(await current.getByRole('complementary',{name:'App updates'}).count(),0);
  assert.equal(await current.getByLabel('Form entry').inputValue(),'Unfinished form in current tab');
  assert.equal(await old.getByLabel('Form entry').inputValue(),'Unfinished order in older tab');
  assert.equal(await current.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting),true);
  pass('Already-loaded release hides the notice through checks and reminder intervals without activating over either unfinished tab');
  await current.screenshot({path:folder+'/already-current.png',fullPage:true});
  await mixed.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(requests.every(url=>!url.startsWith('/api/')));pass('No external requests, Firebase, business APIs or browser exceptions');
  await writeFile(folder+'/results.json',JSON.stringify({passed:results,errors,external,requests:requests.length,productionFirebaseReads:0,productionChanges:0},null,2));
} finally {await browser?.close();server.close();}
