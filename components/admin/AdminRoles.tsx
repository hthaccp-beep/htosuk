import {useEditorClose} from '../useEditorClose';

import React, { useState } from 'react';
import { useAppStore } from '../../store';
import { RoleDefinition, Permission } from '../../types';
import { Plus, Trash2, CheckSquare, Loader2, ShieldAlert } from 'lucide-react';
import { AVAILABLE_PERMISSIONS } from '../../constants';
import { ConfirmModal } from '../ConfirmModal';
import { Modal } from '../Modal';

// Helper to prevent infinite hanging
function withTimeout(promise: Promise<any>, ms: number = 10000): Promise<any> {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Operation timed out.")), ms)
        )
    ]);
}

export const AdminRoles: React.FC = () => {
  const { roles, rolePermissions, addRole, updateRole, deleteRole, updateRolePermissions, currentUser } = useAppStore();
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [editingRolePerms, setEditingRolePerms] = useState<Permission[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});
  const [isProcessing, setIsProcessing] = useState(false);

  const togglePermission = (permId: Permission) => { if (editingRolePerms.includes(permId)) setEditingRolePerms(editingRolePerms.filter(p => p !== permId)); else setEditingRolePerms([...editingRolePerms, permId]); };

  const handleRoleSave = async (e: React.FormEvent) => { 
    e.preventDefault(); 
    if (editingRole) { 
      setIsProcessing(true);
      try {
        if (roles.find(r => r.id === editingRole.id)) {
           await withTimeout(updateRole(editingRole)); 
        } else {
           await withTimeout(addRole(editingRole)); 
        }
        await withTimeout(updateRolePermissions(editingRole.id, editingRolePerms));
        setEditingRole(null); 
      } catch (err: any) {
        console.error("Failed to save role", err);
        alert(`Error saving role: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    } 
  };

  const requestDelete = (id: string) => {
    setConfirmAction(() => async () => {try {await deleteRole(id);setConfirmOpen(false);}catch(error:any){useAppStore.getState().showToast('error',error.message);}});
    setConfirmOpen(true);
  };

  const isAmCreator = currentUser?.role === 'CREATOR';

  const editorClose = useEditorClose(editingRole ? {editingRole,editingRolePerms} : null, isProcessing, () => {setEditingRole(null);});
  return (
    <div>
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
         <div><h3 className="text-lg font-bold text-gray-900">Roles & access</h3><p className="text-xs text-gray-500 font-medium">Manage access levels.</p></div>
         <button onClick={() => { setEditingRole({ id: '', name: '', description: '', isSystem: false }); setEditingRolePerms([]); }} className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-brand-700 transition-colors flex items-center gap-2 whitespace-nowrap"><Plus size={18} /> Add Role</button>
       </div>
       <div className="space-y-4">
         {roles.map(r => {
           // Security Logic:
           // 1. Only CREATOR can edit CREATOR role.
           // 2. A user cannot edit their OWN role (unless they are CREATOR), to prevent self-lockout or escalation.
           const isTargetCreator = r.id === 'CREATOR';
           const isTargetMyRole = r.id === currentUser?.role;
           
           const canEdit = isAmCreator || (!isTargetCreator && !isTargetMyRole);

           return (
             <div key={r.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-brand-200 transition-all">
               <div className="flex-1">
                  <h4 className="font-bold text-gray-900 flex items-center gap-2 text-base">
                    {r.name} 
                    {r.isSystem && <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg border border-gray-200 uppercase tracking-wide">System</span>}
                    {!canEdit && <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-lg border border-red-100 flex items-center gap-1 uppercase tracking-wide"><ShieldAlert size={10} /> Protected</span>}
                  </h4>
                  <p className="text-xs text-gray-500 font-medium mt-1">{r.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                     {(rolePermissions[r.id] || []).slice(0, 5).map(p => (
                        <span key={p} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded-md border border-blue-100 font-medium">{AVAILABLE_PERMISSIONS.find(ap=>ap.id===p)?.label || p}</span>
                     ))}
                     {(rolePermissions[r.id] || []).length > 5 && <span className="text-[10px] text-gray-400 font-bold self-center">+{rolePermissions[r.id].length - 5} more</span>}
                  </div>
               </div>
               <div className="flex gap-2 self-end md:self-center">
                  <button 
                    onClick={() => { setEditingRole(r); setEditingRolePerms(rolePermissions[r.id] || []); }} 
                    disabled={!canEdit}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors border ${!canEdit ? 'bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed' : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'}`}
                  >
                    Edit Permissions
                  </button>
                  {!r.isSystem && <button aria-label={`Delete role ${r.name}`} title={`Delete role ${r.name}`} onClick={() => requestDelete(r.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={18} /></button>}
               </div>
             </div>
           );
         })}
       </div>

       <ConfirmModal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={async () => { await confirmAction(); }} closeOnConfirm={false} title="Delete Role" message="Are you sure you want to delete this role?" />

       {editorClose.confirmation}
       <Modal isOpen={!!editingRole} onClose={editorClose.requestClose} className="max-w-2xl p-6 flex flex-col">
          {editingRole && (
            <>
              <h3 className="font-bold text-xl mb-6 text-gray-900">Edit role & permissions</h3>
              <form onSubmit={handleRoleSave} className="space-y-5 flex-1 overflow-y-auto">
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                    <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Role ID</label><input aria-label="Role ID" type="text" required disabled={!!roles.find(r=>r.id===editingRole.id)} value={editingRole.id} onChange={e => setEditingRole({...editingRole, id: e.target.value.toUpperCase()})} className="w-full border border-gray-300 rounded-xl p-3 text-sm disabled:bg-gray-100 outline-none focus:ring-2 focus:ring-brand-500" /></div>
                    <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Role Name</label><input aria-label="Role Name" type="text" required value={editingRole.name} onChange={e => setEditingRole({...editingRole, name: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                 </div>
                 <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Description</label><input aria-label="Description" type="text" value={editingRole.description} onChange={e => setEditingRole({...editingRole, description: e.target.value})} className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-brand-500" /></div>
                 
                 <div className="border-t border-gray-100 pt-4">
                    <h4 className="font-bold text-sm mb-4 text-gray-800">Permissions</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                       {AVAILABLE_PERMISSIONS.map(perm => (
                          <button type="button" role="checkbox" aria-checked={editingRolePerms.includes(perm.id)} aria-label={perm.label} key={perm.id} onClick={() => togglePermission(perm.id)} className={`text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 active:scale-[0.99] ${editingRolePerms.includes(perm.id) ? 'bg-brand-50 border-brand-200 shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                             <div className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition-colors ${editingRolePerms.includes(perm.id) ? 'bg-brand-600 text-white' : 'bg-gray-100 text-transparent border border-gray-300'}`}>
                                <CheckSquare size={14} />
                             </div>
                             <div>
                                <p className={`text-sm font-bold ${editingRolePerms.includes(perm.id) ? 'text-brand-900' : 'text-gray-700'}`}>{perm.label}</p>
                                <p className="text-xs text-gray-500 leading-tight mt-0.5">{perm.description}</p>
                             </div>
                          </button>
                       ))}
                    </div>
                 </div>
                 <div className="flex justify-end gap-3 mt-6 pt-2 border-t border-gray-100">
                    <button type="button" onClick={editorClose.requestClose} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors text-sm">Cancel</button>
                    <button type="submit" disabled={isProcessing} className="px-5 py-2.5 bg-brand-600 text-white text-sm font-bold rounded-xl flex items-center gap-2 hover:bg-brand-700 shadow-md transition-colors">{isProcessing && <Loader2 size={16} className="animate-spin" />} Save Role</button>
                 </div>
              </form>
            </>
          )}
       </Modal>
    </div>
  );
};
