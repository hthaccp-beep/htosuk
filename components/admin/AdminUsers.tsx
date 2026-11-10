import {useEditorClose} from '../useEditorClose';
import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../store';
import { User, RoleDefinition, Permission } from '../../types';
import { DEFAULT_ROLE_PERMISSIONS } from '../../constants';
import Papa from 'papaparse';
import { 
  Plus, Edit, Trash2, Loader2, Eye, EyeOff, GripVertical, WifiOff, 
  Layers, MapPin, Truck, UserCheck, Search, Check, Info, Lock, AlertCircle 
} from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import { Modal } from '../Modal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase-config';
import { canReorderUser, planUserMove } from '../../shared/user-order';
import { beginPendingWork } from '../../shared/pending-work';

/**
 * Checks whether actor has permission to manage targetUser.
 */
function canManageTarget(actor: User | null | undefined, target: User): boolean {
  if (!actor || actor.active !== true) return false;
  if (actor.id === target.id) return true; // Self-management of details/password

  if (actor.role === 'CREATOR') {
    return ['CREATOR', 'GM', 'MANAGER', 'STAFF'].includes(target.role);
  }
  if (actor.role === 'GM') {
    return ['MANAGER', 'STAFF'].includes(target.role);
  }
  if (actor.role === 'MANAGER') {
    return target.role === 'STAFF' && target.branchId === actor.branchId;
  }
  return false;
}

/**
 * Returns permitted assignable roles for the given actor.
 */
function getAssignableRoles(actor: User | null | undefined, allRoles: RoleDefinition[]): RoleDefinition[] {
  if (!actor || actor.active !== true) return [];
  let allowedRoleIds: string[] = [];
  if (actor.role === 'CREATOR') {
    allowedRoleIds = ['CREATOR', 'GM', 'MANAGER', 'STAFF'];
  } else if (actor.role === 'GM') {
    allowedRoleIds = ['MANAGER', 'STAFF'];
  } else if (actor.role === 'MANAGER') {
    allowedRoleIds = ['STAFF'];
  }
  return allRoles.filter(r => allowedRoleIds.includes(r.id));
}

const ACTION_PERMISSION_DEFS: { id: Permission; label: string; description: string }[] = [
  {id:'view_menu_recipes',label:'Open Standard Menu',description:'View recipes and supplier specifications in the separate Standard Menu app'},
  {id:'edit_menu_recipes',label:'Edit standard recipes',description:'Create recipe drafts and select preferred and alternative products'},
  {id:'approve_menu_recipes',label:'Approve standard recipes',description:'Approve recipe content separately from allergen review'},
  {id:'manage_product_specs',label:'Upload product specifications',description:'Attach original specification files to supplier products'},
  { id: 'create_orders', label: 'Create order', description: 'Can start a new order and add items to cart' },
  { id: 'edit_drafts', label: 'Edit draft', description: 'Can modify and update existing saved drafts' },
  { id: 'submit_orders', label: 'Submit order', description: 'Can finalize and transmit orders to suppliers' },
  { id: 'view_order_history', label: 'View order history', description: 'Can view past order records in authorized scope' },
  { id: 'view_prices', label: 'View prices', description: 'Can see prices, cost estimates, and order value totals' },
  { id: 'view_other_users_orders', label: "View other users' orders", description: 'Can inspect orders submitted by other staff at authorized branches' },
  { id: 'amend_orders', label: 'Amend submitted orders', description: 'Can amend orders after initial submission' },
  { id: 'approve_orders', label: 'Approve orders', description: 'Can approve orders requiring managerial authorization' },
  { id: 'cancel_orders', label: 'Cancel orders', description: 'Can cancel placed orders before dispatch' },
];

export const AdminUsers: React.FC<{transferOnly?: boolean}> = ({transferOnly=false}) => {
  const { users, roles, branches, departments, suppliers, rolePermissions, currentUser, showToast, logout } = useAppStore();
  
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const reorderInFlight = React.useRef(false);
  const [orderMessage, setOrderMessage] = useState('');

  // Re-Authentication Dialog state (when token/session expires or is revoked)
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [showReauthPassword, setShowReauthPassword] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const [reauthAttempts, setReauthAttempts] = useState(0);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  
  const [activeModalTab, setActiveModalTab] = useState<'details' | 'locations' | 'suppliers'>('details');
  const [inheritRolePerms, setInheritRolePerms] = useState(true);

  // Search filters inside modal
  const [branchSearch, setBranchSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isOnline = navigator.onLine;
  const isManager = currentUser?.role === 'MANAGER';
  const isCreatorOrGM = currentUser?.role === 'CREATOR' || currentUser?.role === 'GM';
  const canAdminister = currentUser?.active === true && (isCreatorOrGM || isManager);

  // Visible users in list
  const visibleUsers = useMemo(() => {
    let list: User[] = [];
    if (isCreatorOrGM) {
      list = users;
    } else if (isManager) {
      // Managers only see staff in their own branch
      list = users.filter(u => u.branchId === currentUser?.branchId && (u.role === 'STAFF' || u.id === currentUser?.id));
    } else {
      list = [];
    }
    return [...list].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }, [users, isCreatorOrGM, isManager, currentUser]);

  const availableRoles = useMemo(() => {
    return getAssignableRoles(currentUser, roles);
  }, [currentUser, roles]);

  const isEditingSelf = Boolean(editingUser && editingUser.id && editingUser.id === currentUser?.id);

  const handleExportCSV = () => {
    const data = visibleUsers.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      branchId: u.branchId || '',
      allBranches: u.allBranches ? 'TRUE' : 'FALSE',
      branchIds: (u.branchIds || []).join(';'),
      allDepartments: u.allDepartments ? 'TRUE' : 'FALSE',
      departmentIds: (u.departmentIds || []).join(';'),
      allSuppliers: u.allSuppliers ? 'TRUE' : 'FALSE',
      supplierIds: (u.supplierIds || []).join(';'),
      active: u.active,
      displayOrder: u.displayOrder || 0
    }));
    const csv = Papa.unparse(data,{escapeFormulae:true});
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Users_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // Authenticated call to /api/admin/users
  const callUserAdminApi = async (action: 'create' | 'update' | 'delete' | 'reorder', data: unknown) => {
    // Protect the complete request, including token refresh and response handling.
    const finish = beginPendingWork();
    try {
    const authInstance = auth;
    if (!authInstance?.currentUser) {
      const authErr: any = new Error('Please sign in with an authorized account to manage users.');
      authErr.status = 401;
      throw authErr;
    }
    let token = await authInstance.currentUser.getIdToken();

    let response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action, data })
    });

    // If 401 (token expired/revoked), force-refresh token once and retry!
    if (response.status === 401 && authInstance.currentUser) {
      try {
        token = await authInstance.currentUser.getIdToken(true);
        response = await fetch('/api/admin/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ action, data })
        });
      } catch (_) {}
    }

    const text = await response.text();
    let resData: any = {};
    try { resData = JSON.parse(text); } catch (_) {}

    if (!response.ok || resData?.success !== true) {
      const err: any = new Error(resData?.error || (response.ok
        ? 'The server did not confirm the account change. Keep your details and try again.'
        : `Server returned error (${response.status})`));
      err.status = response.status;
      err.code = resData?.code;
      throw err;
    }

    return resData;
    } finally { finish(); }
  };

  // Account changes go through the server so Auth and profile permissions stay aligned.
  const createNewUserAccount = async (user: User, password: string): Promise<string> => {
    const isEnterprise = user.role === 'CREATOR' || user.role === 'GM';
    const payload: Record<string, unknown> = {
      email: user.username.trim(),
      password: password.trim(),
      displayName: user.displayName.trim(),
      role: user.role,
      branchId: user.branchId || '',
      active: user.active ?? true,
      displayOrder: user.displayOrder || 0,
      allDepartments: isEnterprise ? true : (user.allDepartments ?? true),
      departmentIds: user.departmentIds || [],
      allBranches: isEnterprise ? true : (user.allBranches ?? false),
      branchIds: user.branchIds || [],
      allSuppliers: isEnterprise ? true : (user.allSuppliers ?? true),
      supplierIds: user.supplierIds || [],
      permissionMode: user.permissionMode || 'INHERITED',
      customPermissions: user.customPermissions || [],
    };
    const res = await callUserAdminApi('create', payload);
    return res.uid;
  };

  // A failed account update must not fall back to a partial profile-only save.
  const updateExistingUserAccount = async (user: User, newPassword?: string) => {
    const isEnterprise = user.role === 'CREATOR' || user.role === 'GM';
    const patchData: Record<string, unknown> = {
      id: user.id,
      displayName: user.displayName.trim(),
      role: user.role,
      branchId: user.branchId || '',
      active: user.active ?? true,
      displayOrder: user.displayOrder || 0,
      allDepartments: isEnterprise ? true : (user.allDepartments ?? true),
      departmentIds: user.departmentIds || [],
      allBranches: isEnterprise ? true : (user.allBranches ?? false),
      branchIds: user.branchIds || [],
      allSuppliers: isEnterprise ? true : (user.allSuppliers ?? true),
      supplierIds: user.supplierIds || [],
      permissionMode: user.permissionMode || (inheritRolePerms ? 'INHERITED' : 'CUSTOM'),
      customPermissions: user.customPermissions || [],
    };
    if (newPassword && newPassword.trim()) {
      patchData.password = newPassword.trim();
    }
    await callUserAdminApi('update', patchData);
  };

  const handleReauthenticate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthPassword.trim()) {
      setReauthError('Please enter your password.');
      return;
    }
    setIsReauthenticating(true);
    setReauthError('');
    try {
      const authInstance = auth;
      if (!authInstance) throw new Error('HTOS sign-in is unavailable. Reload HTOS and try again.');
      if (!currentUser?.username) throw new Error('No active user to re-authenticate.');
      
      // Perform fresh sign-in to get new credentials and updated auth_time
      const cred = await signInWithEmailAndPassword(authInstance, currentUser.username.trim(), reauthPassword.trim());
      await cred.user.getIdToken(true);
      
      setReauthAttempts(prev => prev + 1);
      setReauthOpen(false);
      setReauthPassword('');
      showToast('info', 'Sign-in verified. Resuming operation...');
      
      if (pendingAction) {
        const actionToRun = pendingAction;
        setPendingAction(null);
        try {
          await actionToRun();
        } catch (actionErr: any) {
          console.error('Action failed after reauth:', actionErr);
          alert('Could not complete operation: ' + (actionErr.message || 'Operation failed'));
        }
      }
    } catch (err: any) {
      console.error('Re-auth error:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setReauthError('Incorrect password. Please verify and try again.');
      } else {
        setReauthError(err.message || 'Re-authentication failed. Please check your credentials.');
      }
    } finally {
      setIsReauthenticating(false);
    }
  };

  const processCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isOnline) return alert("Cannot manage users while offline.");

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
          const failureList: string[] = [];

          for (const row of data) {
            if (!row.username || !row.displayName) continue;
            
            const existingUser = users.find(u => u.username.toLowerCase() === row.username.toLowerCase() || u.id === row.id);
            const isNew = !existingUser;
            
            const targetRole = row.role || 'STAFF';
            const targetBranch = row.branchId || '';

            // Authorization check before attempting mutation
            if (isManager) {
              if (targetRole !== 'STAFF' || targetBranch !== currentUser?.branchId) {
                failureList.push(`${row.username}: Managers may only import Staff into their own branch.`);
                continue;
              }
            } else if (currentUser?.role === 'GM') {
              if (!['MANAGER', 'STAFF'].includes(targetRole)) {
                failureList.push(`${row.username}: General Managers cannot create or import "${targetRole}" accounts.`);
                continue;
              }
            }

            if (isNew) {
              const userPassword = (row.password || '').trim();
              if (!userPassword || userPassword.length < 6) {
                failureList.push(`${row.username}: Password is required (minimum 6 characters) for new accounts.`);
                continue;
              }

              const targetUser: User = {
                id: '',
                username: row.username.trim(),
                displayName: row.displayName.trim(),
                role: targetRole,
                branchId: targetBranch,
                active: String(row.active).toLowerCase() !== 'false',
                displayOrder: parseInt(row.displayOrder, 10) || (users.length + addedCount + 1000)
              };

              try {
                await createNewUserAccount(targetUser, userPassword);
                addedCount++;
              } catch (createErr: any) {
                failureList.push(`${row.username}: ${createErr.message || 'Creation failed'}`);
              }
            } else {
              // Existing user update
              const targetUser: User = {
                id: existingUser.id,
                username: existingUser.username,
                displayName: row.displayName.trim(),
                role: targetRole,
                branchId: targetBranch,
                active: String(row.active).toLowerCase() !== 'false',
                displayOrder: parseInt(row.displayOrder, 10) || existingUser.displayOrder || 1000
              };

              try {
                await updateExistingUserAccount(targetUser, row.password ? String(row.password).trim() : undefined);
                updatedCount++;
              } catch (updateErr: any) {
                failureList.push(`${row.username}: ${updateErr.message || 'Update failed'}`);
              }
            }
          }

          const summary = failureList.length > 0
            ? `Processed Users.\nAdded: ${addedCount}, Updated: ${updatedCount}, Failed: ${failureList.length}\nFailures:\n- ${failureList.slice(0, 5).join('\n- ')}`
            : `Processed Users.\nAdded: ${addedCount}, Updated: ${updatedCount} successfully.`;
          alert(summary);
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
    setIsDragging(false);
    if (!result.destination || result.source.index === result.destination.index || reorderInFlight.current) return;
    if (!navigator.onLine) { setOrderMessage('Connect to the internet to save the user order.'); return; }
    reorderInFlight.current = true;
    setIsReordering(true);
    setOrderMessage('Saving user order…');
    try {
      const items = planUserMove(visibleUsers, result.source.index, result.destination.index, currentUser);
      if (!items.length) { setOrderMessage(''); return; }
      await callUserAdminApi('reorder', {items});
      const ranks = new Map(items.map(item => [item.id, item.displayOrder]));
      // Merge only ordering into the latest store; do not overwrite account edits from sync.
      useAppStore.setState(state => ({users: state.users.map(user => ranks.has(user.id)
        ? {...user, displayOrder: ranks.get(user.id)!} : user)}));
      setOrderMessage('User order saved.');
    } catch (error) {
      setOrderMessage(`User order was not saved. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      reorderInFlight.current = false;
      setIsReordering(false);
    }
  };

  const handleUserSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingUser || isSavingUser) return;
    if (!isOnline) return alert("Cannot save changes while offline.");

    setIsSavingUser(true);
    try {
      const isNew = !editingUser.id;
      let finalDisplayOrder = editingUser.displayOrder;

      if (isNew && (!finalDisplayOrder || finalDisplayOrder === 0)) {
        const maxOrder = users.reduce((max, u) => Math.max(max, u.displayOrder || 0), 0);
        finalDisplayOrder = maxOrder + 1000;
      }

      const isEnterprise = editingUser.role === 'CREATOR' || editingUser.role === 'GM';
      const userToSave: User = {
        ...editingUser,
        displayOrder: finalDisplayOrder,
        allDepartments: isEnterprise ? true : (editingUser.allDepartments ?? true),
        allBranches: isEnterprise ? true : (editingUser.allBranches ?? false),
        allSuppliers: isEnterprise ? true : (editingUser.allSuppliers ?? true),
        permissionMode: inheritRolePerms ? 'INHERITED' : 'CUSTOM',
        customPermissions: inheritRolePerms ? [] : (editingUser.customPermissions || []),
      };

      if (isNew) {
        await createNewUserAccount(userToSave, passwordInput);
        showToast('success', `User ${editingUser.displayName} created successfully!`);
      } else {
        await updateExistingUserAccount(userToSave, passwordInput || undefined);
        showToast('success', `User ${editingUser.displayName} updated successfully!`);
      }

      setEditingUser(null);
      setPasswordInput('');
      setReauthAttempts(0);
    } catch (err: any) {
      console.error("Save User Error:", err);
      const isQuota =
        err?.status === 503 ||
        err?.code === 'quota/resource-exhausted' ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('Quota exceeded') ||
        err?.message?.includes('quota limit');

      if (isQuota) {
        alert("Firestore database daily request quota limit exceeded. Please wait for the daily quota to reset or upgrade Firestore quota in the Firebase Console. Your entered user details remain safely in the form.");
        return;
      }

      const isExpired =
        (err?.status === 401 && (
          err?.message?.includes('expired') ||
          err?.message?.includes('revoked')
        ));

      // Prompt re-auth only once per save attempt to prevent infinite reauth loops
      if (isExpired && reauthAttempts < 1) {
        setPendingAction(() => async () => {
          await handleUserSave();
        });
        setReauthPassword('');
        setReauthError('');
        setReauthOpen(true);
        return;
      }

      alert("Error saving user: " + (err.message || 'Operation failed'));
    } finally {
      setIsSavingUser(false);
    }
  };

  const executeDelete = async (id: string) => {
    if (!isOnline) return alert("Offline mode active.");
    
    try {
      await callUserAdminApi('delete', { id });
      showToast('info', 'User profile deleted.');
    } catch (e: any) {
      // A denied or failed server deletion must never be retried as a direct database write.
      const isQuota =
        e?.status === 503 ||
        e?.code === 'quota/resource-exhausted' ||
        e?.message?.includes('RESOURCE_EXHAUSTED') ||
        e?.message?.includes('Quota exceeded') ||
        e?.message?.includes('quota limit');

      if (isQuota) {
        alert("Firestore database daily request quota limit exceeded. Cannot delete user at this time. Please try again after quota refreshes.");
        return;
      }

      const isExpired =
        (e?.status === 401 && (
          e?.message?.includes('expired') ||
          e?.message?.includes('revoked')
        ));

      if (isExpired && reauthAttempts < 1) {
        setPendingAction(() => async () => {
          await executeDelete(id);
        });
        setReauthPassword('');
        setReauthError('');
        setReauthOpen(true);
        return;
      }

      alert("Failed to delete user: " + (e.message || 'Operation failed'));
    }
  };

  const requestDelete = (targetUser: User) => {
    if (!canManageTarget(currentUser, targetUser)) {
      alert("You do not have permission to delete this user account.");
      return;
    }
    setConfirmAction(() => () => executeDelete(targetUser.id));
    setConfirmOpen(true);
  };

  // Helper to open edit modal with complete initialized access fields
  const handleOpenEdit = (user: User) => {
    setActiveModalTab('details');
    setPasswordInput('');
    setReauthAttempts(0);
    
    // Determine if user inherits from role or has custom overrides
    const rolePerms = rolePermissions[user.role] || DEFAULT_ROLE_PERMISSIONS[user.role] || [];
    const isCustom = user.permissionMode === 'CUSTOM' || (
      !user.permissionMode &&
      Array.isArray(user.customPermissions) &&
      user.customPermissions.length > 0 &&
      (user.customPermissions.length !== rolePerms.length || !user.customPermissions.every(p => rolePerms.includes(p)))
    );
    setInheritRolePerms(!isCustom);

    const isEnterpriseRole = user.role === 'CREATOR' || user.role === 'GM';

    setEditingUser({
      ...user,
      allDepartments: isEnterpriseRole ? true : (user.allDepartments !== undefined ? user.allDepartments : true),
      departmentIds: user.departmentIds || (departments[0] ? [departments[0].id] : []),
      allBranches: isEnterpriseRole ? true : (user.allBranches ?? false),
      branchIds: user.branchIds || (user.branchId ? [user.branchId] : []),
      allSuppliers: isEnterpriseRole ? true : (user.allSuppliers !== undefined ? user.allSuppliers : true),
      supplierIds: user.supplierIds || [],
      permissionMode: !isCustom ? 'INHERITED' : 'CUSTOM',
      customPermissions: !isCustom ? [] : (user.customPermissions || []),
    });
  };

  const handleOpenNew = () => {
    setActiveModalTab('details');
    setPasswordInput('');
    setReauthAttempts(0);
    setInheritRolePerms(true);
    // Creating a colleague must not preselect the owner's full-access role.
    const defaultRole = availableRoles.some(role => role.id === 'STAFF') ? 'STAFF' : availableRoles.find(role => !['CREATOR', 'GM'].includes(role.id))?.id || '';
    const isEnterpriseRole = defaultRole === 'CREATOR' || defaultRole === 'GM';
    const defaultBranch = '';
    const defaultDepts = departments[0] ? [departments[0].id] : [];
    const defaultBranches = defaultBranch ? [defaultBranch] : [];
    const defaultPerms = rolePermissions[defaultRole] || DEFAULT_ROLE_PERMISSIONS[defaultRole] || [];

    setEditingUser({
      id: '',
      username: '',
      displayName: '',
      role: defaultRole,
      branchId: defaultBranch,
      active: true,
      displayOrder: 0,
      allDepartments: isEnterpriseRole ? true : true,
      departmentIds: defaultDepts,
      allBranches: isEnterpriseRole,
      branchIds: defaultBranches,
      allSuppliers: isEnterpriseRole ? true : true,
      supplierIds: [],
      permissionMode: 'INHERITED',
      customPermissions: [],
    });
  };

  if (!canAdminister) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-gray-100 text-center">
        <p className="text-gray-500 font-medium">You do not have permission to manage user accounts.</p>
      </div>
    );
  }

  const editorClose = useEditorClose(editingUser ? {editingUser,passwordInput} : null, isSavingUser, () => {setEditingUser(null);});
  if (transferOnly) return <div className="h-transfer-actions"><input aria-label="Import users CSV file" type="file" ref={fileInputRef} onChange={processCSVImport} accept=".csv" hidden/><button className="h-button secondary" disabled={isProcessing} onClick={handleExportCSV}>Export users CSV</button><button className="h-button secondary" disabled={!isOnline || isProcessing} onClick={()=>fileInputRef.current?.click()}>Import users CSV</button>{isProcessing&&<span role="status">Importing users…</span>}</div>;

  return (
    <div data-update-safe-view={!editingUser && !reauthOpen && !confirmOpen && !isSavingUser && !isReordering && !isDragging && !isReauthenticating && !isProcessing && !pendingAction ? 'team' : undefined}>
      <input type="file" ref={fileInputRef} onChange={processCSVImport} accept=".csv" className="hidden" />

      <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center mb-6 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm gap-4 sm:gap-0">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Team members</h3>
          <p className="text-xs text-gray-500 font-medium">Manage chef and staff multi-branch permissions, supplier access, and action boundaries.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <button 
            disabled={!isOnline}
            onClick={handleOpenNew} 
            className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-brand-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isOnline ? <Plus size={18} /> : <WifiOff size={18} />} 
            {isOnline ? 'Add User' : 'Offline'}
          </button>
        </div>
      </div>
      
      <p role="status" className="text-sm text-gray-600">{orderMessage || 'Drag the handle to rearrange users. The order saves automatically.'}</p>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden" aria-busy={isReordering}>
        <DragDropContext onBeforeCapture={() => setIsDragging(true)} onDragEnd={onDragEnd}>
          <Droppable droppableId="users-list">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef} className="divide-y divide-gray-100">
                {visibleUsers.map((u, index) => {
                  const isTargetCreator = u.role === 'CREATOR';
                  const isSelf = u.id === currentUser?.id;
                  const isActorCreator = currentUser?.role === 'CREATOR';
                  const canManage = canManageTarget(currentUser, u);
                  const canDrag = canReorderUser(currentUser, u) && isOnline && !isReordering;
                  const canEdit = isActorCreator || (!isTargetCreator && (canManage || isSelf));
                  const canDelete = !isTargetCreator && canManage && !isSelf;

                  // Compute location badges
                  let locationLabel = 'No Branch';
                  if (u.allBranches) {
                    locationLabel = 'All Branches';
                  } else if (Array.isArray(u.branchIds) && u.branchIds.length > 1) {
                    locationLabel = `${u.branchIds.length} Branches`;
                  } else if (Array.isArray(u.branchIds) && u.branchIds.length === 1) {
                    locationLabel = branches.find(b => b.id === u.branchIds![0])?.name || u.branchIds[0];
                  } else if (u.branchId) {
                    locationLabel = branches.find(b => b.id === u.branchId)?.name || 'Branch';
                  }

                  return (
                    <Draggable key={u.id} draggableId={u.id} index={index} isDragDisabled={!canDrag}>
                      {(provided, snapshot) => (
                        <div 
                          ref={provided.innerRef} 
                          {...provided.draggableProps} 
                          style={{ ...provided.draggableProps.style }}
                          className={`p-4 flex flex-col md:flex-row justify-between items-center gap-4 group transition-colors ${snapshot.isDragging ? 'bg-blue-50 shadow-lg z-[60]' : 'hover:bg-gray-50 bg-white'}`}
                        >
                          <div className="flex items-center gap-4 w-full md:w-auto">
                            <div {...provided.dragHandleProps} aria-label={`Rearrange ${u.displayName}`} className={canDrag ? "text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing" : "text-gray-200 cursor-not-allowed"}>
                              <GripVertical size={18} />
                            </div>
                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold text-sm flex-shrink-0">
                              {(u.username[0] || 'U').toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-bold text-gray-900 truncate">{u.displayName}</h4>
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg flex-shrink-0">
                                  {u.role === 'CREATOR' ? 'Admin' : (roles.find(r => r.id === u.role)?.name || u.role)}
                                </span>
                                {isSelf && <span className="text-[10px] font-bold uppercase bg-brand-50 text-brand-700 px-2 py-0.5 rounded-lg">You</span>}
                                {u.active === false && <span className="text-[10px] font-bold uppercase bg-red-50 text-red-600 px-2 py-0.5 rounded-lg">Inactive</span>}
                              </div>
                              <p className="text-xs text-gray-500 font-medium truncate mt-0.5">{u.username}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end flex-wrap">
                            <span className="text-xs text-brand-700 font-semibold bg-brand-50 border border-brand-200 px-2.5 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap">
                              <MapPin size={12} />
                              {locationLabel}
                            </span>
                            <div className="flex gap-2">
                              {canEdit && (
                                <button disabled={!isOnline} onClick={() => handleOpenEdit(u)} title="Edit user" className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-30">
                                  <Edit size={16} />
                                </button>
                              )}
                              {canDelete && (
                                <button disabled={!isOnline} onClick={() => requestDelete(u)} title="Delete user" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30">
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>

      <ConfirmModal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={() => { confirmAction(); setConfirmOpen(false); }} title="Delete User" message="Are you sure you want to delete this user profile and login?" loading={false} />

      {/* Comprehensive Multi-Section User Access Modal */}
      {editorClose.confirmation}
       <Modal isOpen={!!editingUser} onClose={editorClose.requestClose} className="max-w-2xl p-6 max-h-[92vh] flex flex-col">
        {editingUser && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-xl text-gray-900">
                  {editingUser.id ? (isEditingSelf ? 'Edit Your Profile' : `Edit User: ${editingUser.displayName}`) : 'New User Setup'}
                </h3>
                <p className="text-xs text-gray-500 font-medium">Configure account credentials, multi-branch coverage, supplier access, and action permissions.</p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-gray-200 gap-1 mb-4 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setActiveModalTab('details')}
                className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeModalTab === 'details' ? 'border-b-2 border-brand-600 text-brand-700 bg-brand-50/50' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <UserCheck size={14} /> Details
              </button>
              <button
                type="button"
                onClick={() => setActiveModalTab('locations')}
                className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeModalTab === 'locations' ? 'border-b-2 border-brand-600 text-brand-700 bg-brand-50/50' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <MapPin size={14} /> Location Access
              </button>
              <button
                type="button"
                onClick={() => setActiveModalTab('suppliers')}
                className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeModalTab === 'suppliers' ? 'border-b-2 border-brand-600 text-brand-700 bg-brand-50/50' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Truck size={14} /> Supplier Access
              </button>
            </div>

            <form onSubmit={handleUserSave} className="flex-1 overflow-y-auto space-y-4 pr-1">
              
              {/* TAB 1: USER DETAILS */}
              {activeModalTab === 'details' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Email (Login Identity)</label>
                    <input aria-label="Email (Login Identity)" 
                      type="email" 
                      required 
                      disabled={!!editingUser.id} 
                      value={editingUser.username} 
                      onChange={e => setEditingUser({ ...editingUser, username: e.target.value })} 
                      className="w-full border border-gray-300 rounded-xl p-2.5 text-sm disabled:bg-gray-100 outline-none focus:ring-2 focus:ring-brand-500 transition-all" 
                    />
                  </div>
                  
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Display Name</label>
                    <input aria-label="Display Name" 
                      type="text" 
                      required 
                      value={editingUser.displayName} 
                      onChange={e => setEditingUser({ ...editingUser, displayName: e.target.value })} 
                      className="w-full border border-gray-300 rounded-xl p-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500 transition-all" 
                    />
                  </div>
                  
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">
                      Password {editingUser.id ? '(Leave blank to keep current)' : '(Required)'}
                    </label>
                    <div className="relative">
                      <input aria-label="Password" 
                        type={showPassword ? "text" : "password"} 
                        value={passwordInput} 
                        onChange={e => setPasswordInput(e.target.value)} 
                        required={!editingUser.id}
                        minLength={6}
                        className="w-full border border-gray-300 rounded-xl p-2.5 text-sm pr-10 outline-none focus:ring-2 focus:ring-brand-500 transition-all" 
                        placeholder={editingUser.id ? "Leave blank to keep unchanged" : "Enter minimum 6 characters"}
                      />
                      <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <Eye size={18} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Primary Role</label>
                    <select aria-label="Primary Role" required
                      value={editingUser.role} 
                      onChange={e => {
                        const newRole = e.target.value;
                        const rolePerms = rolePermissions[newRole] || DEFAULT_ROLE_PERMISSIONS[newRole] || ['create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices'];
                        const isEnterprise = newRole === 'GM' || newRole === 'CREATOR';
                        setEditingUser({
                          ...editingUser,
                          role: newRole,
                          allBranches: isEnterprise ? true : editingUser.allBranches,
                          allDepartments: isEnterprise ? true : (editingUser.allDepartments ?? true),
                          departmentIds: editingUser.departmentIds || [],
                          allSuppliers: isEnterprise ? true : (editingUser.allSuppliers ?? true),
                          permissionMode: inheritRolePerms ? 'INHERITED' : 'CUSTOM',
                          customPermissions: inheritRolePerms ? [] : rolePerms,
                        });
                      }} 
                      disabled={isEditingSelf || isManager || (!isCreatorOrGM && editingUser.role === 'CREATOR')} 
                      className={`w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-brand-500 ${(isEditingSelf || isManager || (!isCreatorOrGM && editingUser.role === 'CREATOR')) ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                    >
                      <option value="" disabled>Select role</option>
                      {availableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>

                  <div className="pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={editingUser.active ?? true} 
                        onChange={e => setEditingUser({ ...editingUser, active: e.target.checked })} 
                        disabled={isEditingSelf || editingUser.role === 'CREATOR'}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                      />
                      <span className="text-sm font-medium text-gray-700">Account Active</span>
                    </label>
                    {(isEditingSelf || editingUser.role === 'CREATOR') && <p className="text-[10px] text-gray-400 mt-0.5">Administrator accounts cannot be deactivated.</p>}
                  </div>
                </div>
              )}

              {/* TAB 2: LOCATION ACCESS */}
              {activeModalTab === 'locations' && (
                <div className="space-y-4">
                  {isCreatorOrGM && (
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox"
                          checked={editingUser.allBranches ?? false}
                          onChange={e => setEditingUser({ ...editingUser, allBranches: e.target.checked })}
                          className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                        />
                        <span className="text-sm font-bold text-gray-800">Dynamic All Branches</span>
                      </label>
                      <p className="text-xs text-gray-500 mt-1 pl-6">
                        Grants access across all current and future active restaurant branches dynamically. Note: Accounts with multiple branches will see the orange branch confirmation prompt on the Order page to confirm their target location.
                      </p>
                    </div>
                  )}

                  {!editingUser.allBranches && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-gray-600 uppercase">Selected Branches</label>
                        <span className="text-xs text-brand-600 font-semibold">
                          {(editingUser.branchIds || []).length} Selected
                        </span>
                      </div>

                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search branches..."
                          value={branchSearch}
                          onChange={e => setBranchSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>

                      <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-48 overflow-y-auto">
                        {branches
                          .filter(b => b.active && b.name.toLowerCase().includes(branchSearch.toLowerCase()))
                          .map(b => {
                            const isSelected = (editingUser.branchIds || []).includes(b.id);
                            return (
                              <label key={b.id} className="flex items-center justify-between p-2.5 hover:bg-gray-50 cursor-pointer">
                                <div className="flex items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={e => {
                                      const current = editingUser.branchIds || [];
                                      const next = e.target.checked
                                        ? [...current, b.id]
                                        : current.filter(id => id !== b.id);
                                      // If removed branch was preferred, reset preferred branch
                                      const newBranchId = !e.target.checked && editingUser.branchId === b.id
                                        ? (next[0] || '')
                                        : (editingUser.branchId || next[0] || '');
                                      setEditingUser({ ...editingUser, branchIds: next, branchId: newBranchId });
                                    }}
                                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                                  />
                                  <span className="text-xs font-bold text-gray-800">{b.name}</span>
                                </div>
                                <span className="text-[10px] text-gray-400 font-mono">{b.code}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Preferred/Default Branch selector */}
                  <div className="pt-2">
                    <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Default / Preferred Branch</label>
                    <select aria-label="Default / Preferred Branch"
                      value={editingUser.branchId || ''}
                      onChange={e => setEditingUser({ ...editingUser, branchId: e.target.value })}
                      className="w-full border border-gray-300 rounded-xl p-2.5 text-xs bg-white outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">None / Prompt Each Time</option>
                      {branches
                        .filter(b => b.active && (editingUser.allBranches || (editingUser.branchIds || []).includes(b.id)))
                        .map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Retained for convenience, but does not determine the user's complete authorized access.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 4: SUPPLIER ACCESS */}
              {activeModalTab === 'suppliers' && (
                <div className="space-y-4">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={editingUser.allSuppliers ?? true}
                        onChange={e => setEditingUser({ ...editingUser, allSuppliers: e.target.checked })}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                      />
                      <span className="text-sm font-bold text-gray-800">All Branch Suppliers</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-1 pl-6">
                      Enables all suppliers available at the user's assigned branch. Does NOT bypass branch boundaries.
                    </p>
                  </div>

                  {!editingUser.allSuppliers && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-gray-600 uppercase">Selected Suppliers</label>
                        <span className="text-xs text-brand-600 font-semibold">
                          {(editingUser.supplierIds || []).length} Selected
                        </span>
                      </div>

                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search suppliers..."
                          value={supplierSearch}
                          onChange={e => setSupplierSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>

                      <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-52 overflow-y-auto">
                        {suppliers
                          .filter(s => s.active && s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
                          .map(s => {
                            const isSelected = (editingUser.supplierIds || []).includes(s.id);
                            return (
                              <label key={s.id} className="flex items-center justify-between p-2.5 hover:bg-gray-50 cursor-pointer">
                                <div className="flex items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={e => {
                                      const current = editingUser.supplierIds || [];
                                      const next = e.target.checked
                                        ? [...current, s.id]
                                        : current.filter(id => id !== s.id);
                                      setEditingUser({ ...editingUser, supplierIds: next });
                                    }}
                                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                                  />
                                  <span className="text-xs font-bold text-gray-800">{s.name}</span>
                                </div>
                                <span className="text-[10px] text-gray-400 truncate max-w-[140px]">{s.email}</span>
                              </label>
                            );
                          })}
                      </div>
                      <p className="text-[11px] text-gray-400">
                        * For Sushi chefs, select the permitted suppliers (e.g. Japanese Food Supplier and Fish Supplier).
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center pt-4 border-t border-gray-100 mt-4">
                <button 
                  type="button" 
                  onClick={editorClose.requestClose} 
                  className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-colors text-sm"
                >
                  Cancel
                </button>
                <div className="flex gap-2">
                  <button 
                    type="submit" 
                    disabled={isSavingUser} 
                    className="px-6 py-2.5 bg-brand-600 text-white text-sm font-bold rounded-xl flex items-center gap-2 hover:bg-brand-700 shadow-md transition-colors"
                  >
                    {isSavingUser && <Loader2 size={16} className="animate-spin" />} Save Account
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* RE-AUTHENTICATION MODAL FOR EXPIRED / REVOKED SESSIONS */}
      <Modal 
        isOpen={reauthOpen} 
        onClose={() => {
          if (!isReauthenticating) {
            setReauthOpen(false);
            setPendingAction(null);
          }
        }} 
        className="max-w-md p-6 relative z-[110]"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <Lock size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Verify your session</h2>
              <p className="text-xs text-gray-500">Sign-in session has expired or requires renewal</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 leading-relaxed">
            Your administrative session expired or was revoked. Please enter your administrator password for <strong>{currentUser?.username || 'your account'}</strong> to re-authenticate and complete saving without losing your changes.
          </div>

          <form onSubmit={handleReauthenticate} className="space-y-4 pt-1">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1.5">
                Password for {currentUser?.displayName || currentUser?.username}
              </label>
              <div className="relative">
                <input aria-label="Password for" 
                  type={showReauthPassword ? 'text' : 'password'}
                  value={reauthPassword}
                  onChange={e => setReauthPassword(e.target.value)}
                  placeholder="Enter administrator password"
                  autoFocus
                  required
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowReauthPassword(!showReauthPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showReauthPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {reauthError && (
                <div className="mt-2 text-xs font-semibold text-red-600 flex items-center gap-1.5 bg-red-50 p-2.5 rounded-lg border border-red-200">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{reauthError}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                type="submit"
                disabled={isReauthenticating}
                className="flex-1 py-2.5 px-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm shadow-md transition-colors flex items-center justify-center gap-2"
              >
                {isReauthenticating && <Loader2 size={16} className="animate-spin" />}
                Re-Authenticate & Save
              </button>
              <button
                type="button"
                disabled={isReauthenticating}
                onClick={() => {
                  setReauthOpen(false);
                  setPendingAction(null);
                  setReauthAttempts(0);
                }}
                className="py-2.5 px-4 border border-gray-300 hover:bg-gray-100 text-gray-700 font-bold rounded-xl text-xs transition-colors"
                title="Cancel and keep all entered user details"
              >
                Cancel (Keep Details)
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
};
