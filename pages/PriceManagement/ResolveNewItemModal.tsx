import React, { useState, useMemo } from 'react';
import { NewItemNotice, Product, UnitType } from '../../types';
import { useAppStore } from '../../store';
import { Modal } from '../../components/Modal';
import { PlusCircle, Link, XCircle, AlertTriangle, Check, Layers, Package, Truck, Info, Loader2 } from 'lucide-react';
import { stringSimilarity, tokenOverlapScore } from '../../utils/priceMatching';

interface Props {
  notice: NewItemNotice | null;
  onClose: () => void;
  onSuccess?: () => void;
}

type TabMode = 'ADD_NEW' | 'LINK_EXISTING' | 'REJECT';

export const ResolveNewItemModal: React.FC<Props> = ({ notice, onClose, onSuccess }) => {
  const { categories, suppliers, branches, products, resolveNewItem, rejectNewItem, showToast } = useAppStore();

  const [mode, setMode] = useState<TabMode>('ADD_NEW');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields for Add New Product
  const [name, setName] = useState('');
  const [chineseName, setChineseName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [packSize, setPackSize] = useState('');
  const [unitType, setUnitType] = useState<UnitType>('CASE_ONLY');
  const [casePrice, setCasePrice] = useState<number>(0);
  const [packPrice, setPackPrice] = useState<number>(0);
  const [allowedBranchIds, setAllowedBranchIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Link Existing Fields
  const [selectedExistingId, setSelectedExistingId] = useState('');
  const [searchExistingQuery, setSearchExistingQuery] = useState('');
  const [updateExistingCode, setUpdateExistingCode] = useState(true);
  const [updateExistingPrice, setUpdateExistingPrice] = useState(false);

  // Reject Fields
  const [rejectionReason, setRejectionReason] = useState('');

  // Initialize form when notice opens
  React.useEffect(() => {
    if (notice) {
      setName(notice.rawDescription || '');
      setSupplierId(notice.supplierId || suppliers[0]?.id || '');
      setItemCode(notice.rawItemCode || '');
      setPackSize(notice.rawPackSize || '');
      setCasePrice(notice.detectedCasePrice || 0);
      setPackPrice(notice.detectedPackPrice || 0);
      setNotes(notice.notes || '');

      // Pick default category if supplier matches
      const defaultCat = categories.find(c => c.supplierId === notice.supplierId) || categories[0];
      if (defaultCat) setCategoryId(defaultCat.id);

      // Unit type detection
      if (notice.detectedCasePrice > 0 && notice.detectedPackPrice > 0) {
        setUnitType('DUAL');
      } else if (notice.detectedPackPrice > 0 && notice.detectedCasePrice === 0) {
        setUnitType('PACK_ONLY');
      } else {
        setUnitType('CASE_ONLY');
      }

      // Check if duplicate is flagged
      if (notice.possibleDuplicateProductId) {
        setSelectedExistingId(notice.possibleDuplicateProductId);
      }
    }
  }, [notice, categories, suppliers]);

  // Compute duplicate warnings in real-time
  const duplicateSuggestions = useMemo(() => {
    if (!notice) return [];
    const searchTarget = notice.rawDescription || '';
    const scored = products.map(p => {
      const dice = stringSimilarity(searchTarget, p.name);
      const tokens = tokenOverlapScore(searchTarget, p.name);
      const score = Math.round(dice * 0.4 + tokens * 0.6);
      return { product: p, score };
    });
    return scored.filter(s => s.score >= 40).sort((a, b) => b.score - a.score).slice(0, 5);
  }, [notice, products]);

  // Filtered existing products for linking
  const filteredExistingProducts = useMemo(() => {
    const q = searchExistingQuery.toLowerCase().trim();
    if (!q) return products.slice(0, 20);
    return products.filter(p => 
      p.name.toLowerCase().includes(q) || 
      (p.itemCode && p.itemCode.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [products, searchExistingQuery]);

  if (!notice) return null;

  const handleAddNewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Product name is required');
      return;
    }
    if (!categoryId) {
      showToast('error', 'Please select a Category');
      return;
    }

    setIsSubmitting(true);
    try {
      const newProductId = `prod_${Date.now()}`;
      const newProduct: Product = {
        id: newProductId,
        name: name.trim(),
        chineseName: chineseName.trim() || undefined,
        itemCode: itemCode.trim() || undefined,
        categoryId,
        supplierId: supplierId || notice.supplierId,
        packSize: packSize.trim() || undefined,
        unitType,
        casePrice: Number(casePrice) || 0,
        packPrice: Number(packPrice) || 0,
        allowedBranchIds,
        active: true,
        displayOrder: 0,
      };

      await resolveNewItem(notice.id, 'ADDED', newProduct, undefined, notes.trim());
      showToast('success', `Created new catalog product: "${newProduct.name}"`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to create new product', err);
      showToast('error', `Error creating product: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExistingId) {
      showToast('error', 'Please select an existing product to link.');
      return;
    }

    setIsSubmitting(true);
    try {
      const existing = products.find(p => p.id === selectedExistingId);
      const updates: Partial<Product> = {};
      if (updateExistingCode && itemCode.trim()) {
        updates.itemCode = itemCode.trim();
      }
      if (updateExistingPrice) {
        if (notice.detectedCasePrice > 0) updates.casePrice = notice.detectedCasePrice;
        if (notice.detectedPackPrice > 0) updates.packPrice = notice.detectedPackPrice;
      }

      await resolveNewItem(notice.id, 'LINKED', Object.keys(updates).length > 0 ? updates : undefined, selectedExistingId, notes.trim());
      showToast('success', `Linked invoice line to existing product "${existing?.name || selectedExistingId}"`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to link product', err);
      showToast('error', `Error linking product: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      showToast('error', 'Please provide a reason for rejecting this item.');
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectNewItem(notice.id, rejectionReason.trim());
      showToast('info', `Item "${notice.rawDescription}" rejected.`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to reject item', err);
      showToast('error', `Error rejecting item: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={!!notice} onClose={onClose} className="max-w-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div>
          <span className="text-[10px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded uppercase tracking-wider">
            Unrecognised Invoice Line Item
          </span>
          <h3 className="text-xl font-bold text-gray-900 mt-1">Review New Product</h3>
          <p className="text-xs text-gray-500 font-medium">
            Supplier: <strong className="text-gray-700">{notice.supplierName}</strong> &bull; Invoice Ref: <span className="font-mono text-gray-700">{notice.invoiceNumber || 'N/A'}</span>
          </p>
        </div>
      </div>

      {/* Duplicate Warning Banner */}
      {duplicateSuggestions.length > 0 && (
        <div className="mt-4 p-3.5 bg-amber-50 rounded-xl border border-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                Possible Duplicate Product Warning ({duplicateSuggestions[0].score}% match)
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                We detected similar existing items in the database. Linking to an existing product prevents creating duplicate items.
              </p>
              <div className="mt-2 space-y-1">
                {duplicateSuggestions.slice(0, 3).map(({ product: p, score }) => (
                  <div key={p.id} className="flex items-center justify-between bg-white/80 p-2 rounded-lg border border-amber-200 text-xs">
                    <div className="truncate min-w-0 pr-2">
                      <span className="font-bold text-gray-800">{p.name}</span>
                      {p.itemCode && <span className="text-gray-400 font-mono text-[11px] ml-1.5">[{p.itemCode}]</span>}
                      <span className="text-gray-500 text-[11px] ml-2">£{(p.casePrice || p.packPrice || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        {score}% match
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedExistingId(p.id);
                          setMode('LINK_EXISTING');
                        }}
                        className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold transition-colors"
                      >
                        Link to This
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Mode Tabs */}
      <div className="flex border-b border-gray-200 mt-5">
        <button
          type="button"
          onClick={() => setMode('ADD_NEW')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
            mode === 'ADD_NEW'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <PlusCircle size={15} />
          Add as New Product
        </button>
        <button
          type="button"
          onClick={() => setMode('LINK_EXISTING')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
            mode === 'LINK_EXISTING'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Link size={15} />
          Link / Update Existing Product
        </button>
        <button
          type="button"
          onClick={() => setMode('REJECT')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
            mode === 'REJECT'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <XCircle size={15} />
          Do Not Add / Reject
        </button>
      </div>

      {/* Content for MODE: ADD_NEW */}
      {mode === 'ADD_NEW' && (
        <form onSubmit={handleAddNewSubmit} className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Product title"
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 font-medium"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Chinese / Alt Name (Optional)
              </label>
              <input
                type="text"
                value={chineseName}
                onChange={(e) => setChineseName(e.target.value)}
                placeholder="e.g. 泰国香米"
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="">-- Select Category --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Supplier
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Supplier Product Code / SKU
              </label>
              <input
                type="text"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                placeholder="e.g. A0006"
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Pack / Case Size Spec
              </label>
              <input
                type="text"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                placeholder="e.g. 5KG, 24x330ml, 10x1kg"
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Unit Ordering Type
              </label>
              <select
                value={unitType}
                onChange={(e) => setUnitType(e.target.value as UnitType)}
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="CASE_ONLY">Case / Box Only</option>
                <option value="PACK_ONLY">Unit / Pack Only</option>
                <option value="DUAL">Dual (Case & Pack)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Case Price (£)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={casePrice}
                onChange={(e) => setCasePrice(parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 font-bold"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
                Pack / Unit Price (£)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={packPrice}
                onChange={(e) => setPackPrice(parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 font-bold"
              />
            </div>
          </div>

          {/* Branch Availability */}
          <div className="pt-2">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1.5">
              Branch Availability
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAllowedBranchIds([])}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                  allowedBranchIds.length === 0
                    ? 'bg-brand-50 text-brand-700 border-brand-300'
                    : 'bg-gray-50 text-gray-600 border-gray-200'
                }`}
              >
                All Branches
              </button>
              {branches.map((b) => {
                const isSelected = allowedBranchIds.includes(b.id);
                return (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => {
                      if (isSelected) {
                        setAllowedBranchIds(allowedBranchIds.filter((id) => id !== b.id));
                      } else {
                        setAllowedBranchIds([...allowedBranchIds, b.id]);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      isSelected
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit bar */}
          <div className="flex justify-end items-center gap-3 pt-4 border-t border-gray-100">
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
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl shadow-md flex items-center gap-2 transition-all active:scale-95"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Adding Product...</span>
                </>
              ) : (
                <>
                  <PlusCircle size={16} />
                  <span>Confirm & Add Product</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Content for MODE: LINK_EXISTING */}
      {mode === 'LINK_EXISTING' && (
        <form onSubmit={handleLinkSubmit} className="mt-4 space-y-4">
          <p className="text-xs text-gray-600">
            Link this detected invoice line to an existing catalog product. Future scans with this description or code will match automatically.
          </p>

          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
              Search Catalog Products
            </label>
            <input
              type="text"
              placeholder="Search by product name or code..."
              value={searchExistingQuery}
              onChange={(e) => setSearchExistingQuery(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500 mb-2"
            />
          </div>

          <div className="max-h-56 overflow-y-auto custom-scrollbar border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
            {filteredExistingProducts.map((p) => {
              const isSelected = selectedExistingId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedExistingId(p.id)}
                  className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                    isSelected ? 'bg-brand-50/80 border-l-4 border-brand-600' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="min-w-0 pr-3">
                    <p className={`text-sm font-bold truncate ${isSelected ? 'text-brand-900' : 'text-gray-900'}`}>
                      {p.name}
                    </p>
                    <p className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                      {p.itemCode && <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-[11px]">{p.itemCode}</span>}
                      <span>£{(p.casePrice || p.packPrice || 0).toFixed(2)}</span>
                      {p.packSize && <span>&bull; {p.packSize}</span>}
                    </p>
                  </div>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                    isSelected ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300'
                  }`}>
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sync options */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            {itemCode && (
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={updateExistingCode}
                  onChange={(e) => setUpdateExistingCode(e.target.checked)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span>Also update existing product supplier code to <strong>{itemCode}</strong></span>
              </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                checked={updateExistingPrice}
                onChange={(e) => setUpdateExistingPrice(e.target.checked)}
                className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span>Also update existing product price to detected invoice price (£{(notice.detectedCasePrice || notice.detectedPackPrice || 0).toFixed(2)})</span>
            </label>
          </div>

          {/* Submit bar */}
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
              disabled={isSubmitting || !selectedExistingId}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl shadow-md flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Linking...</span>
                </>
              ) : (
                <>
                  <Link size={16} />
                  <span>Link to Product</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Content for MODE: REJECT */}
      {mode === 'REJECT' && (
        <form onSubmit={handleRejectSubmit} className="mt-4 space-y-4">
          <p className="text-xs text-gray-600">
            Do not add this item to the purchasing catalog. It will be recorded as rejected with your explanation.
          </p>

          <div>
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide block mb-1">
              Rejection Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Discontinued item / Wrong delivery / Not approved for restaurant menu..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3.5 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-red-500 placeholder-gray-400"
            />
          </div>

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
              disabled={isSubmitting || !rejectionReason.trim()}
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
                  <span>Do Not Add / Reject</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
