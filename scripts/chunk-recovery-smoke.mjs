// Real service workers, production cache configuration and recovery components.
// Only synthetic local releases are served. Firebase imports are prohibited.
import {build, transformWithEsbuild} from 'vite';
import {readFile, writeFile, mkdir, copyFile, readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.HTOS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(import.meta.dirname, '..').replaceAll('\\','/');
const out = path.resolve(root,'../../work/chunk-recovery-2026-10-20');
const results=[], external=[], requests=[];
const pass=name=>{results.push(name);console.log('PASS '+name);};
for (const mode of ['baseline','repaired']) for (const release of ['A','B']) {
  const dir=path.join(out,mode+release).replaceAll('\\','/');
  await mkdir(dir+'/public',{recursive:true});
  for(const file of ['htos-update-guard.js','icon.svg']) await copyFile(root+'/public/'+file,dir+'/public/'+file);
  await writeFile(dir+'/index.html','<!doctype html><html lang="en-GB"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>HTOS isolated recovery test</title></head><body><div id="root"></div><script type="module" src="fixture:entry"></script></body></html>');
  // A required static dependency with the exact name pattern previously excluded.
  await writeFile(dir+'/orderEmail.ts',`export const requiredValue='Order dependency ${release}';`);
  await writeFile(dir+'/Orders.tsx',`import React from 'react';import {requiredValue} from './orderEmail';export default function Orders(){return <h2>{requiredValue}</h2>}`);
  await writeFile(dir+'/Failed.tsx',`throw new Error('Synthetic screen failure ${release}'); export default function Failed(){return null}`);
  const source=await readFile(mode==='baseline'?out+'/before/vite.config.ts':root+'/vite.config.ts','utf8');
  const config=source
    .replace("from 'vite'",`from '${root}/node_modules/vite/dist/node/index.js'`)
    .replace("from '@vitejs/plugin-react'",`from '${root}/node_modules/@vitejs/plugin-react/dist/index.js'`)
    .replace("from 'vite-plugin-pwa'",`from '${root}/node_modules/vite-plugin-pwa/dist/index.js'`)
    .replace("import release from './app-version.json';",`const release={version:'${release}'};`);
  await writeFile(dir+'/vite.fixture.config.ts',config);
  const entry=`import React,{lazy,Suspense,useState} from 'react';import {createRoot} from 'react-dom/client';import {Routes,Route,useNavigate,useLocation} from 'react-router-dom';
    import {HtosRouter} from '${root}/app/htos/HtosRouter.tsx';import {AppRecovery} from '${root}/components/AppRecovery.tsx';
    import {SafeUpdates,requestUpdateCheck} from '${root}/app/htos/SafeUpdates.tsx';import {updateBlockerCount} from '${root}/shared/update-safety.ts';
    const Orders=lazy(()=>import('${dir}/Orders.tsx')),Failed=lazy(()=>import('${dir}/Failed.tsx'));
    window.blockerCount=updateBlockerCount;
    function HealthyForm(){const [value,setValue]=useState('');const navigate=useNavigate();return <><h2>Overview ready</h2><label>Sample route form<input aria-label="Sample route form" value={value} onChange={e=>setValue(e.target.value)}/></label><button onClick={()=>navigate('/?tab=sample')}>Change sample tab</button></>}
    function Demo(){const navigate=useNavigate(),location=useLocation();const [text,setText]=useState('');const [rootFailure,setRootFailure]=useState(false);if(rootFailure)throw Error('Synthetic outer failure');return <>
      <header><h1>Release ${release}</h1><button onClick={()=>navigate('/')}>Overview</button><button onClick={()=>navigate('/new-order')}>Place order</button><button onClick={()=>navigate('/orders')}>Fail read-only screen</button><button onClick={()=>setRootFailure(true)}>Fail workspace</button><button onClick={requestUpdateCheck}>Check for updates</button></header>
      <div id="htos-update-notice"/><SafeUpdates ready/>
      <label>Unfinished sample form<input aria-label="Unfinished sample form" value={text} onChange={e=>setText(e.target.value)}/></label>
      <main><AppRecovery resetKey={location.pathname+location.search} onOverview={()=>navigate('/')}><Suspense fallback={<p>Opening screen…</p>}><Routes><Route path="/" element={<HealthyForm/>}/><Route path="/new-order" element={<Orders/>}/><Route path="/orders" element={<Failed/>}/></Routes></Suspense></AppRecovery></main></>}
    createRoot(document.getElementById('root')).render(<HtosRouter><Demo/></HtosRouter>);`;
  const buildOptions={root:dir,configFile:dir+'/vite.fixture.config.ts',envDir:dir,publicDir:dir+'/public',logLevel:'error',css:{postcss:{plugins:[]}},
    resolve:{alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom','react-router-dom':root+'/node_modules/react-router-dom'}},
    plugins:[{name:'isolated-recovery',enforce:'pre',resolveId(id){if(id==='fixture:entry')return '\0entry';if(/(?:^|\/)store$/.test(id))return '\0store';if(/firebase/.test(id))throw Error('Firebase prohibited');},async load(id){if(id==='\0store')return `export const useAppStore={getState:()=>({currentUser:{id:'synthetic',role:'STAFF'},cart:{},manualCart:[]})};`;if(id==='\0entry')return (await transformWithEsbuild(entry,'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;}}],
    build:{outDir:dir+'/dist',emptyOutDir:true,rollupOptions:{output:{manualChunks:{orderEmail:[dir+'/orderEmail.ts']}}}}};
  await build(buildOptions);
  if(mode==='repaired'&&release==='B'){
    await writeFile(dir+'/vite.incomplete.config.ts',config.replace("globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']","globPatterns: ['**/*.{css,html}']"));
    await assert.rejects(()=>build({...buildOptions,configFile:dir+'/vite.incomplete.config.ts',build:{...buildOptions.build,outDir:dir+'/incomplete'}}),/Incomplete offline app code/);
    pass('Build fails if any required code is omitted from the offline cache');
  }
}

let served='baselineA', rejectDownload=false;
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;requests.push({served,path:pathname});
  if(rejectDownload&&pathname.startsWith('/assets/')){res.writeHead(503).end();return;}
  try{const file=pathname==='/'?'index.html':pathname.slice(1);if(file.includes('..'))throw Error();const body=await readFile(path.join(out,served,'dist',file));res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(body);}
  catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  async function open(mode){
    served=mode+'A';const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:900}});
    context.on('request',req=>{if(new URL(req.url()).origin!==base)external.push(req.url());});
    const page=await context.newPage();await page.clock.install();await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.getByLabel('Unfinished sample form').fill('Keep my unfinished form');
    await page.evaluate(()=>{localStorage.setItem('sample-draft','Keep my saved draft');sessionStorage.setItem('sample-session','Keep my session');});
    return {context,page};
  }
  {
    const {context,page}=await open('baseline');
    served='baselineB';await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
    await page.getByRole('button',{name:'Place order',exact:true}).click();await page.getByRole('heading',{name:'This screen could not open'}).waitFor();
    pass('Reproduced: old cache exclusions break an unopened order route after a deployment');
    await context.close();
  }
  {
    const {context,page}=await open('repaired');
    await page.getByLabel('Sample route form').fill('Keep form state across query changes');await page.getByRole('button',{name:'Change sample tab'}).click();assert.equal(await page.getByLabel('Sample route form').inputValue(),'Keep form state across query changes');await page.getByLabel('Sample route form').fill('');
    pass('Healthy forms retain their state when a tab or filter changes');
    served='repairedB';await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
    await page.getByRole('button',{name:'Place order',exact:true}).click();await page.getByRole('heading',{name:'Order dependency A'}).waitFor();
    assert.equal(await page.getByLabel('Unfinished sample form').inputValue(),'Keep my unfinished form');
    pass('Repaired: previous release opens its unused order route while the new release waits');
    await context.setOffline(true);await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Place order',exact:true}).click();await page.getByRole('heading',{name:'Order dependency A'}).waitFor();
    pass('Route and its document dependency remain usable offline');
    await context.setOffline(false);
    await page.getByRole('button',{name:'Update now',exact:true}).click();await page.clock.fastForward(61_000);
    assert.equal(await page.getByRole('heading',{level:1}).textContent(),'Release A');assert.equal(await page.getByLabel('Unfinished sample form').inputValue(),'Keep my unfinished form');
    pass('Manual and automatic updates preserve an unfinished form and the old release');
    await page.getByLabel('Unfinished sample form').fill('');
    await page.getByRole('button',{name:'Fail read-only screen'}).click();await page.getByRole('heading',{name:'This screen could not open'}).waitFor();
    assert.ok(await page.getByRole('button',{name:'Place order',exact:true}).isVisible());assert.equal(await page.evaluate(()=>window.blockerCount()),1);
    await page.getByRole('button',{name:'Update now',exact:true}).click();await page.clock.fastForward(61_000);assert.ok(await page.getByRole('heading',{name:'This screen could not open'}).isVisible());
    pass('A failed screen keeps navigation and update controls, and blocks automatic reload');
    let confirms=0;page.once('dialog',async dialog=>{confirms++;assert.match(dialog.message(),/unsaved fields may be lost/);await dialog.dismiss();});
    await page.getByRole('button',{name:'Refresh HTOS'}).click();assert.equal(confirms,1);assert.ok(await page.getByRole('heading',{name:'This screen could not open'}).isVisible());
    assert.equal(await page.evaluate(()=>localStorage.getItem('sample-draft')),'Keep my saved draft');assert.equal(await page.evaluate(()=>sessionStorage.getItem('sample-session')),'Keep my session');
    pass('Cancelled refresh keeps the tab, stored draft and session intact');
    for(const width of [1280,820,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.getByRole('button',{name:'Refresh HTOS'}).isVisible());await page.screenshot({path:out+`/recovery-${width}.png`,fullPage:true});}
    pass('Recovery actions fit desktop, tablet and narrow phone widths');
    await page.getByRole('button',{name:'Return to Overview'}).click();await page.getByRole('heading',{name:'Overview ready'}).waitFor();assert.equal(await page.evaluate(()=>window.blockerCount()),0);
    pass('Return to Overview releases only the recovery hold');
    await page.getByRole('button',{name:'Update now',exact:true}).click();await page.getByRole('heading',{name:'Release B',exact:true}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('sample-draft')),'Keep my saved draft');
    pass('Safe update succeeds from Overview and retains stored drafts');
    await page.getByRole('button',{name:'Fail workspace'}).click();await page.getByRole('heading',{name:'This screen could not open'}).waitFor();assert.equal(await page.getByText('Unexpected Application Error!').count(),0);
    pass('Root router failures also show recovery rather than a developer stack trace');
    await context.close();
  }
  {
    const {context,page}=await open('repaired');served='repairedB';rejectDownload=true;
    await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.getByText('The update could not finish downloading. Your work is unchanged. Check again when connected.').waitFor();rejectDownload=false;
    assert.equal(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting),false);
    await page.getByRole('button',{name:'Place order',exact:true}).click();await page.getByRole('heading',{name:'Order dependency A'}).waitFor();
    pass('Incomplete update downloads never replace the working release');await context.close();
  }
  const sw=await readFile(root+'/dist/sw.js','utf8'),files=(await readdir(root+'/dist/assets')).filter(f=>/\.(js|css)$/.test(f));
  for(const file of files)assert.ok(sw.includes('assets/'+file),'Production asset missing from precache: '+file);
  pass(`Production build precaches all ${files.length} JavaScript and CSS files`);
  const routing=JSON.parse(await readFile(root+'/vercel.json','utf8'));const fallback=new RegExp('^'+routing.rewrites.at(-1).source+'$');
  assert.equal(fallback.test('/assets/missing.js'),false);assert.equal(fallback.test('/settings'),true);assert.equal(fallback.test('/'),true);
  pass('Hosting rewrite excludes missing assets while retaining app navigation');
  assert.deepEqual(external,[]);assert.ok(requests.every(req=>!req.path.startsWith('/api/')));pass('Zero external requests, Firebase reads or business API calls');
  await writeFile(out+'/results.json',JSON.stringify({results,external,requests:requests.length,productionCodeFiles:files.length},null,2));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
