// In-memory only: no business data or credentials are stored here.
const active = new Set<symbol>();
const listeners = new Set<() => void>();
export const pendingWorkCount = () => active.size;
export function subscribePendingWork(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function beginPendingWork() {
  const id = Symbol();
  active.add(id);
  listeners.forEach(listener => listener());
  return () => {
    if (active.delete(id)) listeners.forEach(listener => listener());
  };
}
