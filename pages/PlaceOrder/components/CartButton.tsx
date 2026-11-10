import React, { memo } from 'react';
import { ShoppingCart, ArrowRight } from 'lucide-react';

interface CartButtonProps {
  totalItems: number;
  totalAmount?: number;
  onClick: () => void;
}

export const CartButton = memo<CartButtonProps>(({ totalItems, totalAmount, onClick }) => {
  if (totalItems === 0) return null;

  return (
    <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-6 left-3 right-3 md:left-auto md:right-6 z-40 animate-slide-up">
      <button
        onClick={onClick}
        className="w-full md:w-auto bg-slate-900 hover:bg-black active:scale-[0.98] text-white rounded-2xl md:rounded-full px-4 sm:px-5 py-3 md:py-2.5 shadow-2xl flex items-center justify-between md:justify-center md:space-x-3.5 border border-slate-700/60 backdrop-blur-xl transition-all"
        aria-label={`Review order with ${totalItems} items`}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-brand-600 text-white shadow-sm">
            <ShoppingCart size={17} strokeWidth={2.5} aria-hidden="true" />
            <span className="absolute -top-1 -right-1 bg-white text-brand-700 text-[10px] font-black w-4 h-4 flex items-center justify-center rounded-full shadow-xs">
              {totalItems}
            </span>
          </div>
          <div className="text-left">
            <span className="font-extrabold text-sm tracking-tight block leading-none">
              Review Basket
            </span>
            <span className="text-[10px] text-slate-400 font-medium md:hidden leading-none mt-0.5 block">
              {totalItems} item{totalItems > 1 ? 's' : ''} selected
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {totalAmount !== undefined && totalAmount > 0 ? (
            <span className="bg-slate-800 text-brand-300 border border-slate-700 px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-tight">
              £{totalAmount.toFixed(2)}
            </span>
          ) : null}
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white">
            <ArrowRight size={15} strokeWidth={2.5} />
          </div>
        </div>
      </button>
    </div>
  );
});

CartButton.displayName = 'CartButton';
