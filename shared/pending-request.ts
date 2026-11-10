// Share concurrent reads only. Completion and failure evict the promise so an
// explicit later refresh always reaches the server and permission checks.
const pending = new Map<string, Promise<unknown>>();
export function coalescePending<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request = Promise.resolve().then(load).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}
