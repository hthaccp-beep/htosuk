import React, {useRef, useState} from 'react';
import './resizable-columns.css';
export type ColumnDefinition = readonly [label: string, width: number, minimum: number, maximum: number];
export type ColumnDefinitions = Record<string, ColumnDefinition>;
type Widths = Record<string, number>;
const defaults = (definitions: ColumnDefinitions) => Object.fromEntries(Object.entries(definitions).map(([key, value]) => [key, value[1]])) as Widths;
const clamp = (definitions: ColumnDefinitions, key: string, value: number) => Math.round(Math.max(definitions[key][2], Math.min(definitions[key][3], value)));
function loadWidths(definitions: ColumnDefinitions, storageKey: string): Widths {
 const widths = defaults(definitions);
 try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
  for (const key of Object.keys(widths)) {
   if (typeof saved?.[key] === 'number' && Number.isFinite(saved[key])) widths[key] = clamp(definitions, key, saved[key]);
  }
 } catch { /* Browser storage may be unavailable; defaults still work. */ }
 return widths;
}
export function useColumnWidths(definitions: ColumnDefinitions, storageKey: string) {
 const [widths, setWidths] = useState(() => loadWidths(definitions, storageKey));
 const current = useRef(widths);
 const persist = () => {try {localStorage.setItem(storageKey, JSON.stringify(current.current));} catch { /* Resizing remains available without storage. */ }};
 const resize = (key: string, value: number) => {
  if (!Number.isFinite(value)) return;
  current.current = {...current.current, [key]: clamp(definitions, key, value)};
  setWidths(current.current);
 };
 const reset = () => {current.current = defaults(definitions); setWidths(current.current); persist();};
 return {widths, resize, persist, reset};
}

export function ResizableColumnHeader({column, definition, width, resize, persist, pinnedClass}: {
 column: string; definition: ColumnDefinition; pinnedClass?: string; width: number; resize: (key: string, width: number) => void; persist: () => void;
}) {
 const [label, defaultWidth, min, max] = definition;
 const drag = useRef<{id: number; x: number; width: number} | null>(null);
 const finish = () => {if (drag.current) {drag.current = null; persist();}};
 return <th scope="col" className={pinnedClass}>
  <span className="h-column-label">{label}{pinnedClass && <small>Fixed</small>}</span>
  <div className="h-column-resize" role="separator" tabIndex={0} aria-label={`Resize ${label} column`}
   aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
   title="Drag to resize. Use arrow keys, or double-click to reset."
   onPointerDown={e => {if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = {id:e.pointerId, x:e.clientX, width};}}
   onPointerMove={e => {const start = drag.current; if (start?.id === e.pointerId) resize(column, start.width + e.clientX - start.x);}}
   onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
   onDoubleClick={() => {resize(column, defaultWidth); persist();}}
   onKeyDown={e => {
    const next = e.key === 'ArrowRight' ? width + 10 : e.key === 'ArrowLeft' ? width - 10 : e.key === 'Home' ? min : e.key === 'End' ? max : null;
    if (next !== null) {e.preventDefault(); resize(column, next); persist();}
   }}/>
 </th>;
}
