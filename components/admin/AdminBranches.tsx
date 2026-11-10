import {useEditorClose} from '../useEditorClose';

import React, { useState, useMemo, useCallback } from 'react';
import { useAppStore, can } from '../../store';
import { Branch } from '../../types';
import { Plus, Edit, Trash2, Mail, User as UserIcon, GripVertical } from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import { Modal } from '../Modal';
import { BranchEmailSettingsModal } from './BranchEmailSettingsModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { getUserAuthorizedBranches } from '../../utils/accessControl';

import Papa from 'papaparse';
import {savedListOrder} from '../../shared/list-order';

export const AdminBranches: React.FC<{transferOnly?: boolean}> = ({transferOnly=false}) => {
  const { branches, currentUser, addBranch, updateBranch, deleteBranch } = useAppStore();
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [emailBranchId, setEmailBranchId] = useState<string | null>(null);
  const closeEmailSettings = useCallback(() => setEmailBranchId(null), []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});

  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const canViewGlobal = can(currentUser, 'view_global_data');
  const canManageEmail = currentUser?.active === true && ['CREATOR', 'GM', 'ADMIN'].includes(String(currentUser.role).toUpperCase()) && can(currentUser, 'manage_branches');
  const emailBranch = branches.find(branch => branch.id === emailBranchId);

  const visibleBranches = useMemo(() => {
    const list = canViewGlobal ? branches : getUserAuthorizedBranches(currentUser, branches);
    // Sort by displayOrder
    return savedListOrder(list);
  }, [branches, canViewGlobal, currentUser]);

  const handleExportCSV = () => {
      const data = visibleBranches.map(b => ({
          id: b.id,
          name: b.name,
          code: b.code,
          address: b.address || '',
          email: b.email || '',
          contactPerson: b.contactPerson || '',
          contactPhone: b.contactPhone || '',
          contactEmail: b.contactEmail || '',
          displayOrder: b.displayOrder,
          active: b.active,
          actsAsSupplier: b.actsAsSupplier
      }));
      const csv = Papa.unparse(data,{escapeFormulae:true});
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Branches_Export_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
  };

  const processCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
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
                      if (!row.name || !row.code) continue;
                      
                      const existingBranch = branches.find(b => b.id === row.id);
                      
                      const newBranch: Branch = {
                          id: row.id || crypto.randomUUID(),
                          name: row.name,
                          code: row.code,
                          address: row.address || '',
                          email: row.email || '',
                          contactPerson: row.contactPerson || '',
                          contactPhone: row.contactPhone || '',
                          contactEmail: row.contactEmail || '',
                          displayOrder: parseInt(row.displayOrder) || (branches.length + addedCount + 1000),
                          active: String(row.active).toLowerCase() !== 'false',
                          actsAsSupplier: String(row.actsAsSupplier).toLowerCase() === 'true'
                      };
                      
                      if (existingBranch) {
                          await updateBranch(newBranch);
                          updatedCount++;
                      } else {
                          await addBranch(newBranch);
                          addedCount++;
                      }
                  }
                  alert(`Processed Branches. Added: ${addedCount}, Updated: ${updatedCount}`);
              } catch (err: any) {
                  alert("CSV Error: " + err.message);
              } finally {
                  setIsProcessing(false);
                  if (fileInputRef.current) fileInputRef.current.value = '';
              }
          }
      });
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;

    const items: Branch[] = Array.from(visibleBranches);
    const [movedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, movedItem);
    
    // Gap Indexing Logic (Prev + Next / 2)
    const prevItem: Branch | undefined = items[result.destination.index - 1];
    const nextItem: Branch | undefined = items[result.destination.index + 1];
    
    let newOrder = 0;

    if (!prevItem && !nextItem) {
        // Only item
        newOrder = 1000;
    } else if (!prevItem) {
        // Moved to Top
        const nextOrder = nextItem?.displayOrder || 1000;
        newOrder = nextOrder / 2;
    } else if (!nextItem) {
        // Moved to Bottom
        const prevOrder = prevItem?.displayOrder || 0;
        newOrder = prevOrder + 1000;
    } else {
        // Between two items
        const prevOrder = prevItem?.displayOrder || 0;
        const nextOrder = nextItem?.displayOrder || (prevOrder + 2000);
        newOrder = (prevOrder + nextOrder) / 2;
    }

    if (movedItem) {
       await updateBranch({ ...movedItem, displayOrder: newOrder });
    }
  };

  const handleBranchSave = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editingBranch || isProcessing) return;
    setIsProcessing(true);
    try {
      const value={...editingBranch,name:editingBranch.name.trim()};
      if(!value.name||!value.code.trim()) throw new Error('Branch name and code are required.');
      if(branches.some(b=>b.id!==value.id&&b.code?.trim().toLowerCase()===value.code.trim().toLowerCase()))throw new Error('This branch code is already in use.');
      await (branches.some(r=>r.id===value.id)?updateBranch:addBranch)(value);
      setEditingBranch(null);
      useAppStore.getState().showToast('success','Saved successfully.');
    } catch(error:any) {useAppStore.getState().showToast('error',error.message||'Could not save. Please retry.');}
    finally {setIsProcessing(false);}
  };

  const requestDelete = (id: string) => {
    setConfirmAction(() => async () => {try {await deleteBranch(id);setConfirmOpen(false);}catch(error:any){useAppStore.getState().showToast('error',error.message);}});
    setConfirmOpen(true);
  };

  const editorClose = useEditorClose(editingBranch, isProcessing, () => {setEditingBranch(null);});
  if (transferOnly) return <div className="h-transfer-actions"><input aria-label="Import branches CSV file" type="file" ref={fileInputRef} onChange={processCSVImport} accept=".csv" hidden/><button className="h-button secondary" disabled={isProcessing} onClick={handleExportCSV}>Export branches CSV</button><button className="h-button secondary" disabled={isProcessing} onClick={()=>fileInputRef.current?.click()}>Import branches CSV</button>{isProcessing&&<span role="status">Importing branches…</span>}</div>;

  return (
    <div>
       <input type="file" ref={fileInputRef} onChange={processCSVImport} accept=".csv" className="hidden" />

       <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center mb-6 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm gap-4 sm:gap-0">
         <div>
            <h3 className="text-lg font-bold text-gray-900">Branches</h3>
            <p className="text-xs text-gray-500 font-medium">Manage ordering locations.</p>
         </div>
         <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
             
             <button onClick={() => setEditingBranch({ id: crypto.randomUUID(), name: '', code: '', active: true, actsAsSupplier: false, displayOrder: 0 })} className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-brand-700 transition-colors flex items-center gap-2 whitespace-nowrap"><Plus size={18} /> Add Branch</button>
         </div>
       </div>
       
       <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <DragDropContext onDragEnd={onDragEnd}>
             <Droppable droppableId="branches-list">
               {(provided) => (
                 <div {...provided.droppableProps} ref={provided.innerRef} className="divide-y divide-gray-100">
                    {visibleBranches.map((b, index) => (
                       <Draggable key={b.id} draggableId={b.id} index={index}>
                         {(provided, snapshot) => (
                            <div 
                              ref={provided.innerRef} 
                              {...provided.draggableProps} 
                              style={{ ...provided.draggableProps.style }}
                              className={`p-5 flex flex-col md:flex-row gap-4 justify-between items-center group transition-colors ${snapshot.isDragging ? 'bg-blue-50 shadow-lg z-[60]' : 'hover:bg-gray-50 bg-white'}`}
                            >
                              <div className="flex items-center gap-4 w-full md:w-auto">
                                 <div {...provided.dragHandleProps} aria-label={`Move branch ${b.name}`} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"><GripVertical size={18} /></div>
                                 <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                       <h4 className="font-bold text-gray-900 text-base">{b.name}</h4>
                                       <span className="text-[10px] text-gray-600 font-mono bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{b.code}</span>
                                       {b.actsAsSupplier && <span className="text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-lg border border-purple-100 font-bold uppercase tracking-wide">Supplier</span>}
                                    </div>
                                    <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-1">
                                       {b.email && <div className="flex items-center gap-1.5"><Mail size={12} className="text-gray-400" /> <span className="font-medium">{b.email}</span></div>}
                                       {b.contactPerson && <div className="flex items-center gap-1.5"><UserIcon size={12} className="text-gray-400" /> <span className="font-medium">{b.contactPerson}</span></div>}
                                    </div>
                                 </div>
                              </div>
                              
                              <div className="flex flex-wrap gap-2 w-full md:w-auto justify-end">
                                 {canManageEmail && <button type="button" onClick={() => setEmailBranchId(b.id)} aria-label={`Email settings for ${b.name}`} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"><Mail size={16} /> Email settings</button>}
                                 <button aria-label={`Edit branch ${b.name}`} title={`Edit branch ${b.name}`} onClick={() => setEditingBranch(b)} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"><Edit size={16} /></button>
                                 <button aria-label={`Delete branch ${b.name}`} title={`Delete branch ${b.name}`} onClick={() => requestDelete(b.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16} /></button>
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

       <ConfirmModal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={async()=>{await confirmAction();}} closeOnConfirm={false} title="Delete Branch" message="Are you sure? This will affect history." />
       {canManageEmail && emailBranch && <BranchEmailSettingsModal key={emailBranch.id} branch={emailBranch} onClose={closeEmailSettings} />}

       {editorClose.confirmation}
       <Modal isOpen={!!editingBranch} onClose={editorClose.requestClose} className="max-w-lg p-6">
          {editingBranch && (
            <>
              <h3 className="font-bold text-xl mb-6 text-gray-900">Branch Details</h3>
              <form onSubmit={handleBranchSave} className="space-y-5">
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                    <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Name</label><input aria-label="Name" type="text" required value={editingBranch.name} onChange={e => setEditingBranch({...editingBranch, name: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                    <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Code</label><input aria-label="Code" type="text" required value={editingBranch.code} onChange={e => setEditingBranch({...editingBranch, code: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                 </div>
                 <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Address</label><input aria-label="Address" type="text" value={editingBranch.address || ''} onChange={e => setEditingBranch({...editingBranch, address: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                    <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Manager/Contact</label><input aria-label="Manager/Contact" type="text" value={editingBranch.contactPerson || ''} onChange={e => setEditingBranch({...editingBranch, contactPerson: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                    <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Phone</label><input aria-label="Phone" type="text" value={editingBranch.contactPhone || ''} onChange={e => setEditingBranch({...editingBranch, contactPhone: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                 </div>
                 <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Branch Email</label><input aria-label="Branch Email" type="email" value={editingBranch.email || ''} onChange={e => setEditingBranch({...editingBranch, email: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                 <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Contact Email (Internal)</label><input aria-label="Contact Email (Internal)" type="email" value={editingBranch.contactEmail || ''} onChange={e => setEditingBranch({...editingBranch, contactEmail: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                 
                 <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 flex items-start gap-3">
                    <input type="checkbox" id="actsAsSupplier" checked={editingBranch.actsAsSupplier || false} onChange={e => setEditingBranch({...editingBranch, actsAsSupplier: e.target.checked})} className="w-5 h-5 mt-0.5 text-purple-600 rounded focus:ring-purple-500" />
                    <div>
                       <label htmlFor="actsAsSupplier" className="font-bold text-sm text-purple-900 block mb-1">Acts as Supplier</label>
                       <p className="text-xs text-purple-700 leading-tight">If checked, this branch can receive orders from other branches (e.g. Central Kitchen).</p>
                    </div>
                 </div>

                 <div className="flex justify-end gap-3 mt-6"><button type="button" onClick={editorClose.requestClose} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors text-sm">Cancel</button><button type="submit" className="px-5 py-2.5 bg-brand-600 text-white text-sm font-bold rounded-xl shadow-md hover:bg-brand-700 transition-colors">Save</button></div>
              </form>
            </>
          )}
       </Modal>
    </div>
  );
};
