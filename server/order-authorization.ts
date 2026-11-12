/**
 * Order Authorization & Field-Level Integrity Engine (Issue 5)
 *
 * Enforces the Role / Resource / Action / Field Matrix for orders:
 * - Creator, GM, Manager, Staff, and Linked Supplier roles.
 * - Identity and historical snapshots immutability.
 * - Workflow state transitions (DRAFT -> PLACED, locking Placed records against deletion).
 * - Constrained supplier-side modifications (fulfillment tracking only).
 * - Branch containment for Manager and Staff.
 */

import type { OrderRecord, OrderItem, ManualOrderItem, InvoiceVerification, CreditNoteClaim } from '../types.ts';
import { hasBranchScope, hasSupplierScope } from '../shared/order-scope.ts';

export type UserRole = 'CREATOR' | 'GM' | 'MANAGER' | 'STAFF';

export interface AuthenticatedUser {
  id: string;
  role: UserRole | string;
  branchId?: string;
  active: boolean;
  displayName?: string;
  allBranches?: boolean;
  branchIds?: string[];
  allDepartments?: boolean;
  departmentIds?: string[];
  allSuppliers?: boolean;
  supplierIds?: string[];
  permissionMode?: 'INHERITED' | 'CUSTOM' | string;
  customPermissions?: string[];
}

export interface SupplierRecord {
  id: string;
  name: string;
  active: boolean;
  linkedBranchId?: string;
}

export class OrderAuthorizationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'OrderAuthorizationError';
    this.status = status;
  }
}

function reject(status: number, message: string): never {
  throw new OrderAuthorizationError(status, message);
}

export function isAdminRole(role: string): boolean {
  return role === 'CREATOR' || role === 'GM';
}

export function checkBranchAccess(user: AuthenticatedUser, branchId: string): boolean {
  return hasBranchScope(user, branchId);
}

export function checkDepartmentAccess(user: AuthenticatedUser, departmentId?: string): boolean {
  if (!departmentId) return true;
  if (isAdminRole(user.role)) return true;
  if (user.allDepartments === true) return true;
  if (Array.isArray(user.departmentIds) && user.departmentIds.length > 0) {
    return user.departmentIds.includes(departmentId);
  }
  return true;
}

export function checkSupplierAccess(user: AuthenticatedUser, supplierId: string): boolean {
  return hasSupplierScope(user, supplierId);
}

/**
 * Checks if a user has a specific granular action permission.
 * Distinguishes Inherited permissions from Custom permissions.
 * Custom with no actions must mean no actions.
 */
export function checkUserActionPermission(
  user: AuthenticatedUser,
  action: string,
  rolePermissionsMap?: Record<string, string[]>
): boolean {
  if (!user || user.active !== true) return false;
  if (action === 'review_invoices') {
    if (user.role === 'CREATOR') return true;
    const custom = user.permissionMode === 'CUSTOM' || (user.permissionMode !== 'INHERITED' && !!user.customPermissions?.length);
    return (custom ? user.customPermissions : rolePermissionsMap?.[user.role])?.includes(action) === true;
  }
  if (user.role === 'CREATOR' || user.role === 'GM') return true;

  const isCustom = user.permissionMode === 'CUSTOM' ||
    (user.permissionMode !== 'INHERITED' &&
     Array.isArray(user.customPermissions) &&
     user.customPermissions.length > 0);

  if (isCustom) {
    const list = Array.isArray(user.customPermissions) ? user.customPermissions : [];
    return list.includes(action);
  }

  // Default inherited permissions by role
  const defaultMap: Record<string, string[]> = {
    'STAFF': ['place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_received_orders', 'delete_drafts', 'scan_invoices'],
    'MANAGER': ['place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_other_users_orders', 'amend_orders', 'approve_orders', 'cancel_orders', 'view_reports', 'view_received_orders', 'manage_users', 'delete_orders', 'delete_drafts', 'admin_access', 'scan_invoices', 'view_price_changes', 'approve_price_changes', 'reject_price_changes', 'manage_new_items', 'view_price_history']
  };

  const perms = rolePermissionsMap?.[user.role] || defaultMap[user.role] || [];
  return perms.includes(action);
}

/**
 * Validates Order Creation against the Role / Resource / Action / Field Matrix.
 */
export function validateOrderCreation(
  user: AuthenticatedUser,
  order: Partial<OrderRecord>
): OrderRecord {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to create orders.');
  }

  // Action permission: create_orders
  if (!checkUserActionPermission(user, 'create_orders')) {
    reject(403, 'You do not have permission to create orders.');
  }

  if (!order.id || typeof order.id !== 'string' || !order.id.trim()) {
    reject(400, 'Order ID is required.');
  }

  if (!order.orderedByUserId || order.orderedByUserId !== user.id) {
    reject(403, 'Cannot create an order under another user ID.');
  }

  if (!order.branchId || typeof order.branchId !== 'string') {
    reject(400, 'Order branchId is required.');
  }

  // Branch containment: Non-admin users cannot place orders for unassigned branches
  if (!isAdminRole(user.role)) {
    if (!checkBranchAccess(user, order.branchId)) {
      reject(403, 'You may only create orders for your assigned branch.');
    }
  }

  if (!order.supplierId || typeof order.supplierId !== 'string') {
    reject(400, 'Order supplierId is required.');
  }

  // Supplier containment
  if (!checkSupplierAccess(user, order.supplierId)) {
    reject(403, 'You are not authorized to order from this supplier.');
  }

  // Department containment
  if (!checkDepartmentAccess(user, order.departmentId)) {
    reject(403, 'You may only create orders for your assigned department.');
  }

  if (!order.createdAt || typeof order.createdAt !== 'string') {
    reject(400, 'Order createdAt timestamp is required.');
  }

  const status = order.status || 'PLACED';
  if (status !== 'DRAFT' && status !== 'PLACED') {
    reject(400, `Initial order status must be DRAFT or PLACED, got: ${status}`);
  }

  if (status === 'PLACED' && !checkUserActionPermission(user, 'submit_orders')) {
    reject(403, 'You do not have permission to submit orders.');
  }

  return order as OrderRecord;
}

/**
 * Validates Order Updates against the Role / Resource / Action / Field Matrix.
 */
export function validateOrderUpdate(
  user: AuthenticatedUser,
  currentOrder: OrderRecord,
  updatedOrder: OrderRecord,
  isLinkedSupplier = false
): OrderRecord {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to update orders.');
  }

  // 1. IMMUTABLE CORE IDENTITY FIELDS
  if (updatedOrder.id !== currentOrder.id) {
    reject(403, 'Order ID is immutable and cannot be changed.');
  }
  if (updatedOrder.orderedByUserId !== currentOrder.orderedByUserId) {
    reject(403, 'Order author (orderedByUserId) is immutable and cannot be changed.');
  }
  if (updatedOrder.branchId !== currentOrder.branchId) {
    reject(403, 'Order branchId is immutable and cannot be reassigned.');
  }
  if (updatedOrder.supplierId !== currentOrder.supplierId) {
    reject(403, 'Order supplierId is immutable and cannot be reassigned.');
  }
  if (updatedOrder.createdAt !== currentOrder.createdAt) {
    reject(403, 'Order createdAt timestamp is immutable and cannot be changed.');
  }

  // 2. WORKFLOW STATE TRANSITION
  const oldStatus = currentOrder.status;
  const newStatus = updatedOrder.status;

  if (oldStatus === 'PLACED' && newStatus === 'DRAFT') {
    reject(403, 'A placed order cannot be reverted back to DRAFT status.');
  }

  if (newStatus !== 'DRAFT' && newStatus !== 'PLACED' && newStatus !== 'CANCELLED') {
    reject(400, `Invalid order status: ${newStatus}`);
  }

  if (oldStatus === 'DRAFT' && newStatus === 'PLACED') {
    if (!checkUserActionPermission(user, 'submit_orders')) {
      reject(403, 'You do not have permission to submit orders.');
    }
  }

  if (oldStatus === 'DRAFT' && newStatus === 'DRAFT') {
    if (!checkUserActionPermission(user, 'edit_drafts')) {
      reject(403, 'You do not have permission to edit draft orders.');
    }
  }

  if (oldStatus === 'PLACED' && newStatus === 'CANCELLED') {
    if (!checkUserActionPermission(user, 'cancel_orders')) {
      reject(403, 'You do not have permission to cancel placed orders.');
    }
  }

  const isAdmin = isAdminRole(user.role);
  const isBranchMember = checkBranchAccess(user, currentOrder.branchId);

  // 3. SUPPLIER-SIDE MODIFICATIONS (Fulfillment tracking only)
  if (isLinkedSupplier) {
    // Linked suppliers cannot edit draft orders
    if (oldStatus !== 'PLACED') {
      reject(403, 'Suppliers can only update placed orders.');
    }

    // Immutable snapshots cannot be modified by supplier
    if (updatedOrder.branchNameSnapshot !== currentOrder.branchNameSnapshot ||
        updatedOrder.supplierNameSnapshot !== currentOrder.supplierNameSnapshot ||
        updatedOrder.orderedByNameSnapshot !== currentOrder.orderedByNameSnapshot) {
      reject(403, 'Historical order snapshots cannot be modified by suppliers.');
    }

    // Supplier cannot change status or email fields
    if (updatedOrder.status !== currentOrder.status ||
        updatedOrder.emailTo !== currentOrder.emailTo) {
      reject(403, 'Suppliers cannot modify order status or recipient details.');
    }

    // Supplier cannot forge or modify invoice verification or credit claims
    if (JSON.stringify(updatedOrder.invoiceVerification) !== JSON.stringify(currentOrder.invoiceVerification) ||
        JSON.stringify(updatedOrder.creditNoteClaim) !== JSON.stringify(currentOrder.creditNoteClaim)) {
      reject(403, 'Suppliers cannot modify invoice verification or credit note claims.');
    }

    // Supplier cannot alter ordered quantities or prices
    if (currentOrder.items.length !== updatedOrder.items.length) {
      reject(403, 'Suppliers cannot add or remove items from the order.');
    }

    for (let i = 0; i < currentOrder.items.length; i++) {
      const orig = currentOrder.items[i];
      const mod = updatedOrder.items[i];
      if (orig.productId !== mod.productId ||
          orig.caseQty !== mod.caseQty ||
          orig.packQty !== mod.packQty ||
          orig.casePriceSnapshot !== mod.casePriceSnapshot ||
          orig.packPriceSnapshot !== mod.packPriceSnapshot) {
        reject(403, 'Suppliers cannot modify ordered quantities or price snapshots.');
      }
    }

    return updatedOrder;
  }

  // 4. RESTAURANT USER MODIFICATIONS
  if (!isBranchMember || !checkSupplierAccess(user, currentOrder.supplierId)) {
    reject(403, 'This order is outside your assigned branches or suppliers.');
  }
  if (oldStatus === 'DRAFT') {
    // Draft can be updated by its author, branch manager, or admin
    const isAuthor = user.id === currentOrder.orderedByUserId;
    const isBranchManager = user.role === 'MANAGER' && isBranchMember;

    if (!isAdmin && !isBranchManager && !isAuthor) {
      reject(403, 'You are not authorized to edit this draft order.');
    }

    return updatedOrder;
  }

  // Placed Order: Branch member or admin only
  if (!isAdmin && !isBranchMember) {
    reject(403, 'You are not authorized to update orders for other branches.');
  }

  // Snapshots on placed orders are immutable
  if (updatedOrder.branchNameSnapshot !== currentOrder.branchNameSnapshot ||
      updatedOrder.supplierNameSnapshot !== currentOrder.supplierNameSnapshot ||
      updatedOrder.orderedByNameSnapshot !== currentOrder.orderedByNameSnapshot) {
    reject(403, 'Historical order snapshots are immutable once placed.');
  }

  // 5. INVOICE VERIFICATION & PROCESSING INTEGRITY
  validateInvoiceVerificationIntegrity(currentOrder, updatedOrder);

  return updatedOrder;
}

/**
 * Validates invoice verification data against the trusted write boundary.
 * Prevents failed or incomplete reviews from setting receivedStatus: 'PROCESSED'.
 */
export function validateInvoiceVerificationIntegrity(
  currentOrder: OrderRecord,
  updatedOrder: OrderRecord
): void {
  // If receivedStatus is advancing to PROCESSED, ensure valid, completed verification exists
  if (updatedOrder.receivedStatus === 'PROCESSED' && currentOrder.receivedStatus !== 'PROCESSED') {
    const v = updatedOrder.invoiceVerification;
    if (!v || typeof v !== 'object') {
      reject(400, 'Cannot mark order as PROCESSED without a valid invoice verification.');
    }
    if (v.reviewStatus !== 'VERIFIED' && v.reviewStatus !== 'REVIEWED_WITH_EXCEPTION') {
      reject(400, `Cannot mark order as PROCESSED with incomplete review status: ${v.reviewStatus}.`);
    }
    if (!v.verifiedBy || typeof v.verifiedBy !== 'string') {
      reject(400, 'Invoice verification requires a recorded verifiedBy reviewer.');
    }
    if (!v.invoiceNumber && !v.invoiceNumberNotProvided) {
      reject(400, 'Invoice verification requires an invoice number or documented exception.');
    }
    if (v.scanStatus === 'FAILED' && v.reviewMethod !== 'MANUAL') {
      reject(400, 'Failed scans must not be marked verified without complete manual review.');
    }
  }

  // Prevent marking DRAFT or INCOMPLETE review as PROCESSED
  if (updatedOrder.invoiceVerification) {
    const v = updatedOrder.invoiceVerification;
    if ((v.reviewStatus === 'DRAFT' || v.reviewStatus === 'INCOMPLETE') && updatedOrder.receivedStatus === 'PROCESSED') {
      reject(400, 'Draft or incomplete invoice reviews cannot set order receivedStatus to PROCESSED.');
    }
    // Prevent empty verification object advancing status
    if (Object.keys(v).length <= 2 && !v.reviewStatus && updatedOrder.receivedStatus === 'PROCESSED') {
      reject(400, 'Empty verification object cannot advance order processing status.');
    }
  }
}

/**
 * Validates Order Deletion against the Role / Resource / Action / Field Matrix.
 * Placed orders are permanent records and cannot be deleted by clients.
 */
export function validateOrderDeletion(
  user: AuthenticatedUser,
  order: OrderRecord
): void {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to delete orders.');
  }

  if (order.status !== 'DRAFT') {
    reject(403, 'Placed orders are permanent business records and cannot be deleted.');
  }

  const isAdmin = isAdminRole(user.role);
  const isBranchManager = user.role === 'MANAGER' && checkBranchAccess(user, order.branchId);
  const isAuthor = user.id === order.orderedByUserId;

  if (!checkBranchAccess(user, order.branchId) || !checkSupplierAccess(user, order.supplierId)) {
    reject(403, 'This order is outside your assigned branches or suppliers.');
  }

  if (!isAdmin && !isBranchManager && !isAuthor) {
    reject(403, 'You do not have permission to delete this draft order.');
  }

  if (!checkUserActionPermission(user, 'delete_drafts')) {
    reject(403, 'You do not have permission to delete draft orders.');
  }
}
