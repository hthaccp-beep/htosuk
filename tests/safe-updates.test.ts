import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {protectUpdate, updateBlockerCount, updateHold, type UpdateSafety} from '../shared/update-safety.ts';

const clean: UpdateSafety = {ready:true,signedIn:true,path:'/',pending:0,drafts:false,protectedWork:0,editorOpen:false,enteredText:false};
test('updates are safe on the idle overview for any role, with no role or price access changes', () => {
  assert.equal(updateHold(clean),'');
  assert.equal(updateHold({...clean,signedIn:false}), '');
});
test('every unfinished-work signal independently prevents automatic and manual reload', () => {
  for (const patch of [{ready:false},{pending:1},{drafts:true},{protectedWork:1},{editorOpen:true},{enteredText:true},{path:'/new-order'},{path:'/settings'},{path:'/checks'},{path:'/unknown'}])
    assert.ok(updateHold({...clean,...patch}),JSON.stringify(patch));
});
test('nested work protection is released independently and cleanup is idempotent', () => {
  const first=protectUpdate(), second=protectUpdate();
  assert.equal(updateBlockerCount(),2); first(); first();
  assert.equal(updateBlockerCount(),1); second(); assert.equal(updateBlockerCount(),0);
});
test('only a mounted ready Team list opts Settings into safe updating', () => {
  assert.equal(updateHold({...clean,path:'/settings',teamListReady:true}), '');
  for (const patch of [{teamListReady:false},{ready:false},{pending:1},{drafts:true},{protectedWork:1},{editorOpen:true},{enteredText:true}])
    assert.ok(updateHold({...clean,path:'/settings',teamListReady:true,...patch}),JSON.stringify(patch));
  assert.ok(updateHold({...clean,path:'/new-order',teamListReady:true}));
  assert.ok(updateHold({...clean,path:'/unknown',teamListReady:true}));
});
async function workerCheck(clients: {id:string;url:string}[], sourceId='this-tab') {
  let handler: (event:any)=>void = ()=>{};
  let active=0, task=Promise.resolve(); const messages:any[]=[];
  vm.runInNewContext(readFileSync(new URL('../public/htos-update-guard.js',import.meta.url),'utf8'),{
    self:{addEventListener:(_name:string,fn:any)=>handler=fn,registration:{scope:'https://test.invalid/'},
      clients:{matchAll:async()=>clients},skipWaiting:async()=>{active++;}},
  });
  handler({data:{type:'HTOS_SAFE_ACTIVATE',token:'sample'},source:{id:sourceId,postMessage:(value:any)=>messages.push(value)},waitUntil:(promise:Promise<void>)=>task=promise});
  await task; return {active,messages};
}
test('waiting worker activates only for the requesting tab when it is the only HTOS tab', async () => {
  assert.equal((await workerCheck([{id:'this-tab',url:'https://test.invalid/#/'}])).active,1);
});
test('an older or busy second tab prevents activation and receives no forced reload', async () => {
  const result=await workerCheck([{id:'this-tab',url:'https://test.invalid/#/'},{id:'old-tab',url:'https://test.invalid/#/new-order'}]);
  assert.equal(result.active,0); assert.equal(result.messages[0].type,'HTOS_UPDATE_HELD');
});
test('missing or mismatched requesting client cannot activate a waiting worker', async () => {
  assert.equal((await workerCheck([])).active,0);
  assert.equal((await workerCheck([{id:'another-tab',url:'https://test.invalid/'}])).active,0);
});
