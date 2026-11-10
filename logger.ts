
export type LogType = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  message: string;
}

const listeners: Set<() => void> = new Set();
let logs: LogEntry[] = [];
const MAX_LOGS = 200;

function safeStringify(obj: any): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj === 'string') return obj;
  if (obj instanceof Error) return obj.message || String(obj);
  
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  } catch {
    try {
      return String(obj);
    } catch {
      return '[Unserializable Object]';
    }
  }
}

export const addLog = (type: LogType, message: any) => {
  const msgStr = safeStringify(message);
  
  // Mirror to console for standard debugging
  if (type === 'error') console.error(msgStr);
  else if (type === 'warn') console.warn(msgStr);
  else console.log(`[Log] ${msgStr}`);

  const entry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString(),
    type,
    message: msgStr
  };
  
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.pop();
  
  listeners.forEach(l => l());
};

export const getLogs = () => logs;
export const clearLogs = () => { logs = []; listeners.forEach(l => l()); };
export const subscribeLogs = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
