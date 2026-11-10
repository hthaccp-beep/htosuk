import React, { useState, useMemo } from 'react';
import { useAppStore, can } from '../../store';
import { OrderRecord } from '../../types';
import { 
  FileSpreadsheet, Search, Filter, Calendar, MapPin, Truck, 
  CheckCircle2, AlertCircle, FileCheck, ArrowRight, Loader2, RefreshCw 
} from 'lucide-react';
import { InvoiceCrossCheckModal } from '../../components/InvoiceCrossCheckModal';
import { isUserAuthorizedForBranch, getUserAuthorizedBranches } from '../../utils/accessControl';

export const InvoiceReconciliationView: React.FC = () => {
  const { orders, branches, suppliers, currentUser, markOrderAsProcessed, showToast } = useAppStore();

  const canViewGlobal = can(currentUser, 'view_global_data');
  const authorizedBranches = useMemo(() => {
    return getUserAuthorizedBranches(currentUser, branches);
  }, [currentUser, branches]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNVERIFIED' | 'VERIFIED'>('ALL');
  const [crossCheckOrder, setCrossCheckOrder] = useState<OrderRecord | null>(null);

  // Helper to determine if an order is verified (ignoring empty or draft verifications)
  const isOrderVerified = (o: OrderRecord): boolean => {
    return o.receivedStatus === 'PROCESSED' && 
           !!o.invoiceVerification && 
           (o.invoiceVerification.reviewStatus === 'VERIFIED' || o.invoiceVerification.reviewStatus === 'REVIEWED_WITH_EXCEPTION');
  };

  // Filtered orders list (only placed orders, excluding drafts)
  const filteredOrders = useMemo(() => {
    let list = orders.filter(o => o.status === 'PLACED');

    // Branch authorization
    if (!canViewGlobal) {
      list = list.filter(o => isUserAuthorizedForBranch(currentUser, o.branchId));
    }

    // Branch filter
    if (selectedBranchId !== 'ALL') {
      list = list.filter(o => o.branchId === selectedBranchId);
    }

    // Status filter
    if (statusFilter === 'VERIFIED') {
      list = list.filter(isOrderVerified);
    } else if (statusFilter === 'UNVERIFIED') {
      list = list.filter(o => !isOrderVerified(o));
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(o => 
        o.id.toLowerCase().includes(q) ||
        o.branchNameSnapshot.toLowerCase().includes(q) ||
        o.supplierNameSnapshot.toLowerCase().includes(q) ||
        (o.invoiceNumber && o.invoiceNumber.toLowerCase().includes(q))
      );
    }

    // Sort newest first
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, canViewGlobal, currentUser, selectedBranchId, statusFilter, searchQuery]);

  const stats = useMemo(() => {
    const totalPlaced = orders.filter(o => o.status === 'PLACED' && (canViewGlobal || isUserAuthorizedForBranch(currentUser, o.branchId))).length;
    const verified = orders.filter(o => o.status === 'PLACED' && isOrderVerified(o) && (canViewGlobal || isUserAuthorizedForBranch(currentUser, o.branchId))).length;
    const unverified = totalPlaced - verified;
    return { totalPlaced, verified, unverified };
  }, [orders, canViewGlobal, currentUser]);

  const handleCrossCheckComplete = () => {
    setCrossCheckOrder(null);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs">
          <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Total Invoices to Verify</p>
          <p className="text-2xl font-black text-gray-900 mt-1">{stats.totalPlaced}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/20 shadow-2xs">
          <p className="text-[10px] font-bold uppercase text-amber-700 tracking-wider flex items-center gap-1">
            <AlertCircle size={12} /> Pending Reconciliation
          </p>
          <p className="text-2xl font-black text-amber-900 mt-1">{stats.unverified}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-2xs">
          <p className="text-[10px] font-bold uppercase text-emerald-700 tracking-wider flex items-center gap-1">
            <CheckCircle2 size={12} /> Reconciled & Verified
          </p>
          <p className="text-2xl font-black text-emerald-900 mt-1">{stats.verified}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order ID, branch, supplier, invoice #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Branch filter */}
          {(canViewGlobal || authorizedBranches.length > 1) && (
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-gray-700 bg-white outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="ALL">All Branches</option>
              {(canViewGlobal ? branches : authorizedBranches).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-gray-700 bg-white outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="UNVERIFIED">Pending Verification</option>
            <option value="VERIFIED">Verified Only</option>
          </select>
        </div>
      </div>

      {/* Orders List Table */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-xs">
          No orders found matching the reconciliation filters.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50/80 text-gray-500 font-bold border-b border-gray-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">ORDER / DATE</th>
                  <th className="px-4 py-3">BRANCH</th>
                  <th className="px-4 py-3">SUPPLIER</th>
                  <th className="px-4 py-3">DELIVERY</th>
                  <th className="px-4 py-3 text-center">STATUS</th>
                  <th className="px-4 py-3 text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrders.map((order) => {
                  const isVerified = !!order.invoiceVerification;
                  return (
                    <tr key={order.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono font-bold text-gray-800">
                          #{order.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="text-[10px] text-gray-400 block mt-0.5">
                          {new Date(order.createdAt).toLocaleDateString()} · {order.items.length + (order.manualItems?.length || 0)} items
                        </span>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-gray-700">
                          <MapPin size={13} className="text-gray-400 shrink-0" />
                          <span className="font-medium truncate max-w-[180px]">{order.branchNameSnapshot}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800">
                        {order.supplierNameSnapshot}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                        {order.deliveryDate ? (
                          <div className="flex items-center gap-1 text-emerald-700 font-semibold">
                            <Truck size={13} className="shrink-0" />
                            <span>{new Date(order.deliveryDate).toLocaleDateString()}</span>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {isVerified ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={11} /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <AlertCircle size={11} /> Unverified
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setCrossCheckOrder(order)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 ml-auto ${
                            isVerified 
                              ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                              : 'bg-brand-600 hover:bg-brand-700 text-white'
                          }`}
                        >
                          <FileSpreadsheet size={13} />
                          <span>{isVerified ? 'Review Invoice' : 'Check Invoice'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice Cross-Check / OCR Reconciliation Modal */}
      {crossCheckOrder && (
        <InvoiceCrossCheckModal
          order={crossCheckOrder}
          onClose={() => setCrossCheckOrder(null)}
          onSaveAndClose={handleCrossCheckComplete}
        />
      )}
    </div>
  );
};
