import React, { useState } from 'react';
import { PriceChangeNotice } from '../../types';
import { useAppStore } from '../../store';
import { Modal } from '../../components/Modal';
import { CheckCircle2, TrendingUp, TrendingDown, Calendar, FileText, User, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  notice: PriceChangeNotice | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ApprovePriceChangeModal: React.FC<Props> = ({ notice, onClose, onSuccess }) => {
  const { approvePriceChange, showToast } = useAppStore();
  const [effectiveDate, setEffectiveDate] = useState(() => {
    return notice?.invoiceDate || new Date().toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!notice) return null;

  const isIncrease = (notice.priceDiff ?? 0) > 0;
  const isCase = (notice.newCasePrice !== undefined && notice.newCasePrice > 0) || (notice.oldCasePrice !== undefined && notice.oldCasePrice > 0);
  const oldPrice = isCase ? notice.oldCasePrice : notice.oldPackPrice;
  const newPrice = isCase ? notice.newCasePrice : notice.newPackPrice;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await approvePriceChange(notice.id, effectiveDate, notes.trim());
      showToast('success', `Price update approved for "${notice.productName}"`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Approval failed', err);
      showToast('error', `Failed to approve price change: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={!!notice} onClose={onClose} className="max-w-xl p-6">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Approve Price Change</h3>
          <p className="text-xs text-gray-500 font-medium">Update the official catalog price and record an audit log.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {/* Product & Supplier info */}
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-xs font-bold text-brand-600 uppercase tracking-wide">{notice.supplierName}</p>
              <h4 className="text-base font-bold text-gray-900 mt-0.5">{notice.productName}</h4>
              {notice.itemCode && (
                <p className="text-xs text-gray-500 font-mono mt-0.5">Code: {notice.itemCode}</p>
              )}
            </div>
            <div className="text-right">
              <span className="text-[11px] font-bold text-gray-400 uppercase">Inv / Note Ref</span>
              <p className="text-xs font-mono font-bold text-gray-700">{notice.invoiceNumber || 'N/A'}</p>
            </div>
          </div>

          {/* Price comparison card */}
          <div className="mt-3 pt-3 border-t border-gray-200/70 grid grid-cols-3 gap-3 text-center">
            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
              <span className="text-[10px] font-bold text-gray-400 uppercase block">Current Price</span>
              <span className="text-sm font-bold text-gray-600 line-through">
                {oldPrice !== undefined ? `£${oldPrice.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className={`p-2.5 rounded-lg border ${isIncrease ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <span className="text-[10px] font-bold text-gray-500 uppercase block">New Invoiced</span>
              <span className={`text-base font-extrabold ${isIncrease ? 'text-amber-700' : 'text-emerald-700'}`}>
                {newPrice !== undefined ? `£${newPrice.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className={`p-2.5 rounded-lg border ${isIncrease ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <span className="text-[10px] font-bold text-gray-500 uppercase block">Difference</span>
              <div className={`flex items-center justify-center gap-1 font-bold text-xs ${isIncrease ? 'text-red-700' : 'text-green-700'}`}>
                {isIncrease ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                <span>
                  {(notice.priceDiff ?? 0) >= 0 ? `+£${(notice.priceDiff ?? 0).toFixed(2)}` : `-£${Math.abs(notice.priceDiff ?? 0).toFixed(2)}`}
                </span>
                <span className="text-[10px]">
                  ({(notice.percentChange ?? 0) >= 0 ? `+${notice.percentChange ?? 0}%` : `${notice.percentChange ?? 0}%`})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-3 pt-1">
          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5 mb-1">
              <Calendar size={13} className="text-gray-400" />
              Effective Date
            </label>
            <input
              type="date"
              required
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
            <p className="text-[11px] text-gray-400 mt-1">Date this new price takes effect in the purchasing catalog.</p>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5 mb-1">
              <FileText size={13} className="text-gray-400" />
              Approval Notes / Reason (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Verified with supplier rep. Seasonal price adjustment."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 placeholder-gray-400 resize-none"
            />
          </div>
        </div>

        {/* Audit info */}
        <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex items-start gap-2.5">
          <AlertCircle size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 space-y-0.5">
            <p className="font-semibold">Audit Record Notice</p>
            <p className="text-blue-700">
              The existing price history will never be overwritten. A permanent audit entry will record your name, date, invoice ref, and old price.
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end items-center gap-3 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-sm font-bold rounded-xl shadow-md flex items-center gap-2 transition-all"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Approving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>Approve & Update Price</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
