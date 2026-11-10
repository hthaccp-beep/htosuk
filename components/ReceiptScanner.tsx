import React, { useState, useRef } from 'react';
import { Camera, Upload, Loader2, CheckCircle, AlertCircle, ScanLine } from 'lucide-react';
import { extractReceiptQuantities } from '../utils/geminiOCR';
import { useAppStore } from '../store';
import { OrderRecord } from '../types';

interface ReceiptScannerProps {
    order: OrderRecord;
    onScanComplete: (updates: any) => void;
}

export const ReceiptScanner: React.FC<ReceiptScannerProps> = ({ order, onScanComplete }) => {
    const { showToast } = useAppStore();
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsScanning(true);
        setError('');

        try {
            const data = await extractReceiptQuantities(file, order.items, order.manualItems);
            
            // Reconcile findings with order
            const extracted = data.extractedItems || [];
            if (extracted.length === 0) {
                setError('Could not find any matching items on the receipt.');
                setIsScanning(false);
                return;
            }

            // Map findings to updates
            const updatedItems = order.items.map(item => {
                const itemDesc = (item.productNameSnapshot || '').toLowerCase().trim();
                const match = extracted.find((ext: any) => {
                    const extName = (ext.matchedOrderName || ext.rawScannedName || ext.description || '').toLowerCase().trim();
                    return extName === itemDesc || (extName && itemDesc && (extName.includes(itemDesc) || itemDesc.includes(extName)));
                });
                if (match) {
                    return { ...item, sentCaseQty: match.deliveredCaseQty ?? item.sentCaseQty, sentPackQty: match.deliveredPackQty ?? item.sentPackQty };
                }
                return item;
            });

            const updatedManualItems = order.manualItems.map(item => {
                const itemDesc = (item.description || '').toLowerCase().trim();
                const match = extracted.find((ext: any) => {
                    const extName = (ext.matchedOrderName || ext.rawScannedName || ext.description || '').toLowerCase().trim();
                    return extName === itemDesc || (extName && itemDesc && (extName.includes(itemDesc) || itemDesc.includes(extName)));
                });
                if (match) {
                    return { ...item, sentCaseQty: match.deliveredCaseQty ?? item.sentCaseQty, sentPackQty: match.deliveredPackQty ?? item.sentPackQty };
                }
                return item;
            });

            // Calculate fulfillment status
            let hasOOS = false;
            let completelyEmpty = true;

            [...updatedItems, ...updatedManualItems].forEach(item => {
                const orderedTotal = (item.caseQty || 0) + (item.packQty || 0);
                if (orderedTotal > 0) {
                    completelyEmpty = false;
                    const sentTotal = (item.sentCaseQty || 0) + (item.sentPackQty || 0);
                    if (sentTotal < orderedTotal) {
                        hasOOS = true;
                    }
                }
            });

            const finalStatus = completelyEmpty ? 'UNFULFILLED' : (hasOOS ? 'PARTIAL' : 'FULFILLED');

            showToast('success', `Matched ${extracted.length} items from receipt successfully.`);
            onScanComplete({ 
                items: updatedItems, 
                manualItems: updatedManualItems, 
                fulfillmentStatus: finalStatus,
                receivedStatus: 'PROCESSED'
            });

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to scan receipt.');
        } finally {
            setIsScanning(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 mt-4">
            <h4 className="font-bold text-brand-900 flex items-center gap-2 mb-2">
                <ScanLine size={18} />
                Smart Receipt Verification (OCR)
            </h4>
            <p className="text-xs text-brand-700 mb-4">
                Scan the delivery receipt or photograph the physical invoice to automatically verify delivered quantities against this order.
            </p>

            <input 
                type="file" 
                accept="image/*,application/pdf" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                capture="environment" // Suggests mobile devices use back camera
            />

            {error && (
                <div className="mb-4 text-xs font-bold text-red-600 bg-red-50 p-2 rounded flex items-start gap-1">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="flex gap-2">
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isScanning}
                    className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
                >
                    {isScanning ? (
                        <>
                            <Loader2 className="animate-spin" size={16} /> Scanning Receipt...
                        </>
                    ) : (
                        <>
                            <Camera size={16} /> Take Photo / Upload
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};
