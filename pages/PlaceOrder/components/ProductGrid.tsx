import React, { memo } from 'react';
import { Search } from 'lucide-react';
import { Product, CartItem, Category, getCaseUnitLabel, getPackUnitLabel, isCaseQtyAllowed, isPackQtyAllowed } from '../../../types';

interface ProductGridProps {
  sortedCategories: Category[];
  groupedProducts: Record<string, Product[]>;
  checklistIndexMap?: Record<string, number>;
  cart: Record<string, CartItem>;
  viewMode: 'grid' | 'list';
  onQuantityChange: (product: Product, type: 'case' | 'pack', value: string) => void;
}

// Memoized Compact Clean Input Component (matching Order System V3)
const QuantityInput = memo<{
  value: number;
  onChange: (val: string) => void;
  label: string;
  isPack?: boolean;
}>(({ value, onChange, label }) => {
  const isFilled = value > 0;
  return (
    <div
      className={`relative w-[46px] sm:w-[50px] h-[38px] sm:h-[40px] rounded-lg border flex flex-col items-center justify-between py-0.5 px-0.5 select-none shrink-0 transition-all ${
        isFilled
          ? 'border-brand-500 bg-brand-50/80 text-brand-900 ring-1 ring-brand-300 shadow-2xs'
          : 'border-gray-200/90 bg-slate-50/80 hover:bg-white hover:border-gray-300 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-200 focus-within:bg-white shadow-2xs'
      }`}
    >
      {/* Clear Top Unit Label */}
      <span
        className={`text-[8px] sm:text-[8.5px] font-extrabold uppercase tracking-wider leading-none pt-0.5 pointer-events-none transition-colors ${
          isFilled ? 'text-brand-700' : 'text-gray-500'
        }`}
      >
        {label}
      </span>

      {/* Main quantity numeric input */}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        value={isFilled ? value : ''}
        onChange={(e) => {
          const clean = e.target.value.replace(/[^0-9]/g, '');
          onChange(clean);
        }}
        onFocus={(e) => e.target.select()}
        className={`w-full min-w-0 text-center font-black text-xs sm:text-[13px] bg-transparent outline-none leading-none pb-0.5 transition-colors ${
          isFilled ? 'text-brand-950' : 'text-gray-700 placeholder-gray-300'
        }`}
        aria-label={`${label} quantity`}
      />
    </div>
  );
});

QuantityInput.displayName = 'QuantityInput';

// Memoized Product Card (Grid View - compact, smaller easy-to-read font matching V3)
const ProductCardGrid = memo<{
  product: Product;
  caseQty: number;
  packQty: number;
  onQuantityChange: (product: Product, type: 'case' | 'pack', value: string) => void;
}>(({ product, caseQty, packQty, onQuantityChange }) => {
  const showCase = isCaseQtyAllowed(product);
  const showPack = isPackQtyAllowed(product);
  const caseLabel = getCaseUnitLabel(product);
  const packLabel = getPackUnitLabel(product);
  const hasQty = caseQty > 0 || packQty > 0;
  
  return (
    <div
      className={`flex flex-row items-center justify-between p-2 sm:p-2.5 rounded-xl border transition-all duration-150 gap-2 ${
        hasQty
          ? 'border-brand-400 bg-brand-50/25 shadow-2xs ring-1 ring-brand-200/80'
          : 'border-gray-200/80 bg-white hover:border-gray-300 hover:shadow-2xs shadow-2xs'
      }`}
    >
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden pr-0.5">
        <span 
          className="text-[11.5px] sm:text-xs font-semibold text-gray-900 leading-snug break-words line-clamp-2"
          title={product.name}
        >
          {product.name}
        </span>
        {product.chineseName && (
          <span className="text-[10px] sm:text-[10.5px] font-normal text-gray-500 mt-0.5 leading-tight truncate">
            {product.chineseName}
          </span>
        )}
        {product.packSize && (
          <span className="text-[9px] sm:text-[9.5px] text-gray-400 font-medium mt-0.5 truncate">
            {product.packSize}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {showCase && (
          <QuantityInput 
            value={caseQty} 
            onChange={(val) => onQuantityChange(product, 'case', val)} 
            label={caseLabel.toUpperCase()} 
          />
        )}
        {showPack && (
          <QuantityInput 
            value={packQty} 
            onChange={(val) => onQuantityChange(product, 'pack', val)} 
            label={packLabel.toUpperCase()} 
            isPack 
          />
        )}
      </div>
    </div>
  );
});

ProductCardGrid.displayName = 'ProductCardGrid';

// Memoized Product Row (List View - compact rows)
const ProductRowList = memo<{
  product: Product;
  caseQty: number;
  packQty: number;
  onQuantityChange: (product: Product, type: 'case' | 'pack', value: string) => void;
}>(({ product, caseQty, packQty, onQuantityChange }) => {
  const showCase = isCaseQtyAllowed(product);
  const showPack = isPackQtyAllowed(product);
  const caseLabel = getCaseUnitLabel(product);
  const packLabel = getPackUnitLabel(product);
  const hasQty = caseQty > 0 || packQty > 0;
  
  return (
    <tr className={`transition-colors ${hasQty ? 'bg-brand-50/30' : 'hover:bg-gray-50/70'}`}>
      <td className="px-3 sm:px-3.5 py-1.5 sm:py-2">
        <div className="flex flex-col min-w-0">
          <span className="text-[11.5px] sm:text-xs font-semibold text-gray-900 leading-snug break-words">
            {product.name}
          </span>
          {product.chineseName && (
            <span className="text-[10px] sm:text-[10.5px] text-gray-500 font-normal mt-0.5">
              {product.chineseName}
            </span>
          )}
          {product.packSize && (
            <span className="text-[9px] sm:text-[9.5px] text-gray-400 font-medium mt-0.5">
              {product.packSize}
            </span>
          )}
        </div>
      </td>
      <td className="w-16 sm:w-20 px-1.5 py-1.5 text-center align-middle">
        {showCase ? (
          <div className="flex justify-center">
            <QuantityInput 
              value={caseQty} 
              onChange={(val) => onQuantityChange(product, 'case', val)} 
              label={caseLabel.toUpperCase()} 
            />
          </div>
        ) : (
          <span className="text-xs text-gray-300 font-bold">—</span>
        )}
      </td>
      <td className="w-16 sm:w-20 px-1.5 py-1.5 text-center align-middle">
        {showPack ? (
          <div className="flex justify-center">
            <QuantityInput 
              value={packQty} 
              onChange={(val) => onQuantityChange(product, 'pack', val)} 
              label={packLabel.toUpperCase()} 
              isPack 
            />
          </div>
        ) : (
          <span className="text-xs text-gray-300 font-bold">—</span>
        )}
      </td>
    </tr>
  );
});

ProductRowList.displayName = 'ProductRowList';

export const ProductGrid: React.FC<ProductGridProps> = memo(({
  sortedCategories,
  groupedProducts,
  checklistIndexMap,
  cart,
  viewMode,
  onQuantityChange
}) => {
  const totalProducts = Object.values(groupedProducts).reduce((sum, list) => sum + list.length, 0);

  if (totalProducts === 0) {
    return (
      <div className="px-4 py-12 text-center max-w-md mx-auto space-y-2.5">
        <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto border border-gray-200 shadow-2xs">
          <Search size={18} />
        </div>
        <h3 className="text-sm font-bold text-gray-800">No matching products found</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          No products match your current search query or branch availability rules for this supplier. Check your spelling or try another keyword.
        </p>
      </div>
    );
  }

  return (
    <div className="px-2 md:px-3 space-y-4 pt-2 md:pt-3">
      {sortedCategories.map(cat => {
        const prods = groupedProducts[cat.id];
        if (!prods || prods.length === 0) return null;
        
        // Performance: content-visibility allows browser engine to skip layout calculation for offscreen categories
        return (
          <div 
            key={cat.id} 
            id={`cat-${cat.id}`} 
            className="scroll-mt-28 md:scroll-mt-24 relative z-0"
            style={{ contentVisibility: 'auto', containIntrinsicSize: '400px' }} 
          >
            <div className="flex items-center mb-1.5 px-0.5">
              <h3 className="text-[11px] sm:text-xs font-bold text-brand-700 tracking-tight uppercase bg-brand-50 px-2 py-0.5 rounded border border-brand-100 shadow-2xs">
                {cat.name}
              </h3>
              <div className="h-px bg-gray-200 flex-1 ml-2.5 opacity-60"></div>
            </div>

            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-2.5">
                {prods.map(p => {
                  const item = cart[p.id] || { caseQty: 0, packQty: 0 };
                  return (
                    <ProductCardGrid 
                      key={p.id} 
                      product={p} 
                      caseQty={item.caseQty} 
                      packQty={item.packQty} 
                      onQuantityChange={onQuantityChange} 
                    />
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200/90 shadow-2xs overflow-hidden">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50/90 border-b border-gray-200">
                    <tr>
                      <th className="px-3.5 py-2 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                        Product Details
                      </th>
                      <th className="w-18 sm:w-22 px-2 py-2 text-center text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                        Box
                      </th>
                      <th className="w-18 sm:w-22 px-2 py-2 text-center text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                        Unit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {prods.map(p => {
                      const item = cart[p.id] || { caseQty: 0, packQty: 0 };
                      return (
                        <ProductRowList 
                          key={p.id} 
                          product={p} 
                          caseQty={item.caseQty} 
                          packQty={item.packQty} 
                          onQuantityChange={onQuantityChange} 
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

ProductGrid.displayName = 'ProductGrid';
