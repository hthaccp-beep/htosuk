
import React, { useState, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore, can } from '../store';
import { OrderRecord, OrderItem, ManualOrderItem } from '../types';
import { 
  Printer, Calendar, Truck, CheckCircle, Clock, Trash2, X, 
  Package, Loader2, AlertCircle, ChevronDown, User, AlertTriangle, FileSpreadsheet, ShieldAlert,
  MailWarning, RefreshCw 
} from 'lucide-react';
import { generateOrderEmailContent, generateOrderPDF } from '../utils/orderEmail';
import { sendEmail, readEmailError } from '../utils/sendEmail';
import { dispatchDeliveryNoteNotification } from '../utils/deliveryCommunication';
import { addLog } from '../logger';
import { ConfirmModal } from '../components/ConfirmModal';
import { InvoiceCrossCheckModal } from '../components/InvoiceCrossCheckModal';
import { 
  computeFulfillmentStatus, 
  canUserProcessFulfillment, 
  STANDARD_SHORTAGE_REASONS 
} from '../utils/fulfillmentEngine';
import { getUserSupplierBranches } from '../utils/accessControl';

// --- FULFILLMENT MODAL COMPONENT ---
const FulfillmentModal: React.FC<{
  order: OrderRecord | null;
  onClose: () => void;
  onConfirm: (
    updatedItems: OrderItem[], 
    updatedManualItems: ManualOrderItem[], 
    status: 'FULFILLED' | 'PARTIAL' | 'UNFULFILLED',
    notificationEmail: string,
    notes?: string
  ) => void;
  isProcessing: boolean;
}> = ({ order, onClose, onConfirm, isProcessing }) => {
  const { branches } = useAppStore();
  const [items, setItems] = useState<OrderItem[]>([]);
  const [manualItems, setManualItems] = useState<ManualOrderItem[]>([]);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (order) {
      setItems(order.items.map(i => ({
        ...i,
        sentCaseQty: i.sentCaseQty !== undefined ? i.sentCaseQty : i.caseQty,
        sentPackQty: i.sentPackQty !== undefined ? i.sentPackQty : i.packQty,
        shortageReason: i.shortageReason || (
          ((i.sentCaseQty !== undefined && i.sentCaseQty < i.caseQty) || (i.sentPackQty !== undefined && i.sentPackQty < i.packQty))
            ? STANDARD_SHORTAGE_REASONS[0] 
            : undefined
        )
      })));
      setManualItems(order.manualItems.map(m => ({
        ...m,
        sentCaseQty: m.sentCaseQty !== undefined ? m.sentCaseQty : m.caseQty,
        sentPackQty: m.sentPackQty !== undefined ? m.sentPackQty : m.packQty,
        shortageReason: m.shortageReason || (
          ((m.sentCaseQty !== undefined && m.sentCaseQty < m.caseQty) || (m.sentPackQty !== undefined && m.sentPackQty < m.packQty))
            ? STANDARD_SHORTAGE_REASONS[0] 
            : undefined
        )
      })));
      
      const branch = branches.find(b => b.id === order.branchId);
      setNotifyEmail(branch?.contactEmail || branch?.email || '');
      setNotes(order.fulfillmentNotes || '');
    }
  }, [order, branches]);

  const fulfillmentCalc = useMemo(() => {
    return computeFulfillmentStatus(items, manualItems);
  }, [items, manualItems]);

  if (!order) return null;

  const handleItemChange = (index: number, field: 'sentCaseQty' | 'sentPackQty', val: string) => {
    const cleanVal = parseInt(val.replace(/[^0-9]/g, '')) || 0;
    const newItems = [...items];
    newItems[index][field] = cleanVal;
    
    // Auto-populate shortage reason if short
    const isShort = (field === 'sentCaseQty' ? cleanVal : (newItems[index].sentCaseQty || 0)) < newItems[index].caseQty ||
                    (field === 'sentPackQty' ? cleanVal : (newItems[index].sentPackQty || 0)) < newItems[index].packQty;
    if (isShort && !newItems[index].shortageReason) {
      newItems[index].shortageReason = STANDARD_SHORTAGE_REASONS[0];
    }
    setItems(newItems);
  };

  const handleItemReasonChange = (index: number, reason: string) => {
    const newItems = [...items];
    newItems[index].shortageReason = reason;
    setItems(newItems);
  };

  const handleManualItemChange = (index: number, field: 'sentCaseQty' | 'sentPackQty', val: string) => {
    const cleanVal = parseInt(val.replace(/[^0-9]/g, '')) || 0;
    const newItems = [...manualItems];
    newItems[index][field] = cleanVal;

    const isShort = (field === 'sentCaseQty' ? cleanVal : (newItems[index].sentCaseQty || 0)) < newItems[index].caseQty ||
                    (field === 'sentPackQty' ? cleanVal : (newItems[index].sentPackQty || 0)) < newItems[index].packQty;
    if (isShort && !newItems[index].shortageReason) {
      newItems[index].shortageReason = STANDARD_SHORTAGE_REASONS[0];
    }
    setManualItems(newItems);
  };

  const handleManualItemReasonChange = (index: number, reason: string) => {
    const newItems = [...manualItems];
    newItems[index].shortageReason = reason;
    setManualItems(newItems);
  };

  const handleSubmit = () => {
    onConfirm(items, manualItems, fulfillmentCalc.status, notifyEmail, notes);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-fade-in">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
               <Truck className="text-brand-600" /> Supplier Fulfillment Check
            </h2>
            <p className="text-xs text-gray-500">Confirm actual quantities dispatched to {order.branchNameSnapshot}</p>
          </div>
          <button onClick={onClose} disabled={isProcessing} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm transition-colors disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-white custom-scrollbar">
           {/* Live Fulfillment Calculation Badge */}
           <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold mb-4 ${
             fulfillmentCalc.status === 'FULFILLED'
               ? 'bg-green-50 text-green-800 border-green-200'
               : fulfillmentCalc.status === 'PARTIAL'
               ? 'bg-amber-50 text-amber-800 border-amber-200'
               : 'bg-red-50 text-red-800 border-red-200'
           }`}>
             <div className="flex items-center gap-2">
               {fulfillmentCalc.status === 'FULFILLED' ? (
                 <CheckCircle size={16} className="text-green-600" />
               ) : (
                 <AlertTriangle size={16} className={fulfillmentCalc.status === 'PARTIAL' ? 'text-amber-600' : 'text-red-600'} />
               )}
               <span>{fulfillmentCalc.summaryText}</span>
             </div>
             <span className="uppercase text-[10px] px-2 py-0.5 rounded-full bg-white shadow-2xs border border-gray-200">
               {fulfillmentCalc.status}
             </span>
           </div>

           <div className="overflow-x-auto">
             <table className="w-full text-sm mb-6 min-w-[620px]">
              <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px] tracking-wider">
                 <tr>
                    <th className="px-4 py-3 text-left">Item Name</th>
                    <th className="px-2 py-3 text-center w-20">Ordered Bx</th>
                    <th className="px-2 py-3 text-center w-20">Sent Bx</th>
                    <th className="px-2 py-3 text-center w-20">Ordered Pk</th>
                    <th className="px-2 py-3 text-center w-20">Sent Pk</th>
                    <th className="px-3 py-3 text-left w-48">Status / OOS Reason</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                 {items.map((item, idx) => {
                    const isShortBox = (item.sentCaseQty || 0) < item.caseQty;
                    const isShortPack = (item.sentPackQty || 0) < item.packQty;
                    const isShort = isShortBox || isShortPack;

                    return (
                       <tr key={idx} className={`hover:bg-gray-50 ${isShort ? 'bg-amber-50/20' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-900">{item.productNameSnapshot}</td>
                          <td className="px-2 py-3 text-center text-gray-500 font-mono">{item.caseQty}</td>
                          <td className="px-2 py-3 text-center">
                             <input 
                               type="number" 
                               min="0"
                               className={`w-16 text-center border rounded py-1 font-bold outline-none focus:ring-2 focus:ring-brand-500 ${isShortBox ? 'border-red-300 text-red-600 bg-red-50' : 'border-gray-200 text-green-700'}`}
                               value={item.sentCaseQty} 
                               onChange={(e) => handleItemChange(idx, 'sentCaseQty', e.target.value)}
                             />
                          </td>
                          <td className="px-2 py-3 text-center text-gray-500 font-mono">{item.packQty}</td>
                          <td className="px-2 py-3 text-center">
                             <input 
                               type="number" 
                               min="0"
                               className={`w-16 text-center border rounded py-1 font-bold outline-none focus:ring-2 focus:ring-brand-500 ${isShortPack ? 'border-red-300 text-red-600 bg-red-50' : 'border-gray-200 text-green-700'}`}
                               value={item.sentPackQty} 
                               onChange={(e) => handleItemChange(idx, 'sentPackQty', e.target.value)}
                             />
                          </td>
                          <td className="px-3 py-3">
                            {isShort ? (
                              <select
                                className="w-full text-xs border border-red-200 bg-red-50 text-red-800 rounded px-2 py-1 font-medium outline-none focus:ring-1 focus:ring-red-400"
                                value={item.shortageReason || STANDARD_SHORTAGE_REASONS[0]}
                                onChange={(e) => handleItemReasonChange(idx, e.target.value)}
                              >
                                {STANDARD_SHORTAGE_REASONS.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-green-700 font-bold text-xs flex items-center gap-1">
                                <CheckCircle size={14} /> Full
                              </span>
                            )}
                          </td>
                       </tr>
                    );
                 })}
                 {manualItems.map((item, idx) => {
                    const isShortBox = (item.sentCaseQty || 0) < item.caseQty;
                    const isShortPack = (item.sentPackQty || 0) < item.packQty;
                    const isShort = isShortBox || isShortPack;

                    return (
                       <tr key={`m-${idx}`} className={`bg-yellow-50/30 ${isShort ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-900">{item.description} <span className="text-[10px] text-yellow-600 bg-yellow-100 px-1 rounded ml-1">Manual</span></td>
                          <td className="px-2 py-3 text-center text-gray-500 font-mono">{item.caseQty}</td>
                          <td className="px-2 py-3 text-center">
                             <input 
                               type="number" 
                               min="0"
                               className={`w-16 text-center border rounded py-1 font-bold outline-none focus:ring-2 focus:ring-brand-500 ${isShortBox ? 'border-red-300 text-red-600 bg-red-50' : 'border-gray-200 text-green-700'}`}
                               value={item.sentCaseQty} 
                               onChange={(e) => handleManualItemChange(idx, 'sentCaseQty', e.target.value)}
                             />
                          </td>
                          <td className="px-2 py-3 text-center text-gray-500 font-mono">{item.packQty}</td>
                          <td className="px-2 py-3 text-center">
                             <input 
                               type="number" 
                               min="0"
                               className={`w-16 text-center border rounded py-1 font-bold outline-none focus:ring-2 focus:ring-brand-500 ${isShortPack ? 'border-red-300 text-red-600 bg-red-50' : 'border-gray-200 text-green-700'}`}
                               value={item.sentPackQty} 
                               onChange={(e) => handleManualItemChange(idx, 'sentPackQty', e.target.value)}
                             />
                          </td>
                          <td className="px-3 py-3">
                            {isShort ? (
                              <select
                                className="w-full text-xs border border-red-200 bg-red-50 text-red-800 rounded px-2 py-1 font-medium outline-none focus:ring-1 focus:ring-red-400"
                                value={item.shortageReason || STANDARD_SHORTAGE_REASONS[0]}
                                onChange={(e) => handleManualItemReasonChange(idx, e.target.value)}
                              >
                                {STANDARD_SHORTAGE_REASONS.map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-green-700 font-bold text-xs flex items-center gap-1">
                                <CheckCircle size={14} /> Full
                              </span>
                            )}
                          </td>
                       </tr>
                    );
                 })}
              </tbody>
           </table>
           </div>

           {/* Notes / Dispatch instructions */}
           <div className="mb-4">
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Fulfillment Notes / Dispatch Instructions</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes for receiving branch kitchen manager (e.g. substitutions, temperature check notes)..."
                className="w-full border border-gray-200 rounded-lg p-2.5 text-xs h-16 outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              />
           </div>

           <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-2">
              <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Delivery Notification Email</label>
              <div className="flex gap-2">
                 <input 
                   type="email" 
                   value={notifyEmail}
                   onChange={(e) => setNotifyEmail(e.target.value)}
                   className="flex-1 border border-blue-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                   placeholder="branch@example.com"
                 />
              </div>
              <p className="text-xs text-blue-600 mt-1">Ordering branch will receive an automated Delivery Note PDF with shortages and dispatched items itemized.</p>
           </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-white rounded-b-2xl flex justify-end gap-3">
           <button onClick={onClose} disabled={isProcessing} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors text-sm">Cancel</button>
           <button onClick={handleSubmit} disabled={isProcessing} className="px-5 py-2.5 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 shadow-md transition-colors text-sm flex items-center gap-2">
              {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
              Confirm & Issue Delivery Note
           </button>
        </div>
      </div>
    </div>
  );
};

export const ReceivedOrders: React.FC = () => {
    const { orders, currentUser, markOrderAsProcessed, suppliers, branches, products, deleteOrder, showToast } = useAppStore();
    
    // State
    const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
    const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
    const [crossCheckOrder, setCrossCheckOrder] = useState<OrderRecord | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Internal Branch Selection (Receiver Context)
    const [selectedInternalBranchId, setSelectedInternalBranchId] = useState<string>('');
    
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // 1. Identify Internal Branches (Only branches marked as supplier that user is authorized to see)
    const internalBranches = useMemo(() => {
        return getUserSupplierBranches(currentUser, branches);
    }, [currentUser, branches]);

    // Initialize & Synchronize Selection to an authorized supplier branch
    useEffect(() => {
        if (internalBranches.length > 0) {
            if (!selectedInternalBranchId || !internalBranches.some(b => b.id === selectedInternalBranchId)) {
                setSelectedInternalBranchId(internalBranches[0].id);
            }
        } else {
            setSelectedInternalBranchId('');
        }
    }, [internalBranches, selectedInternalBranchId]);

    // 2. Identify the Supplier Record(s) linked to the Selected Internal Branch
    const matchingSupplierIds = useMemo(() => {
        if (!selectedInternalBranchId) return new Set<string>();
        const ids = new Set<string>();
        ids.add(selectedInternalBranchId);
        const branchObj = branches.find(b => b.id === selectedInternalBranchId);
        suppliers.forEach(s => {
            if (s.linkedBranchId === selectedInternalBranchId || s.id === selectedInternalBranchId) {
                ids.add(s.id);
            } else if (branchObj && s.name.trim().toLowerCase() === branchObj.name.trim().toLowerCase()) {
                ids.add(s.id);
            }
        });
        return ids;
    }, [suppliers, branches, selectedInternalBranchId]);

    const targetSupplier = useMemo(() => {
        if (!selectedInternalBranchId) return null;
        const branchObj = branches.find(b => b.id === selectedInternalBranchId);
        return suppliers.find(s => 
            s.linkedBranchId === selectedInternalBranchId || 
            s.id === selectedInternalBranchId ||
            (branchObj && s.name.trim().toLowerCase() === branchObj.name.trim().toLowerCase())
        ) || null;
    }, [suppliers, branches, selectedInternalBranchId]);

    const targetSupplierId = targetSupplier?.id || selectedInternalBranchId || null;

    // 3. Filter Orders sent TO this supplier
    const displayedOrders = useMemo(() => {
        if (matchingSupplierIds.size === 0) return [];

        return orders
          .filter(o => {
              // Match supplier (sent to this supplier branch)
              const isToMe = matchingSupplierIds.has(o.supplierId);
              if (!isToMe) return false;

              // Tab Filter
              if (activeTab === 'new') {
                  // "New" = Placed status AND (New or undefined received status)
                  return o.status === 'PLACED' && (!o.receivedStatus || o.receivedStatus === 'NEW');
              } else {
                  // "History" = Processed
                  return o.receivedStatus === 'PROCESSED';
              }
          })
          .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [orders, matchingSupplierIds, activeTab]);

    const newOrderCount = useMemo(() => {
        if (matchingSupplierIds.size === 0) return 0;
        
        return orders.filter(o => 
            matchingSupplierIds.has(o.supplierId) && 
            o.status === 'PLACED' && 
            (!o.receivedStatus || o.receivedStatus === 'NEW')
        ).length;
    }, [orders, matchingSupplierIds]);

    const handleOpenFulfillment = (order: OrderRecord) => {
        const auth = canUserProcessFulfillment(currentUser, order, suppliers, branches);
        if (!auth.allowed) {
            showToast('error', auth.reason || 'You do not have permission to process fulfillment for this order.', 'Permission Denied');
            return;
        }
        setSelectedOrder(order);
    };

    const handleFulfillment = async (
        updatedItems: OrderItem[], 
        updatedManualItems: ManualOrderItem[], 
        status: 'FULFILLED' | 'PARTIAL' | 'UNFULFILLED',
        notificationEmail: string,
        notes?: string
    ) => {
        if (!selectedOrder) return;

        const auth = canUserProcessFulfillment(currentUser, selectedOrder, suppliers, branches);
        if (!auth.allowed) {
            showToast('error', auth.reason || 'You do not have permission to fulfill this order.', 'Unauthorized');
            return;
        }

        setIsProcessing(true);

        try {
            const nowIso = new Date().toISOString();
            const fulfillmentUpdates: Partial<OrderRecord> = {
                items: updatedItems,
                manualItems: updatedManualItems,
                fulfillmentStatus: status,
                processedAt: nowIso,
                processedByUserId: currentUser?.id,
                processedByNameSnapshot: currentUser?.displayName,
                fulfillmentNotes: notes,
                receivedStatus: 'PROCESSED',
                deliveryEmailStatus: notificationEmail ? 'PENDING' : undefined
            };

            // 1. Save durable fulfillment record to database FIRST
            await markOrderAsProcessed(selectedOrder.id, fulfillmentUpdates);

            // 2. Dispatch delivery note email if requested
            if (notificationEmail && navigator.onLine) {
                const branch = branches.find(b => b.id === selectedOrder.branchId);
                const supplier = suppliers.find(s => s.id === selectedOrder.supplierId);
                if (!branch) throw new Error("Branch data missing");

                const result = await dispatchDeliveryNoteNotification({
                    order: { ...selectedOrder, ...fulfillmentUpdates },
                    branch,
                    supplier,
                    products,
                    recipientEmail: notificationEmail
                });

                if (result.success) {
                    await markOrderAsProcessed(selectedOrder.id, {
                        deliveryEmailStatus: 'SENT',
                        deliveryEmailSentAt: result.sentAt,
                        deliveryEmailError: undefined
                    });
                    addLog('info', `🚚 Delivery Note sent to ${notificationEmail}`);
                } else {
                    addLog('error', `Delivery Note Email Failure: ${result.error}`);
                    await markOrderAsProcessed(selectedOrder.id, {
                        deliveryEmailStatus: 'FAILED',
                        deliveryEmailError: result.error,
                        deliveryEmailRetryCount: (selectedOrder.deliveryEmailRetryCount || 0) + 1
                    });
                    showToast('warning', `Fulfillment saved, but Delivery Note email failed: ${result.error}`, 'Email Not Sent');
                    setSelectedOrder(null);
                    return;
                }
            }

            showToast('success', `Order #${selectedOrder.id.slice(0,5).toUpperCase()} marked as ${status}.`, 'Fulfillment Recorded');
            setSelectedOrder(null);
            
        } catch (err: any) {
            console.error(err);
            addLog('error', `Fulfillment Error: ${err.message}`);
            showToast('error', err.message || 'Failed to process fulfillment', 'Fulfillment Error');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRetryDeliveryNote = async (order: OrderRecord) => {
        const branch = branches.find(b => b.id === order.branchId);
        const supplier = suppliers.find(s => s.id === order.supplierId);
        if (!branch) {
            showToast('error', 'Branch information missing', 'Retry Failed');
            return;
        }

        const targetEmail = branch.contactEmail || order.emailTo;
        if (!targetEmail) {
            showToast('error', 'No notification email address found for this branch', 'Retry Failed');
            return;
        }

        setIsProcessing(true);
        try {
            await markOrderAsProcessed(order.id, { deliveryEmailStatus: 'PENDING' });
            const result = await dispatchDeliveryNoteNotification({
                order,
                branch,
                supplier,
                products,
                recipientEmail: targetEmail
            });

            if (result.success) {
                await markOrderAsProcessed(order.id, {
                    deliveryEmailStatus: 'SENT',
                    deliveryEmailSentAt: result.sentAt,
                    deliveryEmailError: undefined
                });
                showToast('success', `Delivery Note successfully sent to ${targetEmail}`, 'Delivery Note Sent');
            } else {
                await markOrderAsProcessed(order.id, {
                    deliveryEmailStatus: 'FAILED',
                    deliveryEmailError: result.error,
                    deliveryEmailRetryCount: (order.deliveryEmailRetryCount || 0) + 1
                });
                showToast('error', `Delivery Note send failed: ${result.error}`, 'Delivery Note Failed');
            }
        } catch (err: any) {
            await markOrderAsProcessed(order.id, {
                deliveryEmailStatus: 'FAILED',
                deliveryEmailError: err.message,
                deliveryEmailRetryCount: (order.deliveryEmailRetryCount || 0) + 1
            });
            showToast('error', err.message, 'Retry Error');
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePrintChecklist = async (order: OrderRecord) => {
        const receiverBranch = branches.find(b => b.id === selectedInternalBranchId);
        const receiverName = receiverBranch ? receiverBranch.name : 'Unknown Branch';
        
        const iframeId = 'checklist-print-frame';
        let iframe = document.getElementById(iframeId) as HTMLIFrameElement;
        if (iframe) document.body.removeChild(iframe);
        iframe = document.createElement('iframe');
        iframe.id = iframeId;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        
        const doc = iframe.contentWindow?.document;
        if (doc) {
            doc.open();
            
            // Prepare Items List
            const allItems = [
                ...order.items.map(i => ({
                    name: i.productNameSnapshot,
                    qty: `${i.caseQty > 0 ? i.caseQty + ' Box' : ''} ${i.packQty > 0 ? i.packQty + ' Pack' : ''}`.trim()
                })),
                ...order.manualItems.map(i => ({
                    name: i.description + ' (Manual)',
                    qty: `${i.caseQty > 0 ? i.caseQty + ' Box' : ''} ${i.packQty > 0 ? i.packQty + ' Pack' : ''}`.trim()
                }))
            ];

            doc.write(`
                <html>
                <head>
                    <title>Packing Slip ${order.id.slice(0,5)}</title>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
                        body { 
                            font-family: 'Inter', sans-serif; 
                            padding: 40px; 
                            color: #000;
                            -webkit-print-color-adjust: exact; 
                        }
                        .header-row { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; }
                        .main-title { font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
                        .meta-block { text-align: right; font-size: 11px; line-height: 1.4; }
                        
                        .info-grid {
                            border-top: 3px solid #000;
                            border-bottom: 1px solid #ccc;
                            padding: 15px 0;
                            margin-bottom: 30px;
                            display: flex;
                            justify-content: space-between;
                            font-size: 12px;
                        }
                        .col { display: flex; flex-direction: column; gap: 6px; }
                        .label { font-weight: 800; text-transform: uppercase; margin-right: 5px; }
                        
                        .items-container {
                            display: grid;
                            grid-template-columns: 1fr 1fr 1fr;
                            column-gap: 40px;
                            row-gap: 15px;
                            font-size: 11px;
                        }
                        
                        .item-row {
                            display: flex;
                            justify-content: space-between;
                            align-items: flex-end;
                            border-bottom: 1px dotted #999;
                            padding-bottom: 2px;
                        }
                        .item-name { font-weight: 600; padding-right: 10px; }
                        .item-qty { font-weight: 800; white-space: nowrap; }
                        
                        .footer {
                            margin-top: 40px;
                            border-top: 1px solid #eee;
                            padding-top: 10px;
                            text-align: center;
                            font-size: 10px;
                            color: #666;
                            font-weight: 500;
                        }
                        
                        @media print {
                            @page { margin: 10mm; size: A4; }
                        }
                    </style>
                </head>
                <body>
                    <div class="header-row">
                        <div class="main-title">PACKING SLIP</div>
                        <div class="meta-block">
                            <div><strong>ORDER #${order.id.slice(0,8).toUpperCase()}</strong></div>
                            <div>${new Date(order.createdAt).toLocaleString('en-GB')}</div>
                        </div>
                    </div>
                    
                    <div class="info-grid">
                        <div class="col">
                            <div><span class="label">FROM:</span> ${order.branchNameSnapshot}</div>
                            <div><span class="label">ORDERED BY:</span> ${order.orderedByNameSnapshot}</div>
                        </div>
                        <div class="col">
                            <div><span class="label">DATE:</span> ${new Date(order.createdAt).toLocaleDateString('en-GB')}</div>
                            <div><span class="label">TIME:</span> ${new Date(order.createdAt).toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'})}</div>
                        </div>
                        <div class="col">
                            <div style="font-size: 14px;"><span class="label">DELIVERY:</span> <strong>${order.deliveryDate || 'ASAP'}</strong></div>
                        </div>
                    </div>
                    
                    <div class="items-container">
                        ${allItems.map(item => `
                            <div class="item-row">
                                <span class="item-name">${item.name}</span>
                                <span class="item-qty">${item.qty}</span>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="footer">
                        Internal Use Only • ${order.branchNameSnapshot} to ${receiverName}
                    </div>
                </body>
                </html>
            `);
            doc.close();
            setTimeout(() => {
                try {
                    iframe.contentWindow?.print();
                } catch(e) { console.error("Print Error", e); }
            }, 500);
        }
    };

    const confirmDelete = () => {
        if (deleteId) {
            deleteOrder(deleteId);
            setDeleteId(null);
        }
    };

    if (internalBranches.length === 0) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className="pb-20 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Incoming Orders</h2>
                    <p className="text-gray-500 text-sm font-medium">Manage incoming stock requests from client branches.</p>
                </div>
                
                {/* Branch Selector: Only show assigned branches that are marked as supplier */}
                {internalBranches.length > 1 ? (
                    <div className="relative">
                        <select 
                            value={selectedInternalBranchId} 
                            onChange={(e) => setSelectedInternalBranchId(e.target.value)}
                            className="appearance-none bg-white border border-gray-300 text-gray-700 py-2 pl-4 pr-10 rounded-xl shadow-sm text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                            {internalBranches.map(b => (
                                <option key={b.id} value={b.id}>{b.name} (Supplier Branch)</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                    </div>
                ) : (
                    <div className="flex items-center gap-2 bg-purple-50 text-purple-700 px-3 py-2 rounded-xl border border-purple-200 text-xs font-bold shadow-xs">
                        <Truck size={15} />
                        <span>{internalBranches[0]?.name} (Supplier Branch)</span>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
                <button 
                    onClick={() => setActiveTab('new')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'new' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <Clock size={16} /> New Orders
                    {newOrderCount > 0 && <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-xs">{newOrderCount}</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('history')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'history' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <CheckCircle size={16} /> Order History
                </button>
            </div>

            {/* List */}
            {displayedOrders.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-400">
                    <Package size={48} className="mx-auto mb-4 opacity-20" />
                    {selectedInternalBranchId ? (
                        targetSupplierId ? (
                            <p>No orders found for this supplier.</p>
                        ) : (
                            <div className="text-orange-600 bg-orange-50 p-4 rounded-lg inline-block border border-orange-200">
                                <p className="font-bold">Configuration Error</p>
                                <p className="text-xs mt-1">This branch acts as a supplier, but no Supplier Record is linked to it in the database.</p>
                                <p className="text-xs mt-1">Please ask Admin to link a Supplier to this Branch ID.</p>
                            </div>
                        )
                    ) : (
                        <p>No internal branch context selected.</p>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {displayedOrders.map(order => (
                        <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-brand-200 transition-all group">
                             {/* Top Row: Sender Info & Item Count */}
                             <div className="flex justify-between items-start mb-2">
                                <div>
                                    <h3 className="text-base font-bold text-gray-900">{order.branchNameSnapshot}</h3>
                                    <p className="text-xs text-gray-500 font-medium flex items-center gap-1 mt-0.5">
                                        {order.orderedByNameSnapshot || 'Unknown User'}
                                    </p>
                                </div>
                                <div className="text-right">
                                     <span className="inline-block bg-blue-50 text-blue-700 text-xs font-bold px-2 py-1 rounded-lg border border-blue-100">
                                        {order.items.length + order.manualItems.length} Items
                                     </span>
                                </div>
                             </div>

                             {/* Dates Row */}
                             <div className="flex flex-wrap gap-4 text-xs text-gray-500 font-medium mb-4">
                                <span className="flex items-center gap-1.5"><Calendar size={14} className="text-gray-400"/> {new Date(order.createdAt).toLocaleDateString('en-GB')}</span>
                                <span className="flex items-center gap-1.5"><Truck size={14} className="text-gray-400"/> Due: {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('en-GB') : 'ASAP'}</span>
                             </div>

                             {/* Comments if any */}
                             {order.comments && (
                                <div className="mb-4 text-xs text-gray-600 bg-yellow-50 px-3 py-2 rounded border border-yellow-100">
                                    "{order.comments}"
                                </div>
                             )}

                             {/* Fulfillment & Delivery Note Notification Status (for processed history) */}
                             {order.receivedStatus === 'PROCESSED' && (
                                <div className="mb-3 p-3 bg-gray-50/90 rounded-lg border border-gray-200 text-xs flex flex-wrap items-center justify-between gap-2">
                                   <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-bold text-gray-700">Fulfillment:</span>
                                      {order.fulfillmentStatus === 'FULFILLED' && (
                                         <span className="inline-flex items-center gap-1 font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                                            <CheckCircle size={12} /> Fulfilled
                                         </span>
                                      )}
                                      {order.fulfillmentStatus === 'PARTIAL' && (
                                         <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                            <AlertTriangle size={12} /> Partial / Shortages
                                         </span>
                                      )}
                                      {order.fulfillmentStatus === 'UNFULFILLED' && (
                                         <span className="inline-flex items-center gap-1 font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                                            <X size={12} /> Unfulfilled
                                         </span>
                                      )}
                                   </div>

                                   <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-bold text-gray-700">Delivery Note:</span>
                                      {order.deliveryEmailStatus === 'SENT' && (
                                         <span className="inline-flex items-center gap-1 font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200" title={order.deliveryEmailSentAt ? `Sent at ${new Date(order.deliveryEmailSentAt).toLocaleString()}` : 'Sent'}>
                                            <CheckCircle size={12} /> Sent {order.deliveryEmailSentAt ? new Date(order.deliveryEmailSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                         </span>
                                      )}
                                      {order.deliveryEmailStatus === 'PENDING' && (
                                         <span className="inline-flex items-center gap-1 font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                                            <Loader2 size={12} className="animate-spin" /> Sending...
                                         </span>
                                      )}
                                      {order.deliveryEmailStatus === 'FAILED' && (
                                         <div className="flex items-center gap-1.5">
                                            <span className="inline-flex items-center gap-1 font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200 cursor-help" title={order.deliveryEmailError || 'Failed to dispatch delivery note'}>
                                               <MailWarning size={12} /> Failed {order.deliveryEmailRetryCount ? `(${order.deliveryEmailRetryCount} retries)` : ''}
                                            </span>
                                            <button
                                               onClick={() => handleRetryDeliveryNote(order)}
                                               disabled={isProcessing}
                                               className="px-2 py-0.5 bg-red-600 text-white font-bold rounded text-[11px] hover:bg-red-700 transition-colors shadow-xs flex items-center gap-1"
                                               title="Retry sending Delivery Note to ordering branch"
                                            >
                                               <RefreshCw size={10} /> Retry
                                            </button>
                                         </div>
                                      )}
                                      {!order.deliveryEmailStatus && (
                                         <span className="text-gray-400 italic">Not Dispatched</span>
                                      )}
                                   </div>
                                </div>
                             )}

                             {/* Action Bar (Gray Background) */}
                             <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-50">
                                <button 
                                    onClick={() => handlePrintChecklist(order)}
                                    className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-3 py-2 rounded-lg transition-colors"
                                >
                                    <Printer size={16} /> Print Checklist
                                </button>
                                
                                <div className="flex items-center gap-2">
                                    <button 
                                        type="button"
                                        onClick={() => setCrossCheckOrder(order)}
                                        className="bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 px-3 py-2 rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 shadow-2xs"
                                        title="Check Invoice & Reconcile"
                                    >
                                        <FileSpreadsheet size={15} /> Check Invoice
                                    </button>
                                    {activeTab === 'new' ? (
                                        <button 
                                            onClick={() => handleOpenFulfillment(order)}
                                            className="bg-brand-600 text-white px-4 py-2 rounded-lg font-bold text-xs shadow-sm hover:bg-brand-700 transition-colors flex items-center gap-2"
                                        >
                                            <CheckCircle size={16} /> Process Order
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={() => handleOpenFulfillment(order)}
                                            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-bold text-xs hover:bg-gray-200 transition-colors flex items-center gap-2"
                                        >
                                            <CheckCircle size={16} /> View Details
                                        </button>
                                    )}
                                    
                                    <button 
                                        onClick={() => setDeleteId(order.id)}
                                        className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors border border-transparent hover:border-red-100"
                                        title="Delete Order"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                             </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modals */}
            {selectedOrder && (
                <FulfillmentModal 
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    onConfirm={handleFulfillment}
                    isProcessing={isProcessing}
                />
            )}

            {crossCheckOrder && (
                <InvoiceCrossCheckModal
                    order={crossCheckOrder}
                    onClose={() => setCrossCheckOrder(null)}
                    onSaveAndClose={() => {
                        setCrossCheckOrder(null);
                    }}
                />
            )}
            
            <ConfirmModal 
                isOpen={!!deleteId}
                onClose={() => setDeleteId(null)}
                onConfirm={confirmDelete}
                title="Delete Received Order"
                message="Are you sure you want to delete this order? This action cannot be undone."
            />
        </div>
    );
};
