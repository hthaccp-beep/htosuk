
import React, { useMemo, useState } from 'react';
import { useAppStore, can } from '../store';
import { ShoppingBag, Clock, AlertCircle, FileText, Loader2, Send, MailWarning, RefreshCw, Trash2, ScanLine, AlertTriangle, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { OrderRecord } from '../types';
import { addLog } from '../logger';
import { generateOrderEmailContent, generateOrderPDF } from '../utils/orderEmail';
import { sendEmail, readEmailError } from '../utils/sendEmail';
import type { EmailAttachment } from '../shared/email';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatRoleName } from '../constants';
import { isUserAuthorizedForBranch } from '../utils/accessControl';

export const Dashboard: React.FC = () => {
  const { currentUser, roles, orders, suppliers, branches, products, priceChangeNotices, newItemNotices, updateOrder, showToast, deleteOrder } = useAppStore();
  const navigate = useNavigate();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deleteDraftId, setDeleteDraftId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const pendingPriceCount = useMemo(() => priceChangeNotices.filter(n => n.status === 'PENDING').length, [priceChangeNotices]);
  const pendingNewCount = useMemo(() => newItemNotices.filter(n => n.status === 'PENDING').length, [newItemNotices]);
  const totalPendingReviews = pendingPriceCount + pendingNewCount;
  
  // Permission Check
  const canViewGlobal = can(currentUser, 'view_global_data');
  const canViewOtherOrders = currentUser?.role === 'CREATOR' || currentUser?.role === 'GM' || can(currentUser, 'view_other_users_orders');

  // Filter orders based on authorized branch access AND Sort by Date Descending (Newest First)
  const myBranchOrders = useMemo(() => {
     let list = [];
     if (canViewGlobal) {
       list = [...orders]; // Create copy to avoid mutating store if we sort
     } else {
       list = orders.filter(o => isUserAuthorizedForBranch(currentUser, o.branchId));
     }
     return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, currentUser, canViewGlobal]);

  // --- WIDGET DATA CALCULATION ---

  // 1. Active Drafts - scoped to authorized branches and user ownership
  const activeDrafts = useMemo(() => {
    return myBranchOrders
      .filter(o => {
        if (o.status !== 'DRAFT') return false;
        if (!canViewOtherOrders && o.orderedByUserId !== currentUser?.id) {
          return false;
        }
        return true;
      });
  }, [myBranchOrders, canViewOtherOrders, currentUser]);

  // --- HANDLERS ---

  const handleResumeDraft = (draft: OrderRecord) => {
    navigate('/place-order', {
      state: {
        cartItems: draft.items,
        manualItems: draft.manualItems,
        branchId: draft.branchId,
        supplierId: draft.supplierId,
        deliveryDate: draft.deliveryDate,
        comments: draft.comments,
        emailTo: draft.emailTo, // Pass saved email
        isDraftResume: true,
        draftId: draft.id
      }
    });
  };

  const handleDeleteDraft = (id: string) => {
    setDeleteDraftId(id);
  };

  const confirmDeleteDraft = async () => {
    if (deleteDraftId) {
        await deleteOrder(deleteDraftId);
        showToast('success', 'Draft deleted successfully.');
        setDeleteDraftId(null);
    }
  };

  const handleResendEmail = async (order: OrderRecord) => {
    if (!navigator.onLine) {
      showToast('error', "Cannot resend email while offline.", "No Connection");
      return;
    }

    setResendingId(order.id);
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
      await updateOrder(order.id, { emailStatus: 'SENT' });
      showToast('success', "Email resent successfully!", "Sent");

    } catch (err: any) {
      console.error(err);
      addLog('error', `Resend Failed: ${err.message}`);
      showToast('error', `Failed to resend: ${err.message}`, "Error");
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="space-y-3 md:space-y-4 animate-fade-in pb-12">
      
      {/* 1. Header */}
      <div className="flex justify-between items-center gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-extrabold text-gray-900 tracking-tight">Dashboard</h2>
          <p className="text-xs text-gray-500 font-medium mt-0.5">
            {currentUser?.displayName} <span className="text-gray-300">·</span> {formatRoleName(currentUser?.role, roles)}
          </p>
        </div>

        {/* Online Status Indicator (top right) */}
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold shadow-2xs transition-all ${
          isOnline 
            ? 'bg-white border-emerald-200 text-emerald-700' 
            : 'bg-amber-50 border-amber-300 text-amber-800'
        }`}>
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      {/* 2. PRIMARY ACTION & KPI ROW */}
      <div className="grid grid-cols-1 min-[720px]:grid-cols-3 gap-3">
        
        {/* Main Action: New Order */}
        <Link to="/place-order" className="bg-gradient-to-br from-brand-600 to-brand-500 rounded-xl p-5 text-white shadow-xl shadow-brand-500/30 hover:shadow-brand-500/40 hover:-translate-y-0.5 transition-all active:scale-[0.98] flex flex-col justify-between h-32 md:h-36 relative overflow-hidden group">
          <div className="z-10">
            <div className="flex justify-between items-start">
              <h3 className="text-xl font-extrabold tracking-tight">New Order</h3>
              <div className="bg-white/20 p-2 rounded-xl backdrop-blur-md">
                <ShoppingBag size={22} className="text-white" />
              </div>
            </div>
            <p className="mt-2 text-brand-100 text-xs font-semibold tracking-wide">Start a fresh supply request.</p>
          </div>
          <div className="absolute -right-6 -bottom-6 bg-white/10 w-24 h-24 rounded-full group-hover:scale-[2] transition-transform duration-700 ease-out"></div>
          <div className="absolute top-0 right-0 p-8 w-full h-full bg-gradient-to-b from-transparent to-black/5 mix-blend-overlay"></div>
        </Link>

        {/* Replacement 1: Order Cutoffs (Replaces Quick Reorder) */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 md:p-5 shadow-sm flex flex-col h-32 md:h-40 relative overflow-hidden">
           <h3 className="font-bold text-gray-900 flex items-center gap-1.5 mb-2 text-xs md:text-sm uppercase tracking-wide">
             <Clock size={16} className="text-gray-500" />
             Order Cutoffs
           </h3>
           <div className="overflow-y-auto pr-1 custom-scrollbar flex-1 -mr-1">
              {suppliers.filter(s => s.active).length === 0 && <p className="text-[10px] md:text-xs text-gray-400 italic">No suppliers configured.</p>}
              {suppliers.filter(s => s.active).map(s => {
                const schedule = s.deliverySchedules[currentUser?.branchId || ''] || s.deliverySchedules['default'];
                if (!schedule) return null;
                return (
                  <div key={s.id} className="mb-2 last:mb-0 border-b border-gray-50 pb-1.5 last:border-0 last:pb-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                       <span className="text-[10px] md:text-xs font-bold text-gray-800 truncate mr-1">{s.name}</span>
                    </div>
                    <p className="text-[9px] md:text-[10px] text-gray-500 leading-tight bg-gray-50 inline-block px-1.5 py-0.5 rounded">{schedule}</p>
                  </div>
                );
              })}
           </div>
        </div>

        {/* Replacement 2: Active Drafts (Replaces Weekly Spend) */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 md:p-5 shadow-sm flex flex-col h-32 md:h-40 relative overflow-hidden">
           <div className="flex justify-between items-center mb-2">
             <h3 className="font-bold text-gray-900 flex items-center gap-1.5 text-xs md:text-sm uppercase tracking-wide">
               <AlertCircle size={16} className="text-orange-500" />
               Active Drafts
             </h3>
             {activeDrafts.length > 0 && (
               <span className="bg-orange-100 text-orange-700 text-[9px] md:text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                 {activeDrafts.length}
               </span>
             )}
           </div>
           
           <div className="overflow-y-auto pr-1 custom-scrollbar flex-1 -mr-1 space-y-1.5 md:space-y-2">
             {activeDrafts.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-gray-400 italic text-[10px] md:text-xs">
                 <p>No active drafts.</p>
                 <p className="text-[9px] md:text-[10px] opacity-70">Start a new order!</p>
               </div>
             ) : (
               activeDrafts.map(draft => (
                 <div key={draft.id} className="flex flex-col p-2 md:p-2.5 bg-orange-50 rounded-md border border-orange-100 group transition-colors hover:bg-orange-100">
                    <div className="flex justify-between items-start mb-1">
                      <p className="text-[10px] md:text-xs font-bold text-gray-900 truncate flex-1 mr-1">{draft.supplierNameSnapshot}</p>
                      <span className="text-[9px] md:text-[10px] text-orange-600 whitespace-nowrap">{new Date(draft.createdAt).toLocaleDateString(undefined, {month:'short', day:'numeric'})}</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-[9px] md:text-[10px] text-orange-800 font-medium">{draft.items.length + draft.manualItems.length} items</span>
                       <div className="flex items-center gap-1.5 md:gap-2">
                           {can(currentUser, 'delete_drafts') && (
                               <button 
                                    onClick={() => handleDeleteDraft(draft.id)}
                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete Draft"
                               >
                                    <Trash2 size={15} />
                                </button>
                           )}
                           <button 
                            onClick={() => handleResumeDraft(draft)}
                            className="text-xs bg-white border border-orange-200 text-orange-700 font-bold px-3 py-1.5 rounded-lg shadow-xs hover:bg-orange-600 hover:text-white active:scale-95 transition-all"
                          >
                            Resume
                          </button>
                       </div>
                    </div>
                 </div>
               ))
             )}
           </div>
        </div>
      </div>

      {/* Price Monitoring Alert Banner */}
      {totalPendingReviews > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/5 border border-amber-300 rounded-xl p-3.5 md:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm animate-scale-in">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-amber-500/20">
              <AlertTriangle size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs md:text-sm font-extrabold text-amber-950">
                  Price Changes & New Products Require Approval
                </h4>
                <span className="bg-amber-600 text-white text-[10px] font-extrabold px-1.5 py-0.2 rounded-full">
                  {totalPendingReviews}
                </span>
              </div>
              <p className="text-[11px] md:text-xs text-amber-800 mt-0.5 font-medium">
                {pendingPriceCount > 0 && `${pendingPriceCount} price change${pendingPriceCount > 1 ? 's' : ''}`}
                {pendingPriceCount > 0 && pendingNewCount > 0 && ' & '}
                {pendingNewCount > 0 && `${pendingNewCount} new product${pendingNewCount > 1 ? 's' : ''}`} detected from scanned delivery notes.
              </p>
            </div>
          </div>
          <Link
            to="/prices"
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-md transition-all whitespace-nowrap flex items-center gap-1.5 self-end sm:self-auto"
          >
            <span>Review Changes</span>
            <ChevronRight size={14} />
          </Link>
        </div>
      )}

      {/* 3. Condensed History (Placed Orders Only) */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 md:p-5 shadow-sm">
        <div className="flex justify-between items-center mb-3 md:mb-4">
           <h3 className="font-bold text-gray-900 flex items-center gap-1.5 text-sm md:text-base">
             <FileText size={18} className="text-gray-500" />
             Recent Orders
           </h3>
           <Link to="/history" className="text-[10px] md:text-xs font-bold text-brand-600 hover:text-brand-700 bg-brand-50 px-2 md:px-3 py-1 md:py-1.5 rounded-md transition-colors">View All</Link>
        </div>
        <div className="overflow-x-auto no-scrollbar">
           <table className="w-full text-xs md:text-sm text-left whitespace-nowrap">
             <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[9px] md:text-[10px] tracking-wide">
               <tr>
                 <th className="px-3 md:px-4 py-2 md:py-3 rounded-l-md">Supplier</th>
                 <th className="px-3 md:px-4 py-2 md:py-3">Date</th>
                 <th className="px-3 md:px-4 py-2 md:py-3">Status</th>
                 <th className="px-3 md:px-4 py-2 md:py-3 rounded-r-md text-right">Items</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-gray-50">
               {myBranchOrders.filter(o => o.status === 'PLACED').slice(0, 5).map(o => (
                 <tr key={o.id} className="hover:bg-gray-50/50">
                   <td className="px-3 md:px-4 py-2.5 md:py-3 font-bold text-gray-900">{o.supplierNameSnapshot}</td>
                   <td className="px-3 md:px-4 py-2.5 md:py-3 text-gray-500 text-[10px] md:text-xs font-medium">{new Date(o.createdAt).toLocaleDateString()}</td>
                   <td className="px-3 md:px-4 py-2.5 md:py-3">
                     <div className="flex flex-col items-start gap-1">
                        {/* Sync Status */}
                        {o._hasPendingWrites && (
                            <span className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 md:px-2 py-0.5 rounded-full">
                               <RefreshCw size={10} className="animate-spin" /> Syncing
                            </span>
                        )}
                        
                        {/* Email / Comms Status */}
                        {o.emailStatus === 'SENT' && (
                            <span className="text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                               Accepted
                            </span>
                        )}
                        {o.emailStatus === 'PARTIAL' && (
                            <span className="text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                               Partial (CC Error)
                            </span>
                        )}
                        {o.emailStatus === 'UNCERTAIN' && (
                            <div className="flex items-center gap-1.5">
                               <span className="text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200 flex items-center gap-1" title="Mail server response timed out. Verify inbox before resending.">
                                  <MailWarning size={10} /> Uncertain
                               </span>
                               <button 
                                  onClick={() => handleResendEmail(o)}
                                  disabled={resendingId === o.id}
                                  className="text-[9px] md:text-[10px] bg-white border border-orange-200 text-orange-700 font-bold px-1.5 md:px-2 py-0.5 rounded shadow-sm hover:bg-orange-50 flex items-center gap-1 transition-colors"
                                  title="Check branch inbox first, then resend if needed"
                               >
                                  {resendingId === o.id ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                                  Resend
                               </button>
                            </div>
                        )}
                        {(o.emailStatus === 'FAILED' || o.emailStatus === 'OFFLINE_MANUAL') && (
                            <div className="flex items-center gap-1.5">
                               <span className="text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
                                  <MailWarning size={10} /> Failed
                               </span>
                               <button 
                                  onClick={() => handleResendEmail(o)}
                                  disabled={resendingId === o.id}
                                  className="text-[9px] md:text-[10px] bg-white border border-red-200 text-red-700 font-bold px-1.5 md:px-2 py-0.5 rounded shadow-sm hover:bg-red-50 flex items-center gap-1 transition-colors"
                               >
                                  {resendingId === o.id ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                                  Retry
                               </button>
                            </div>
                        )}
                        {o.emailStatus === 'SKIPPED' && (
                            <span className="text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                               WhatsApp Only
                            </span>
                        )}
                        {o.emailStatus === 'PENDING' && (
                            <span className="text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
                               Sending...
                            </span>
                        )}
                        {!o.emailStatus && (
                            <span className="text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                               Placed
                            </span>
                        )}
                        {o.whatsAppStatus === 'OPENED' && (
                            <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded">
                               WA Link Opened
                            </span>
                        )}
                     </div>
                   </td>
                   <td className="px-3 md:px-4 py-2.5 md:py-3 text-right font-mono text-[10px] md:text-xs font-medium text-gray-600">{o.items.length + o.manualItems.length}</td>
                 </tr>
               ))}
               {myBranchOrders.filter(o => o.status === 'PLACED').length === 0 && (
                 <tr>
                   <td colSpan={4} className="text-center py-6 md:py-8 text-gray-400 italic text-xs md:text-sm">No recent placed orders.</td>
                 </tr>
               )}
             </tbody>
           </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteDraftId}
        onClose={() => setDeleteDraftId(null)}
        onConfirm={confirmDeleteDraft}
        title="Delete Draft"
        message="Are you sure you want to delete this draft? This cannot be undone."
      />

    </div>
  );
};
