/**
 * Price Approval & Global Settings Permission Service (Issue 6)
 *
 * Implements strict authorization rules, reviewer identity verification,
 * state transition integrity, and audit history immutability for:
 * - Price Change Notices (propose, review, approve, reject)
 * - New Item Notices (propose, resolve, link, reject)
 * - Global System Settings vs Branch Configuration
 * - Append-Only Price History Audit Trail
 */

import type {
  PriceChangeNotice,
  NewItemNotice,
  PriceHistoryRecord,
  PriceMonitoringSettings,
  User,
} from '../types.ts';

export type UserRole = 'CREATOR' | 'GM' | 'MANAGER' | 'STAFF';

export interface AuthenticatedUser {
  id: string;
  role: UserRole | string;
  branchId?: string;
  active: boolean;
  displayName?: string;
  permissions?: string[];
}

export class PriceApprovalError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PriceApprovalError';
    this.status = status;
  }
}

function reject(status: number, message: string): never {
  throw new PriceApprovalError(status, message);
}

export function isAdminUser(user: AuthenticatedUser): boolean {
  return user.role === 'CREATOR' || user.role === 'GM';
}

export function canApprovePriceChanges(user: AuthenticatedUser): boolean {
  if (!user || user.active !== true) return false;
  if (isAdminUser(user)) return true;
  if (user.role === 'MANAGER') return true;
  return Array.isArray(user.permissions) && user.permissions.includes('approve_price_changes');
}

export function canRejectPriceChanges(user: AuthenticatedUser): boolean {
  if (!user || user.active !== true) return false;
  if (isAdminUser(user)) return true;
  if (user.role === 'MANAGER') return true;
  return Array.isArray(user.permissions) && user.permissions.includes('reject_price_changes');
}

export function canManageNewItems(user: AuthenticatedUser): boolean {
  if (!user || user.active !== true) return false;
  if (isAdminUser(user)) return true;
  if (user.role === 'MANAGER') return true;
  return Array.isArray(user.permissions) && user.permissions.includes('manage_new_items');
}

export function canManageGlobalSettings(user: AuthenticatedUser): boolean {
  if (!user || user.active !== true) return false;
  // Global settings (role permissions, system configuration, price monitoring thresholds)
  // are restricted strictly to General Managers and Creators.
  return isAdminUser(user);
}

/**
 * 1. Validate Price Change Notice Proposal / Creation
 * Any active user (Staff, Manager, GM, Creator) scanning an invoice can propose a notice.
 */
export function validatePriceNoticeCreation(
  user: AuthenticatedUser,
  notice: Partial<PriceChangeNotice>
): PriceChangeNotice {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to propose price changes.');
  }

  if (!notice.id || typeof notice.id !== 'string') {
    reject(400, 'Notice ID is required.');
  }

  if (!notice.productId || typeof notice.productId !== 'string') {
    reject(400, 'Product ID is required.');
  }

  if (!notice.supplierId || typeof notice.supplierId !== 'string') {
    reject(400, 'Supplier ID is required.');
  }

  if (!notice.invoiceNumber || typeof notice.invoiceNumber !== 'string') {
    reject(400, 'Invoice number is required.');
  }

  if (typeof notice.oldCasePrice !== 'number' || notice.oldCasePrice < 0) {
    reject(400, 'Old case price must be a non-negative number.');
  }

  if (typeof notice.newCasePrice !== 'number' || notice.newCasePrice < 0) {
    reject(400, 'New case price must be a non-negative number.');
  }

  if (notice.oldPackPrice !== undefined && (typeof notice.oldPackPrice !== 'number' || notice.oldPackPrice < 0)) {
    reject(400, 'Old pack price must be a non-negative number.');
  }

  if (notice.newPackPrice !== undefined && (typeof notice.newPackPrice !== 'number' || notice.newPackPrice < 0)) {
    reject(400, 'New pack price must be a non-negative number.');
  }

  if (!notice.uploadedByUserId || notice.uploadedByUserId !== user.id) {
    reject(403, 'Uploader identity mismatch: uploadedByUserId must match authenticated user.');
  }

  // Pre-approval protection: initial status must ALWAYS be PENDING
  if (notice.status !== 'PENDING') {
    reject(403, `Notice cannot be created with status "${notice.status}". Must be "PENDING".`);
  }

  return notice as PriceChangeNotice;
}

/**
 * 2. Validate Price Change Notice Review (Approval or Rejection)
 * Strictly enforces reviewer role, state transitions, reviewer identity, and core detection immutability.
 */
export function validatePriceNoticeReview(
  user: AuthenticatedUser,
  currentNotice: PriceChangeNotice,
  update: Partial<PriceChangeNotice>
): PriceChangeNotice {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to review price changes.');
  }

  // State Transition Guard: Can only review PENDING notices
  if (currentNotice.status !== 'PENDING') {
    reject(
      409,
      `Price notice is already finalized as "${currentNotice.status}" and cannot be reviewed again.`
    );
  }

  const newStatus = update.status;
  if (newStatus !== 'APPROVED' && newStatus !== 'REJECTED') {
    reject(400, `Review status must be either "APPROVED" or "REJECTED", got: ${newStatus}`);
  }

  // Permission Check
  if (newStatus === 'APPROVED' && !canApprovePriceChanges(user)) {
    reject(403, 'You do not have permission to approve price changes.');
  }

  if (newStatus === 'REJECTED' && !canRejectPriceChanges(user)) {
    reject(403, 'You do not have permission to reject price changes.');
  }

  // Self-approval policy: Non-admin users cannot approve their own proposed price increases (case or pack)
  const isSelfPriceIncrease =
    (currentNotice.newCasePrice !== undefined && currentNotice.oldCasePrice !== undefined && currentNotice.newCasePrice > currentNotice.oldCasePrice) ||
    (currentNotice.newPackPrice !== undefined && currentNotice.oldPackPrice !== undefined && currentNotice.newPackPrice > currentNotice.oldPackPrice);

  if (
    newStatus === 'APPROVED' &&
    !isAdminUser(user) &&
    currentNotice.uploadedByUserId === user.id &&
    isSelfPriceIncrease
  ) {
    reject(403, 'Non-admin users cannot approve their own proposed price increases.');
  }

  // Reviewer Identity Protection: reviewedByUserId must match the caller
  if (!update.reviewedByUserId || update.reviewedByUserId !== user.id) {
    reject(403, 'Reviewer identity mismatch: reviewedByUserId must match authenticated reviewer.');
  }

  if (!update.reviewedAt || typeof update.reviewedAt !== 'string') {
    reject(400, 'Review timestamp (reviewedAt) is required.');
  }

  // Effective Date required on Approval
  if (newStatus === 'APPROVED') {
    if (!update.effectiveDate || typeof update.effectiveDate !== 'string') {
      reject(400, 'Effective date is required when approving a price change.');
    }
  }

  // Rejection Reason required on Rejection
  if (newStatus === 'REJECTED') {
    if (!update.rejectionReason || typeof update.rejectionReason !== 'string' || !update.rejectionReason.trim()) {
      reject(400, 'Rejection reason is required when rejecting a price change.');
    }
  }

  // Core Detection Immutability: Reviewers cannot alter the underlying detected facts
  if (update.id && update.id !== currentNotice.id) {
    reject(403, 'Notice ID cannot be changed.');
  }
  if (update.productId && update.productId !== currentNotice.productId) {
    reject(403, 'Product ID cannot be altered during review.');
  }
  if (update.supplierId && update.supplierId !== currentNotice.supplierId) {
    reject(403, 'Supplier ID cannot be altered during review.');
  }
  if (update.oldCasePrice !== undefined && update.oldCasePrice !== currentNotice.oldCasePrice) {
    reject(403, 'Detected old price cannot be altered during review.');
  }
  if (update.newCasePrice !== undefined && update.newCasePrice !== currentNotice.newCasePrice) {
    reject(403, 'Detected new price cannot be altered during review.');
  }
  if (update.uploadedByUserId && update.uploadedByUserId !== currentNotice.uploadedByUserId) {
    reject(403, 'Original uploader cannot be changed during review.');
  }

  return {
    ...currentNotice,
    ...update,
    status: newStatus,
  } as PriceChangeNotice;
}

/**
 * 3. Validate New Item Notice Proposal
 */
export function validateNewItemNoticeCreation(
  user: AuthenticatedUser,
  notice: Partial<NewItemNotice>
): NewItemNotice {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to propose new items.');
  }

  if (!notice.id || typeof notice.id !== 'string') {
    reject(400, 'Notice ID is required.');
  }

  if (!notice.supplierId || typeof notice.supplierId !== 'string') {
    reject(400, 'Supplier ID is required.');
  }

  if (!notice.rawDescription || typeof notice.rawDescription !== 'string' || !notice.rawDescription.trim()) {
    reject(400, 'Raw description is required.');
  }

  if (!notice.uploadedByUserId || notice.uploadedByUserId !== user.id) {
    reject(403, 'Uploader identity mismatch: uploadedByUserId must match authenticated user.');
  }

  if (notice.status !== 'PENDING') {
    reject(403, `Notice cannot be created with status "${notice.status}". Must be "PENDING".`);
  }

  return notice as NewItemNotice;
}

/**
 * 4. Validate New Item Notice Resolution
 */
export function validateNewItemNoticeResolution(
  user: AuthenticatedUser,
  currentNotice: NewItemNotice,
  update: Partial<NewItemNotice>
): NewItemNotice {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to resolve new item notices.');
  }

  if (currentNotice.status !== 'PENDING') {
    reject(
      409,
      `New item notice is already finalized as "${currentNotice.status}" and cannot be resolved again.`
    );
  }

  if (!canManageNewItems(user)) {
    reject(403, 'You do not have permission to resolve new item notices.');
  }

  const newStatus = update.status;
  if (!newStatus || !['ADDED', 'LINKED', 'REJECTED'].includes(newStatus)) {
    reject(400, `Resolution status must be ADDED, LINKED, or REJECTED, got: ${newStatus}`);
  }

  if (!update.reviewedByUserId || update.reviewedByUserId !== user.id) {
    reject(403, 'Reviewer identity mismatch: reviewedByUserId must match authenticated user.');
  }

  if (newStatus === 'ADDED' && !update.createdProductId) {
    reject(400, 'Created product ID is required when adding a new item to catalogue.');
  }

  if (newStatus === 'LINKED' && !update.linkedProductId) {
    reject(400, 'Linked product ID is required when linking to an existing catalogue item.');
  }

  if (newStatus === 'REJECTED' && (!update.rejectionReason || !update.rejectionReason.trim())) {
    reject(400, 'Rejection reason is required when rejecting a new item notice.');
  }

  // Core detection immutability
  if (update.id && update.id !== currentNotice.id) {
    reject(403, 'Notice ID cannot be changed.');
  }
  if (update.supplierId && update.supplierId !== currentNotice.supplierId) {
    reject(403, 'Supplier ID cannot be altered during resolution.');
  }
  if (update.rawDescription && update.rawDescription !== currentNotice.rawDescription) {
    reject(403, 'Detected description cannot be altered during resolution.');
  }

  return {
    ...currentNotice,
    ...update,
    status: newStatus,
  } as NewItemNotice;
}

/**
 * 5. Validate Global Settings Updates
 * Restricts system-wide settings (role permissions, price monitoring, email transport)
 * to General Managers and Creators.
 */
export function validateGlobalSettingsUpdate(
  user: AuthenticatedUser,
  settingDocId: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to modify settings.');
  }

  const globalSettingDocs = new Set([
    'role_permissions',
    'price_monitoring',
    'email_config',
    'system_settings',
  ]);

  if (globalSettingDocs.has(settingDocId)) {
    if (!canManageGlobalSettings(user)) {
      reject(403, `Only General Managers and Creators can modify global "${settingDocId}" settings.`);
    }
  }

  // If modifying role_permissions, enforce that the caller cannot grant themselves roles above their own
  if (settingDocId === 'role_permissions' && user.role !== 'CREATOR') {
    if (user.role !== 'GM') {
      reject(403, 'Only Administrators can update role permissions.');
    }
  }

  return data;
}

/**
 * 6. Validate Price History Audit Record
 * Append-only audit record creation.
 */
export function validatePriceHistoryCreation(
  user: AuthenticatedUser,
  record: Partial<PriceHistoryRecord>
): PriceHistoryRecord {
  if (!user || user.active !== true) {
    reject(403, 'Active user account required to record price history.');
  }

  if (!canApprovePriceChanges(user)) {
    reject(403, 'Only authorized reviewers can create price history audit records.');
  }

  if (!record.id || typeof record.id !== 'string') {
    reject(400, 'Price history record ID is required.');
  }

  if (!record.productId || typeof record.productId !== 'string') {
    reject(400, 'Product ID is required.');
  }

  if (!record.approvedByUserId || record.approvedByUserId !== user.id) {
    reject(403, 'Audit record author must match authenticated reviewer.');
  }

  if (!record.effectiveDate || typeof record.effectiveDate !== 'string') {
    reject(400, 'Effective date is required on price history records.');
  }

  return record as PriceHistoryRecord;
}
