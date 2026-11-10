import React from 'react';
import { 
  X, AlertTriangle, Calendar, MessageCircle, 
  Save, Clipboard, Check, Loader2, Tag, Info, MapPin, FileText, Paperclip 
} from 'lucide-react';
import { CartItem, ManualOrderItem, Product, Branch, Supplier, getCaseUnitLabel, getPackUnitLabel } from '../../../types';
import { OrderTotalsBreakdown } from '../../../utils/orderPricing';
import { useAppStore, can } from '../../../store';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  
  cartItems: CartItem[];
  manualItems: ManualOrderItem[];
  products: Product[];
  
  activeBranch: Branch | undefined;
  activeSupplier: Supplier | undefined;
  deliveryDate: string;
  estimatedTotal: number;
  orderTotals?: OrderTotalsBreakdown;
  
  comments: string;
  onCommentsChange: (val: string) => void;
  emailOverride: string;
  onEmailChange: (val: string) => void;
  
  // Presentation Props (Logic Removed)
  submitLabel: string;
  SubmitIcon: React.ElementType;
  submitVariant: string;
  
  sendMethod: 'EMAIL' | 'WHATSAPP' | 'BOTH'; // Used for info display only
  isOffline: boolean;
  isSending: boolean;
  copySuccess: boolean;
  
  onSaveDraft: () => void;
  onCopy: () => void;
  onSubmit: () => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen, onClose, cartItems, manualItems, products, activeBranch, activeSupplier,
  deliveryDate, estimatedTotal, orderTotals, comments, onCommentsChange, emailOverride, onEmailChange,
  sendMethod, isOffline, isSending, copySuccess, onSaveDraft, onCopy, onSubmit,
  submitLabel, SubmitIcon, submitVariant
}) => {
  const { currentUser } = useAppStore();
  const canViewPrices = can(currentUser, 'view_prices');
  const canSubmit = can(currentUser, 'submit_orders');
  const canSaveDraft = can(currentUser, 'edit_drafts') || can(currentUser, 'create_orders');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-end md:items-center justify-center md:p-4 backdrop-blur-md pt-[env(safe-area-inset-top)]">
      <div className="bg-white w-full max-h-[96dvh] md:h-auto md:max-w-lg md:max-h-[90dvh] rounded-t-[2rem] md:rounded-3xl shadow-2xl flex flex-col animate-slide-up md:animate-fade-in overflow-hidden">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white z-10 flex-shrink-0">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900 tracking-tight">Review Order & Email</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase">{activeBranch?.name}</span>
              <span className="text-gray-300">•</span>
              <span className="text-[10px] font-bold text-brand-600 uppercase">{activeSupplier?.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-gray-50 p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4 bg-gray-50/50 overscroll-contain">
          {/* Prominent Context Banner */}
          <div className="bg-gradient-to-r from-brand-50 to-slate-50 border border-brand-200 rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-extrabold text-brand-600 uppercase tracking-widest block mb-1">
              Target Branch & Supplier
            </span>
            <div className="flex items-center gap-2 text-base font-black text-gray-900 flex-wrap">
              <span className="bg-brand-600 text-white px-2.5 py-0.5 rounded-lg text-sm font-extrabold flex items-center gap-1 shadow-xs">
                <MapPin size={14} /> {activeBranch?.name || 'No Branch'}
              </span>
              <span className="text-gray-400">·</span>
              <span className="text-brand-800 text-sm font-bold">
                {activeSupplier?.name}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">
              Ordering for: <strong className="text-gray-800">{activeBranch?.name}</strong> · <strong className="text-gray-800">{activeSupplier?.name}</strong>
            </p>
          </div>
          {isOffline && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-start gap-2 shadow-sm">
              <AlertTriangle className="text-orange-600 shrink-0" size={16} />
              <div>
                <h4 className="text-xs font-bold text-orange-800 uppercase tracking-wide mb-0.5">Offline Mode Active</h4>
                <p className="text-[10px] text-orange-700 leading-relaxed">
                  The system cannot send emails automatically. This order will be saved to History, and a PDF copy will be downloaded to your device. You must send this PDF to the supplier manually.
                </p>
              </div>
            </div>
          )}
          
          <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm space-y-1">
            <div className="flex items-center gap-2 text-xs text-gray-700">
              <Calendar size={14} className="text-brand-500" />
              <span className="font-medium">
                Delivery: <span className="font-bold text-gray-900">{new Date(deliveryDate).toLocaleDateString()}</span>
              </span>
            </div>
            {(sendMethod === 'WHATSAPP' || sendMethod === 'BOTH') && (
              <div className="flex items-center gap-2 text-xs text-green-700 pt-1">
                <MessageCircle size={14} />
                <span className="font-bold">Sending via WhatsApp{sendMethod === 'BOTH' ? ' & Email' : ''}</span>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gray-50/50 px-3 py-1.5 border-b border-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              Items Breakdown
            </div>
            <div className="divide-y divide-gray-100">
              {cartItems.map(item => {
                const product = products.find(p => p.id === item.productId);
                const caseLabel = getCaseUnitLabel(product);
                const packLabel = getPackUnitLabel(product);
                const casePrice = item.casePriceSnapshot ?? product?.casePrice ?? 0;
                const packPrice = item.packPriceSnapshot ?? product?.packPrice ?? 0;
                const lineCost = (item.caseQty * casePrice) + (item.packQty * packPrice);

                return (
                  <div key={item.productId} className="flex justify-between items-center p-2.5 hover:bg-gray-50 transition-colors">
                    <div className="min-w-0 pr-3">
                      <p className="font-bold text-gray-900 text-xs truncate">{item.productNameSnapshot}</p>
                      <div className="flex gap-1.5 text-[9px] text-gray-400 mt-0.5">
                        {product?.itemCode && <span className="font-mono">#{product.itemCode}</span>}
                        {product?.packSize && <span>{product.packSize}</span>}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {item.caseQty > 0 && <span className="bg-brand-50 text-brand-700 text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-brand-100">{item.caseQty} {caseLabel}</span>}
                        {item.packQty > 0 && <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-gray-200">{item.packQty} {packLabel}</span>}
                      </div>
                      {canViewPrices && lineCost > 0 && (
                        <span className="block text-[10px] font-mono font-bold text-gray-700 mt-0.5">
                          £{lineCost.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {manualItems.filter(m => m.description && (m.caseQty > 0 || m.packQty > 0)).map((item, i) => {
                return (
                  <div key={i} className="flex justify-between items-center p-2.5 bg-amber-50/50">
                    <div className="min-w-0 pr-3">
                      <p className="font-bold text-gray-900 text-xs truncate">{item.description}</p>
                      <span className="text-[9px] text-amber-700 font-bold uppercase tracking-wider">Custom Item</span>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {item.caseQty > 0 && <span className="bg-white text-gray-800 text-[10px] font-bold px-2 py-0.5 rounded-md border border-gray-200 shadow-2xs">{item.caseQty} Box</span>}
                        {item.packQty > 0 && <span className="bg-white text-gray-800 text-[10px] font-bold px-2 py-0.5 rounded-md border border-gray-200 shadow-2xs">{item.packQty} Unit</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pricing & Order Totals Breakdown Card (Enforces View Prices Permission) */}
          {canViewPrices && (orderTotals && orderTotals.grandTotal > 0 ? (
            <div className="bg-gray-900 text-white p-3.5 rounded-2xl shadow-lg space-y-2">
              <div className="flex justify-between items-center text-xs opacity-80">
                <span>Standard Catalog Items</span>
                <span className="font-mono">£{orderTotals.catalogSubtotal.toFixed(2)}</span>
              </div>
              
              {(orderTotals.manualConfirmedSubtotal > 0 || orderTotals.manualEstimatedSubtotal > 0) && (
                <div className="flex justify-between items-center text-xs text-yellow-300">
                  <span>Custom Items (Estimated)</span>
                  <span className="font-mono">£{(orderTotals.manualConfirmedSubtotal + orderTotals.manualEstimatedSubtotal).toFixed(2)}</span>
                </div>
              )}

              {orderTotals.vatTotal > 0 && (
                <div className="flex justify-between items-center text-xs opacity-80">
                  <span>Estimated VAT</span>
                  <span className="font-mono">£{orderTotals.vatTotal.toFixed(2)}</span>
                </div>
              )}

              <div className="border-t border-gray-800 pt-2 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider">
                  {orderTotals.isExact ? 'Estimated Total' : 'Estimated Total *'}
                </span>
                <span className="text-lg font-extrabold font-mono text-white">
                  £{orderTotals.grandTotal.toFixed(2)}
                </span>
              </div>

              {orderTotals.hasUnpricedItems && (
                <p className="text-[10px] text-amber-300 bg-amber-950/40 p-1.5 rounded-lg border border-amber-800/50 mt-1">
                  * Excludes custom item(s) which will be invoiced directly by the supplier.
                </p>
              )}
            </div>
          ) : estimatedTotal > 0 ? (
            <div className="flex justify-between items-center px-3 py-2.5 bg-gray-900 text-white rounded-xl shadow-lg">
              <span className="text-xs font-bold uppercase tracking-wide opacity-80">Estimated Total</span>
              <span className="text-base font-bold">£{estimatedTotal.toFixed(2)}</span>
            </div>
          ) : null)}

          <div className="space-y-3">
            {(sendMethod === 'EMAIL' || sendMethod === 'BOTH') && (
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-gray-500 uppercase ml-1">Email Dispatch & Routing</label>
                <div className="space-y-1.5 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-2xs">
                  <p className="break-all"><span className="font-bold text-gray-900">From: </span>{activeBranch?.name || 'Branch'} &lt;{activeBranch?.email?.trim() || 'branch@hareandtortoise.co.uk'}&gt;</p>
                  <p className="break-all"><span className="font-bold text-gray-900">To: </span>{emailOverride?.trim() || activeSupplier?.email?.trim() || 'No recipient set'}</p>
                  <p className="break-all"><span className="font-bold text-gray-900">Reply-To: </span>{activeBranch?.email?.trim() || 'branch@hareandtortoise.co.uk'} (Direct Branch Inbox)</p>
                  <p className="break-all"><span className="font-bold text-gray-900">Copy (CC): </span>{activeBranch?.email ? `${activeBranch.email}, ` : ''}info@hareandtortoise.co.uk + saved branch CCs</p>
                </div>

                {/* Attachment Preview (R03) */}
                <div className="flex items-center justify-between p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl text-xs text-blue-900">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={16} className="text-blue-600 shrink-0" />
                    <span className="font-mono text-[11px] font-bold truncate">
                      Order_{activeBranch?.name?.replace(/\s+/g, '_') || 'Branch'}_{deliveryDate || 'ASAP'}.pdf
                    </span>
                  </div>
                  <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md shrink-0">
                    PDF Attached
                  </span>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase ml-1">Recipient Override (Optional)</label>
                  <input 
                    type="email" 
                    value={emailOverride} 
                    onChange={e => onEmailChange(e.target.value)} 
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-xs outline-none focus:ring-2 focus:ring-brand-500 bg-white shadow-sm transition-shadow" 
                    placeholder="Defaults to supplier email" 
                  />
                  <p className="mt-1 text-[10px] text-gray-500">Only contacts saved on this supplier or branch may receive this order email.</p>
                </div>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase ml-1">Comments</label>
              <textarea 
                value={comments} 
                onChange={e => onCommentsChange(e.target.value)} 
                className="w-full border border-gray-300 rounded-lg p-2.5 text-xs h-20 resize-none outline-none focus:ring-2 focus:ring-brand-500 bg-white shadow-sm transition-shadow" 
                placeholder="Enter special instructions..." 
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 md:p-4 border-t border-gray-100 bg-white md:rounded-b-3xl pb-[max(16px,env(safe-area-inset-bottom))] flex-shrink-0 z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <div className="flex gap-2">
            {canSaveDraft && (
              <button
                onClick={onSaveDraft}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <Save size={16} /> Save Draft
              </button>
            )}
            <button
              onClick={onCopy}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              {copySuccess ? <Check size={16} className="text-green-600" /> : <Clipboard size={16} />}
              {copySuccess ? 'Copied!' : 'Copy'}
            </button>
            {canSubmit ? (
              <button
                onClick={onSubmit}
                disabled={isSending}
                className={`flex-[2] py-3 rounded-xl font-bold text-xs text-white flex items-center justify-center gap-1.5 shadow-md transition-all ${
                  submitVariant === 'warning'
                    ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20'
                    : 'bg-brand-600 hover:bg-brand-700 shadow-brand-500/20'
                }`}
              >
                {isSending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <SubmitIcon size={16} />
                )}
                {submitLabel}
              </button>
            ) : (
              <button
                disabled
                className="flex-[2] py-3 rounded-xl font-bold text-xs text-gray-400 bg-gray-100 flex items-center justify-center gap-1.5 cursor-not-allowed border border-gray-200"
                title="You do not have permission to submit orders"
              >
                Submit Not Permitted
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
