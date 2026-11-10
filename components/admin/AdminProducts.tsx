import {useEditorClose} from '../useEditorClose';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore, can } from '../../store';
import { Product, Category, PriceHistoryRecord } from '../../types';
import { Plus, Edit, Trash2, Loader2, Search, CheckSquare, Square, GripVertical, Check, Store, ChevronDown, ChevronRight, AlertCircle, ArrowUp, ArrowDown, RefreshCw, Download, Upload, Sliders, AlertTriangle } from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import { Modal } from '../Modal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../../firebase-config';
import {api} from '../../app/htos/ui';
import {orderedProductGroups} from '../../app/htos/orderingHelpers';
import {productSequence,productFingerprint} from '../../shared/product-workbench';
import {useSupplierProducts} from '../../hooks/useSupplierProducts';


export const AdminProducts: React.FC<{onBulk?:()=>void;onReadSupplier?:()=>void}> = ({onBulk,onReadSupplier}) => {
  const { products, categories, suppliers, branches, currentUser, addProduct, updateProduct, deleteProduct } = useAppStore();

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productAvailabilityMode, setProductAvailabilityMode] = useState<'ALL' | 'SPECIFIC'>('ALL');
  const [branchSearch, setBranchSearch] = useState('');

  const [productFilterSupplier, setProductFilterSupplier] = useState<string>('');
  const catalogue=useSupplierProducts(editingProduct?.supplierId||productFilterSupplier);
  const [productSearch, setProductSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState(new Set<string>());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  // Accordion State: Track which categories are expanded
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const resetSelection=()=>{setProductFilterSupplier('');setProductSearch('');setShowInactive(false);setSelectedProductIds(new Set());setExpandedCategories(new Set());};

  useEffect(() => {
    if (editingProduct) {
       if (editingProduct.allowedBranchIds && editingProduct.allowedBranchIds.length > 0) {
          setProductAvailabilityMode('SPECIFIC');
       } else {
          setProductAvailabilityMode('ALL');
       }
       setBranchSearch('');
    }
  }, [editingProduct?.id]);

  // FIX: Auto-correct Category ID if it becomes invalid for the selected Supplier
  useEffect(() => {
    if (!editingProduct) return;

    const targetSupplier = editingProduct.supplierId;
    const currentCatId = editingProduct.categoryId;

    const validCategories = categories.filter(c => !c.supplierId || c.supplierId === targetSupplier);
    const isValid = validCategories.some(c => c.id === currentCatId);

    if (!isValid) {
        setEditingProduct(prev => prev ? ({ ...prev, categoryId: '' }) : null);
    }
  }, [editingProduct?.supplierId, categories]);

  useEffect(() => {
    setSelectedProductIds(new Set());
  }, [productFilterSupplier, productSearch, showInactive]);

  const toggleCategory = (catId: string) => {
      const newSet = new Set(expandedCategories);
      if (newSet.has(catId)) newSet.delete(catId);
      else newSet.add(catId);
      setExpandedCategories(newSet);
  };

  const expandAll = () => {
      setExpandedCategories(new Set(sortedCategories.map(c => c.id)));
  };
  const collapseAll = () => setExpandedCategories(new Set());

  const handleAddNewProduct = () => {
      if(!productFilterSupplier)return;
      setEditingProduct({
          id: crypto.randomUUID(),
          name: '',
          chineseName: '',
          categoryId: '',
          supplierId: productFilterSupplier,
          displayOrder: 0,
          allowedBranchIds: [],
          active: true,
          casePrice: 0,
          packPrice: 0,
          unitType: 'DUAL',
          caseUnitName: 'Box',
          packUnitName: 'Unit'
      });
  };

  const handleProductSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || isSavingProduct) return;
    if(!catalogue.ready){alert(catalogue.error||'Wait for this supplier’s products to finish loading.');return;}
    if(!editingProduct.supplierId||!editingProduct.categoryId){alert('Select supplier and category before saving.');return;}

    if (productAvailabilityMode === 'SPECIFIC' && editingProduct.allowedBranchIds.length === 0) {
      alert("Please select at least one branch or switch to 'Available to All Branches'.");
      return;
    }

    // R10: Duplicate-check supplier code within the same supplier
    const cleanCode = (editingProduct.itemCode || '').trim().toUpperCase();
    if (cleanCode && editingProduct.active !== false) {
      const duplicate = products.find(x =>
        x.id !== editingProduct.id &&
        x.active !== false &&
        x.supplierId === editingProduct.supplierId &&
        (x.itemCode || '').trim().toUpperCase() === cleanCode
      );
      if (duplicate) {
        alert(`Duplicate product code: "${cleanCode}" is already assigned to "${duplicate.name}". Each code must be unique within a supplier.`);
        return;
      }
    }

    const p = {
      ...editingProduct,
      itemCode: (editingProduct.itemCode || '').trim(),
      casePrice: Number.isFinite(Number(editingProduct.casePrice)) ? Math.max(0, Number(editingProduct.casePrice)) : 0,
      packPrice: Number.isFinite(Number(editingProduct.packPrice)) ? Math.max(0, Number(editingProduct.packPrice)) : 0,
      displayOrder: Number(editingProduct.displayOrder)
    };

    setIsSavingProduct(true);
    try {
      const existing = products.find(x => x.id === p.id);
      if (existing) {
        if(existing.supplierId!==p.supplierId)throw new Error('Keep the existing supplier. Create a separate product for a different supplier.');
        if ((existing as any).version && (editingProduct as any)._initialVersion && (existing as any).version !== (editingProduct as any)._initialVersion) {
          alert(`Conflict: Product was updated by another user (current version v${(existing as any).version}). Form preserved.`);
          return;
        }
        await api('/api/admin/workspace',{action:'product-bulk',requestId:crypto.randomUUID(),supplierId:existing.supplierId,rows:[{id:p.id,expected:productFingerprint(existing),values:p}]});
        if(p.casePrice!==existing.casePrice||p.packPrice!==existing.packPrice)alert('Details saved. Price changes await approval in Catalogue → Price approvals.');
      } else {
        await addProduct(p);
      }
      setEditingProduct(null);resetSelection();
    } catch (err: any) {
      console.error('Failed to save product:', err);
      alert(`Save failed: ${err.message || 'Network or database error'}. Your edits have been preserved.`);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const filteredProducts = useMemo(() => {
    if(!productFilterSupplier)return [];
    return products.filter(p => {
       if (p.removedAt) return false;
       if (!showInactive && p.active === false) return false;
       if (productFilterSupplier && p.supplierId !== productFilterSupplier) return false;
       if (productSearch) {
         const term = productSearch.toLowerCase();
         return p.name.toLowerCase().includes(term) || (p.itemCode && p.itemCode.toLowerCase().includes(term)) || (p.chineseName && p.chineseName.includes(term));
       }
       return true;
    });
  }, [products, productFilterSupplier, productSearch, showInactive]);

  const fullSequence=useMemo(()=>productSequence(products.filter(p=>!p.removedAt&&p.supplierId===productFilterSupplier),categories),[products,categories,productFilterSupplier]);
  const sortedCategories=useMemo(()=>orderedProductGroups(filteredProducts,categories),[filteredProducts,categories]);
  const groupedProducts=useMemo(()=>Object.fromEntries(sortedCategories.map(group=>[group.id,group.products])),[sortedCategories]);
  useEffect(() => {
      if (productSearch) {
          const matchingCats = Object.keys(groupedProducts).filter(key => groupedProducts[key].length > 0);
          setExpandedCategories(new Set(matchingCats));
      }
  }, [productSearch, groupedProducts]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination } = result;

    if (!destination) return;

    if (source.droppableId !== destination.droppableId) {
        alert("You can only reorder items within the same category. To change categories, edit the product.");
        return;
    }

    const catId = source.droppableId.replace('cat-', '');
    const items = groupedProducts[catId] || [];

    const newItems: Product[] = Array.from(items);
    const [movedItem] = newItems.splice(source.index, 1);
    newItems.splice(destination.index, 0, movedItem);

    if(source.index===destination.index)return;
    const movedIds=new Set(newItems.map(p=>p.id));let cursor=0;
    const sequence=fullSequence.map(p=>movedIds.has(p.id)?newItems[cursor++].id:p.id);
    await saveSequence(sequence);
  };

  const saveSequence=async(sequence:string[])=>{
    if(isProcessing)return;
    if(fullSequence.length>240){alert('Rearranging more than 240 products needs a larger catalogue review. Nothing was saved.');return;}
    setIsProcessing(true);
    try{await api('/api/admin/workspace',{action:'product-bulk',supplierId:productFilterSupplier,requestId:crypto.randomUUID(),sequence,rows:fullSequence.map(p=>({id:p.id,expected:productFingerprint(p),values:{}}))});}
    catch(e:any){alert('Could not save product order: '+e.message);}
    finally{setIsProcessing(false);}
  };
  const handleResequence = async (_catId:string,_items:Product[]) => {
    if(confirm('Normalise catalogue positions to 1, 2, 3 without changing the current sequence?'))await saveSequence(fullSequence.map(p=>p.id));
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedProductIds(new Set(filteredProducts.map(p => p.id)));
    else setSelectedProductIds(new Set());
  };

  const toggleProductSelect = (id: string) => {
    const newSet = new Set(selectedProductIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedProductIds(newSet);
  };

  const handleBulkDelete = async () => {
    if (selectedProductIds.size === 0) return;
    if (!can(currentUser, 'manage_products')) { alert("Permission denied"); return; }
    setConfirmAction(() => async () => {
        setIsProcessing(true);
        try {
          const batch = writeBatch(db);
          let count = 0;
          selectedProductIds.forEach(id => { if (count < 490) { batch.delete(doc(db, 'products', id)); count++; } });
          await batch.commit();
          setSelectedProductIds(new Set());
          alert(`Deleted ${count} items.`);
        } catch (err: any) { alert("Error: " + err.message); } finally { setIsProcessing(false); }
    });
    setConfirmOpen(true);
  };

  const requestDelete = (id: string) => {
    setConfirmAction(() => () => deleteProduct(id));
    setConfirmOpen(true);
  };

  const neighborhood = useMemo(() => {
      if (!editingProduct || !editingProduct.categoryId) return null;
      const catProds = fullSequence.filter(p => p.categoryId === editingProduct.categoryId);

      const idx = catProds.findIndex(p => p.id === editingProduct.id);

      if (idx === -1) {
          const last = catProds[catProds.length - 1];
          return { prev: last, current: editingProduct, next: null, isNew: true };
      }

      return {
          prev: catProds[idx - 1] || null,
          current: editingProduct,
          next: catProds[idx + 1] || null,
          isNew: false
      };
  }, [editingProduct, fullSequence]);

  const gridClass = "grid grid-cols-[40px_40px_1fr_100px_80px_80px] gap-2 items-center min-w-[500px]";

  const editorClose = useEditorClose(editingProduct, isSavingProduct, () => {setEditingProduct(null);resetSelection();});
  return (
    <div>

       <div className="h-catalogue-header">
         <div>
            <h3 className="text-lg font-bold text-gray-900">Product catalogue</h3>
            <p className="text-xs text-gray-500 font-medium">Browse by supplier. Open a category to edit individual products.</p>
         </div>
         <div className="h-catalogue-controls">
            <select aria-label="Catalogue supplier" value={productFilterSupplier} onChange={e => {setProductFilterSupplier(e.target.value);setProductSearch('');setShowInactive(false);setSelectedProductIds(new Set());setExpandedCategories(new Set());}} className="text-sm border border-gray-300 rounded-xl px-3 py-2 w-full md:w-auto bg-gray-50 focus:bg-white focus:ring-2 focus:ring-brand-500 outline-none">
               <option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="relative flex-1 md:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input disabled={!catalogue.ready} type="text" aria-label="Search catalogue products" placeholder="Search products…" value={productSearch} onChange={e => setProductSearch(e.target.value)} className="text-sm border border-gray-300 rounded-xl pl-9 pr-3 py-2 w-full bg-gray-50 focus:bg-white focus:ring-2 focus:ring-brand-500 outline-none" />
            </div>

            {onBulk&&<button onClick={onBulk} className="h-button secondary"><Sliders size={16}/> Bulk edit & files</button>}
            {onReadSupplier&&<button onClick={onReadSupplier} className="h-button secondary"><Upload size={16}/> Read supplier file</button>}

            <button disabled={!catalogue.ready} onClick={handleAddNewProduct} className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-brand-700 transition-colors flex items-center gap-2 whitespace-nowrap"><Plus size={18} /> Add Product</button>
         </div>
       </div>

       {!productFilterSupplier&&<p className="h-notice">Select supplier to view or edit its products.</p>}
       {productFilterSupplier&&!catalogue.ready&&<p className="h-notice" role={catalogue.error?'alert':'status'}>{catalogue.error||'Loading this supplier’s products…'}</p>}
       {catalogue.ready&&<>
       {selectedProductIds.size > 0 && (
         <div className="mb-4 bg-blue-50 border border-blue-100 p-3 rounded-xl flex items-center justify-between shadow-sm">
            <div className="text-sm text-blue-800 font-bold flex items-center gap-2">
               <CheckSquare size={18} /><span>{selectedProductIds.size} Items Selected</span>
            </div>
            <div className="flex items-center gap-2">
               <button onClick={() => setSelectedProductIds(new Set())} className="px-3 py-1.5 text-xs text-blue-600 font-bold hover:bg-blue-100 rounded-lg transition-colors">Cancel</button>
               <button onClick={handleBulkDelete} disabled={isProcessing} className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 flex items-center gap-1.5 shadow-sm transition-colors">{isProcessing ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />} Delete Selected</button>
            </div>
         </div>
       )}

       <div className="flex gap-2 mb-4">
          <label className="flex items-center gap-2 mr-auto text-sm"><input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>Show inactive products</label>
          <button onClick={expandAll} className="text-xs font-bold text-gray-500 hover:text-gray-800 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm">Expand All</button>
          <button onClick={collapseAll} className="text-xs font-bold text-gray-500 hover:text-gray-800 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm">Collapse All</button>
       </div>

       <DragDropContext onDragEnd={onDragEnd}>
        <div className="space-y-4">
          {sortedCategories.map(cat => {
             const items = groupedProducts[cat.id] || [];
             const isExpanded = expandedCategories.has(cat.id);

             return (
               <div key={cat.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div
                    onClick={() => toggleCategory(cat.id)}
                    className="flex items-center justify-between p-4 bg-gray-50/50 cursor-pointer hover:bg-gray-100 transition-colors border-b border-gray-100"
                  >
                     <div className="flex items-center gap-3">
                        <div className={`transition-transform duration-200 text-gray-400 ${isExpanded ? 'rotate-90' : ''}`}>
                           <ChevronRight size={20} />
                        </div>
                        <h4 className="font-bold text-gray-900 text-sm uppercase tracking-wide">{cat.name}</h4>
                        <span className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full font-mono">{items.length}</span>
                     </div>
                     {isExpanded && items.length > 0 && (
                        <div onClick={e => e.stopPropagation()}>
                            <button
                                onClick={() => handleResequence(cat.id, items)}
                                disabled={isProcessing}
                                className="text-[10px] flex items-center gap-1 bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-50 hover:text-gray-900 transition-colors"
                                title="Normalise positions without rearranging products"
                            >
                                <RefreshCw size={10} /> Normalise positions
                            </button>
                        </div>
                     )}
                  </div>

                  {isExpanded && (
                     <Droppable droppableId={`cat-${cat.id}`}>
                        {(provided) => (
                           <div ref={provided.innerRef} {...provided.droppableProps} className="divide-y divide-gray-50 overflow-x-auto">
                              {items.length === 0 ? (
                                 <div className="p-8 text-center text-sm text-gray-400 italic">No products in this category.</div>
                              ) : (
                                 items.map((p, index) => {
                                    const isSelected = selectedProductIds.has(p.id);
                                    return (
                                       <Draggable key={p.id} draggableId={p.id} index={index} isDragDisabled={!!productSearch||isProcessing||!catalogue.ready}>
                                          {(provided, snapshot) => (
                                             <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                style={{ ...provided.draggableProps.style }}
                                                className={`p-3 hover:bg-gray-50 transition-colors ${snapshot.isDragging ? 'bg-blue-50 shadow-md z-[60]' : isSelected ? 'bg-blue-50/30' : 'bg-white'}`}
                                             >
                                                <div className={gridClass}>
                                                   <div className="flex justify-center">
                                                      <button aria-label={`Select ${p.name}`} aria-pressed={selectedProductIds.has(p.id)} onClick={() => toggleProductSelect(p.id)} className="text-gray-300 hover:text-brand-600">
                                                         {isSelected ? <CheckSquare size={18} className="text-brand-600" /> : <Square size={18} />}
                                                      </button>
                                                   </div>
                                                   <div className="flex justify-center">
                                                      <div {...provided.dragHandleProps} className={`text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing ${productSearch ? 'opacity-20 pointer-events-none' : ''}`}>
                                                         <GripVertical size={16} />
                                                      </div>
                                                   </div>
                                                   <div className="min-w-0 pr-2">
                                                      <div className="flex items-baseline gap-2">
                                                         <span className="font-bold text-sm text-gray-900 truncate">{p.name}</span>
                                                         {p.chineseName && <span className="text-xs text-gray-500 truncate">{p.chineseName}</span>}
                                                      </div>
                                                      <div className="flex items-center gap-2 mt-0.5">
                                                         {p.itemCode && <span className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 rounded border border-gray-200">#{p.itemCode}</span>}
                                                         {p.packSize && <span className="text-[10px] text-gray-400">{p.packSize}</span>}
                                                         <span className="text-[11px] text-gray-500">Position {fullSequence.findIndex(item=>item.id===p.id)+1}</span>
                                                      </div>
                                                   </div>
                                                   <div className="text-right text-xs font-mono text-gray-700">
                                                      {p.casePrice ? <div>£{p.casePrice.toFixed(2)}</div> : <div className="text-gray-300">-</div>}
                                                   </div>
                                                   <div className="text-center">
                                                      {p.active ? (
                                                         <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">Active</span>
                                                      ) : (
                                                         <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">Inactive</span>
                                                      )}
                                                   </div>
                                                   <div className="flex justify-end gap-1">
                                                      <button aria-label={`Edit ${p.name}`} title={`Edit ${p.name}`} onClick={() => setEditingProduct(p)} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Edit size={16} /></button>
                                                      <button aria-label={`Delete ${p.name}`} title={`Delete ${p.name}`} onClick={() => requestDelete(p.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                                                   </div>
                                                </div>
                                             </div>
                                          )}
                                       </Draggable>
                                    );
                                 })
                              )}
                              {provided.placeholder}
                           </div>
                        )}
                     </Droppable>
                  )}
               </div>
             );
          })}

        </div>
       </DragDropContext>
       </>}

       <ConfirmModal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={() => { confirmAction(); setConfirmOpen(false); }} title="Delete Product" message="Are you sure you want to delete this product?" />

       {editorClose.confirmation}
       <Modal isOpen={!!editingProduct} onClose={editorClose.requestClose} className="max-w-lg p-6">
          {editingProduct && (
            <>
              <h3 className="font-bold text-xl mb-6 text-gray-900">Product Details</h3>
              <form onSubmit={handleProductSave} className="space-y-5">

                {neighborhood && (
                   <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
                      <h4 className="text-xs font-bold text-blue-800 uppercase mb-2 flex items-center gap-2">
                          <Store size={14} /> Position in Category
                      </h4>
                      <div className="space-y-2">
                         {neighborhood.prev ? (
                             <div className="flex items-center gap-2 text-xs text-gray-500 opacity-70">
                                 <ArrowUp size={12} />
                                 <span className="truncate">{neighborhood.prev.name}</span>
                             </div>
                         ) : (
                             <div className="text-[10px] text-gray-400 italic pl-5">Top of List</div>
                         )}

                         <div className="bg-white border border-blue-200 rounded-lg p-2 flex items-center gap-2 shadow-sm">
                             <div className="w-2 h-2 bg-brand-50 rounded-full"></div>
                             <span className="font-bold text-sm text-gray-900 truncate">
                                 {editingProduct.name || '(New Product)'}
                             </span>
                             {neighborhood.isNew && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded font-bold">NEW</span>}
                         </div>

                         {neighborhood.next ? (
                             <div className="flex items-center gap-2 text-xs text-gray-500 opacity-70">
                                 <ArrowDown size={12} />
                                 <span className="truncate">{neighborhood.next.name}</span>
                             </div>
                         ) : (
                             <div className="text-[10px] text-gray-400 italic pl-5">Bottom of List (Auto-Append)</div>
                         )}
                      </div>
                   </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                   <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Name</label><input aria-label="Name" type="text" required value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                   <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Chinese Name</label><input aria-label="Chinese Name" type="text" value={editingProduct.chineseName || ''} onChange={e => setEditingProduct({...editingProduct, chineseName: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                   <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Item Code</label><input aria-label="Item Code" type="text" value={editingProduct.itemCode || ''} onChange={e => setEditingProduct({...editingProduct, itemCode: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                   <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Pack Size</label><input aria-label="Pack Size" type="text" value={editingProduct.packSize || ''} onChange={e => setEditingProduct({...editingProduct, packSize: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                   <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Box Price (£)</label><input aria-label="Box Price (£)" type="number" step="0.01" value={editingProduct.casePrice} onChange={e => setEditingProduct({...editingProduct, casePrice: parseFloat(e.target.value)})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                   <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Pack Price (£)</label><input aria-label="Pack Price (£)" type="number" step="0.01" value={editingProduct.packPrice} onChange={e => setEditingProduct({...editingProduct, packPrice: parseFloat(e.target.value)})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                </div>

                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-4">
                   <div>
                     <label className="text-xs font-bold text-gray-700 uppercase mb-1.5 block">
                       Ordering Unit Support
                     </label>
                     <select aria-label="Ordering Unit Support"
                       value={editingProduct.unitType || 'DUAL'}
                       onChange={e => setEditingProduct({...editingProduct, unitType: e.target.value as any})}
                       className="w-full border border-gray-300 rounded-xl p-3 text-sm bg-white font-medium outline-none focus:ring-2 focus:ring-brand-500"
                     >
                       <option value="DUAL">Dual Units (Box & Single Unit)</option>
                       <option value="CASE_ONLY">Single Unit Only (Box / Outer Case Only)</option>
                       <option value="PACK_ONLY">Single Unit Only (Pack / Individual Unit Only)</option>
                     </select>
                     <p className="text-[11px] text-gray-500 mt-1">
                       Controls whether users order in boxes, single units, or both.
                     </p>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="text-xs font-bold text-gray-600 uppercase mb-1 block">
                         Box Unit Label
                       </label>
                       <input aria-label="Box Unit Label"
                         type="text"
                         placeholder="Box (or Case, Tub, Crate)"
                         value={editingProduct.caseUnitName || ''}
                         onChange={e => setEditingProduct({...editingProduct, caseUnitName: e.target.value})}
                         className="w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500"
                       />
                     </div>
                     <div>
                       <label className="text-xs font-bold text-gray-600 uppercase mb-1 block">
                         Single Unit Label
                       </label>
                       <input aria-label="Single Unit Label"
                         type="text"
                         placeholder="Unit (or Pack, Bottle, Kg)"
                         value={editingProduct.packUnitName || ''}
                         onChange={e => setEditingProduct({...editingProduct, packUnitName: e.target.value})}
                         className="w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500"
                       />
                     </div>
                   </div>
                </div>



                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                   <div>
                      <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Supplier</label>
                      <select aria-label="Supplier" required value={editingProduct.supplierId} onChange={e => setEditingProduct({...editingProduct, supplierId: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500">
                         <option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                   </div>
                   <div>
                      <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Category</label>
                      <select aria-label="Category" required value={editingProduct.categoryId} onChange={e => setEditingProduct({...editingProduct, categoryId: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500">
                         <option value="">Select category</option>{categories.filter(c => !c.supplierId || c.supplierId === editingProduct.supplierId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                   </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-bold text-gray-500 uppercase block">Branch Availability</label>

                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                      <div className="p-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                          <Search size={14} className="text-gray-400"/>
                          <input
                              type="text"
                              placeholder="Search locations..."
                              className="bg-transparent text-xs font-medium outline-none w-full placeholder-gray-400 text-gray-700"
                              value={branchSearch}
                              onChange={(e) => setBranchSearch(e.target.value)}
                          />
                      </div>

                      <div className="max-h-48 overflow-y-auto custom-scrollbar bg-white">
                          <div className="px-3 py-2 bg-gray-50/30 text-[10px] font-bold text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-sm">
                              Locations
                          </div>
                          {branches.filter(b => b.name.toLowerCase().includes(branchSearch.toLowerCase())).map(b => {
                              const isAvailableAtAll = productAvailabilityMode === 'ALL';
                              const isChecked = isAvailableAtAll || editingProduct.allowedBranchIds.includes(b.id);

                              return (
                                  <div
                                      key={b.id}
                                      onClick={() => {
                                          if (isAvailableAtAll) {
                                              setProductAvailabilityMode('SPECIFIC');
                                              const allIds = branches.map(br => br.id);
                                              setEditingProduct({
                                                  ...editingProduct,
                                                  allowedBranchIds: allIds.filter(id => id !== b.id)
                                              });
                                          } else {
                                              const current = editingProduct.allowedBranchIds;
                                              const newIds = current.includes(b.id)
                                                  ? current.filter(id => id !== b.id)
                                                  : [...current, b.id];
                                              setEditingProduct({ ...editingProduct, allowedBranchIds: newIds });
                                          }
                                      }}
                                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors group"
                                  >
                                      <span className="text-sm text-gray-700 font-medium group-hover:text-gray-900">{b.name}</span>
                                      <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isChecked ? 'bg-black border-black text-white' : 'bg-white border-gray-300 group-hover:border-gray-400'}`}>
                                          {isChecked && <Check size={12} strokeWidth={3} />}
                                      </div>
                                  </div>
                              );
                          })}
                      </div>

                      <div
                          onClick={() => {
                              if (productAvailabilityMode === 'ALL') {
                                  setProductAvailabilityMode('SPECIFIC');
                                  setEditingProduct({ ...editingProduct, allowedBranchIds: branches.map(b => b.id) });
                              } else {
                                  setProductAvailabilityMode('ALL');
                                  setEditingProduct({ ...editingProduct, allowedBranchIds: [] });
                              }
                          }}
                          className="p-4 bg-gray-50 border-t border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors flex items-center justify-between group"
                      >
                          <span className="text-sm font-bold text-gray-900">Available at all future locations</span>
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${productAvailabilityMode === 'ALL' ? 'bg-black border-black text-white' : 'bg-white border-gray-300 group-hover:border-gray-400'}`}>
                              {productAvailabilityMode === 'ALL' && <Check size={12} strokeWidth={3} />}
                          </div>
                      </div>
                  </div>
                </div>

                {editingProduct.id && products.some(p => p.id === editingProduct.id) && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Internal System ID (Read-only)</label>
                    <input aria-label="Internal System ID (Read-only)"
                      type="text"
                      readOnly
                      disabled
                      value={editingProduct.id}
                      className="w-full border border-gray-200 bg-gray-100 text-gray-500 rounded-xl p-2.5 text-xs font-mono select-all cursor-not-allowed"
                    />
                  </div>
                )}

                <div>
                   <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Status</label>
                   <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <input type="checkbox" checked={editingProduct.active} onChange={e => setEditingProduct({...editingProduct, active: e.target.checked})} className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500" />
                      <span className="text-sm font-bold text-gray-800">Active (Available for ordering)</span>
                   </div>
                </div>

                {!catalogue.ready&&<p className="h-notice" role={catalogue.error?'alert':'status'}>{catalogue.error||'Checking this supplier’s products…'}</p>}
                <div className="flex justify-end gap-3 mt-6">
                  <button type="button" onClick={editorClose.requestClose} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors text-sm">Cancel</button>
                  <button type="submit" disabled={isSavingProduct||!catalogue.ready} className="px-5 py-2.5 bg-brand-600 text-white text-sm font-bold rounded-xl shadow-md hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center gap-2">
                    {isSavingProduct && <Loader2 size={14} className="animate-spin" />}
                    <span>{isSavingProduct ? 'Saving...' : 'Save'}</span>
                  </button>
                </div>
              </form>
            </>
          )}
       </Modal>

    </div>
  );
};
