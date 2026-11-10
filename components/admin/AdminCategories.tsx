import {useEditorClose} from '../useEditorClose';

import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../../store';
import { Category } from '../../types';
import { Plus, Edit, Trash2, GripVertical, Store, Upload, Download, Loader2, AlertTriangle, AlertCircle, ArrowRight } from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import { Modal } from '../Modal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { checkCategoryIntegrity, type CategoryIntegrityReport } from '../../utils/catalogIntegrity';

export const AdminCategories: React.FC = () => {
  const { categories, suppliers, products, addCategory, updateCategory, deleteCategory, showToast } = useAppStore();
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryFilterSupplier, setCategoryFilterSupplier] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});
  const [isProcessing, setIsProcessing] = useState(false);

  const [categoryDeletionModal, setCategoryDeletionModal] = useState<{
    category: Category;
    report: CategoryIntegrityReport;
    reassignTargetId: string;
  } | null>(null);

  const requestDelete = (cat: Category) => {
    const report = checkCategoryIntegrity(cat.id, products);
    const otherCategories = categories.filter(c => c.id !== cat.id && c.supplierId === cat.supplierId && c.active);
    setCategoryDeletionModal({
      category: cat,
      report,
      reassignTargetId: ''
    });
  };

  const handleConfirmCategoryReassignAndDelete = async () => {
    if (!categoryDeletionModal) return;
    const { category, reassignTargetId } = categoryDeletionModal;
    if (!reassignTargetId) {
      showToast('error', 'Please select a replacement category.', 'Validation Error');
      return;
    }
    setIsProcessing(true);
    try {
      await deleteCategory(category.id, { reassignProductsToCategoryId: reassignTargetId });
      showToast('success', `Category "${category.name}" deleted and products reassigned.`, 'Category Deleted');
      setCategoryDeletionModal(null);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to delete category', 'Delete Error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmCategorySafeDelete = async () => {
    if (!categoryDeletionModal) return;
    const { category } = categoryDeletionModal;
    setIsProcessing(true);
    try {
      await deleteCategory(category.id);
      showToast('success', `Category "${category.name}" deleted.`, 'Category Deleted');
      setCategoryDeletionModal(null);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to delete category', 'Delete Error');
    } finally {
      setIsProcessing(false);
    }
  };



  const handleCategorySave = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editingCategory || isProcessing) return;
    setIsProcessing(true);
    try {
      const value={...editingCategory,name:editingCategory.name.trim()};
      if(!value.name) throw new Error('A name is required.');
      await (categories.some(r=>r.id===value.id)?updateCategory:addCategory)(value);
      setEditingCategory(null);setCategoryFilterSupplier('');
      useAppStore.getState().showToast('success','Saved successfully.');
    } catch(error:any) {useAppStore.getState().showToast('error',error.message||'Could not save. Please retry.');}
    finally {setIsProcessing(false);}
  };

  const visibleCategories = useMemo(() => {
      const filtered = categories.filter(c => 
          categoryFilterSupplier==='ALL' || !!categoryFilterSupplier&&c.supplierId===categoryFilterSupplier
      );
      return filtered.sort((a,b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }, [categories, categoryFilterSupplier]);

  const onCategoryDragEnd = async (result: DropResult) => {
      if (!result.destination) return;
      if (result.destination.index === result.source.index) return;

      const items: Category[] = Array.from(visibleCategories);
      const [movedItem] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, movedItem);
      
      const prevItem = items[result.destination.index - 1];
      const nextItem = items[result.destination.index + 1];
      
      let newOrder = 0;

      if (!prevItem && !nextItem) {
          newOrder = 1000;
      } else if (!prevItem) {
          const nextOrder = nextItem?.displayOrder || 1000;
          newOrder = nextOrder / 2;
      } else if (!nextItem) {
          const prevOrder = prevItem?.displayOrder || 0;
          newOrder = prevOrder + 1000;
      } else {
          const prevOrder = prevItem?.displayOrder || 0;
          const nextOrder = nextItem?.displayOrder || (prevOrder + 2000); 
          newOrder = (prevOrder + nextOrder) / 2;
      }

      if (movedItem) {
        await updateCategory({ ...movedItem, displayOrder: newOrder });
      }
  };

  const editorClose = useEditorClose(editingCategory, isProcessing, () => {setEditingCategory(null);setCategoryFilterSupplier('');});
  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
         <div><h3 className="text-lg font-bold text-gray-900">Categories</h3><p className="text-xs text-gray-500 font-medium">Organise products.</p></div>
         <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
                <select aria-label="Category supplier" value={categoryFilterSupplier} onChange={e => setCategoryFilterSupplier(e.target.value)} className="w-full sm:w-auto text-sm border border-gray-300 rounded-xl pl-9 pr-3 py-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-brand-500 outline-none appearance-none font-bold text-gray-700 min-w-[150px]">
                    <option value="">Select supplier</option><option value="ALL">All suppliers</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <Store size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            {/* Setting displayOrder to 0 triggers the Store's "Auto Append" logic */}
            <button disabled={!categoryFilterSupplier||categoryFilterSupplier==='ALL'} onClick={() => setEditingCategory({ id: crypto.randomUUID(), name: '', displayOrder: 0, active: true, supplierId: categoryFilterSupplier })} className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-brand-700 transition-colors flex items-center gap-2 whitespace-nowrap"><Plus size={18} /> Add Category</button>
         </div>
       </div>
       
       {!categoryFilterSupplier&&<p className="h-notice">Select supplier to manage its categories, or choose All suppliers to browse.</p>}
       <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
         <div className="bg-gray-50/50 px-4 py-3 border-b border-gray-100 flex justify-between items-center">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Category order</span>
            <span className="text-xs font-bold text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">{visibleCategories.length} Categories</span>
         </div>
         <DragDropContext onDragEnd={onCategoryDragEnd}>
           <Droppable droppableId="categories-list">
             {(provided) => (
               <div className="space-y-0 divide-y divide-gray-100" {...provided.droppableProps} ref={provided.innerRef}>
                 {visibleCategories.length === 0 && (
                    <div className="p-8 text-center text-gray-400 text-sm italic">No categories found for this supplier.</div>
                 )}
                 {visibleCategories.map((c, index) => (
                   <Draggable key={c.id} draggableId={c.id} index={index}>
                      {(provided, snapshot) => (
                         <div 
                           ref={provided.innerRef} 
                           {...provided.draggableProps} 
                           style={{ ...provided.draggableProps.style }}
                           className={`p-4 flex justify-between items-center group transition-colors ${snapshot.isDragging ? 'bg-blue-50 shadow-lg z-[60]' : 'hover:bg-gray-50 bg-white'}`}
                         >
                           <div className="flex items-center gap-4">
                               <div {...provided.dragHandleProps} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing p-1 -ml-1"><GripVertical size={18} /></div>
                               <div>
                                   <div className="flex items-center gap-2">
                                       <span className="font-bold text-gray-900 text-sm">{c.name}</span>
                                       {!c.active && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-100">Inactive</span>}
                                   </div>
                               </div>
                           </div>
                           <div className="flex gap-2">
                               <button aria-label={`Edit category ${c.name}`} title={`Edit category ${c.name}`} onClick={() => setEditingCategory(c)} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"><Edit size={16} /></button>
                               <button aria-label={`Delete category ${c.name}`} onClick={() => requestDelete(c)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Category"><Trash2 size={16} /></button>
                           </div>
                         </div>
                      )}
                   </Draggable>
                 ))}
                 {provided.placeholder}
               </div>
             )}
           </Droppable>
         </DragDropContext>
       </div>

       <ConfirmModal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={() => { confirmAction(); setConfirmOpen(false); }} title="Delete Category" message="Are you sure you want to delete this category?" />

       {editorClose.confirmation}
       <Modal isOpen={!!editingCategory} onClose={editorClose.requestClose} className="max-w-sm p-6">
          {editingCategory && (
            <>
              <h3 className="font-bold text-xl mb-6 text-gray-900">Category details</h3>
              <form onSubmit={handleCategorySave} className="space-y-5">
                <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Name</label><input aria-label="Name" type="text" required value={editingCategory.name} onChange={e => setEditingCategory({...editingCategory, name: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                <div>
                   <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Supplier Scope</label>
                   <select aria-label="Supplier Scope" value={editingCategory.supplierId || ''} onChange={e => setEditingCategory({...editingCategory, supplierId: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500">
                      <option value="">All Suppliers</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                   </select>
                </div>
                
                <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                   <input type="checkbox" checked={editingCategory.active} onChange={e => setEditingCategory({...editingCategory, active: e.target.checked})} className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500" />
                   <span className="text-sm font-bold text-gray-800">Active</span>
                </div>

                <div className="flex justify-end gap-3 mt-6"><button type="button" onClick={editorClose.requestClose} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors text-sm">Cancel</button><button type="submit" className="px-5 py-2.5 bg-brand-600 text-white text-sm font-bold rounded-xl shadow-md hover:bg-brand-700 transition-colors">Save</button></div>
              </form>
            </>
          )}
       </Modal>

        {/* Category Deletion & Referential Integrity Modal */}
        <Modal
          isOpen={!!categoryDeletionModal}
          onClose={() => setCategoryDeletionModal(null)}
          className="max-w-md p-6"
        >
          {categoryDeletionModal && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-red-600">
                <AlertTriangle size={24} className="shrink-0" />
                <h3 className="text-lg font-bold text-gray-900">
                  Delete Category: {categoryDeletionModal.category.name}
                </h3>
              </div>

              {categoryDeletionModal.report.canSafeDelete ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    This category has <strong className="text-gray-900">0 active products</strong>. It can be safely deleted.
                  </p>
                  {categoryDeletionModal.report.totalProductsCount > 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                      Note: {categoryDeletionModal.report.totalProductsCount} archived/inactive products are in this category.
                    </p>
                  )}
                  <div className="flex justify-end gap-2 pt-3">
                    <button
                      onClick={() => setCategoryDeletionModal(null)}
                      className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmCategorySafeDelete}
                      disabled={isProcessing}
                      className="px-4 py-2 text-sm font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-sm flex items-center gap-1.5"
                    >
                      {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      Confirm Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle size={14} /> Referential Integrity Warning
                    </div>
                    <p>
                      This category currently contains <strong>{categoryDeletionModal.report.activeProductsCount} active products</strong>.
                      Deleting it without reassigning would orphan these products from catalog navigation.
                    </p>
                  </div>

                  {categories.filter(c => c.id !== categoryDeletionModal.category.id && c.supplierId === categoryDeletionModal.category.supplierId && c.active).length > 0 ? (
                    <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2.5">
                      <div className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
                        <ArrowRight size={16} className="text-blue-600" />
                        Reassign Products &amp; Delete
                      </div>
                      <p className="text-xs text-blue-800">
                        Move all {categoryDeletionModal.report.totalProductsCount} products to another category for this supplier:
                      </p>
                      <select
                        value={categoryDeletionModal.reassignTargetId}
                        onChange={(e) => setCategoryDeletionModal({
                          ...categoryDeletionModal,
                          reassignTargetId: e.target.value
                        })}
                        className="w-full text-xs font-semibold p-2 border border-blue-200 bg-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select category</option>
                        {categories
                          .filter(c => c.id !== categoryDeletionModal.category.id && c.supplierId === categoryDeletionModal.category.supplierId && c.active)
                          .map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={handleConfirmCategoryReassignAndDelete}
                        disabled={isProcessing || !categoryDeletionModal.reassignTargetId}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5"
                      >
                        {isProcessing ? <Loader2 size={14} className="animate-spin" /> : null}
                        Reassign {categoryDeletionModal.report.activeProductsCount} Products &amp; Delete
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                      There are no other active categories for this supplier. Please create another category first, or deactivate the products.
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => setCategoryDeletionModal(null)}
                      className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-xl"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
    </div>
  );
};
