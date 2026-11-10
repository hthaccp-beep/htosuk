import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ManualOrderItem } from '../../../types';

interface CustomItemsProps {
  items: ManualOrderItem[];
  maxItems: number;
  onAdd: () => void;
  onChange: (index: number, field: keyof ManualOrderItem, value: string | number) => void;
  onRemove: (index: number) => void;
}

export const CustomItems: React.FC<CustomItemsProps> = ({ items, maxItems, onAdd, onChange, onRemove }) => {
  return (
    <div className="mt-8 px-2 md:px-4 mb-24">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-extrabold text-gray-900 tracking-tight">
            Custom Items
          </h3>
          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full border border-gray-200 shadow-2xs">
            {items.length}/{maxItems}
          </span>
        </div>

        {items.length < maxItems && (
          <button
            type="button"
            onClick={onAdd}
            className="text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100/80 text-xs sm:text-sm font-bold flex items-center px-3.5 py-1.5 rounded-xl transition-all border border-brand-200/60 shadow-2xs active:scale-95"
          >
            <Plus size={16} className="mr-1 stroke-[2.5]" /> Add Custom
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {items.map((item, idx) => {
          const hasCase = (item.caseQty || 0) > 0;
          const hasPack = (item.packQty || 0) > 0;
          const hasQty = hasCase || hasPack;

          return (
            <div
              key={item.id || idx}
              className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3 sm:p-3.5 rounded-2xl border transition-all duration-200 gap-3 ${
                hasQty
                  ? 'border-brand-300 bg-amber-50/20 shadow-xs'
                  : 'border-gray-200 bg-white hover:border-gray-300 shadow-2xs'
              }`}
            >
              {/* Product description / name input */}
              <div className="flex-1 min-w-0 pr-1">
                <input
                  type="text"
                  placeholder="Enter custom item description..."
                  className="w-full bg-transparent border-b border-dashed border-gray-300 focus:border-brand-500 text-sm sm:text-base font-bold text-gray-900 outline-none placeholder-gray-400 py-1.5 transition-colors"
                  value={item.description}
                  onChange={(e) => onChange(idx, 'description', e.target.value)}
                />
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block mt-1">
                  Custom Order Item
                </span>
              </div>

              {/* Quantities (Box & Unit) */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 self-end sm:self-center">
                {/* Box Quantity Input */}
                <div
                  className={`relative w-[52px] sm:w-[58px] h-[44px] sm:h-[48px] rounded-xl border flex flex-col items-center justify-between py-1 px-0.5 select-none shrink-0 transition-all ${
                    hasCase
                      ? 'border-brand-500 bg-brand-50/70 text-brand-900 ring-2 ring-brand-100 shadow-2xs'
                      : 'border-gray-200/90 bg-slate-50/80 hover:bg-white hover:border-gray-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 focus-within:bg-white shadow-2xs'
                  }`}
                >
                  <span
                    className={`text-[8.5px] sm:text-[9px] font-extrabold uppercase tracking-wider leading-none pt-0.5 pointer-events-none transition-colors ${
                      hasCase ? 'text-brand-600' : 'text-gray-500'
                    }`}
                  >
                    BOX
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                    value={hasCase ? item.caseQty : ''}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^0-9]/g, '');
                      onChange(idx, 'caseQty', clean ? parseInt(clean, 10) : 0);
                    }}
                    onFocus={(e) => e.target.select()}
                    className={`w-full min-w-0 text-center font-black text-sm sm:text-base bg-transparent outline-none leading-none pb-0.5 transition-colors ${
                      hasCase ? 'text-brand-950' : 'text-gray-800 placeholder-gray-300'
                    }`}
                    aria-label="Custom item box quantity"
                  />
                </div>

                {/* Unit Quantity Input */}
                <div
                  className={`relative w-[52px] sm:w-[58px] h-[44px] sm:h-[48px] rounded-xl border flex flex-col items-center justify-between py-1 px-0.5 select-none shrink-0 transition-all ${
                    hasPack
                      ? 'border-brand-500 bg-brand-50/70 text-brand-900 ring-2 ring-brand-100 shadow-2xs'
                      : 'border-gray-200/90 bg-slate-50/80 hover:bg-white hover:border-gray-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 focus-within:bg-white shadow-2xs'
                  }`}
                >
                  <span
                    className={`text-[8.5px] sm:text-[9px] font-extrabold uppercase tracking-wider leading-none pt-0.5 pointer-events-none transition-colors ${
                      hasPack ? 'text-brand-600' : 'text-gray-500'
                    }`}
                  >
                    UNIT
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                    value={hasPack ? item.packQty : ''}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^0-9]/g, '');
                      onChange(idx, 'packQty', clean ? parseInt(clean, 10) : 0);
                    }}
                    onFocus={(e) => e.target.select()}
                    className={`w-full min-w-0 text-center font-black text-sm sm:text-base bg-transparent outline-none leading-none pb-0.5 transition-colors ${
                      hasPack ? 'text-brand-950' : 'text-gray-800 placeholder-gray-300'
                    }`}
                    aria-label="Custom item unit quantity"
                  />
                </div>

                {/* Delete button */}
                <button 
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-95 ml-1"
                  aria-label="Remove item"
                  title="Remove custom item"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="text-center p-6 text-gray-500 bg-gray-50/80 rounded-2xl border border-dashed border-gray-200 text-xs sm:text-sm">
            Add custom items not in the catalog. Enter description and quantities (Box / Unit).
          </div>
        )}
      </div>
    </div>
  );
};
