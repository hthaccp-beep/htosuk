import React from 'react';
import { 
  ChevronDown, Store, Lock, Info, Calendar, Search, 
  X, LayoutGrid, List, Loader2, Printer, Clock, AlertCircle, AlertTriangle,
  Building2
} from 'lucide-react';
import { Branch, Supplier, Category } from '../../../types';
import { CutoffStatus, ValidationResult } from '../../../utils/deliveryScheduler';

interface OrderHeaderProps {
  canViewGlobal: boolean;
  branches: Branch[];
  suppliers: Supplier[];
  categories: Category[];
  isOnline?: boolean;
  
  selectedBranchId: string;
  selectedSupplierId: string;
  deliveryDate: string;
  deliveryScheduleText: string | null;
  cutoffStatus?: CutoffStatus;
  deliveryDateValidation?: ValidationResult;
  searchTerm: string;
  viewMode: 'grid' | 'list';
  
  isHeaderExpanded: boolean;
  resumingDraftId: string | null;
  hasActiveOrder: boolean;
  isGeneratingChecklist: boolean;
  needsBranchConfirmation?: boolean;
  
  dateHelpers: {
    todayStr: string;
    tomorrowStr: string;
    dayAfterStr: string;
    tomorrowLabel: string;
    dayAfterLabel: string;
    earliestStr?: string;
    earliestLabel?: string;
  };

  onToggleHeader: () => void;
  onBranchChange: (id: string) => void;
  onSupplierChange: (id: string) => void;
  onDeliveryDateChange: (date: string) => void;
  onSearchChange: (term: string) => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onPrintChecklist: () => void;
}

export const OrderHeader: React.FC<OrderHeaderProps> = ({
  canViewGlobal,
  branches,
  suppliers,
  categories,
  isOnline = true,
  selectedBranchId,
  selectedSupplierId,
  deliveryDate,
  deliveryScheduleText,
  cutoffStatus,
  deliveryDateValidation,
  searchTerm,
  viewMode,
  isHeaderExpanded,
  resumingDraftId,
  hasActiveOrder,
  isGeneratingChecklist,
  needsBranchConfirmation = false,
  dateHelpers,
  onToggleHeader,
  onBranchChange,
  onSupplierChange,
  onDeliveryDateChange,
  onSearchChange,
  onViewModeChange,
  onPrintChecklist
}) => {
  const activeSupplier = suppliers.find(s => s.id === selectedSupplierId);
  const activeBranch = branches.find(b => b.id === selectedBranchId);
  const isBranchLocked = branches.length <= 1;

  const scrollToCategory = (id: string) => {
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md shadow-xs border-b border-gray-200/90 transition-all duration-200">
      {/* Multi-Branch Confirmation Prompt */}
      {needsBranchConfirmation && (
        <div className="bg-amber-500 text-white px-3 py-1.5 text-xs font-bold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Which branch are you ordering for? Please confirm your branch selection before submitting.</span>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* --- DESKTOP & TABLET COMPACT HEADER (md and up) --- */}
      {/* ============================================================== */}
      <div className="hidden md:block">
        {/* Row 1: Unified Slim Controls & Status Bar */}
        <div className="px-3 lg:px-4 py-2 flex flex-wrap items-center justify-between gap-2 bg-white">
          {/* Left: Branch, Supplier & Delivery Date in a sleek inline flow */}
          <div className="flex items-center flex-wrap gap-2 min-w-0">
            {/* Branch Selector */}
            <div className="relative min-w-[150px] lg:min-w-[170px] max-w-[210px]">
              <select 
                value={selectedBranchId} 
                onChange={(e) => onBranchChange(e.target.value)} 
                disabled={isBranchLocked} 
                className={`w-full appearance-none bg-slate-50/80 border border-gray-200 rounded-lg pl-7 pr-7 h-8 text-xs font-bold text-gray-900 focus:ring-1 focus:ring-brand-500 focus:border-brand-500 focus:bg-white transition-all cursor-pointer hover:border-gray-300 truncate shadow-2xs ${
                  isBranchLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed opacity-80' : ''
                }`}
                title={`Branch: ${activeBranch?.name}`}
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {!isBranchLocked 
                ? <Store className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-600 pointer-events-none" size={13} /> 
                : <Lock className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={13} />
              }
              {!isBranchLocked && <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={13} />}
            </div>

            {/* Supplier Selector */}
            <div className="relative min-w-[160px] lg:min-w-[190px] max-w-[230px]">
              {suppliers.length === 0 ? (
                <div className="h-8 px-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center text-xs text-amber-800 font-semibold truncate shadow-2xs">
                  No suppliers
                </div>
              ) : (
                <select 
                  value={selectedSupplierId} 
                  onChange={(e) => onSupplierChange(e.target.value)} 
                  className="w-full appearance-none bg-slate-50/80 border border-gray-200 rounded-lg pl-7 pr-7 h-8 text-xs font-bold text-gray-900 focus:ring-1 focus:ring-brand-500 focus:border-brand-500 focus:bg-white transition-all cursor-pointer hover:border-gray-300 truncate shadow-2xs"
                  title={`Supplier: ${activeSupplier?.name}`}
                >
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <Building2 className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-600 pointer-events-none" size={13} />
              {suppliers.length > 0 && <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={13} />}
            </div>

            {/* Delivery Date Selection */}
            <div className="flex items-center gap-1 bg-slate-50/80 p-0.5 rounded-lg border border-gray-200 shadow-2xs">
              <button 
                type="button"
                onClick={() => onDeliveryDateChange(dateHelpers.tomorrowStr)} 
                className={`h-7 px-2 rounded-md text-[10.5px] font-bold flex items-center gap-1 transition-all ${
                  deliveryDate === dateHelpers.tomorrowStr 
                    ? 'bg-brand-600 text-white shadow-2xs' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white'
                }`}
                title="Tomorrow Delivery Date"
              >
                <span>Tomorrow</span>
                <span className={`text-[9px] font-medium ${deliveryDate === dateHelpers.tomorrowStr ? 'text-brand-100' : 'text-gray-400'}`}>
                  ({dateHelpers.tomorrowLabel})
                </span>
              </button>

              <button 
                type="button"
                onClick={() => onDeliveryDateChange(dateHelpers.dayAfterStr)} 
                className={`h-7 px-2 rounded-md text-[10.5px] font-bold flex items-center gap-1 transition-all ${
                  deliveryDate === dateHelpers.dayAfterStr 
                    ? 'bg-brand-600 text-white shadow-2xs' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white'
                }`}
                title="Next Day Delivery Date"
              >
                <span>Next Day</span>
                <span className={`text-[9px] font-medium ${deliveryDate === dateHelpers.dayAfterStr ? 'text-brand-100' : 'text-gray-400'}`}>
                  ({dateHelpers.dayAfterLabel})
                </span>
              </button>

              <div className="relative">
                <input 
                  type="date" 
                  value={deliveryDate} 
                  min={cutoffStatus?.nextValidDeliveryDate || dateHelpers.todayStr} 
                  onChange={(e) => onDeliveryDateChange(e.target.value)} 
                  className={`h-7 pl-6 pr-2 bg-white border rounded-md text-[11px] font-bold focus:ring-1 focus:ring-brand-500 outline-none transition-all cursor-pointer ${
                    deliveryDateValidation && !deliveryDateValidation.valid 
                      ? 'border-red-500 bg-red-50/30 text-red-900' 
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  }`} 
                  title="Choose Delivery Date"
                />
                <Calendar size={12} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Validation error if any */}
            {deliveryDateValidation && !deliveryDateValidation.valid && (
              <span className="text-[10px] text-red-600 font-bold flex items-center gap-1 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                <AlertCircle size={11} className="shrink-0" />
                <span className="truncate max-w-[200px]">{deliveryDateValidation.error}</span>
              </span>
            )}
          </div>

          {/* Right: Cutoff status, Resumed draft badge & THE ONLY Online status indicator */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Cutoff Status Pill */}
            {cutoffStatus && (
              <div 
                className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border shadow-2xs transition-all ${
                  cutoffStatus.urgency === 'URGENT'
                    ? 'bg-red-50 text-red-800 border-red-300 animate-pulse'
                    : cutoffStatus.urgency === 'APPROACHING'
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : cutoffStatus.urgency === 'PASSED'
                    ? 'bg-gray-100 text-gray-700 border-gray-200'
                    : 'bg-blue-50/80 text-blue-800 border-blue-200'
                }`}
                title={deliveryScheduleText || cutoffStatus.badgeText}
              >
                <Clock size={12} className={cutoffStatus.urgency === 'URGENT' ? 'text-red-600' : 'text-blue-600'} />
                <span className="truncate max-w-[180px] lg:max-w-none">{cutoffStatus.badgeText}</span>
              </div>
            )}

            {/* Resumed Draft Badge */}
            {resumingDraftId && (
              <span className="bg-amber-500/15 text-amber-800 border border-amber-300 text-[10px] px-2 py-1 rounded-lg font-bold shadow-2xs">
                Draft
              </span>
            )}

            {/* THE ONLY Online status indicator on the top right */}
            <div 
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold shadow-2xs transition-all ${
                isOnline 
                  ? 'bg-emerald-50/90 border-emerald-200 text-emerald-700' 
                  : 'bg-amber-50 border-amber-300 text-amber-800'
              }`}
              title={isOnline ? 'System is online and connected' : 'System is offline - changes will sync when connected'}
            >
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>

        {/* Row 2: Compact Category Chips + Search & Tools Sub-Toolbar */}
        <div className="bg-slate-50/90 border-t border-gray-200/80 px-3 lg:px-4 py-1.5 flex items-center justify-between gap-2.5">
          {/* Scrollable Category Chips */}
          <div className="flex-1 overflow-x-auto no-scrollbar flex space-x-1 scroll-smooth min-w-0 pr-1">
            {categories.map(cat => (
              <button 
                key={cat.id} 
                className="whitespace-nowrap px-2.5 py-1 bg-white text-gray-600 border border-gray-200/80 rounded-md text-[10.5px] font-semibold hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 transition-colors shadow-2xs active:scale-95 shrink-0" 
                onClick={() => scrollToCategory(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Search, Grid/List view toggle & Checklist (NO duplicate online button here!) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* View Mode Switcher */}
            <div className="flex bg-gray-200/70 p-0.5 rounded-lg h-7.5 items-center">
              <button 
                onClick={() => onViewModeChange('grid')} 
                className={`h-6.5 px-2 rounded-md flex items-center gap-1 text-[10px] font-bold transition-all ${
                  viewMode === 'grid' 
                    ? 'bg-white text-brand-700 shadow-2xs' 
                    : 'text-gray-500 hover:text-gray-700'
                }`} 
                title="Grid View"
              >
                <LayoutGrid size={13} />
              </button>
              <button 
                onClick={() => onViewModeChange('list')} 
                className={`h-6.5 px-2 rounded-md flex items-center gap-1 text-[10px] font-bold transition-all ${
                  viewMode === 'list' 
                    ? 'bg-white text-brand-700 shadow-2xs' 
                    : 'text-gray-500 hover:text-gray-700'
                }`} 
                title="List View"
              >
                <List size={13} />
              </button>
            </div>

            {/* Quick Search */}
            <div className="w-32 md:w-40 lg:w-48 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={12} />
              <input 
                type="text" 
                placeholder="Search items..." 
                className="w-full pl-7 pr-6 py-1 h-7.5 bg-white border border-gray-300 rounded-lg text-xs font-medium focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all shadow-2xs" 
                value={searchTerm} 
                onChange={e => onSearchChange(e.target.value)} 
              />
              {searchTerm && (
                <button 
                  onClick={() => onSearchChange('')} 
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Print Checklist Button */}
            <button 
              onClick={onPrintChecklist} 
              disabled={isGeneratingChecklist} 
              className="h-7.5 px-2.5 bg-white border border-gray-300 text-gray-700 text-[10px] font-bold rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all shadow-2xs flex items-center gap-1 shrink-0"
              title="Print Order Checklist"
            >
              {isGeneratingChecklist ? <Loader2 size={12} className="animate-spin text-brand-600" /> : <Printer size={12} />}
              <span className="hidden sm:inline">Checklist</span>
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* --- MOBILE COMPACT HEADER (Under md) --- */}
      {/* ============================================================== */}
      <div className="md:hidden">
        {/* Compact Bar: Supplier, Date & Online Status */}
        <div 
          className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-100 cursor-pointer bg-white h-11" 
          onClick={onToggleHeader}
        >
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-gray-900 truncate max-w-[130px]">
              {activeSupplier?.name || 'Select Supplier'}
            </span>
            <span className="text-gray-300 text-xs">|</span>
            <span className={`text-[10px] font-semibold truncate ${deliveryDate ? 'text-gray-600' : 'text-red-500 font-bold'}`}>
              {deliveryDate ? new Date(deliveryDate).toLocaleDateString(undefined, {month:'short', day:'numeric'}) : 'Set Date'}
            </span>
            {hasActiveOrder && (
              <span className="bg-orange-100 text-orange-700 text-[8.5px] uppercase font-black px-1.5 py-0.2 rounded-full">
                {resumingDraftId ? 'Draft' : 'Active'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* The Online badge on mobile */}
            <div 
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9.5px] font-bold shadow-2xs ${
                isOnline 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                  : 'bg-amber-50 border-amber-300 text-amber-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>

            <div className={`text-gray-400 transition-transform duration-200 ${isHeaderExpanded ? 'rotate-180' : ''}`}>
              <ChevronDown size={16} />
            </div>
          </div>
        </div>
        
        {/* Collapsible Mobile Dropdowns Panel */}
        {isHeaderExpanded && (
          <div className="bg-slate-50 border-b border-gray-200 p-2.5 animate-fade-in shadow-inner space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[9.5px] uppercase font-bold text-gray-500 mb-0.5">Target Branch</label>
                <div className="relative">
                  <select 
                    value={selectedBranchId} 
                    onChange={(e) => onBranchChange(e.target.value)} 
                    disabled={isBranchLocked} 
                    className={`w-full bg-white border border-gray-200 rounded-lg pl-8 pr-7 text-xs font-bold text-gray-900 h-9 focus:ring-1 focus:ring-brand-500 outline-none shadow-2xs ${
                      isBranchLocked ? 'bg-gray-100 text-gray-500 appearance-none' : ''
                    }`}
                  >
                    {branches.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
                  </select>
                  <Store className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-600 pointer-events-none" size={13} />
                  {!isBranchLocked && <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={13} />}
                </div>
              </div>

              <div>
                <label className="block text-[9.5px] uppercase font-bold text-gray-500 mb-0.5">Supplier</label>
                <div className="relative">
                  <select 
                    value={selectedSupplierId} 
                    onChange={(e) => onSupplierChange(e.target.value)} 
                    className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-7 text-xs font-bold text-gray-900 h-9 focus:ring-1 focus:ring-brand-500 outline-none shadow-2xs truncate"
                  >
                    {suppliers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                  <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-600 pointer-events-none" size={13} />
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={13} />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[9.5px] uppercase font-bold text-gray-600 mb-0.5">
                Delivery Date <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => onDeliveryDateChange(dateHelpers.tomorrowStr)} 
                  className={`h-9 px-2 rounded-lg text-[10px] font-bold border flex-1 transition-all ${
                    deliveryDate === dateHelpers.tomorrowStr 
                      ? 'bg-brand-600 text-white border-brand-600 shadow-2xs' 
                      : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  Tomorrow ({dateHelpers.tomorrowLabel})
                </button>
                <button 
                  type="button"
                  onClick={() => onDeliveryDateChange(dateHelpers.dayAfterStr)} 
                  className={`h-9 px-2 rounded-lg text-[10px] font-bold border flex-1 transition-all ${
                    deliveryDate === dateHelpers.dayAfterStr 
                      ? 'bg-brand-600 text-white border-brand-600 shadow-2xs' 
                      : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  Next Day ({dateHelpers.dayAfterLabel})
                </button>
                <input 
                  type="date" 
                  value={deliveryDate} 
                  min={cutoffStatus?.nextValidDeliveryDate || dateHelpers.todayStr} 
                  onChange={(e) => onDeliveryDateChange(e.target.value)} 
                  className={`bg-white border rounded-lg px-2 text-xs font-bold text-gray-900 h-9 focus:ring-1 focus:ring-brand-500 outline-none shadow-2xs flex-1 ${
                    deliveryDateValidation && !deliveryDateValidation.valid 
                      ? 'border-red-500 bg-red-50/30' 
                      : 'border-gray-300'
                  }`} 
                />
              </div>
            </div>

            {/* Cutoff Clock & Urgency Badge (Mobile) */}
            {cutoffStatus && (
              <div className={`flex items-center justify-between text-[10px] px-2 py-1 rounded-md border ${
                cutoffStatus.urgency === 'URGENT' 
                  ? 'bg-red-50 text-red-700 border-red-200 font-bold animate-pulse'
                  : 'bg-blue-50/80 text-blue-700 border-blue-200 font-medium'
              }`}>
                <div className="flex items-center gap-1 truncate">
                  <Clock size={11} className="shrink-0" />
                  <span className="truncate">{cutoffStatus.badgeText}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mobile Search & Category Bar */}
        <div className="px-2 py-1.5 flex gap-1.5 items-center bg-white border-b border-gray-100">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
            <input 
              type="text" 
              placeholder="Search items..." 
              className="w-full pl-7 pr-6 py-1 bg-gray-100 border-none rounded-lg text-xs focus:ring-1 focus:ring-brand-500 placeholder-gray-400 focus:bg-white transition-colors" 
              value={searchTerm} 
              onChange={e => onSearchChange(e.target.value)} 
            />
            {searchTerm && (
              <button 
                onClick={() => onSearchChange('')} 
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 p-0.5"
              >
                <X size={11} />
              </button>
            )}
          </div>

          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 shrink-0">
            <button 
              onClick={() => onViewModeChange('grid')} 
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white text-brand-600 shadow-2xs' : 'text-gray-400'}`}
              title="Grid View"
            >
              <LayoutGrid size={14} />
            </button>
            <button 
              onClick={() => onViewModeChange('list')} 
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white text-brand-600 shadow-2xs' : 'text-gray-400'}`}
              title="List View"
            >
              <List size={14} />
            </button>
          </div>

          <button 
            onClick={onPrintChecklist} 
            disabled={isGeneratingChecklist} 
            className="p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 shrink-0 flex items-center justify-center"
            title="Checklist"
          >
            {isGeneratingChecklist ? <Loader2 size={14} className="animate-spin text-brand-600" /> : <Printer size={14} />}
          </button>
        </div>

        {/* Mobile Category Chips Horizontal Scroll */}
        <div className="flex overflow-x-auto no-scrollbar bg-slate-50/95 border-b border-gray-200 px-2 py-1 gap-1 snap-x">
          {categories.map(cat => (
            <button 
              key={cat.id} 
              className="snap-start shrink-0 px-2.5 py-0.5 bg-white border border-gray-200 rounded-md text-[10px] font-semibold text-gray-600 shadow-2xs whitespace-nowrap active:scale-95 active:bg-brand-50 active:text-brand-700" 
              onClick={() => scrollToCategory(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
