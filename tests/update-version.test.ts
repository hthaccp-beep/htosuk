import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startSafeUpdates, type UpdateState} from '../app/htos/safe-updates.ts';

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 150; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Controller did not settle');
};

test('version-aware update controller with isolated browser services', async t => {
  async function fixture(run: (env: any) => Promise<void>, version: string | null = '8.61') {
    const originals = new Map(['navigator', 'document', 'window', 'fetch', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const sw = new EventTarget(), doc = new EventTarget(), win = new EventTarget();
    let replies = true, throwMessage = false, reloads = 0, frozen = false, activations = 0, hold = '', reloadFails = false;
    let activation: any;
    let serverVersion = version || '8.61', reads = 0;
    const storage = new Map<string,string>();
    const sessionStorage = {getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)};
    const worker = Object.assign(new EventTarget(), {
      state: 'installed',
      postMessage(data: any, ports: MessagePort[]) {
        if (throwMessage) throw new Error('worker gone');
        if (data.type === 'HTOS_RELEASE' && replies && version) ports[0].postMessage({version});
        if (data.type === 'HTOS_SAFE_ACTIVATE') {activations++; activation=data;}
      },
    });
    const registration = Object.assign(new EventTarget(), {waiting: worker as any, installing: null, update: async () => {}});
    Object.assign(sw, {register: async () => registration});
    Object.assign(doc, {visibilityState: 'visible'});
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {onLine: true, serviceWorker: sw}});
    Object.defineProperty(globalThis, 'document', {configurable: true, value: doc});
    Object.defineProperty(globalThis, 'window', {configurable: true, value: win});
    Object.defineProperty(globalThis, 'sessionStorage', {configurable:true,value:sessionStorage});
    Object.defineProperty(globalThis, 'fetch', {configurable: true, value: async () => {reads++; return {ok: true, json: async () => ({version: serverVersion})};}});
    let state: UpdateState | undefined;
    const controller = startSafeUpdates({loadedVersion: '8.60', hold: () => hold, signedIn: () => true,
      changed: next => {state = next;}, freeze: value => {frozen = value;}, reload: () => {reloads++;if(reloadFails)throw new Error('reload failed');}});
    try {
      await run({controller, registration, sw, worker, state: () => state, reloads: () => reloads,
        setVersion:(v:string)=>{serverVersion=v;}, reads:()=>reads, doc, win, storage,
        frozen: () => frozen, activations: () => activations, silence: () => {replies = false;},
        failMessages: () => {throwMessage = true;}, activation:()=>activation,setHold:(value:string)=>{hold=value;},failReload:()=>{reloadFails=true;}});
    } finally {
      controller.stop();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }

  await t.test('same worker/app version clears notice and cannot activate or reload', async () => {
    await fixture(async e => {
      await until(() => !e.state().checking);
      assert.equal(e.state().available, false); assert.equal(e.state().message, '');
      await e.controller.check(); await e.controller.apply();
      assert.equal(e.state().message, 'Your app is up to date — version 8.60.'); assert.equal(e.activations(), 0); assert.equal(e.reloads(), 0);
    }, '8.60');
  });
  await t.test('a genuinely different version keeps progress locked until the new page opens', async () => {
    await fixture(async e => {
      await until(() => !e.state().checking);
      assert.equal(e.state().available, true);
      await e.controller.apply(); assert.equal(e.activations(), 1); assert.equal(e.frozen(), true);
      e.registration.waiting = null; e.sw.dispatchEvent(new Event('controllerchange'));
      assert.equal(e.reloads(), 1); assert.equal(e.state().available, false);
      assert.equal(e.state().message, 'Update ready. Reloading HTOS…'); assert.equal(e.state().applying, true);assert.equal(e.state().reloading,true);
      await e.controller.apply();await e.controller.check();e.controller.later();
      assert.equal(e.activations(),1);assert.equal(e.reloads(),1);assert.equal(e.frozen(),true);assert.equal(e.state().deferred,false);
    });
  });
  await t.test('rapid repeated clicks start one probe and show immediate busy feedback',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);
      let finish:any, probes=0;
      globalThis.fetch=(()=>{probes++;return new Promise(resolve=>{finish=resolve;});}) as typeof fetch;
      const first=e.controller.apply();
      assert.equal(e.state().preparing,true);assert.match(e.state().message,/Checking/);
      await e.controller.apply();await until(()=>probes===1);
      assert.equal(e.state().applying,true);assert.equal(e.frozen(),true);
      await e.controller.apply();assert.equal(probes,1);
      finish({ok:true,json:async()=>({version:'8.61'})});await first;
      assert.equal(e.activations(),1);assert.equal(e.state().preparing,false);assert.equal(e.state().applying,true);
    });
  });
  await t.test('unfinished work releases busy feedback and never probes or activates',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);e.setHold('Save unfinished work first.');
      globalThis.fetch=(()=>{throw new Error('Probe must not run');}) as typeof fetch;
      await e.controller.apply();assert.equal(e.state().preparing,false);assert.equal(e.state().applying,false);assert.equal(e.state().message,'Save unfinished work first.');assert.equal(e.frozen(),false);assert.equal(e.activations(),0);
    });
  });
  await t.test('other-tab holds replace progress with the reason and permit a later retry',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);await e.controller.apply();
      const event=Object.assign(new Event('message'),{source:e.worker,data:{type:'HTOS_UPDATE_HELD',token:e.activation().token}});e.sw.dispatchEvent(event);
      assert.equal(e.state().applying,false);assert.equal(e.state().preparing,false);assert.equal(e.frozen(),false);assert.match(e.state().message,/other HTOS tabs/);assert.equal(e.reloads(),0);
      await e.controller.apply();assert.equal(e.activations(),2);
    });
  });
  await t.test('failed connection releases progress and preserves the old page',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);globalThis.fetch=(async()=>{throw new Error('offline');}) as typeof fetch;
      await e.controller.apply();assert.equal(e.state().preparing,false);assert.equal(e.state().applying,false);assert.equal(e.frozen(),false);assert.match(e.state().message,/could not connect/);assert.equal(e.reloads(),0);
    });
  });
  await t.test('failed reload releases the cover and gives a safe recovery instruction',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);await e.controller.apply();e.failReload();e.sw.dispatchEvent(new Event('controllerchange'));
      assert.equal(e.state().applying,false);assert.equal(e.state().reloading,false);assert.equal(e.frozen(),false);assert.match(e.state().message,/Reloading did not finish/);
    });
  });
  await t.test('a stalled activation times out without leaving the interface locked',async context=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);
      context.mock.timers.enable({apis:['setTimeout']});
      try {
        await e.controller.apply();assert.equal(e.state().applying,true);
        context.mock.timers.tick(15_000);
        assert.equal(e.state().applying,false);assert.equal(e.frozen(),false);assert.equal(e.reloads(),0);
        assert.match(e.state().message,/taking longer than expected/);
      } finally {context.mock.timers.reset();}
    });
  });
  await t.test('a stalled page reload times out with a recovery message',async context=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);
      context.mock.timers.enable({apis:['setTimeout']});
      try {
        await e.controller.apply();e.sw.dispatchEvent(new Event('controllerchange'));
        assert.equal(e.state().reloading,true);assert.equal(e.frozen(),true);
        context.mock.timers.tick(15_000);
        assert.equal(e.state().reloading,false);assert.equal(e.state().applying,false);assert.equal(e.frozen(),false);
        assert.equal(e.reloads(),1);assert.match(e.state().message,/Reloading did not finish/);
      } finally {context.mock.timers.reset();}
    });
  });
  await t.test('worker without version support is held rather than blindly activated', async () => {
    await fixture(async e => {await until(() => !e.state().checking); assert.equal(e.state().available, false); assert.match(e.state().message,/not yet verified/); await e.controller.apply(); assert.equal(e.activations(),0);}, null);
  });
  await t.test('worker disappearing clears a previous update or hold message', async () => {
    await fixture(async e => {
      await until(() => !e.state().checking); await e.controller.check();
      assert.ok(e.state().message); e.registration.waiting = null; e.setVersion('8.60'); await e.controller.check();
      e.sw.dispatchEvent(new Event('controllerchange'));
      assert.equal(e.state().available, false); assert.equal(e.state().message, '');
    });
  });
  await t.test('late version response after stop cannot publish or freeze the page', async () => {
    await fixture(async e => {
      e.controller.stop(); const before = e.state();
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(e.state(), before); assert.equal(e.frozen(), false); assert.equal(e.reloads(), 0);
    });
  });
  await t.test('stale response cannot label a replacement worker as already loaded', async () => {
    await fixture(async e => {
      e.setVersion('8.62'); e.registration.waiting = Object.assign(new EventTarget(), {postMessage: (_data: any, ports: MessagePort[]) => ports[0].postMessage({version: '8.62'})});
      await until(() => !e.state().checking); await e.controller.check();
      assert.equal(e.state().available, true);
    }, '8.60');
  });
  await t.test('manual check confirms current version with no waiting worker and does not freeze', async () => {
    await fixture(async e => {
      await until(() => !e.state().checking); e.registration.waiting = null; e.setVersion('8.60');
      await e.controller.check();
      assert.equal(e.state().message, 'Your app is up to date — version 8.60.');
      assert.equal(e.state().available, false); assert.equal(e.frozen(), false); assert.equal(e.reloads(), 0);
    });
  });
  await t.test('an update still downloading never produces an up-to-date confirmation', async () => {
    await fixture(async e => {
      await until(() => !e.state().checking); e.registration.waiting = null;
      e.registration.installing = {state: 'installing'};
      await e.controller.check();
      assert.equal(e.state().message, 'Downloading an update. Keep working while it finishes.');
    });
  });
  await t.test('failed check never produces an up-to-date confirmation', async () => {
    await fixture(async e => {
      await until(() => !e.state().checking);
      e.registration.update = async () => {throw new Error('offline');};
      await e.controller.check();
      assert.equal(e.state().message, 'Updates could not be checked. Keep working and try again when connected.');
    }, '8.60');
  });
  await t.test('manual click during the opening background check still receives confirmation', async () => {
    await fixture(async e => {
      assert.equal(e.state().checking, true);
      await e.controller.check();
      await until(() => !e.state().checking);
      assert.equal(e.state().message, 'Your app is up to date — version 8.60.');
    }, '8.60');
  });
  await t.test('manual downloading status becomes confirmation once the same-version worker finishes', async () => {
    await fixture(async e => {
      await until(() => !e.state().checking);
      e.registration.installing = {state: 'installing'};
      await e.controller.check();
      assert.equal(e.state().message, 'Downloading an update. Keep working while it finishes.');
      e.registration.installing = null;
      e.sw.dispatchEvent(new Event('controllerchange'));
      await until(() => e.state().message === 'Your app is up to date — version 8.60.');
      assert.equal(e.reloads(), 0); assert.equal(e.activations(), 0);
    }, '8.60');
  });
  await t.test('manifest newer than loaded app never gives a false current-version confirmation',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);e.registration.waiting=null;
      await e.controller.check();assert.match(e.state().message,/being prepared/);assert.equal(e.state().available,false);
      assert.equal(e.reloads(),0);assert.equal(e.frozen(),false);
    });
  });
  await t.test('release changes between download and activation cannot activate stale code',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);e.setVersion('8.62');await e.controller.apply();
      assert.equal(e.activations(),0);assert.equal(e.reloads(),0);assert.equal(e.frozen(),false);
      assert.match(e.state().message,/not yet verified/);
    });
  });
  await t.test('malformed version response never confirms success or reloads',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);globalThis.fetch=async()=>Response.json({version:''});
      await e.controller.check();assert.match(e.state().message,/could not be checked/);await e.controller.apply();assert.equal(e.activations(),0);
    });
  });
  await t.test('checks every minute only while visible, throttles focus, and resumes online',async context=>{
    context.mock.timers.enable({apis:['Date','setInterval'],now:100_000});
    try { await fixture(async e=>{
      await until(()=>!e.state().checking);const initial=e.reads();
      context.mock.timers.tick(59_000);assert.equal(e.reads(),initial);
      context.mock.timers.tick(1000);await until(()=>!e.state().checking);assert.equal(e.reads(),initial+1);
      e.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(e.reads(),initial+1);
      e.doc.visibilityState='hidden';context.mock.timers.tick(120_000);assert.equal(e.reads(),initial+1);
      e.doc.visibilityState='visible';e.doc.dispatchEvent(new Event('visibilitychange'));await until(()=>!e.state().checking);assert.equal(e.reads(),initial+2);
      e.win.dispatchEvent(new Event('online'));await until(()=>!e.state().checking);assert.equal(e.reads(),initial+3);
      e.controller.stop();context.mock.timers.tick(120_000);assert.equal(e.reads(),initial+3);
    },'8.60'); } finally {context.mock.timers.reset();}
  });
  await t.test('matching successful-update receipt confirms once and preserves unrelated drafts',async()=>{
    await fixture(async e=>{
      await until(()=>!e.state().checking);e.storage.set('draft','unchanged');
      e.storage.set('htos-update-target',JSON.stringify({version:'8.60',at:Date.now()}));await e.controller.check();
      assert.match(e.state().message,/up to date/);assert.equal(e.storage.has('htos-update-target'),false);assert.equal(e.storage.get('draft'),'unchanged');
      assert.equal(e.reloads(),0);
    },'8.60');
  });

});
