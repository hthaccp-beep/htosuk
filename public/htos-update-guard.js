/* Runs in the waiting worker. Never touches business storage or the network.
 * A second open tab (including an older release) prevents activation. This
 * avoids replacing/deleting its cached code while it may contain unsaved work.
 */
self.addEventListener('message', event => {
  if (event.data?.type !== 'HTOS_SAFE_ACTIVATE' || !event.source?.id) return;
  const source = event.source;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const scope = self.registration.scope;
    const scoped = windows.filter(client => client.url.startsWith(scope));
    if (scoped.length !== 1 || scoped[0].id !== source.id) {
      source.postMessage({type: 'HTOS_UPDATE_HELD', token: event.data.token});
      return;
    }
    await self.skipWaiting();
  })());
});
