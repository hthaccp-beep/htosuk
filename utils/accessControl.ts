import type { User, Branch, Supplier, Department, Permission } from '../types.ts';

/**
 * Access Control & Filtering Engine for Multi-Branch & Multi-Department Operations
 *
 * Implements the 6-condition supplier filtering matrix, branch and department authorization,
 * and user permission evaluation.
 */

export function isUserAuthorizedForBranch(user: User | null | undefined, branchId: string): boolean {
  if (!user || user.active !== true) return false;
  if (!branchId) return false;

  // Creator & GM have enterprise-wide access
  if (user.role === 'CREATOR' || user.role === 'GM') return true;

  // Dynamic All Branches setting
  if (user.allBranches === true) return true;

  const assignedIds = new Set<string>();
  if (Array.isArray(user.branchIds)) {
    user.branchIds.forEach(id => { if (id && id.trim()) assignedIds.add(id.trim()); });
  }
  if (user.branchId && user.branchId.trim()) {
    assignedIds.add(user.branchId.trim());
  }

  return assignedIds.has(branchId);
}

export function isUserAuthorizedForDepartment(user: User | null | undefined, departmentId?: string): boolean {
  if (!user || user.active !== true) return false;
  if (!departmentId) return true;

  if (user.role === 'CREATOR' || user.role === 'GM' || user.allDepartments === true) return true;

  if (Array.isArray(user.departmentIds) && user.departmentIds.length > 0) {
    return user.departmentIds.includes(departmentId);
  }

  return true;
}

export function isSupplierAvailableAtBranch(supplier: Supplier | null | undefined, branchId: string): boolean {
  if (!supplier || supplier.active !== true) return false;
  if (!branchId) return false;

  // Dynamic All Branches setting
  if (supplier.allBranches === true) return true;

  // If allBranches is explicitly false, ONLY specified branches are available
  if (supplier.allBranches === false) {
    if (Array.isArray(supplier.availableBranchIds)) {
      return supplier.availableBranchIds.includes(branchId);
    }
    if (supplier.deliveryRules && Object.keys(supplier.deliveryRules).length > 0) {
      return !!(supplier.deliveryRules[branchId] && supplier.deliveryRules[branchId].length > 0);
    }
    return false;
  }

  // Explicit availableBranchIds list (when allBranches not explicitly true)
  if (Array.isArray(supplier.availableBranchIds) && supplier.availableBranchIds.length > 0) {
    return supplier.availableBranchIds.includes(branchId);
  }

  // Check deliveryRules map if configured
  if (supplier.deliveryRules && Object.keys(supplier.deliveryRules).length > 0) {
    const rules = supplier.deliveryRules[branchId];
    if (rules && rules.length > 0) return true;
    return false;
  }

  // Check deliverySchedules map if specific branch schedules exist
  if (supplier.deliverySchedules && Object.keys(supplier.deliverySchedules).length > 1) {
    if (supplier.deliverySchedules[branchId]) return true;
    if (supplier.deliverySchedules['default']) return true;
  }

  // Default: available across branches if no restrictions configured
  return true;
}

export function isSupplierSupportingDepartment(_supplier: Supplier | null | undefined, _departmentId?: string): boolean {
  // Department scoping has been removed to simplify operations and avoid confusion
  return true;
}

export function isSupplierPermittedForUser(
  user: User | null | undefined,
  supplier: Supplier | null | undefined,
  branchId: string,
  _departmentId?: string
): boolean {
  if (!user || user.active !== true || !supplier || supplier.active !== true) return false;

  // Creator & GM have full enterprise-wide access to all active suppliers across all branches
  if (user.role === 'CREATOR' || user.role === 'GM') return true;

  // Must match branch availability first (supplier must service the selected branch)
  if (!isSupplierAvailableAtBranch(supplier, branchId)) return false;

  // Dynamic All Suppliers setting for user
  if (user.allSuppliers === true) {
    return true; // Already verified branch availability above
  }

  // Explicit selected eligible suppliers for this user
  if (Array.isArray(user.supplierIds)) {
    if (user.supplierIds.length === 0) return false; // Empty selection means no suppliers assigned
    return user.supplierIds.includes(supplier.id);
  }

  // If allSuppliers is explicitly false and no supplierIds set, user has no supplier access
  if (user.allSuppliers === false) {
    return false;
  }

  // Legacy user with no supplier configuration: allowed if eligible at branch
  return true;
}

/**
 * For a new order, show a supplier only when:
 * 1. The account is active.
 * 2. The user has a valid assignment for the selected branch.
 * 3. The user has the action permission required.
 * 4. The supplier is active and available at the selected branch (or user is Creator/GM with enterprise access).
 * 5. The supplier is permitted by the user's supplier assignment.
 */
export function isSupplierEligibleForOrder(
  user: User | null | undefined,
  supplier: Supplier | null | undefined,
  branchId: string,
  departmentId?: string,
  hasActionPermission = true
): boolean {
  // 1. Account active
  if (!user || user.active !== true) return false;

  // 2. User assigned to branch
  if (!isUserAuthorizedForBranch(user, branchId)) return false;

  // 3. Action permission
  if (!hasActionPermission) return false;

  // Creator & GM have full enterprise access to all active suppliers across all branches
  if (user.role === 'CREATOR' || user.role === 'GM') {
    return Boolean(supplier && supplier.active !== false);
  }

  // 4. Supplier active and available at selected branch
  if (!supplier || supplier.active !== true || !isSupplierAvailableAtBranch(supplier, branchId)) return false;

  // 5. Permitted by user's supplier assignment
  if (!isSupplierPermittedForUser(user, supplier, branchId, departmentId)) return false;

  return true;
}

/**
 * Filter suppliers for the order placement screen based on current user and branch.
 */
export function filterSuppliersForOrdering(
  user: User | null | undefined,
  allSuppliers: Supplier[],
  branchId: string,
  departmentId?: string,
  hasActionPermission = true
): Supplier[] {
  return allSuppliers.filter(supplier =>
    isSupplierEligibleForOrder(user, supplier, branchId, departmentId, hasActionPermission)
  );
}

/**
 * Returns branches authorized for the current user.
 * Only returns active branches assigned to the user (or all if Creator/GM/allBranches).
 */
export function getUserAuthorizedBranches(user: User | null | undefined, allBranches: Branch[]): Branch[] {
  if (!user || user.active !== true) return [];
  const activeBranches = allBranches.filter(b => b.active !== false);

  if (user.role === 'CREATOR' || user.role === 'GM' || user.allBranches === true) {
    return activeBranches;
  }

  const assignedIds = new Set<string>();
  if (Array.isArray(user.branchIds)) {
    user.branchIds.forEach(id => { if (id && id.trim()) assignedIds.add(id.trim()); });
  }
  if (user.branchId && user.branchId.trim()) {
    assignedIds.add(user.branchId.trim());
  }

  if (assignedIds.size > 0) {
    return activeBranches.filter(b => assignedIds.has(b.id));
  }

  return [];
}

/**
 * Returns branches that act as suppliers (internal suppliers) and are assigned to the current user.
 * For Incoming Orders page access and selection.
 */
export function getUserSupplierBranches(user: User | null | undefined, allBranches: Branch[]): Branch[] {
  if (!user || user.active !== true) return [];
  const activeSupplierBranches = allBranches.filter(b => b.active !== false && b.actsAsSupplier === true);

  // Creator & GM have enterprise-wide access to all supplier branches
  if (user.role === 'CREATOR' || user.role === 'GM') {
    return activeSupplierBranches;
  }

  const assignedIds = new Set<string>();
  if (Array.isArray(user.branchIds)) {
    user.branchIds.forEach(id => { if (id && id.trim()) assignedIds.add(id.trim()); });
  }
  if (user.branchId && user.branchId.trim()) {
    assignedIds.add(user.branchId.trim());
  }

  return activeSupplierBranches.filter(b => assignedIds.has(b.id));
}

/**
 * Returns departments authorized for the current user.
 */
export function getUserAuthorizedDepartments(user: User | null | undefined, allDepartments: Department[]): Department[] {
  if (!user || user.active !== true) return [];
  const activeDepartments = allDepartments.filter(d => !d.archived);

  if (user.role === 'CREATOR' || user.role === 'GM' || user.allDepartments === true) {
    return activeDepartments;
  }

  if (Array.isArray(user.departmentIds) && user.departmentIds.length > 0) {
    return activeDepartments.filter(d => user.departmentIds!.includes(d.id));
  }

  return activeDepartments;
}

/**
 * Evaluates whether a user is authorized to perform a specific action.
 * Enforces:
 * - Active account requirement
 * - Enterprise-wide access for Creator and GM
 * - Explicit distinction between Inherited and Custom permissions
 * - Custom permissions with 0 actions strictly means NO actions
 */
export function hasActionPermission(
  user: User | null | undefined,
  action: Permission,
  rolePermissionsMap?: Record<string, Permission[]>
): boolean {
  if (!user || user.active !== true) return false;
  if (user.role === 'CREATOR' || user.role === 'GM') return true;

  const isCustom = user.permissionMode === 'CUSTOM' ||
    (user.permissionMode !== 'INHERITED' &&
     Array.isArray(user.customPermissions) &&
     user.customPermissions.length > 0);

  if (isCustom) {
    const customList = Array.isArray(user.customPermissions) ? user.customPermissions : [];
    return customList.includes(action);
  }

  const defaultRolePermissions: Record<string, Permission[]> = {
    'CREATOR': [],
    'GM': [
      'place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_other_users_orders', 'amend_orders', 'approve_orders', 'cancel_orders',
      'view_reports', 'view_global_data', 'view_received_orders', 'manage_users', 'manage_roles', 'manage_departments',
      'manage_products', 'manage_categories', 'manage_ordering', 'manage_branches', 'manage_suppliers', 'manage_email_config', 'manage_data',
      'delete_orders', 'delete_drafts', 'admin_access', 'scan_invoices', 'view_price_changes', 'approve_price_changes', 'reject_price_changes',
      'manage_new_items', 'view_price_history', 'manage_price_monitoring', 'view_audit_logs'
    ],
    'MANAGER': [
      'place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_other_users_orders', 'amend_orders', 'approve_orders', 'cancel_orders',
      'view_reports', 'view_received_orders', 'manage_users', 'delete_orders', 'delete_drafts', 'admin_access',
      'scan_invoices', 'view_price_changes', 'approve_price_changes', 'reject_price_changes', 'manage_new_items', 'view_price_history'
    ],
    'STAFF': [
      'place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices',
      'view_received_orders', 'delete_drafts', 'scan_invoices'
    ]
  };

  const perms = rolePermissionsMap?.[user.role] || defaultRolePermissions[user.role] || [];
  return perms.includes(action);
}

