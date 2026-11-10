import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, can } from '../store';
import { 
  Trash2, Printer, Calendar, MapPin, Truck, Eye, X, 
  Send, Loader2, MailWarning, RefreshCw, FileSpreadsheet 
} from 'lucide-react';
import { OrderRecord } from '../types';
import { addLog } from '../logger';
import { generateOrderEmailContent, generateOrderPDF } from '../utils/orderEmail';
import { sendEmail, readEmailError, EmailRequestError } from '../utils/sendEmail';
import type { EmailAttachment } from '../shared/email';
import { ConfirmModal } from '../components/ConfirmModal';
import { InvoiceCrossCheckModal } from '../components/InvoiceCrossCheckModal';
import { LIVE_SYNC_DAYS } from '../constants';
import { isUserAuthorizedForBranch, getUserAuthorizedBranches } from '../utils/accessControl';

// Clean Order Details Modal matching ordersystemV3 (Image 3 & 4)
const ViewOrderModal: React.FC<{
  order: OrderRecord | null;
  onClose: () => void;
  onResend: (order: OrderRecord) => void;
  onCheckInvoice?: (order: OrderRecord) => void;
  isResending: boolean;
}> = ({ order, onClose, onResend, onCheckInvoice, isResending }) => {
  React.useEffect(() => {
    if (!order) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [order, onClose]);

  if (!order) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="view-order-title"
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col animate-fade-in overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 pb-3 flex justify-between items-start">
          <div>
            <h3 id="view-order-title" className="text-xl font-bold text-gray-900 leading-tight">Order Details</h3>
            <p className="text-xs text-gray-400 font-mono mt-0.5">#{order.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            aria-label="Close Order Details"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 pt-1 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* 4-Grid: Branch, Supplier, Created, Delivery */}
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">BRANCH</p>
              <p className="font-semibold text-gray-900 leading-snug">{order.branchNameSnapshot}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">SUPPLIER</p>
              <p className="font-semibold text-gray-900 leading-snug">{order.supplierNameSnapshot}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">CREATED</p>
              <p className="font-semibold text-gray-700 leading-snug">{new Date(order.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">DELIVERY</p>
              <p className="font-bold text-emerald-600 leading-snug">
                {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : 'Not set'}
              </p>
            </div>
          </div>

          {/* Communication Status Card */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">COMMUNICATION STATUS</p>
              {order.status === 'DRAFT' ? (
                <span className="inline-flex items-center gap-1.5 font-bold text-amber-700">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span> Draft
                </span>
              ) : order.emailStatus === 'SENT' ? (
                <div className="flex flex-col">
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Accepted by Mail Server
                  </span>
                  <span className="text-[11px] text-gray-500 font-normal">Check branch inbox or spam folder for copy</span>
                </div>
              ) : order.emailStatus === 'PARTIAL' ? (
                <div className="flex flex-col">
                  <span className="inline-flex items-center gap-1.5 font-bold text-amber-700">
                    <MailWarning size={14} className="shrink-0 text-amber-600" /> Partial (CC Delivery Issue)
                  </span>
                  <span className="text-[11px] text-gray-500 font-normal">Supplier accepted; secondary CC failed</span>
                </div>
              ) : order.emailStatus === 'UNCERTAIN' ? (
                <div className="flex flex-col">
                  <span className="inline-flex items-center gap-1.5 font-bold text-orange-700">
                    <MailWarning size={14} className="shrink-0 text-orange-600" /> Uncertain (Server Timed Out)
                  </span>
                  <span className="text-[11px] text-gray-500 font-normal">Please verify branch inbox before retrying</span>
                </div>
              ) : order.emailStatus === 'SKIPPED' ? (
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span> WhatsApp Link Only
                </span>
              ) : (
                <div className="flex flex-col">
                  <span className="inline-flex items-center gap-1.5 font-bold text-red-600">
                    <MailWarning size={14} className="shrink-0" /> Failed / Offline
                  </span>
                  {order.emailError && (
                    <span className="text-[11px] text-red-500 font-normal max-w-xs truncate">{order.emailError}</span>
                  )}
                </div>
              )}
              {order.whatsAppStatus === 'OPENED' && (
                <span className="mt-1 inline-block text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                  WhatsApp Link Opened
                </span>
              )}
            </div>

            {order.status !== 'DRAFT' && order.emailStatus !== 'SENT' && (
              <button
                type="button"
                onClick={() => onResend(order)}
                disabled={isResending}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm text-xs disabled:opacity-50"
              >
                {isResending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Resend Email
              </button>
            )}
          </div>

          {/* Items Ordered List */}
          <div>
            <h4 className="text-xs font-bold text-gray-900 mb-2">Items Ordered</h4>
            <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-xl bg-white p-2.5 custom-scrollbar space-y-1">
              {order.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-1.5 first:pt-0 last:pb-0">
                  <span className="text-gray-800 font-medium truncate pr-2">{item.productNameSnapshot}</span>
                  <span className="text-gray-500 text-[11px] font-semibold whitespace-nowrap shrink-0">
                    Ordered: {item.caseQty > 0 ? `${item.caseQty} ${item.caseUnitSnapshot || 'Bx'}` : ''} {item.packQty > 0 ? `${item.packQty} ${item.packUnitSnapshot || 'Pk'}` : ''}
                  </span>
                </div>
              ))}
              {order.manualItems?.map((m, idx) => (
                <div key={`m-${idx}`} className="flex justify-between items-center py-1.5 first:pt-0 last:pb-0">
                  <span className="text-gray-800 font-medium italic truncate pr-2">{m.description}</span>
                  <span className="text-gray-500 text-[11px] font-semibold whitespace-nowrap shrink-0">
                    Ordered: {m.caseQty > 0 ? `${m.caseQty} Bx` : ''} {m.packQty > 0 ? `${m.packQty} Pk` : ''}
                  </span>
                </div>
              ))}
              {order.items.length === 0 && (!order.manualItems || order.manualItems.length === 0) && (
                <p className="text-gray-400 italic text-center py-2">No items recorded in this order.</p>
              )}
            </div>
          </div>

          {/* Comments if any */}
          {order.comments && (
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">COMMENTS</p>
              <p className="text-xs text-gray-700 italic">"{order.comments}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-2">
          {order.status !== 'DRAFT' && onCheckInvoice ? (
            <button 
              type="button"
              onClick={() => {
                onClose();
                onCheckInvoice(order);
              }}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 active:scale-95 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-xs"
              title="Check Invoice & Reconcile"
            >
              <FileSpreadsheet size={14} />
              <span>Check Invoice</span>
            </button>
          ) : <div />}

          <button 
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const OrderHistory: React.FC = () => {
  const navigate = useNavigate();
  const { 
    orders, currentUser, deleteOrder, branches, suppliers, products, 
    updateOrder, fetchArchivedOrders, showToast 
  } = useAppStore();

  const canViewGlobal = can(currentUser, 'view_global_data');
  const canViewOrderHistory = currentUser?.role === 'CREATOR' || currentUser?.role === 'GM' || can(currentUser, 'view_order_history');
  const canViewOtherOrders = currentUser?.role === 'CREATOR' || currentUser?.role === 'GM' || can(currentUser, 'view_other_users_orders');

  const authorizedBranches = useMemo(() => {
    return getUserAuthorizedBranches(currentUser, branches);
  }, [currentUser, branches]);

  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewOrder, setViewOrder] = useState<OrderRecord | null>(null);
  const [crossCheckOrder, setCrossCheckOrder] = useState<OrderRecord | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 30;

  const selectableBranches = useMemo(() => {
    if (canViewGlobal) {
      const activeOrHistoric = Array.from(new Set(orders.map(o => o.branchId)));
      return activeOrHistoric.map(bid => {
        const found = branches.find(b => b.id === bid);
        const name = found?.name || orders.find(o => o.branchId === bid)?.branchNameSnapshot || bid;
        return { id: bid, name };
      });
    }
    return authorizedBranches.map(b => ({ id: b.id, name: b.name }));
  }, [canViewGlobal, orders, branches, authorizedBranches]);

  const filteredOrders = useMemo(() => {
    if (!canViewOrderHistory) return [];

    return orders
      .filter(o => {
        // 1. Branch Authorization
        if (canViewGlobal) {
          if (filterBranch !== 'all' && o.branchId !== filterBranch) return false;
        } else {
          if (!isUserAuthorizedForBranch(currentUser, o.branchId)) return false;
          if (filterBranch !== 'all' && o.branchId !== filterBranch) return false;
        }

        // 2. Supplier Authorization
        if (currentUser?.role !== 'CREATOR' && currentUser?.role !== 'GM') {
          if (currentUser?.allSuppliers === false) {
            if (!Array.isArray(currentUser?.supplierIds) || currentUser.supplierIds.length === 0) return false;
            if (!currentUser.supplierIds.includes(o.supplierId)) return false;
          } else if (Array.isArray(currentUser?.supplierIds) && currentUser.allSuppliers !== true) {
            if (!currentUser.supplierIds.includes(o.supplierId)) return false;
          }
        }

        // 3. User Ownership Scope
        if (!canViewOtherOrders && o.orderedByUserId !== currentUser?.id) {
          return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Newest First
  }, [orders, canViewOrderHistory, canViewOtherOrders, canViewGlobal, filterBranch, currentUser]);

  const paginatedOrders = useMemo(() => {
    return filteredOrders.slice(0, page * ITEMS_PER_PAGE);
  }, [filteredOrders, page]);

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const oldestDate = filteredOrders.length > 0 
        ? new Date(filteredOrders[filteredOrders.length - 1].createdAt)
        : new Date();
      const start = new Date(oldestDate);
      start.setDate(start.getDate() - 60);

      const end = new Date();
      end.setDate(end.getDate() - LIVE_SYNC_DAYS);
      
      await fetchArchivedOrders(start.toISOString(), end.toISOString());
      setPage(prev => prev + 1);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleResendEmail = async (order: OrderRecord) => {
    if (!navigator.onLine) {
      showToast('error', "Cannot resend email while offline.", "Offline");
      return;
    }

    setIsResending(true);
    try {
      const branch = branches.find(b => b.id === order.branchId);
      const supplier = suppliers.find(s => s.id === order.supplierId);
      
      if (!branch) throw new Error("Branch data not found");

      const { subject, htmlBody } = generateOrderEmailContent(order, branch, supplier, products);
      const pdfBase64 = await generateOrderPDF(order, branch, supplier, products);
      
      const attachments: EmailAttachment[] = [{
        filename: `Order_${order.branchNameSnapshot}_${order.deliveryDate || 'ASAP'}.pdf`,
        content: pdfBase64,
        encoding: 'base64'
      }];

      const response = await sendEmail({
        purpose: 'resend',
        orderId: order.id,
        to: order.emailTo,
        subject,
        html: htmlBody,
        attachments
      });

      if (!response.ok) {
        throw await readEmailError(response);
      }

      addLog('info', `📧 Resent email for order ${order.id.slice(0,8)}`);
      await updateOrder(order.id, { 
        emailStatus: 'SENT',
        emailSentAt: new Date().toISOString(),
        emailError: undefined
      });
      showToast('success', "Mail server accepted the order confirmation email. Please check your branch inbox or spam folder for confirmation.", "Accepted by Mail Server");
      setViewOrder(prev => prev ? { ...prev, emailStatus: 'SENT' } : null);
    } catch (err: any) {
      console.error(err);
      addLog('error', `Resend Failed: ${err.message}`);
      const isUncertain = err instanceof EmailRequestError && err.status === 502;
      const nextStatus = isUncertain ? 'UNCERTAIN' : 'FAILED';
      await updateOrder(order.id, {
        emailStatus: nextStatus,
        emailError: err.message || 'Email resend failed',
        emailRetryCount: (order.emailRetryCount || 0) + 1
      });
      setViewOrder(prev => prev ? { ...prev, emailStatus: nextStatus, emailError: err.message } : null);
      showToast(
        'error',
        isUncertain
          ? 'Mail server response timed out. Delivery status is uncertain; please check your branch inbox/spam folder before attempting again.'
          : `Failed to resend order email: ${err.message || 'Transport error'}. Please check branch email settings.`,
        isUncertain ? 'Status Uncertain' : 'Resend Failed'
      );
    } finally {
      setIsResending(false);
    }
  };

  const handlePrint = (order: OrderRecord) => {
    const branch = branches.find(b => b.id === order.branchId);
    const supplier = suppliers.find(s => s.id === order.supplierId);

    const { htmlBody } = generateOrderEmailContent(order, branch, supplier, products);

    const iframeId = 'print-frame-order-history';
    let iframe = document.getElementById(iframeId) as HTMLIFrameElement;
    if (iframe) {
      document.body.removeChild(iframe);
    }
    
    iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.style.visibility = 'hidden';
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
        <head>
          <title>Order ${order.id.slice(0,8)}</title>
          <style>
            @media print {
              @page { size: A4; margin: 10mm; }
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
            body { font-family: sans-serif; margin: 0; padding: 20px; }
          </style>
        </head>
        <body>
          ${htmlBody}
          <script>
            window.onload = () => {
              setTimeout(() => {
                try { window.print(); } catch(e) { console.error(e); }
              }, 500);
            };
          </script>
        </body>
        </html>
      `);
      doc.close();
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteOrder(deleteId);
      setDeleteId(null);
      showToast('success', "Order deleted successfully.");
    }
  };

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto animate-fade-in">
      {/* Header matching ordersystemV3 (Image 2) */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Order History</h2>
          <p className="text-xs text-gray-400 italic mt-0.5">
            Showing recent orders (Last {LIVE_SYNC_DAYS} Days). Load older data below if needed.
          </p>
        </div>

        {/* Branch Selector */}
        {(canViewGlobal || authorizedBranches.length > 1) && (
          <div className="w-full sm:w-auto">
            <select 
              className="w-full sm:w-auto bg-white border border-gray-200 text-gray-800 rounded-xl px-3.5 py-2 text-xs font-bold focus:ring-2 focus:ring-brand-500 outline-none shadow-xs cursor-pointer hover:border-gray-300 transition-colors"
              value={filterBranch}
              onChange={e => { setFilterBranch(e.target.value); setPage(1); }}
            >
              <option value="all">{canViewGlobal ? 'All Branches' : 'All My Branches'}</option>
              {selectableBranches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Order Table View (Matching Image 2) */}
      {!canViewOrderHistory ? (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200 p-12 text-center">
          <p className="text-gray-800 font-bold text-base">Access Denied</p>
          <p className="text-gray-500 text-xs mt-1">You do not have permission to view order history.</p>
        </div>
      ) : paginatedOrders.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200 p-12 text-center text-gray-400 text-sm">
          No orders found for this view.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50/75 text-gray-500 font-bold border-b border-gray-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">ORDERED</th>
                  <th className="px-5 py-3.5">DELIVERY</th>
                  <th className="px-5 py-3.5">BRANCH</th>
                  <th className="px-5 py-3.5">SUPPLIER</th>
                  <th className="px-5 py-3.5 text-center">STATUS</th>
                  <th className="px-5 py-3.5 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedOrders.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50/75 transition-colors group">
                    {/* Ordered */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-gray-700 font-medium">
                        <Calendar size={14} className="text-gray-400 shrink-0" />
                        <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 pl-5 block mt-0.5">
                        {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>

                    {/* Delivery */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {order.deliveryDate ? (
                        <div className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                          <Truck size={14} className="shrink-0" />
                          <span>{new Date(order.deliveryDate).toLocaleDateString()}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>

                    {/* Branch */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-gray-700">
                        <MapPin size={14} className="text-gray-400 shrink-0" />
                        <span className="font-medium truncate max-w-[200px]">{order.branchNameSnapshot}</span>
                      </div>
                    </td>

                    {/* Supplier */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="font-medium text-gray-800 truncate max-w-[220px] block">
                        {order.supplierNameSnapshot}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5 text-center whitespace-nowrap">
                      <div className="flex flex-col items-center justify-center gap-1">
                        {order.status === 'DRAFT' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Draft
                          </span>
                        ) : order.emailStatus === 'SENT' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100" title="Mail server accepted">
                            Accepted
                          </span>
                        ) : order.emailStatus === 'PARTIAL' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200" title="Accepted by supplier, CC failed">
                            Partial CC
                          </span>
                        ) : order.emailStatus === 'UNCERTAIN' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-200" title="Timeout - verify inbox">
                            Uncertain
                          </span>
                        ) : order.emailStatus === 'SKIPPED' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100" title="WhatsApp opened">
                            WhatsApp
                          </span>
                        ) : order.emailStatus === 'FAILED' || order.emailStatus === 'OFFLINE_MANUAL' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200" title="Email Failed">
                            Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600">
                            Pending
                          </span>
                        )}

                        {order.fulfillmentStatus === 'FULFILLED' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            ✓ Done
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions: View (Eye), Print (Printer), Delete (Trash2) */}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {order.status === 'DRAFT' && can(currentUser, 'edit_drafts') && (
                          <button
                            type="button"
                            onClick={() => navigate('/place-order', {
                              state: {
                                cartItems: order.items,
                                manualItems: order.manualItems,
                                branchId: order.branchId,
                                supplierId: order.supplierId,
                                deliveryDate: order.deliveryDate,
                                comments: order.comments,
                                emailTo: order.emailTo,
                                isDraftResume: true,
                                draftId: order.id,
                              }
                            })}
                            className="px-2.5 py-1 text-brand-600 hover:text-brand-800 hover:bg-brand-50 rounded-lg transition-colors font-bold text-xs mr-1 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                            title="Edit Draft"
                            aria-label="Edit Draft"
                          >
                            Edit
                          </button>
                        )}

                        {/* View Button */}
                        <button
                          type="button"
                          onClick={() => setViewOrder(order)}
                          className="p-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
                          title="View Details"
                          aria-label="View Order Details"
                        >
                          <Eye size={16} />
                        </button>

                        {/* Check Invoice Button (for Placed Orders) */}
                        {order.status !== 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => setCrossCheckOrder(order)}
                            className="p-2 text-brand-600 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                            title="Check Invoice & Reconcile"
                            aria-label="Check Invoice"
                          >
                            <FileSpreadsheet size={16} />
                          </button>
                        )}

                        {/* Print Button */}
                        <button
                          type="button"
                          onClick={() => handlePrint(order)}
                          className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                          title="Print Order"
                          aria-label="Print Order"
                        >
                          <Printer size={16} />
                        </button>

                        {/* Delete Button */}
                        {(can(currentUser, 'delete_orders') || (order.status === 'DRAFT' && can(currentUser, 'delete_drafts'))) && (
                          <button
                            type="button"
                            onClick={() => setDeleteId(order.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
                            title="Delete Order"
                            aria-label="Delete Order"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Load More Button at bottom */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="px-5 py-2 text-xs font-bold text-gray-600 hover:text-brand-600 hover:bg-white rounded-xl border border-gray-200 transition-colors shadow-2xs flex items-center gap-2 disabled:opacity-50"
        >
          {isLoadingMore ? <Loader2 size={14} className="animate-spin text-brand-600" /> : <RefreshCw size={14} />}
          Load Older History
        </button>
      </div>

      {/* View Order Modal (Image 3 & 4) */}
      <ViewOrderModal
        order={viewOrder}
        onClose={() => setViewOrder(null)}
        onResend={handleResendEmail}
        onCheckInvoice={setCrossCheckOrder}
        isResending={isResending}
      />

      {/* Check Invoice / Reconciliation Modal */}
      {crossCheckOrder && (
        <InvoiceCrossCheckModal
          order={crossCheckOrder}
          onClose={() => setCrossCheckOrder(null)}
          onSaveAndClose={() => {
            setCrossCheckOrder(null);
            showToast('success', 'Invoice verification saved successfully.');
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete Order"
        message="Are you sure you want to delete this order? This action cannot be undone."
      />
    </div>
  );
};
