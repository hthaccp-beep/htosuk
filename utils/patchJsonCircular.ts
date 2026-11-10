// Protects the runtime from "Uncaught TypeError: Converting circular structure to JSON"
// which can occur when circular objects (such as Firestore's internal WebChannel/EventTarget)
// are logged, synced, or passed to devtools / iframe serialization bridges.

function createSafeReplacer(customReplacer?: any) {
  const seen = new WeakSet();
  return function (this: any, key: string, val: any) {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    if (typeof customReplacer === 'function') {
      return customReplacer.call(this, key, val);
    }
    if (Array.isArray(customReplacer)) {
      if (key === '' || customReplacer.includes(key)) return val;
      return undefined;
    }
    return val;
  };
}

// 1. Monkey-patch JSON.stringify to handle circular references safely
if (typeof JSON !== 'undefined' && JSON.stringify) {
  const originalStringify = JSON.stringify;
  (JSON as any).stringify = function (value: any, replacer?: any, space?: any) {
    try {
      return originalStringify(value, createSafeReplacer(replacer), space);
    } catch (err: any) {
      if (err instanceof TypeError && String(err.message || '').toLowerCase().includes('circular')) {
        try {
          return originalStringify(value, createSafeReplacer(), space);
        } catch {
          return '"[Circular]"';
        }
      }
      throw err;
    }
  };
}

// 2. Protect console.error and console.warn from transmitting raw circular objects to devtools / iframe postMessage hooks
if (typeof console !== 'undefined') {
  const sanitize = (arg: any) => {
    if (typeof arg !== 'object' || arg === null) return arg;
    if (arg instanceof Error) return arg.message || String(arg);
    try {
      JSON.stringify(arg);
      return arg;
    } catch {
      try {
        return String(arg);
      } catch {
        return '[Circular Object]';
      }
    }
  };

  const origError = console.error;
  console.error = function (...args: any[]) {
    try {
      origError.apply(console, args.map(sanitize));
    } catch {
      origError.apply(console, args.map(a => typeof a === 'string' ? a : String(a)));
    }
  };

  const origWarn = console.warn;
  console.warn = function (...args: any[]) {
    try {
      origWarn.apply(console, args.map(sanitize));
    } catch {
      origWarn.apply(console, args.map(a => typeof a === 'string' ? a : String(a)));
    }
  };
}

// 3. Catch unhandled circular errors at window level
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event?.message && String(event.message).toLowerCase().includes('circular structure to json')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    if (event?.reason?.message && String(event.reason.message).toLowerCase().includes('circular structure to json')) {
      event.preventDefault();
    }
  });
}

export {};
