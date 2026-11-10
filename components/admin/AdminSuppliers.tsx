
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {useSupplierProducts} from '../../hooks/useSupplierProducts';
import { useAppStore } from '../../store';
import { Supplier, Branch } from '../../types';
import { Plus, Edit, Trash2, MessageCircle, Loader2, AlertCircle, AlertTriangle, ShieldCheck, ArrowRight, MapPin } from 'lucide-react';
import { Modal } from '../Modal';
import {Link} from 'react-router-dom';
import {can} from '../../store';
import { checkSupplierIntegrity, type SupplierIntegrityReport } from '../../utils/catalogIntegrity';

import Papa from 'papaparse';
import {validateSupplierMinimum} from '../../shared/order-minimum';
import {savedListOrder,canArrangeSuppliers,nextListPosition} from '../../shared/list-order';
import {DragDropContext,Droppable,Draggable,type DropResult} from '@hello-pangea/dnd';
import {GripVertical, X} from 'lucide-react';
import {beginPendingWork} from '../../shared/pending-work';
import {SupplierDetailsFields, type SupplierDetailsDraft} from './SupplierDetailsFields';

export const AdminSuppliers: React.FC<{transferOnly?: boolean}> = ({transferOnly=false}) => {
  const { 
    suppliers, branches, departments, products, categories, 
    addSupplier, updateSupplier, deleteSupplier, reorderSupplier,
    currentUser, showToast
  } = useAppStore();

  const [editingSupplier, setEditingSupplier] = useState<SupplierDetailsDraft | null>(null);
  const originalSupplier = useRef('');
  const supplierPersisted = useRef(false);
  const [supplierSaved, setSupplierSaved] = useState(false);
  const supplierSaving = useRef(false);
  const [discardSupplier, setDiscardSupplier] = useState(false);
  const [supplierSaveError, setSupplierSaveError] = useState('');
  const closeSupplierButton = useRef<HTMLButtonElement>(null);
  const supplierDirty = !!editingSupplier && JSON.stringify(editingSupplier) !== originalSupplier.current;
  const openSupplierEditor = (supplier: Supplier) => {
    const draft = structuredClone(supplier);
    originalSupplier.current = JSON.stringify(draft);
    supplierPersisted.current = suppliers.some(item => item.id === supplier.id);
    setSupplierSaved(false);
    setEditingSupplier(draft);
    setDiscardSupplier(false);
    setSupplierSaveError('');
  };
  const closeSupplierEditor = () => {
    if (supplierSaving.current) return;
    if (supplierDirty) setDiscardSupplier(true);
    else setEditingSupplier(null);
  };
  const keepSupplierEditing = () => {
    setDiscardSupplier(false);
    requestAnimationFrame(() => closeSupplierButton.current?.focus());
  };
  useEffect(() => {
    if (!editingSupplier) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || supplierSaving.current) return;
      event.preventDefault();
      if (discardSupplier) keepSupplierEditing();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (supplierDirty || supplierSaving.current) { event.preventDefault(); event.returnValue = ''; }
    };
    document.addEventListener('keydown', escape);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('keydown', escape);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [!!editingSupplier, supplierDirty, discardSupplier]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [savingOrder,setSavingOrder]=useState(false),[orderMessage,setOrderMessage]=useState('');
  const orderSaving=useRef(false);
  const sortedSuppliers=useMemo(()=>savedListOrder(suppliers),[suppliers]);
  const arrangeAllowed=canArrangeSuppliers(currentUser);
  const onDragEnd=async(result:DropResult)=>{
    if(!result.destination||result.source.index===result.destination.index||orderSaving.current||!arrangeAllowed)return;
    const target=sortedSuppliers[result.destination.index];if(!target)return;
    orderSaving.current=true;setSavingOrder(true);setOrderMessage('Saving supplier order…');
    try{await reorderSupplier(result.draggableId,target.id);setOrderMessage('Supplier order saved. Dropdowns use this order too.');}
    catch(error:any){setOrderMessage(`Supplier order was not saved. ${error.message||'Please try again.'}`);}
    finally{orderSaving.current=false;setSavingOrder(false);}
  };
  const [checkingSupplier,setCheckingSupplier]=useState<Supplier|null>(null);

  const [supplierDeletionModal, setSupplierDeletionModal] = useState<{
    supplier: Supplier;
    report: SupplierIntegrityReport;
    reassignTargetId: string;
  } | null>(null);
  // Only removal needs the whole reference set, to detect categories wrongly
  // shared by another supplier. Keep it live until this review is closed.
  const catalogue=useSupplierProducts(checkingSupplier?.id||supplierDeletionModal?.supplier.id||'',true);

  const handleSupplierDelete = (supplier: Supplier) => {
    if(!checkingSupplier)setCheckingSupplier(supplier);
  };
  useEffect(()=>{
    if(!checkingSupplier)return;
    if(catalogue.error){showToast('error',catalogue.error);setCheckingSupplier(null);return;}
    if(!catalogue.ready)return;
    const report=checkSupplierIntegrity(checkingSupplier.id,products,categories);
    setSupplierDeletionModal({supplier:checkingSupplier,report,reassignTargetId:''});
    setCheckingSupplier(null);
  },[checkingSupplier,catalogue.ready,catalogue.error,products,categories,showToast]);

  const handleConfirmSupplierDeactivation = async () => {
    if (!supplierDeletionModal) return;
    if(!catalogue.ready){showToast('error',catalogue.error||'Wait for the product check to finish.');return;}
    const { supplier } = supplierDeletionModal;
    setIsProcessing(true);
    try {
      await updateSupplier({ ...supplier, active: false });
      showToast('success', `Supplier "${supplier.name}" has been deactivated.`, 'Supplier Deactivated');
      setSupplierDeletionModal(null);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to deactivate supplier', 'Deactivation Failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmSupplierReassignAndDelete = async () => {
    if (!supplierDeletionModal) return;
    if(!catalogue.ready){showToast('error',catalogue.error||'Wait for the product check to finish.');return;}
    const { supplier, reassignTargetId } = supplierDeletionModal;
    if (!reassignTargetId) {
      showToast('error', 'Please select a replacement supplier.', 'Validation Error');
      return;
    }
    setIsProcessing(true);
    try {
      await deleteSupplier(supplier.id, { reassignProductsToSupplierId: reassignTargetId });
      showToast('success', `Supplier "${supplier.name}" deleted and products reassigned.`, 'Supplier Deleted');
      setSupplierDeletionModal(null);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to delete supplier', 'Delete Failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmSafeDelete = async () => {
    if (!supplierDeletionModal) return;
    if(!catalogue.ready){showToast('error',catalogue.error||'Wait for the product check to finish.');return;}
    const { supplier } = supplierDeletionModal;
    setIsProcessing(true);
    try {
      await deleteSupplier(supplier.id);
      showToast('success', `Supplier "${supplier.name}" deleted.`, 'Supplier Deleted');
      setSupplierDeletionModal(null);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to delete supplier', 'Delete Failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const suppliersCsvInputRef = useRef<HTMLInputElement>(null);


  const handleExportSuppliersCSV = () => {
      const data = sortedSuppliers.map(s => ({
          id: s.id,
          name: s.name,
          email: s.email || '',
          globalAccountCode: s.globalAccountCode || '',
          contactName: s.contactName || '',
          contactPhone: s.contactPhone || '',
          preferredMethod: s.preferredMethod || 'EMAIL',
          mobileNumber: s.mobileNumber || '',
          allDepartments: s.allDepartments ? 'TRUE' : 'FALSE',
          departmentIds: (s.departmentIds || []).join(';'),
          allBranches: s.allBranches ? 'TRUE' : 'FALSE',
          availableBranchIds: (s.availableBranchIds || []).join(';'),
          active: s.active,
          displayOrder: s.displayOrder
      }));
      const csv = Papa.unparse(data,{escapeFormulae:true});
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Suppliers_Export_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
  };

  const processSuppliersCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsProcessing(true);
      Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: async (results) => {
              try {
                  const data = results.data as any[];
                  if (data.length === 0) throw new Error("CSV file is empty.");

                  let addedCount = 0;
                  let updatedCount = 0;

                  for (const row of data) {
                      if (!row.name) continue;
                      
                      const existingSupplier = suppliers.find(s => s.id === row.id);
                      
                      const allDepts = String(row.allDepartments).toUpperCase() === 'TRUE';
                      const deptIds = row.departmentIds ? String(row.departmentIds).split(';').map(x => x.trim()).filter(Boolean) : existingSupplier?.departmentIds;
                      const allBr = String(row.allBranches).toUpperCase() === 'TRUE';
                      const brIds = row.availableBranchIds ? String(row.availableBranchIds).split(';').map(x => x.trim()).filter(Boolean) : existingSupplier?.availableBranchIds;

                      const newSupplier: Supplier = {
                          minimumOrderAmount: existingSupplier?.minimumOrderAmount??0,
                          branchMinimumOrderAmounts: existingSupplier?.branchMinimumOrderAmounts??{},
                          id: row.id || crypto.randomUUID(),
                          displayOrder: row.displayOrder!==undefined&&String(row.displayOrder).trim()!==''&&Number.isFinite(Number(row.displayOrder))?Number(row.displayOrder):existingSupplier?(existingSupplier.displayOrder??0):nextListPosition(suppliers)+addedCount*1000,
                          name: row.name,
                          email: row.email || '',
                          globalAccountCode: row.globalAccountCode || '',
                          contactName: row.contactName || '',
                          contactPhone: row.contactPhone || '',
                          preferredMethod: (row.preferredMethod as any) || 'EMAIL',
                          mobileNumber: row.mobileNumber || '',
                          active: String(row.active).toLowerCase() !== 'false',
                          allDepartments: allDepts,
                          departmentIds: deptIds,
                          allBranches: allBr,
                          availableBranchIds: brIds,
                          deliveryRules: existingSupplier?.deliveryRules || {},
                          deliverySchedules: existingSupplier?.deliverySchedules || {},
                          branchAccountCodes: existingSupplier?.branchAccountCodes || {}
                      };
                      
                      if (existingSupplier) {
                          await updateSupplier(newSupplier);
                          updatedCount++;
                      } else {
                          await addSupplier(newSupplier);
                          addedCount++;
                      }
                  }
                  alert(`Processed Suppliers. Added: ${addedCount}, Updated: ${updatedCount}`);
              } catch (err: any) {
                  alert("CSV Error: " + err.message);
              } finally {
                  setIsProcessing(false);
                  if (suppliersCsvInputRef.current) suppliersCsvInputRef.current.value = '';
              }
          }
      });
  };

  const sortedBranches = useMemo(() => {
    return savedListOrder(branches);
  }, [branches]);

  const handleSupplierSave = async (e: React.FormEvent) => { 
    e.preventDefault(); 
    if (editingSupplier) { 
      const cleanSchedules = { ...editingSupplier.deliverySchedules };
      Object.keys(cleanSchedules).forEach(key => {
          if (!cleanSchedules[key]?.trim()) delete cleanSchedules[key];
      });

      const cleanCodes = { ...editingSupplier.branchAccountCodes };
      Object.keys(cleanCodes).forEach(key => {
          if (!cleanCodes[key]?.trim()) delete cleanCodes[key];
      });

      const {minimumOrderAmount, ...supplierDetails} = editingSupplier;
      const finalSupplier: Supplier = {
          ...supplierDetails,
          ...(minimumOrderAmount === undefined ? {} : {minimumOrderAmount: minimumOrderAmount === '' ? 0 : minimumOrderAmount}),
          deliverySchedules: cleanSchedules,
          branchAccountCodes: cleanCodes
      };

      if(isProcessing || supplierSaving.current) return;
      supplierSaving.current = true;
      const finishSaving = beginPendingWork();
      setSupplierSaveError('');
      setSupplierSaved(false);
      setIsProcessing(true);
      try {
        if(!finalSupplier.name.trim()) throw new Error('A supplier name is required.');
        validateSupplierMinimum(finalSupplier);
        await (supplierPersisted.current ? updateSupplier : addSupplier)(finalSupplier);
        supplierPersisted.current = true;
        originalSupplier.current = JSON.stringify(finalSupplier);
        setEditingSupplier(finalSupplier);
        setSupplierSaved(true);
        showToast('success','Supplier saved.');
      } catch(error:any) {setSupplierSaveError(error.message || 'Could not save supplier. Please try again.');}
      finally {finishSaving();supplierSaving.current = false;setIsProcessing(false);}
    } 
  };

  if (transferOnly) return <div className="h-transfer-actions"><input aria-label="Import suppliers CSV file" type="file" ref={suppliersCsvInputRef} onChange={processSuppliersCSVImport} accept=".csv" hidden/><button className="h-button secondary" disabled={isProcessing} onClick={handleExportSuppliersCSV}>Export suppliers CSV</button><button className="h-button secondary" disabled={isProcessing} onClick={()=>suppliersCsvInputRef.current?.click()}>Import suppliers CSV</button>{isProcessing&&<span role="status">Importing suppliers…</span>}</div>;

  return (
    <div>
      {checkingSupplier&&<p className="h-notice" role="status">Checking products for {checkingSupplier.name}…</p>}
      <input type="file" ref={suppliersCsvInputRef} onChange={processSuppliersCSVImport} accept=".csv" className="hidden" />

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
         <div>
             <h3 className="text-lg font-bold text-gray-900">Suppliers</h3>
             <p className="text-xs text-gray-500 font-medium">Manage vendor details. {arrangeAllowed&&'Drag the handle to rearrange. Dropdowns follow this order.'}</p>
         </div>
         <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-start sm:justify-end">
             <button onClick={() => openSupplierEditor({ id: crypto.randomUUID(), name: '', email: '', active: true, allDepartments: true, departmentIds: [], allBranches: true, availableBranchIds: [], deliveryRules: {}, deliverySchedules: {}, branchAccountCodes: {} })} className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-brand-700 transition-colors flex items-center gap-2 whitespace-nowrap">
                 <Plus size={18} /> Add Supplier
             </button>
         </div>
       </div>
       {orderMessage&&<p role="status" className={`h-notice ${orderMessage.includes('not saved')?'error':''}`}>{orderMessage}</p>}
       <DragDropContext onDragEnd={onDragEnd}><Droppable droppableId="suppliers-list">{provided=><div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3" aria-busy={savingOrder}>
         {sortedSuppliers.map((s,index) => {
           let branchLabel = 'All Branches';
           if (s.allBranches === false && Array.isArray(s.availableBranchIds) && s.availableBranchIds.length > 0) {
             branchLabel = `${s.availableBranchIds.length} Branches`;
           }

           return (
           <Draggable key={s.id} draggableId={s.id} index={index} isDragDisabled={!arrangeAllowed||savingOrder||isProcessing}>{provided=><div ref={provided.innerRef} {...provided.draggableProps} style={provided.draggableProps.style} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-brand-200 flex items-start md:items-center gap-3">
             {arrangeAllowed&&<div {...provided.dragHandleProps} aria-label={`Rearrange ${s.name}`} title="Drag to rearrange, or use Space and arrow keys" aria-disabled={savingOrder||isProcessing} className="p-2 text-gray-500 rounded-lg cursor-grab hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"><GripVertical size={20}/></div>}
             <div className="flex flex-1 min-w-0 flex-col md:flex-row justify-between items-start md:items-center gap-4">
             <div>
               <div className="font-bold text-gray-900 flex items-center gap-2 text-base flex-wrap">
                  {s.name}
                  {s.active === false && (<span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-lg border border-red-200 font-bold uppercase tracking-wide">Inactive</span>)}
                  {s.linkedBranchId && (<span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg border border-blue-100 font-bold uppercase tracking-wide">Internal</span>)}
                  {s.preferredMethod === 'WHATSAPP' && <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-lg border border-green-100 font-bold flex items-center gap-1 uppercase tracking-wide"><MessageCircle size={10} /> WhatsApp</span>}
                  <span className="text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-lg border border-purple-200 font-bold flex items-center gap-1">
                    <MapPin size={10} /> {branchLabel}
                  </span>
               </div>
               <div className="text-xs text-gray-500 font-medium mt-1">{s.email}</div>
             </div>
             <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto justify-start sm:justify-end">
               {can(currentUser,'manage_products')&&<Link className="h-button secondary" to={`/settings?tab=products&view=bulk&supplier=${encodeURIComponent(s.id)}`}>Manage products</Link>}
               <div className="h-6 w-px bg-gray-200 mx-1"></div>
               <button aria-label={`Edit supplier ${s.name}`} title={`Edit supplier ${s.name}`} onClick={() => openSupplierEditor(s)} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"><Edit size={16} /></button>
               <button aria-label={`Delete supplier ${s.name}`} onClick={() => handleSupplierDelete(s)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Supplier"><Trash2 size={16} /></button>
             </div>
             </div>
           </div>}</Draggable>
           );
         })}
         {provided.placeholder}
       </div>}</Droppable></DragDropContext>

       <Modal isOpen={!!editingSupplier} onClose={closeSupplierEditor} dismissOnBackdrop={false} labelledBy="supplier-editor-title" className="supplier-editor overflow-hidden max-h-[92dvh]">
          {editingSupplier && (
            <>
              <div className="supplier-editor-header">
                <div><h3 id="supplier-editor-title">Supplier details</h3><p>{supplierPersisted.current ? 'Edit supplier details, ordering and branch settings.' : 'Add a supplier and choose its ordering settings.'}</p></div>
                <button ref={closeSupplierButton} type="button" aria-label="Close supplier details" disabled={isProcessing} onClick={closeSupplierEditor} className="p-2 rounded-lg hover:bg-gray-100"><X size={20}/></button>
              </div>
              {discardSupplier ? <div role="alertdialog" aria-labelledby="supplier-discard-title" aria-describedby="supplier-discard-description" className="supplier-discard space-y-4">
                <h4 id="supplier-discard-title" className="text-lg font-bold">Discard unsaved changes?</h4>
                <p id="supplier-discard-description">Your supplier details have not been saved. Keep editing to finish, or discard these changes.</p>
                <div className="flex flex-wrap justify-end gap-3">
                  <button type="button" autoFocus onClick={keepSupplierEditing} className="h-button">Keep editing</button>
                  <button type="button" onClick={() => {setDiscardSupplier(false);setEditingSupplier(null);}} className="h-button secondary">Discard changes</button>
                </div>
              </div> : <form onSubmit={handleSupplierSave}>
                <SupplierDetailsFields key={editingSupplier.id} supplier={editingSupplier} branches={sortedBranches} onChange={draft => {setEditingSupplier(draft);setSupplierSaved(false);}} disabled={isProcessing}/>
                <div className="supplier-editor-footer">
                  {supplierSaveError && <p role="alert" className="supplier-editor-error">{supplierSaveError} Your edits are still here.</p>}
                  <div className="supplier-editor-actions">
                    <span role="status">{isProcessing ? 'Saving your changes…' : supplierDirty ? 'Unsaved changes' : supplierSaved ? 'Supplier saved. You can keep editing.' : 'No unsaved changes'}</span>
                    <div><button type="button" disabled={isProcessing} onClick={closeSupplierEditor} className="h-button secondary">Close</button><button type="submit" disabled={isProcessing} className="h-button">{isProcessing ? 'Saving…' : 'Save supplier'}</button></div>
                  </div>
                </div>
              </form>}
            </>
          )}
       </Modal>

        {/* Supplier Deletion & Referential Integrity Modal */}
        <Modal
          isOpen={!!supplierDeletionModal}
          onClose={() => setSupplierDeletionModal(null)}
          className="max-w-lg p-6"
        >
          {supplierDeletionModal && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-red-600">
                <AlertTriangle size={24} className="shrink-0" />
                <h3 className="text-lg font-bold text-gray-900">
                  Delete Supplier: {supplierDeletionModal.supplier.name}
                </h3>
              </div>

              {supplierDeletionModal.report.canSafeDelete ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    This supplier has <strong className="text-gray-900">0 active products</strong>. It can be safely deleted.
                  </p>
                  {supplierDeletionModal.report.totalProductsCount > 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                      Note: {supplierDeletionModal.report.totalProductsCount} archived/inactive products are linked. Deleting the supplier will remove this supplier entity.
                    </p>
                  )}
                  <div className="flex justify-end gap-2 pt-3">
                    <button
                      onClick={() => setSupplierDeletionModal(null)}
                      className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmSafeDelete}
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
                      This supplier is linked to <strong>{supplierDeletionModal.report.activeProductsCount} active products</strong> and <strong>{supplierDeletionModal.report.categoriesCount} categories</strong>.
                      Deleting without reassigning would orphan these products from catalog views.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {/* Safe Option 1: Deactivate */}
                    <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <div className="font-bold text-xs text-gray-900 mb-1 flex items-center gap-1.5">
                        <ShieldCheck size={16} className="text-green-600" />
                        Recommended: Deactivate Supplier
                      </div>
                      <p className="text-xs text-gray-500 mb-2.5">
                        Hides this supplier and its catalog from Order Placement while preserving historical orders, prices, and past records.
                      </p>
                      <button
                        onClick={handleConfirmSupplierDeactivation}
                        disabled={isProcessing}
                        className="w-full py-2 bg-gray-800 hover:bg-black text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                      >
                        Deactivate Supplier (Safe)
                      </button>
                    </div>

                    {/* Option 2: Reassign & Delete */}
                    {suppliers.filter(s => s.id !== supplierDeletionModal.supplier.id && s.active).length > 0 && (
                      <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2.5">
                        <div className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
                          <ArrowRight size={16} className="text-blue-600" />
                          Reassign Products &amp; Delete
                        </div>
                        <p className="text-xs text-blue-800">
                          Move all {supplierDeletionModal.report.totalProductsCount} products to another supplier before deleting:
                        </p>
                        <select
                          value={supplierDeletionModal.reassignTargetId}
                          onChange={(e) => setSupplierDeletionModal({
                            ...supplierDeletionModal,
                            reassignTargetId: e.target.value
                          })}
                          className="w-full text-xs font-semibold p-2 border border-blue-200 bg-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {suppliers
                            .filter(s => s.id !== supplierDeletionModal.supplier.id && s.active)
                            .map(s => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.email || 'No email'})
                              </option>
                            ))}
                        </select>
                        <button
                          onClick={handleConfirmSupplierReassignAndDelete}
                          disabled={isProcessing || !supplierDeletionModal.reassignTargetId}
                          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5"
                        >
                          {isProcessing ? <Loader2 size={14} className="animate-spin" /> : null}
                          Reassign {supplierDeletionModal.report.activeProductsCount} Products &amp; Delete
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => setSupplierDeletionModal(null)}
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
