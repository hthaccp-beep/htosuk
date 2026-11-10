import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import Papa from 'papaparse';
import {supplierCatalogImport} from '../server/supplier-catalog-service.ts';
import {catalogueErrorPayload} from '../shared/catalogue-errors.ts';

const output=resolve(process.env.HTOS_CSV_TEST_OUTPUT||'../../work/csv-flow-2026-10-29'),staticRoot=resolve(output,'preview');
await mkdir(output,{recursive:true});
if(!process.argv.includes('--no-build'))await build({configFile:false,envDir:resolve(output,'empty-env'),plugins:[react(),{
 name:'offline-firebase',enforce:'pre',resolveId(source){if(/(?:^|\/)firebase-config(?:\.ts)?$/.test(source))return '\0offline-firebase';},
 load(id){if(id==='\0offline-firebase')return 'export const db=null,auth=null,configurationError="Offline test",firebaseConfig={};';}
}],build:{target:'esnext',outDir:staticRoot,emptyOutDir:true,rollupOptions:{input:resolve('tests/csv-flow-preview.html')}}});

const seed=()=>new Map<string,any>(Object.entries({
 'users/owner':{id:'owner',displayName:'Test owner',role:'CREATOR',active:true},
 'settings/role_permissions':{map:{}},'suppliers/s':{id:'s',name:'Test supplier',active:true},
 'categories/c':{id:'c',name:'Food',supplierId:'s',active:true,displayOrder:1},
 'branches/b':{id:'b',name:'Test branch',code:'B',active:true},
 'products/p':{id:'p',supplierId:'s',name:'Test rice',itemCode:'001',categoryId:'c',active:true,casePrice:10,packPrice:2,displayOrder:1,allowedBranchIds:[]},
 'products/inactive':{id:'inactive',supplierId:'s',name:'Inactive noodles',itemCode:'002',categoryId:'c',active:false,displayOrder:2,allowedBranchIds:[]},
 'products/missing':{id:'missing',supplierId:'s',name:'Kept product',itemCode:'003',categoryId:'c',active:true,displayOrder:3,allowedBranchIds:[]},
 'products/deleted':{id:'deleted',supplierId:'s',name:'Deleted product',itemCode:'004',categoryId:'c',active:false,removedAt:'2026-01-01',displayOrder:4,allowedBranchIds:[]},
 'products/other':{id:'other',supplierId:'other',name:'Other supplier',itemCode:'001',active:true,allowedBranchIds:[]},
 'orders/history':{id:'history',items:[{productId:'p',productNameSnapshot:'Test rice',casePriceSnapshot:7}]}
}));
let data=seed(),calls:any[]=[],failCommit=false;
const reads:string[]=[];
const snap=(path:string)=>({id:path.split('/')[1],exists:data.has(path),data:()=>structuredClone(data.get(path))});
const records=(name:string)=>[...data].filter(([k])=>k.startsWith(name+'/')).map(([,v])=>structuredClone(v));
const db={collection:(name:string)=>({name,doc:(id:string)=>({path:`${name}/${id}`}),where:(key:string,_op:string,value:string)=>({name,key,value})}),runTransaction:async(fn:any)=>{
 const writes:any[]=[];
 const result=await fn({get:async(ref:any)=>{reads.push(ref.path||ref.name);return ref.path?snap(ref.path):{docs:[...data.keys()].filter(k=>k.startsWith(ref.name+'/')&&(!ref.key||data.get(k)[ref.key]===ref.value)).map(snap)};},
 create:(ref:any,value:any)=>writes.push({create:true,path:ref.path,value}),update:(ref:any,value:any)=>writes.push({path:ref.path,value})});
 if(failCommit&&writes.length){failCommit=false;throw new Error('Synthetic connection failure. Retry this review.');}
 for(const w of writes)if(w.create&&data.has(w.path))throw new Error('Duplicate create');
 for(const w of writes)data.set(w.path,w.create?structuredClone(w.value):{...data.get(w.path),...structuredClone(w.value)});
 return result;
}};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url!,'http://localhost');
 const json=(value:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 try{
  if(url.pathname==='/test-reset'){data=seed();calls=[];failCommit=url.searchParams.has('fail');return json({ok:true});}
  if(url.pathname==='/test-state')return json({currentUser:data.get('users/owner'),products:records('products'),suppliers:records('suppliers'),categories:records('categories'),branches:records('branches'),rolePermissions:{},orders:records('orders')});
  if(url.pathname==='/test-import'){
   let body='';for await(const part of req)body+=part;
   const input=JSON.parse(body);calls.push(structuredClone(input));
   try{return json(await supplierCatalogImport(db,'owner',input));}catch(error){return json({error:(error as Error).message,...catalogueErrorPayload(error)},400);}
  }
  const path=resolve(staticRoot,'.'+decodeURIComponent(url.pathname==='/'?'/tests/csv-flow-preview.html':url.pathname));
  if(!path.startsWith(staticRoot+sep))return json({error:'Forbidden'},403);
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'} as any)[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const runtimeRequire=createRequire('C:/Users/allan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=runtimeRequire('playwright');
const results:string[]=[],blocked:string[]=[],errors:string[]=[];
let browser:any;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,serviceWorkers:'block'});
 await context.route('**/*',(route:any)=>{const url=route.request().url();if(url.startsWith(origin+'/'))return route.continue();blocked.push(url);return route.abort();});
 const page=await context.newPage();page.on('pageerror',(e:Error)=>errors.push(e.message));
 const reset=async(fail=false)=>{await fetch(origin+'/test-reset'+(fail?'?fail=1':''));await page.goto(origin);await page.getByRole('button',{name:'Upload CSV',exact:true}).waitFor();};
 const upload=async(csv:string)=>{await page.getByLabel('Upload edited HTOS catalogue').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});};
 const review=async()=>{
  await page.getByRole('heading',{name:'Review CSV · Test supplier'}).waitFor();
  if(await page.getByRole('button',{name:'Check changes',exact:true}).count()){
   assert.equal(await page.getByRole('button',{name:/Confirm & save/}).count(),0);
   if(await page.getByLabel('New product category',{exact:true}).count())await page.getByLabel('New product category',{exact:true}).selectOption('c');
   if(await page.getByLabel('New product branch availability',{exact:true}).count())await page.getByLabel('New product branch availability',{exact:true}).selectOption('ALL');
   await page.getByRole('button',{name:'Check changes',exact:true}).click();
   await page.getByRole('button',{name:'Check changes',exact:true}).waitFor({state:'detached'});
  }
 };
 const confirm=async()=>{await page.getByRole('checkbox',{name:/I checked/}).check();await page.getByRole('button',{name:/Confirm & save/}).click();};
 const unchangedHistory=()=>assert.deepEqual(data.get('orders/history'),seed().get('orders/history'));

 await reset();assert.equal(await page.getByLabel('CSV action',{exact:true}).inputValue(),'catalogue');
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
 const download=await downloadEvent;const csv=await readFile(await download.path(),'utf8');
 const rows=Papa.parse<any>(csv,{header:true,skipEmptyLines:true}).data;
 assert.deepEqual(rows.map(r=>r.SystemID),['p','inactive','missing']);assert.equal(rows[1].Active,'FALSE');
 results.push('Export contains active and inactive products; excludes deleted and other-supplier records.');
 await upload(csv);await review();await page.getByText('No changes.',{exact:true}).waitFor();assert.equal(calls.length,1);assert.equal(calls[0].mode,'catalogue');assert.equal(calls[0].removeMissing,false);assert.equal(await page.getByRole('button',{name:/Confirm & save/}).count(),0);
 results.push('Owner defaults to Add and update; unchanged full export needs no save.');

 await reset();
 const mixed='SystemID,ItemCode,Name,Category,Active,PriceBox,SupplierID\np,001,Updated rice,Food,TRUE,12,\n,NEW,New noodles,Food,TRUE,,\n,,Unique uncoded product,Food,TRUE,,';
 await upload(mixed);await review();assert.equal(calls.filter(c=>c.action==='catalog-commit').length,0);
 await page.getByText('3 rows with no SupplierID use the selected supplier:',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm & save',exact:true}).isDisabled(),true);
 await page.screenshot({path:resolve(output,'review-desktop.png'),fullPage:true});
 await confirm();await page.getByRole('heading',{name:'Product list saved'}).waitFor();
 assert.equal(data.get('products/missing').active,true);assert.equal(data.get('products/p').casePrice,12);
 const created=records('products').filter(p=>p.id.startsWith('ci_'));assert.equal(created.length,2);assert.ok(created.every(p=>p.supplierId==='s'&&p.casePrice===undefined));unchangedHistory();
 results.push('Blank suppliers inherit selection; new coded/uncoded IDs assigned only on confirmation; omissions/history preserved.');

 await reset();await upload('SystemID,ItemCode,Name,Active,SupplierID\n,002,Reactivated noodles,TRUE,');await review();await confirm();await page.getByRole('heading',{name:'Product list saved'}).waitFor();
 assert.equal(data.get('products/inactive').active,true);assert.equal(records('products').length,5);unchangedHistory();
 results.push('Inactive supplier-code match updates/reactivates the existing ID without duplication.');

 await reset();await upload('SystemID,ItemCode,Name,Active,SupplierID\n,NEW,New product,TRUE,foreign');await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/SupplierID does not match/);assert.equal(calls.length,0);
 results.push('Foreign supplier is rejected in the browser before any server call.');
 await reset();await upload('SystemID,ItemCode,Name,Active,SupplierID\np,001,Test rice,TRUE,\n,001,Second pack,TRUE,');await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/Rows 2 and 3/);assert.equal(calls.filter(c=>c.action==='catalog-commit').length,0);unchangedHistory();
 results.push('Duplicate CSV identities identify both rows and prevent all saves.');

 await reset();await page.getByLabel('CSV action',{exact:true}).selectOption('replace-catalogue');
 await upload('SystemID,ItemCode,Name,Active,SupplierID\np,001,Test rice,TRUE,s');await review();assert.equal(calls[0].mode,'replace-catalogue');assert.equal(calls[0].removeMissing,true);
 await page.getByRole('button',{name:'Cancel upload',exact:true}).click();assert.equal(await page.getByLabel('CSV action',{exact:true}).inputValue(),'catalogue');assert.equal(data.get('products/missing').active,true);
 results.push('Replacement requires explicit mode selection; cancel keeps records and restores the default.');

 await reset(true);await upload(mixed);await review();await confirm();await page.getByRole('alert').waitFor();assert.equal(records('products').length,5);assert.equal(data.get('products/p').name,'Test rice');
 await page.getByRole('button',{name:'Confirm & save',exact:true}).click();await page.getByRole('heading',{name:'Product list saved'}).waitFor();
 const commits=calls.filter(c=>c.action==='catalog-commit');assert.equal(commits.length,2);assert.equal(commits[0].requestId,commits[1].requestId);assert.equal(records('products').length,7);unchangedHistory();
 results.push('Failed save leaves synthetic records untouched; retry keeps its request ID and creates once.');

 await reset();await page.setViewportSize({width:390,height:844});await upload(mixed);await review();
 await page.screenshot({path:resolve(output,'review-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 await page.getByRole('button',{name:'Cancel upload',exact:true}).click();assert.equal(records('products').length,5);
 results.push('Mobile review fits the viewport; cancelling saves nothing.');
 const multipleErrors='SystemID,ItemCode,Name,Active,PriceBox,PriceUnit,SupplierID,BranchScope,B\np,001,Test rice,maybe,bad,-1,s,ALL,No\n,NEW,New food,TRUE,bad,,foreign,ALL,Yes';
 await reset();await page.setViewportSize({width:1440,height:1000});await upload(multipleErrors);
 await page.getByRole('heading',{name:'6 issues found across 2 rows'}).waitFor();
 assert.equal(await page.getByRole('region',{name:'All detected file issues'}).locator('li').count(),6);
 assert.equal(calls.length,0);assert.deepEqual(data,seed());
 assert.equal(await page.getByRole('button',{name:/Confirm & save/}).count(),0);
 await page.screenshot({path:resolve(output,'all-issues-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Retry check',exact:true}).click();
 await page.getByRole('heading',{name:'6 issues found across 2 rows'}).waitFor();
 assert.equal(calls.length,0);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:resolve(output,'all-issues-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 await page.getByRole('region',{name:'All detected file issues'}).focus();
 assert.equal(await page.getByRole('region',{name:'All detected file issues'}).evaluate((el:any)=>el===document.activeElement),true);
 results.push('All six independent issues across two rows show at once on desktop and mobile; retry reads no catalogue, saves nothing, and the list is keyboard accessible.');
 await upload('SystemID,ItemCode,Name,Active,PriceBox,SupplierID\np,001,Test rice,TRUE,10,s');await review();
 assert.equal(await page.getByRole('region',{name:'All detected file issues'}).count(),0);
 assert.deepEqual(data,seed());
 results.push('Choosing a corrected file clears the old error list and continues to review without saving.');
 await reset();await upload('SystemID,ItemCode,Name,Active\nunknown,NEW,Unknown,TRUE\nother,OTHER,Foreign,TRUE\np,001,Valid change,TRUE');
 await page.getByRole('heading',{name:'2 issues found across 2 rows'}).waitFor();
 assert.equal(await page.getByRole('region',{name:'All detected file issues'}).locator('li').count(),2);
 assert.equal(calls.length,1);assert.deepEqual(data,seed());
 results.push('Server-side catalogue issues survive the API response and show every invalid ID together; valid rows are not partially saved.');
 await reset();await upload('SystemID,ItemCode,Name,Active\np,001,Rice\nq,002,Noodles,TRUE,extra\nr,003,Other,TRUE');
 await page.getByRole('heading',{name:'2 issues found across 2 rows'}).waitFor();
 assert.equal(calls.length,0);assert.deepEqual(data,seed());
 await page.getByRole('button',{name:'Cancel upload',exact:true}).click();
 await page.getByRole('button',{name:'Upload CSV',exact:true}).waitFor();
 results.push('All malformed row lengths are shown together; structural failures never reach the server and cancellation clears the report.');

 await reset();await page.setViewportSize({width:1440,height:1000});await upload('SystemID,Name,Active\n,New tea,TRUE');
 await page.getByLabel('New product category',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Check changes',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:/Confirm & save/}).count(),0);
 await page.screenshot({path:resolve(output,'new-product-choices-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 await page.screenshot({path:resolve(output,'new-product-choices-mobile.png'),fullPage:true});
 await page.getByLabel('New product category',{exact:true}).selectOption('c');
 await page.getByLabel('New product branch availability',{exact:true}).selectOption('SELECTED');
 assert.equal(await page.getByRole('button',{name:'Check changes',exact:true}).isDisabled(),true);
 await page.getByLabel('B — Test branch',{exact:true}).check();
 await page.getByRole('button',{name:'Check changes',exact:true}).click();await page.getByRole('button',{name:'Check changes',exact:true}).waitFor({state:'detached'});
 await page.getByText('Review complete product order · 4 products',{exact:true}).click();
 await confirm();await page.getByRole('heading',{name:'Product list saved'}).waitFor();
 const newTea=records('products').find(p=>p.name==='New tea');assert.deepEqual(newTea.allowedBranchIds,['b']);assert.equal(newTea.categoryId,'c');assert.equal(newTea.cataloguePosition,4);assert.equal(newTea.casePrice,undefined);unchangedHistory();
 results.push('Missing new category/branch choices block saving; selected branches are explicit; mobile fits and new unknown-price product appends after confirmation.');

 await reset();await page.setViewportSize({width:1440,height:1000});
 await page.getByText('File guide',{exact:true}).click();
 await page.getByLabel('Use CSV row order',{exact:true}).check();
 await upload('CSVVersion,SystemID,Position,Active\n2,missing,3,TRUE\n2,p,1,TRUE');await review();
 await page.getByText('Review complete product order · 3 products',{exact:true}).click();
 await page.screenshot({path:resolve(output,'row-order-review.png'),fullPage:true});
 await confirm();await page.getByRole('heading',{name:'Product list saved'}).waitFor();
 assert.equal(data.get('products/missing').cataloguePosition,1);assert.equal(data.get('products/p').cataloguePosition,2);assert.equal(data.get('products/inactive').cataloguePosition,3);unchangedHistory();
 results.push('Use CSV row order puts file rows first and retains omitted inactive products after them, without changing history.');

 await page.goto(origin+'/?view=catalogue#catalogue');
 await page.getByLabel('Catalogue supplier',{exact:true}).selectOption('s');
 await page.getByRole('button',{name:'Expand All',exact:true}).click();
 assert.deepEqual(await page.getByRole('button',{name:/^Edit /}).evaluateAll((els:any[])=>els.map(e=>e.getAttribute('aria-label'))),['Edit Kept product','Edit Test rice']);
 await page.getByLabel('Show inactive products',{exact:true}).check();
 assert.deepEqual(await page.getByRole('button',{name:/^Edit /}).evaluateAll((els:any[])=>els.map(e=>e.getAttribute('aria-label'))),['Edit Kept product','Edit Test rice','Edit Inactive noodles']);
 await page.getByText('Position 3',{exact:true}).waitFor();
 await page.screenshot({path:resolve(output,'catalogue-order.png'),fullPage:true});
 results.push('Actual catalogue component follows saved CSV sequence; inactive toggle retains positions and no raw 9999 ranks are displayed.');
 assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);assert.equal(reads.some(r=>r.startsWith('orders')),false);
 results.push('Zero external requests, Firebase connections, order reads or browser exceptions.');
 await writeFile(resolve(output,'browser-results.json'),JSON.stringify({passed:results.length,results,blocked,errors,syntheticServiceReads:reads.length},null,2));
 console.log(JSON.stringify({passed:results.length,results},null,2));
}catch(error){await writeFile(resolve(output,'browser-failure.json'),JSON.stringify({error:String(error),results,blocked,errors},null,2));throw error;}
finally{await browser?.close();await new Promise<void>(done=>server.close(()=>done()));}
