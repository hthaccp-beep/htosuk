import React, { useState } from 'react';
import { Modal } from './Modal';
import { 
  ColumnMappingProfile, 
  getSavedImportProfiles, 
  saveImportProfile 
} from '../utils/supplierImportProfiles';
import { Sliders, Check, Save, RotateCcw, HelpCircle, ArrowRight } from 'lucide-react';

interface ColumnMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  detectedHeaders: string[];
  sampleRows: Record<string, any>[];
  supplierName: string;
  supplierId: string;
  activeProfile: ColumnMappingProfile;
  onApplyProfile: (profile: ColumnMappingProfile) => void;
}

export const ColumnMappingModal: React.FC<ColumnMappingModalProps> = ({
  isOpen,
  onClose,
  detectedHeaders,
  sampleRows,
  supplierName,
  supplierId,
  activeProfile,
  onApplyProfile,
}) => {
  const [profiles, setProfiles] = useState<ColumnMappingProfile[]>(() => getSavedImportProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>(activeProfile.id);

  // Field mapping state (maps app field to exact header name selected from detected headers)
  const [mappings, setMappings] = useState<{
    itemCode: string;
    description: string;
    unitsPerCase: string;
    caseQty: string;
    packPrice: string;
    casePrice: string;
    total: string;
    packaging: string;
  }>(() => {
    const findHeader = (patterns?: string[]) => {
      if (!patterns) return '';
      for (const h of detectedHeaders) {
        const cleanH = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const p of patterns) {
          const cleanP = p.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanH === cleanP || cleanH.includes(cleanP)) return h;
        }
      }
      return '';
    };

    return {
      itemCode: findHeader(activeProfile.columns.itemCode),
      description: findHeader(activeProfile.columns.description),
      unitsPerCase: findHeader(activeProfile.columns.unitsPerCase),
      caseQty: findHeader(activeProfile.columns.caseQty),
      packPrice: findHeader(activeProfile.columns.packPrice),
      casePrice: findHeader(activeProfile.columns.casePrice),
      total: findHeader(activeProfile.columns.total),
      packaging: findHeader(activeProfile.columns.packaging),
    };
  });

  const [saveAsDefault, setSaveAsDefault] = useState(true);

  // Switch profile handler
  const handleProfileChange = (pId: string) => {
    setSelectedProfileId(pId);
    const p = profiles.find(item => item.id === pId);
    if (!p) return;

    const findHeader = (patterns?: string[]) => {
      if (!patterns) return '';
      for (const h of detectedHeaders) {
        const cleanH = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const pat of patterns) {
          const cleanP = pat.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanH === cleanP || cleanH.includes(cleanP)) return h;
        }
      }
      return '';
    };

    setMappings({
      itemCode: findHeader(p.columns.itemCode),
      description: findHeader(p.columns.description),
      unitsPerCase: findHeader(p.columns.unitsPerCase),
      caseQty: findHeader(p.columns.caseQty),
      packPrice: findHeader(p.columns.packPrice),
      casePrice: findHeader(p.columns.casePrice),
      total: findHeader(p.columns.total),
      packaging: findHeader(p.columns.packaging),
    });
  };

  const sampleRow1 = sampleRows[0] || {};

  const handleSaveAndApply = () => {
    const updatedProfile: ColumnMappingProfile = {
      id: selectedProfileId.startsWith('custom_') ? selectedProfileId : `custom_${supplierId || 'sup'}_${Date.now()}`,
      name: `${supplierName || 'Custom'} Import Format`,
      supplierId: supplierId || undefined,
      description: `Configured columns for ${supplierName}`,
      version: 1,
      formulaId: 'AUTO_BEST_EFFORT',
      columns: {
        itemCode: mappings.itemCode ? [mappings.itemCode] : [],
        description: mappings.description ? [mappings.description] : [],
        unitsPerCase: mappings.unitsPerCase ? [mappings.unitsPerCase] : [],
        caseQty: mappings.caseQty ? [mappings.caseQty] : [],
        packPrice: mappings.packPrice ? [mappings.packPrice] : [],
        casePrice: mappings.casePrice ? [mappings.casePrice] : [],
        total: mappings.total ? [mappings.total] : [],
        packaging: mappings.packaging ? [mappings.packaging] : [],
      },
      deriveCasePrice: (row, parsed) => {
        // R08 FIX: Explicit mapped case price always takes precedence if valid and > 0!
        if (typeof parsed.casePrice === 'number' && Number.isFinite(parsed.casePrice) && parsed.casePrice > 0) {
          return parsed.casePrice;
        }
        if (parsed.total > 0 && parsed.caseQty > 0) {
          return Math.round((parsed.total / parsed.caseQty) * 100) / 100;
        }
        if (parsed.unitsPerCase > 0 && parsed.packPrice > 0) {
          return Math.round((parsed.unitsPerCase * parsed.packPrice) * 100) / 100;
        }
        return 0;
      }
    };

    if (saveAsDefault) {
      saveImportProfile(updatedProfile);
    }
    onApplyProfile(updatedProfile);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-2xl w-full p-5 max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between pb-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <Sliders size={18} />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Spreadsheet Column Mapping</h3>
            <p className="text-xs text-gray-500">
              Configure or verify how Excel columns map to catalog fields for <strong>{supplierName}</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar py-4 space-y-4">
        {/* Preset Selector */}
        <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 flex items-center justify-between gap-3">
          <div>
            <label className="text-xs font-bold text-gray-700 block">Saved Format Preset</label>
            <p className="text-[11px] text-gray-500">Pick an existing supplier template or customize below</p>
          </div>
          <select
            value={selectedProfileId}
            onChange={(e) => handleProfileChange(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 max-w-[240px]"
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Column Mapping Fields Table */}
        <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 bg-white">
          <div className="bg-gray-50/80 px-3 py-2 grid grid-cols-12 text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            <span className="col-span-4">App Field</span>
            <span className="col-span-5">Spreadsheet Column</span>
            <span className="col-span-3">Sample Value (Row 1)</span>
          </div>

          {/* Supplier Product Code */}
          <div className="px-3 py-2.5 grid grid-cols-12 items-center gap-2 hover:bg-gray-50/50">
            <div className="col-span-4">
              <span className="text-xs font-bold text-gray-800 block">Supplier Product Code</span>
              <span className="text-[10px] text-gray-500">Item No. / SKU</span>
            </div>
            <div className="col-span-5">
              <select
                value={mappings.itemCode}
                onChange={(e) => setMappings({ ...mappings, itemCode: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">-- None --</option>
                {detectedHeaders.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 truncate text-xs font-mono font-bold text-brand-700 bg-gray-50 px-2 py-0.5 rounded">
              {mappings.itemCode ? String(sampleRow1[mappings.itemCode] ?? '—') : '—'}
            </div>
          </div>

          {/* Description */}
          <div className="px-3 py-2.5 grid grid-cols-12 items-center gap-2 hover:bg-gray-50/50">
            <div className="col-span-4">
              <span className="text-xs font-bold text-gray-800 block">Product Description</span>
              <span className="text-[10px] text-gray-500">Item Description / Name</span>
            </div>
            <div className="col-span-5">
              <select
                value={mappings.description}
                onChange={(e) => setMappings({ ...mappings, description: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">-- None --</option>
                {detectedHeaders.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 truncate text-xs text-gray-700 bg-gray-50 px-2 py-0.5 rounded">
              {mappings.description ? String(sampleRow1[mappings.description] ?? '—') : '—'}
            </div>
          </div>

          {/* Units per Case */}
          <div className="px-3 py-2.5 grid grid-cols-12 items-center gap-2 hover:bg-gray-50/50">
            <div className="col-span-4">
              <span className="text-xs font-bold text-gray-800 block">Units per Case</span>
              <span className="text-[10px] text-gray-500">Unit Qty (Inner count)</span>
            </div>
            <div className="col-span-5">
              <select
                value={mappings.unitsPerCase}
                onChange={(e) => setMappings({ ...mappings, unitsPerCase: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">-- None --</option>
                {detectedHeaders.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 truncate text-xs text-gray-700 bg-gray-50 px-2 py-0.5 rounded">
              {mappings.unitsPerCase ? String(sampleRow1[mappings.unitsPerCase] ?? '—') : '—'}
            </div>
          </div>

          {/* Case Qty (Count of cases) */}
          <div className="px-3 py-2.5 grid grid-cols-12 items-center gap-2 bg-amber-50/30 hover:bg-amber-50/50">
            <div className="col-span-4">
              <span className="text-xs font-bold text-amber-900 block">Case Quantity (Count)</span>
              <span className="text-[10px] text-amber-700 font-semibold">⚠️ Case count only, NEVER price</span>
            </div>
            <div className="col-span-5">
              <select
                value={mappings.caseQty}
                onChange={(e) => setMappings({ ...mappings, caseQty: e.target.value })}
                className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">-- None --</option>
                {detectedHeaders.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 truncate text-xs text-amber-900 bg-amber-100/60 px-2 py-0.5 rounded font-mono">
              {mappings.caseQty ? `${String(sampleRow1[mappings.caseQty] ?? '—')} cases` : '—'}
            </div>
          </div>

          {/* Unit / Pack Price */}
          <div className="px-3 py-2.5 grid grid-cols-12 items-center gap-2 hover:bg-gray-50/50">
            <div className="col-span-4">
              <span className="text-xs font-bold text-gray-800 block">Unit / Pack Price</span>
              <span className="text-[10px] text-gray-500">Unit Price (£ / piece)</span>
            </div>
            <div className="col-span-5">
              <select
                value={mappings.packPrice}
                onChange={(e) => setMappings({ ...mappings, packPrice: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">-- None --</option>
                {detectedHeaders.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 truncate text-xs font-bold text-gray-900 bg-gray-50 px-2 py-0.5 rounded">
              {mappings.packPrice ? `£${sampleRow1[mappings.packPrice] ?? '—'}` : '—'}
            </div>
          </div>

          {/* Total (LC) */}
          <div className="px-3 py-2.5 grid grid-cols-12 items-center gap-2 hover:bg-gray-50/50">
            <div className="col-span-4">
              <span className="text-xs font-bold text-gray-800 block">Total (LC) / Line Total</span>
              <span className="text-[10px] text-gray-500">Used to derive Case Price</span>
            </div>
            <div className="col-span-5">
              <select
                value={mappings.total}
                onChange={(e) => setMappings({ ...mappings, total: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">-- None --</option>
                {detectedHeaders.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 truncate text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
              {mappings.total ? `£${sampleRow1[mappings.total] ?? '—'}` : '—'}
            </div>
          </div>

          {/* Packaging / Case UoM */}
          <div className="px-3 py-2.5 grid grid-cols-12 items-center gap-2 hover:bg-gray-50/50">
            <div className="col-span-4">
              <span className="text-xs font-bold text-gray-800 block">Packaging / Case UoM</span>
              <span className="text-[10px] text-gray-500">Pack size description</span>
            </div>
            <div className="col-span-5">
              <select
                value={mappings.packaging}
                onChange={(e) => setMappings({ ...mappings, packaging: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">-- None --</option>
                {detectedHeaders.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3 truncate text-xs text-gray-700 bg-gray-50 px-2 py-0.5 rounded">
              {mappings.packaging ? String(sampleRow1[mappings.packaging] ?? '—') : '—'}
            </div>
          </div>
        </div>

        {/* Calculation Preview Box */}
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 text-xs space-y-1">
          <p className="font-bold text-emerald-900 flex items-center gap-1.5">
            <Check size={14} className="text-emerald-600" />
            Derived Price Preview for Row 1:
          </p>
          <div className="text-[11px] text-emerald-800 flex items-center gap-4 flex-wrap">
            <span>
              Product: <strong>{mappings.description ? sampleRow1[mappings.description] : '—'}</strong>
            </span>
            <span>
              Pack Price: <strong>£{mappings.packPrice ? sampleRow1[mappings.packPrice] : '—'}</strong>
            </span>
            <span>
              Derived Case Price: <strong>
                £{mappings.total && sampleRow1[mappings.total] 
                  ? Number(sampleRow1[mappings.total]).toFixed(2) 
                  : (mappings.unitsPerCase && mappings.packPrice 
                      ? (Number(sampleRow1[mappings.unitsPerCase]) * Number(sampleRow1[mappings.packPrice])).toFixed(2)
                      : '—')}
              </strong>
            </span>
          </div>
        </div>

        {/* Save as default checkbox */}
        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-700">
          <input
            type="checkbox"
            checked={saveAsDefault}
            onChange={(e) => setSaveAsDefault(e.target.checked)}
            className="rounded text-brand-600 focus:ring-brand-500 w-4 h-4"
          />
          <span>Remember this mapping format for <strong>{supplierName}</strong> uploads in the future</span>
        </label>
      </div>

      <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveAndApply}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-all active:scale-95"
        >
          <Save size={14} />
          <span>Apply & Re-analyze File</span>
        </button>
      </div>
    </Modal>
  );
};
