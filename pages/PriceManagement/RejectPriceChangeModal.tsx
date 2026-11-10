import React, { useState } from 'react';
import { PriceChangeNotice } from '../../types';
import { useAppStore } from '../../store';
import { Modal } from '../../components/Modal';
import { XCircle, AlertTriangle, FileText, Loader2 } from 'lucide-react';

interface Props {
  notice: PriceChangeNotice | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export const RejectPriceChangeModal: React.FC<Props> = ({ notice, onClose, onSuccess }) => {
  const { rejectPriceChange, showToast } = useAppStore();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!notice) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      showToast('error', 'Please provide a reason for rejecting the price change.');
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectPriceChange(notice.id, reason.trim());
      showToast('info', `Price change for "${notice.productName}" was rejected.`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Rejection failed', err);
      showToast('error', `Failed to reject price change: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const commonReasons = [
    'Incorrect price invoiced by supplier (Credit Note requested)',
    'Wrong product code / item mismatch on invoice',
    'One-off promotional price or temporary surcharge',
    'Price under negotiation with supplier sales rep',
    'Contracted annual group price applies'
  ];

  return (
    <Modal isOpen={!!notice} onClose={onClose} className="max-w-lg p-6">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
          <XCircle size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Reject Price Change</h3>
          <p className="text-xs text-gray-500 font-medium">Keep the existing system price and log the reason in the audit trail.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {/* Notice Summary */}
        <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="font-bold text-gray-500">Supplier:</span>
            <span className="font-semibold text-gray-800">{notice.supplierName}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-gray-500">Product:</span>
            <span className="font-bold text-gray-900 truncate max-w-[280px]">{notice.productName}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-gray-500">Recorded Price:</span>
            <span className="font-bold text-gray-700">
              {notice.oldCasePrice !== undefined
                ? `£${notice.oldCasePrice.toFixed(2)}`
                : (notice.oldPackPrice !== undefined ? `£${notice.oldPackPrice.toFixed(2)}` : '—')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-gray-500">Detected Invoiced Price:</span>
            <span className="font-bold text-red-600">
              {notice.newCasePrice !== undefined
                ? `£${notice.newCasePrice.toFixed(2)}`
                : (notice.newPackPrice !== undefined ? `£${notice.newPackPrice.toFixed(2)}` : '—')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-gray-500">Invoice Ref:</span>
            <span className="font-mono text-gray-700">{notice.invoiceNumber || 'N/A'}</span>
          </div>
        </div>

        {/* Common Quick Reasons */}
        <div>
          <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1.5">
            Quick Reasons:
          </label>
          <div className="flex flex-wrap gap-1.5">
            {commonReasons.map((cr) => (
              <button
                type="button"
                key={cr}
                onClick={() => setReason(cr)}
                className="text-[11px] font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg transition-colors text-left"
              >
                {cr}
              </button>
            ))}
          </div>
        </div>

        {/* Reason Textarea */}
        <div>
          <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5 mb-1">
            <FileText size={13} className="text-gray-400" />
            Rejection Reason / Notes <span className="text-red-500">*</span>
          </label>
          <textarea
            required
            rows={3}
            placeholder="Explain why this price change is being rejected..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-red-500 placeholder-gray-400"
          />
        </div>

        {/* Warning Banner */}
        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p>
            The official system price will remain unchanged. If the supplier overcharged, consider filing a Credit Note claim for difference.
          </p>
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
            disabled={isSubmitting || !reason.trim()}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white text-sm font-bold rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Rejecting...</span>
              </>
            ) : (
              <>
                <XCircle size={16} />
                <span>Confirm Rejection</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
