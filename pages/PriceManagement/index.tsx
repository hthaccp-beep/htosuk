import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore, can } from '../../store';
import { PriceChangeNotice, NewItemNotice } from '../../types';
import { ScanInvoiceModal } from './ScanInvoiceModal';
import { ApprovePriceChangeModal } from './ApprovePriceChangeModal';
import { RejectPriceChangeModal } from './RejectPriceChangeModal';
import { ResolveNewItemModal } from './ResolveNewItemModal';
import { PriceHistoryView } from './PriceHistoryView';
import { PriceSettingsView } from './PriceSettingsView';
import { InvoiceReconciliationView } from './InvoiceReconciliationView';
import { 
  ScanLine, AlertTriangle, PlusCircle, CheckCircle2, XCircle, 
  History, Settings, Search, Filter, ArrowUpRight, ArrowDownRight, 
  Clock, FileText, Check, ShieldCheck, ChevronRight, ChevronLeft, Sparkles, FileSpreadsheet,
  Loader2, Zap 
} from 'lucide-react';

type Tab = 'PENDING' | 'PRICE_CHANGES' | 'NEW_ITEMS' | 'RECONCILIATION' | 'HISTORY' | 'SETTINGS';

export const PriceManagement: React.FC = () => {
  const { 
    priceChangeNotices, newItemNotices, priceHistory, currentUser, suppliers 
  } = useAppStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTabParam = (searchParams.get('tab') || '').toUpperCase();
  const getInitialTab = (): Tab => {
    if (rawTabParam === 'CHECK_INVOICE' || rawTabParam === 'CHECK-INVOICE' || rawTabParam === 'RECONCILIATION' || rawTabParam === 'INVOICE') return 'RECONCILIATION';
    if (rawTabParam === 'SETTINGS') return 'SETTINGS';
    if (rawTabParam === 'PRICE_CHANGES' || rawTabParam === 'PRICES') return 'PRICE_CHANGES';
    if (rawTabParam === 'NEW_ITEMS' || rawTabParam === 'NEW') return 'NEW_ITEMS';
    if (rawTabParam === 'HISTORY') return 'HISTORY';
    return 'PENDING';
  };

  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab);

  // Sync state if URL searchParams changes externally
  useEffect(() => {
    const tabParam = (searchParams.get('tab') || '').toUpperCase();
    if (tabParam) {
      if ((tabParam === 'CHECK_INVOICE' || tabParam === 'CHECK-INVOICE' || tabParam === 'RECONCILIATION' || tabParam === 'INVOICE') && activeTab !== 'RECONCILIATION') {
        setActiveTab('RECONCILIATION');
      } else if (tabParam === 'SETTINGS' && activeTab !== 'SETTINGS') {
        setActiveTab('SETTINGS');
      } else if ((tabParam === 'PRICE_CHANGES' || tabParam === 'PRICES') && activeTab !== 'PRICE_CHANGES') {
        setActiveTab('PRICE_CHANGES');
      } else if ((tabParam === 'NEW_ITEMS' || tabParam === 'NEW') && activeTab !== 'NEW_ITEMS') {
        setActiveTab('NEW_ITEMS');
      } else if (tabParam === 'HISTORY' && activeTab !== 'HISTORY') {
        setActiveTab('HISTORY');
      } else if (tabParam === 'PENDING' && activeTab !== 'PENDING') {
        setActiveTab('PENDING');
      }
    }
  }, [searchParams]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab: tab.toLowerCase() }, { replace: true });
  };

  const tabsRef = useRef<HTMLDivElement>(null);
  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      tabsRef.current.scrollBy({
        left: direction === 'left' ? -220 : 220,
        behavior: 'smooth'
      });
    }
  };
  
  // Modal states
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [approvingNotice, setApprovingNotice] = useState<PriceChangeNotice | null>(null);
  const [rejectingNotice, setRejectingNotice] = useState<PriceChangeNotice | null>(null);
  const [resolvingNewItem, setResolvingNewItem] = useState<NewItemNotice | null>(null);

  // Filters for All Price Changes Tab
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [supplierFilter, setSupplierFilter] = useState<string>('ALL');

  // Permissions
  const canScan = can(currentUser, 'scan_invoices');
  const canApprove = can(currentUser, 'approve_price_changes');
  const canReject = can(currentUser, 'reject_price_changes');
  const canManageNew = can(currentUser, 'manage_new_items');
  const canViewHistory = can(currentUser, 'view_price_history');
  const canManageSettings = can(currentUser, 'manage_price_monitoring') || currentUser?.role === 'CREATOR' || currentUser?.role === 'GM';

  const [isBatchApproving, setIsBatchApproving] = useState(false);

  const handleBatchApproveAll = async () => {
    if (!currentUser || pendingPriceChanges.length === 0) return;
    setIsBatchApproving(true);
    try {
      let count = 0;
      for (const notice of pendingPriceChanges) {
        try {
          await useAppStore.getState().approvePriceChange(
            notice.id, 
            notice.invoiceDate || new Date().toISOString().split('T')[0], 
            'Batch approved by manager'
          );
          count++;
        } catch (itemErr: any) {
          console.warn(`Failed to approve notice ${notice.id}:`, itemErr);
        }
      }
      useAppStore.getState().showToast('success', `Successfully approved and applied ${count} price changes to catalog!`);
    } catch (err: any) {
      useAppStore.getState().showToast('error', `Batch approval error: ${err.message}`);
    } finally {
      setIsBatchApproving(false);
    }
  };

  // Pending counts
  const pendingPriceChanges = useMemo(() => {
    return priceChangeNotices.filter(n => n.status === 'PENDING');
  }, [priceChangeNotices]);

  const pendingNewItems = useMemo(() => {
    return newItemNotices.filter(n => n.status === 'PENDING');
  }, [newItemNotices]);

  const totalPending = pendingPriceChanges.length + pendingNewItems.length;

  // Filtered Price Changes for Tab 2
  const filteredPriceChanges = useMemo(() => {
    let list = [...priceChangeNotices];
    if (statusFilter !== 'ALL') {
      list = list.filter(n => n.status === statusFilter);
    }
    if (supplierFilter !== 'ALL') {
      list = list.filter(n => n.supplierId === supplierFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(n => 
        n.productName.toLowerCase().includes(q) ||
        (n.itemCode && n.itemCode.toLowerCase().includes(q)) ||
        n.invoiceNumber.toLowerCase().includes(q) ||
        n.supplierName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => new Date(b.detectedDate).getTime() - new Date(a.detectedDate).getTime());
    return list;
  }, [priceChangeNotices, statusFilter, supplierFilter, searchQuery]);

  // Filtered New Items for Tab 3
  const filteredNewItems = useMemo(() => {
    let list = [...newItemNotices];
    if (statusFilter !== 'ALL') {
      list = list.filter(n => n.status === statusFilter);
    }
    if (supplierFilter !== 'ALL') {
      list = list.filter(n => n.supplierId === supplierFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(n => 
        n.rawDescription.toLowerCase().includes(q) ||
        (n.rawItemCode && n.rawItemCode.toLowerCase().includes(q)) ||
        n.invoiceNumber.toLowerCase().includes(q) ||
        n.supplierName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => new Date(b.detectedDate).getTime() - new Date(a.detectedDate).getTime());
    return list;
  }, [newItemNotices, statusFilter, supplierFilter, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto pb-20">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900">Invoice Scanning & Price Updates</h2>
            {totalPending > 0 && (
              <span className="bg-red-500 text-white text-xs font-extrabold px-2.5 py-0.5 rounded-full shadow-sm animate-pulse">
                {totalPending} Review Required
              </span>
            )}
          </div>
          <p className="text-gray-500 text-sm font-medium mt-0.5">
            OCR scan supplier documents, detect price variances, prevent duplicate products, and maintain full audit logs.
          </p>
        </div>

        {canScan && (
          <button
            onClick={() => setIsScanOpen(true)}
            className="bg-brand-600 hover:bg-brand-700 active:scale-95 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2 whitespace-nowrap self-stretch sm:self-auto justify-center"
          >
            <ScanLine size={18} />
            <span>Update Prices (PDF, Photo, Excel)</span>
          </button>
        )}
      </div>

      {/* Tabs Navigation Bar - Responsive horizontal scroll with arrows and mobile selector */}
      <div className="bg-gray-100/90 p-1.5 rounded-2xl border border-gray-200/90 mb-6 shadow-2xs">
        <div className="flex items-center gap-1">
          {/* Scroll Left Button */}
          <button
            type="button"
            onClick={() => scrollTabs('left')}
            className="hidden sm:flex items-center justify-center w-7 h-7 rounded-lg bg-white/80 hover:bg-white text-gray-500 hover:text-gray-900 shadow-2xs border border-gray-200/60 transition-colors shrink-0 active:scale-95"
            title="Scroll tabs left"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft size={16} />
          </button>

          <div 
            ref={tabsRef}
            className="flex-1 flex items-center gap-1.5 sm:gap-2 overflow-x-auto custom-scrollbar py-1 px-1 scroll-smooth"
          >
            {/* Pending Approvals */}
            <button
              type="button"
              onClick={() => handleTabChange('PENDING')}
              className={`flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-all active:scale-95 ${
                activeTab === 'PENDING'
                  ? 'bg-white text-brand-700 shadow-xs ring-1 ring-gray-200/80 font-extrabold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <Clock size={15} className={activeTab === 'PENDING' ? 'text-brand-600' : 'text-gray-400'} />
              <span>Pending Approvals</span>
              {totalPending > 0 && (
                <span className="bg-brand-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ml-0.5 shadow-2xs">
                  {totalPending}
                </span>
              )}
            </button>

            {/* Price Changes */}
            <button
              type="button"
              onClick={() => handleTabChange('PRICE_CHANGES')}
              className={`flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-all active:scale-95 ${
                activeTab === 'PRICE_CHANGES'
                  ? 'bg-white text-brand-700 shadow-xs ring-1 ring-gray-200/80 font-extrabold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <AlertTriangle size={15} className={activeTab === 'PRICE_CHANGES' ? 'text-brand-600' : 'text-gray-400'} />
              <span>Price Changes</span>
              <span className="text-[10px] text-gray-400 font-semibold">({priceChangeNotices.length})</span>
            </button>

            {/* New Item Notices */}
            <button
              type="button"
              onClick={() => handleTabChange('NEW_ITEMS')}
              className={`flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-all active:scale-95 ${
                activeTab === 'NEW_ITEMS'
                  ? 'bg-white text-brand-700 shadow-xs ring-1 ring-gray-200/80 font-extrabold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <PlusCircle size={15} className={activeTab === 'NEW_ITEMS' ? 'text-brand-600' : 'text-gray-400'} />
              <span>New Item Notices</span>
              <span className="text-[10px] text-gray-400 font-semibold">({newItemNotices.length})</span>
            </button>

            {/* Check Invoice (Invoice Reconciliation) */}
            <button
              type="button"
              id="tab-check-invoice"
              onClick={() => handleTabChange('RECONCILIATION')}
              className={`flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-all active:scale-95 ${
                activeTab === 'RECONCILIATION'
                  ? 'bg-white text-brand-700 shadow-xs ring-1 ring-gray-200/80 font-extrabold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <FileSpreadsheet size={15} className={activeTab === 'RECONCILIATION' ? 'text-brand-600' : 'text-gray-400'} />
              <span>Check Invoice</span>
              <span className="hidden lg:inline text-[11px] text-gray-400 font-normal">/ Reconciliation</span>
            </button>

            {/* Price History & Audit */}
            {canViewHistory && (
              <button
                type="button"
                onClick={() => handleTabChange('HISTORY')}
                className={`flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-all active:scale-95 ${
                  activeTab === 'HISTORY'
                    ? 'bg-white text-brand-700 shadow-xs ring-1 ring-gray-200/80 font-extrabold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                }`}
              >
                <History size={15} className={activeTab === 'HISTORY' ? 'text-brand-600' : 'text-gray-400'} />
                <span>Price History & Audit</span>
              </button>
            )}

            {/* Settings */}
            {canManageSettings && (
              <button
                type="button"
                id="tab-settings"
                onClick={() => handleTabChange('SETTINGS')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-all active:scale-95 ${
                  activeTab === 'SETTINGS'
                    ? 'bg-white text-brand-700 shadow-xs ring-1 ring-gray-200/80 font-extrabold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                }`}
              >
                <Settings size={15} className={activeTab === 'SETTINGS' ? 'text-brand-600' : 'text-gray-400'} />
                <span>Settings</span>
              </button>
            )}
          </div>

          {/* Scroll Right Button */}
          <button
            type="button"
            onClick={() => scrollTabs('right')}
            className="hidden sm:flex items-center justify-center w-7 h-7 rounded-lg bg-white/80 hover:bg-white text-gray-500 hover:text-gray-900 shadow-2xs border border-gray-200/60 transition-colors shrink-0 active:scale-95"
            title="Scroll tabs right"
            aria-label="Scroll tabs right"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Mobile Tab Selector: Guaranteed 100% visibility for mobile & small screens */}
        <div className="sm:hidden mt-2 pt-2 border-t border-gray-200/70 flex items-center gap-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase shrink-0">Section:</span>
          <select
            value={activeTab}
            onChange={(e) => handleTabChange(e.target.value as Tab)}
            className="flex-1 bg-white border border-gray-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 shadow-2xs outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="PENDING">Pending Approvals ({totalPending})</option>
            <option value="PRICE_CHANGES">Price Changes ({priceChangeNotices.length})</option>
            <option value="NEW_ITEMS">New Item Notices ({newItemNotices.length})</option>
            <option value="RECONCILIATION">Check Invoice / Reconciliation</option>
            {canViewHistory && <option value="HISTORY">Price History & Audit</option>}
            {canManageSettings && <option value="SETTINGS">Settings</option>}
          </select>
        </div>
      </div>

      {/* TAB 1: PENDING APPROVALS */}
      {activeTab === 'PENDING' && (
        <div className="space-y-6">
          {totalPending === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center shadow-sm">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-lg font-bold text-gray-900">All Caught Up!</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                No price changes or unrecognised items are waiting for review. You can scan or upload a new delivery note any time.
              </p>
              {canScan && (
                <button
                  onClick={() => setIsScanOpen(true)}
                  className="mt-5 inline-flex items-center gap-2 bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold px-4 py-2 rounded-xl text-xs transition-colors"
                >
                  <ScanLine size={16} />
                  <span>Scan New Invoice</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* SECTION: Pending Price Changes */}
              {pendingPriceChanges.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                        <AlertTriangle size={16} className="text-amber-500" />
                        <span>Pending Price Changes ({pendingPriceChanges.length})</span>
                      </h3>
                      <span className="hidden sm:inline text-xs text-gray-500">&bull; Requires Manager Approval</span>
                    </div>

                    {canApprove && pendingPriceChanges.length > 0 && (
                      <button
                        type="button"
                        disabled={isBatchApproving}
                        onClick={handleBatchApproveAll}
                        className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-xs transition-all disabled:opacity-50"
                      >
                        {isBatchApproving ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            <span>Applying All...</span>
                          </>
                        ) : (
                          <>
                            <Zap size={13} className="fill-white" />
                            <span>Batch Approve & Apply All ({pendingPriceChanges.length})</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pendingPriceChanges.map((notice) => {
                      const isIncrease = (notice.priceDiff ?? 0) > 0;
                      const oldP = notice.oldCasePrice ?? notice.oldPackPrice;
                      const newP = notice.newCasePrice ?? notice.newPackPrice;

                      return (
                        <div
                          key={notice.id}
                          className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:border-brand-200 transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">
                                  {notice.supplierName}
                                </span>
                                <h4 className="text-sm font-bold text-gray-900 mt-0.5 line-clamp-2">
                                  {notice.productName}
                                </h4>
                                {notice.itemCode && (
                                  <span className="text-[11px] font-mono text-gray-400">
                                    SKU: {notice.itemCode}
                                  </span>
                                )}
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold flex items-center gap-0.5 flex-shrink-0 ${
                                isIncrease ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
                              }`}>
                                {isIncrease ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                                {(notice.priceDiff ?? 0) >= 0 ? `+£${(notice.priceDiff ?? 0).toFixed(2)}` : `-£${Math.abs(notice.priceDiff ?? 0).toFixed(2)}`} ({(notice.percentChange ?? 0) >= 0 ? `+${notice.percentChange ?? 0}%` : `${notice.percentChange ?? 0}%`})
                              </span>
                            </div>

                            {/* Price Compare Row */}
                            <div className="grid grid-cols-2 gap-2 my-3 p-2.5 bg-gray-50 rounded-xl text-center">
                              <div>
                                <span className="text-[10px] font-bold text-gray-400 uppercase block">Recorded</span>
                                <span className="text-sm font-bold text-gray-500 line-through">
                                  {oldP !== undefined ? `£${oldP.toFixed(2)}` : '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-brand-600 uppercase block">New Invoiced</span>
                                <span className="text-sm font-extrabold text-gray-900">
                                  {newP !== undefined ? `£${newP.toFixed(2)}` : '—'}
                                </span>
                              </div>
                            </div>

                            {/* Metadata */}
                            <div className="text-[11px] text-gray-500 space-y-0.5 mb-3">
                              <p>
                                <strong>Invoice:</strong> {notice.invoiceNumber || 'N/A'} &bull; <strong>Date:</strong> {notice.invoiceDate || 'N/A'}
                              </p>
                              <p>
                                <strong>Scanned by:</strong> {notice.uploadedByUserName}
                              </p>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                            {canReject && (
                              <button
                                type="button"
                                onClick={() => setRejectingNotice(notice)}
                                className="flex-1 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 border border-red-200 rounded-xl transition-colors text-center"
                              >
                                Reject
                              </button>
                            )}
                            {canApprove && (
                              <button
                                type="button"
                                onClick={() => setApprovingNotice(notice)}
                                className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5"
                              >
                                <Check size={14} />
                                <span>Approve</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION: Pending New / Unrecognised Items */}
              {pendingNewItems.length > 0 && (
                <div className="space-y-3 pt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <PlusCircle size={16} className="text-blue-500" />
                      <span>Unrecognised Products ({pendingNewItems.length})</span>
                    </h3>
                    <span className="text-xs text-gray-500">Add to Catalog or Link</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pendingNewItems.map((notice) => {
                      const detectedPrice = notice.detectedCasePrice || notice.detectedPackPrice || 0;

                      return (
                        <div
                          key={notice.id}
                          className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:border-brand-200 transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">
                                  {notice.supplierName}
                                </span>
                                <h4 className="text-sm font-bold text-gray-900 mt-0.5 line-clamp-2">
                                  {notice.rawDescription}
                                </h4>
                                <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-1">
                                  {notice.rawItemCode && (
                                    <span className="font-mono bg-gray-100 px-1 rounded">
                                      SKU: {notice.rawItemCode}
                                    </span>
                                  )}
                                  {notice.rawPackSize && <span>Pack: {notice.rawPackSize}</span>}
                                  <span className="font-bold text-gray-900">£{detectedPrice.toFixed(2)}</span>
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200 flex-shrink-0">
                                New Item
                              </span>
                            </div>

                            {/* Duplicate Warning */}
                            {notice.possibleDuplicateProductName && (
                              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 my-2.5">
                                <p className="font-bold flex items-center gap-1 text-[11px]">
                                  <AlertTriangle size={13} className="text-amber-600" />
                                  Possible Duplicate Found ({notice.duplicateMatchScore || 75}% match):
                                </p>
                                <p className="font-medium text-amber-800 truncate mt-0.5">
                                  {notice.possibleDuplicateProductName}
                                </p>
                              </div>
                            )}

                            <div className="text-[11px] text-gray-500 space-y-0.5 mb-3">
                              <p>
                                <strong>Invoice:</strong> {notice.invoiceNumber || 'N/A'} &bull; <strong>Date:</strong> {notice.invoiceDate || 'N/A'}
                              </p>
                              <p>
                                <strong>Scanned by:</strong> {notice.uploadedByUserName}
                              </p>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                            {canManageNew && (
                              <button
                                type="button"
                                onClick={() => setResolvingNewItem(notice)}
                                className="w-full px-3 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5"
                              >
                                <span>Review & Resolve Item</span>
                                <ChevronRight size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: ALL PRICE CHANGES */}
      {activeTab === 'PRICE_CHANGES' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex-1 flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search price notices by product, code, or invoice..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 bg-gray-50 focus:bg-white"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none focus:ring-2 focus:ring-brand-500 font-medium"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending Approval</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>

              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none focus:ring-2 focus:ring-brand-500 font-medium"
              >
                <option value="ALL">All Suppliers</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* List Table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {filteredPriceChanges.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-xs">
                No price change notices match the selected criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Product</th>
                      <th className="py-3 px-4">Supplier</th>
                      <th className="py-3 px-4 text-right">Old Price</th>
                      <th className="py-3 px-4 text-right">New Price</th>
                      <th className="py-3 px-4 text-center">Variance</th>
                      <th className="py-3 px-4">Invoice Ref</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPriceChanges.map((notice) => {
                      const isIncrease = (notice.priceDiff ?? 0) > 0;
                      const oldP = notice.oldCasePrice ?? notice.oldPackPrice;
                      const newP = notice.newCasePrice ?? notice.newPackPrice;

                      return (
                        <tr key={notice.id} className="hover:bg-gray-50/70 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap text-gray-500">
                            {notice.detectedDate.split('T')[0]}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-gray-900 block truncate max-w-[200px]">
                              {notice.productName}
                            </span>
                            {notice.itemCode && (
                              <span className="text-[10px] font-mono text-gray-400">
                                {notice.itemCode}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-gray-700">
                            {notice.supplierName}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-400 line-through">
                            {oldP !== undefined ? `£${oldP.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-gray-900">
                            {newP !== undefined ? `£${newP.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                              isIncrease ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                            }`}>
                              {isIncrease ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                              {(notice.priceDiff ?? 0) >= 0 ? `+£${(notice.priceDiff ?? 0).toFixed(2)}` : `-£${Math.abs(notice.priceDiff ?? 0).toFixed(2)}`}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-gray-600">
                            {notice.invoiceNumber || '—'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {notice.status === 'PENDING' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800">
                                Pending
                              </span>
                            )}
                            {notice.status === 'APPROVED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                                Approved
                              </span>
                            )}
                            {notice.status === 'REJECTED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-gray-100 text-gray-600">
                                Rejected
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {notice.status === 'PENDING' && (
                              <div className="flex items-center justify-end gap-1.5">
                                {canReject && (
                                  <button
                                    onClick={() => setRejectingNotice(notice)}
                                    className="px-2.5 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  >
                                    Reject
                                  </button>
                                )}
                                {canApprove && (
                                  <button
                                    onClick={() => setApprovingNotice(notice)}
                                    className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
                                  >
                                    Approve
                                  </button>
                                )}
                              </div>
                            )}
                            {notice.status !== 'PENDING' && (
                              <span className="text-[11px] text-gray-400">
                                {notice.reviewedByUserName ? `By ${notice.reviewedByUserName}` : 'Processed'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: NEW ITEM NOTICES */}
      {activeTab === 'NEW_ITEMS' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex-1 flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search new item notices..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 bg-gray-50 focus:bg-white"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none focus:ring-2 focus:ring-brand-500 font-medium"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="ADDED">Added as New</option>
                <option value="LINKED">Linked</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {filteredNewItems.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-xs">
                No new item notices found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Supplier</th>
                      <th className="py-3 px-4">SKU / Code</th>
                      <th className="py-3 px-4 text-right">Invoiced Price</th>
                      <th className="py-3 px-4">Duplicate Warning</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredNewItems.map((notice) => {
                      const detectedPrice = notice.detectedCasePrice || notice.detectedPackPrice || 0;

                      return (
                        <tr key={notice.id} className="hover:bg-gray-50/70 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap text-gray-500">
                            {notice.detectedDate.split('T')[0]}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-gray-900 block truncate max-w-[220px]">
                              {notice.rawDescription}
                            </span>
                            {notice.rawPackSize && (
                              <span className="text-[10px] text-gray-400">
                                {notice.rawPackSize}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-gray-700">
                            {notice.supplierName}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-gray-600">
                            {notice.rawItemCode || '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-gray-900">
                            £{detectedPrice.toFixed(2)}
                          </td>
                          <td className="py-3 px-4">
                            {notice.possibleDuplicateProductName ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 truncate max-w-[160px]">
                                {notice.possibleDuplicateProductName} ({notice.duplicateMatchScore || 75}%)
                              </span>
                            ) : (
                              <span className="text-gray-400 text-[11px]">None</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {notice.status === 'PENDING' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800">
                                Pending
                              </span>
                            )}
                            {notice.status === 'ADDED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                                Added to Catalog
                              </span>
                            )}
                            {notice.status === 'LINKED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800">
                                Linked
                              </span>
                            )}
                            {notice.status === 'REJECTED' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-gray-100 text-gray-600">
                                Rejected
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {notice.status === 'PENDING' && canManageNew && (
                              <button
                                onClick={() => setResolvingNewItem(notice)}
                                className="px-3 py-1 text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-sm transition-colors"
                              >
                                Resolve
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: INVOICE RECONCILIATION */}
      {activeTab === 'RECONCILIATION' && <InvoiceReconciliationView />}

      {/* TAB 5: PRICE HISTORY & AUDIT */}
      {activeTab === 'HISTORY' && <PriceHistoryView />}

      {/* TAB 6: SETTINGS */}
      {activeTab === 'SETTINGS' && <PriceSettingsView />}

      {/* Modals */}
      <ScanInvoiceModal
        isOpen={isScanOpen}
        onClose={() => setIsScanOpen(false)}
        onSuccess={() => setActiveTab('PENDING')}
      />

      <ApprovePriceChangeModal
        notice={approvingNotice}
        onClose={() => setApprovingNotice(null)}
      />

      <RejectPriceChangeModal
        notice={rejectingNotice}
        onClose={() => setRejectingNotice(null)}
      />

      <ResolveNewItemModal
        notice={resolvingNewItem}
        onClose={() => setResolvingNewItem(null)}
      />
    </div>
  );
};
