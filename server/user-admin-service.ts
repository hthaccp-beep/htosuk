import {menuAccessChangeError} from './menu-access-guard.ts';
/**
 * Core User Administration Service & Authorization Engine
 *
 * Implements strict server-side authorization and multi-step transaction handling
 * for creating, updating, deactivating, reactivating, reordering, and deleting user accounts.
 *
 * Designed to be testable with synthetic mocks without calling live Firebase.
 */

export type Role = 'CREATOR' | 'GM' | 'MANAGER' | 'STAFF';

export interface UserDoc {
  id: string;
  username: string;
  displayName: string;
  role: Role | string;
  branchId: string;
  active: boolean;
  displayOrder?: number;
  allDepartments?: boolean;
  departmentIds?: string[];
  allBranches?: boolean;
  branchIds?: string[];
  allSuppliers?: boolean;
  supplierIds?: string[];
  permissionMode?: 'INHERITED' | 'CUSTOM' | string;
  customPermissions?: string[];
  updatedAt?: string;
  updatedBy?: string;
  [key: string]: unknown;
}

export interface UserAdminRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface UserAdminResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): UserAdminResponse;
  json(data: unknown): unknown;
  end(): unknown;
}

export interface UserAdminDependencies {
  verifyToken(token: string): Promise<{ uid: string }>;
  getUser(uid: string): Promise<UserDoc | undefined>;
  getBranch?(branchId: string): Promise<Record<string, unknown> | undefined>;
  createUserAuth(params: { email: string; password?: string; displayName?: string }): Promise<{ uid: string }>;
  updateUserAuth(uid: string, params: { email?: string; password?: string; displayName?: string; disabled?: boolean }): Promise<void>;
  revokeUserTokens?(uid: string): Promise<void>;
  deleteUserAuth(uid: string): Promise<void>;
  createUserProfile(uid: string, data: UserDoc): Promise<void>;
  updateUserProfile(uid: string, data: Partial<UserDoc>, expectedVersion?: { role?: string; branchId?: string }): Promise<void>;
  deleteUserProfile(uid: string): Promise<void>;
  saveUserOrder?(requesterUid: string, items: Array<{id: string; displayOrder: number; expectedDisplayOrder: number}>, timestamp: string): Promise<void>;
  now?: () => Date;
}

export class UserAdminError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'UserAdminError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status: number, message: string, code?: string): never => {
  throw new UserAdminError(status, message, code);
};

export const RECOGNIZED_ROLES = new Set<Role>(['CREATOR', 'GM', 'MANAGER', 'STAFF']);
const EMAIL_REGEX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Authorization Matrix Validation:
 * Validates whether `requester` has permission to manage a target account
 * with `currentRole`/`currentBranch` changing to `newRole`/`newBranch`.
 */
export function checkUserAdminPermission(
  requester: UserDoc,
  targetId: string,
  currentTarget: { role: string; branchId?: string; active?: boolean; allBranches?: boolean; branchIds?: string[] },
  newTarget?: { role?: string; branchId?: string; active?: boolean; allBranches?: boolean; branchIds?: string[] },
  action: 'create' | 'update' | 'delete' | 'reorder' = 'update'
): void {
  // 1. Requester must be active and have a known administrative role
  if (requester.active !== true) {
    fail(403, 'Inactive users cannot administer user accounts.');
  }

  const requesterRole = requester.role as Role;
  if (!RECOGNIZED_ROLES.has(requesterRole) || requesterRole === 'STAFF') {
    fail(403, 'You do not have permission to administer user accounts.');
  }

  const isSelf = requester.id === targetId;

  // 2. Self-Operation Constraints
  if (isSelf) {
    if (action === 'delete') {
      fail(400, 'You cannot delete your own account through account administration.');
    }
    if (newTarget) {
      if (newTarget.role !== undefined && newTarget.role !== requester.role) {
        fail(403, 'You cannot change your own role.');
      }
      if (newTarget.active !== undefined && newTarget.active !== requester.active) {
        fail(403, 'You cannot change your own active status.');
      }
      if (requester.role !== 'CREATOR' && newTarget.branchId !== undefined && (newTarget.branchId || '') !== (requester.branchId || '')) {
        fail(403, 'You cannot change your own branch.');
      }
    }
    // Valid self-service updates (such as displayName or password) are permitted
    if (action === 'update') {
      return;
    }
  }

  // 3. Target CREATOR Protection
  if (action !== 'create' && currentTarget.role === 'CREATOR') {
    if (action === 'delete') {
      fail(403, 'CREATOR accounts cannot be modified or deleted through account administration.');
    }
    if (requesterRole !== 'CREATOR') {
      fail(403, 'CREATOR accounts cannot be modified or deleted through account administration.');
    }
    if (newTarget) {
      if (newTarget.role !== undefined && newTarget.role !== 'CREATOR') {
        fail(403, 'CREATOR accounts cannot be demoted.');
      }
      if (newTarget.active !== undefined && newTarget.active === false) {
        fail(403, 'CREATOR accounts cannot be deactivated.');
      }
    }
    if (action === 'update' || action === 'reorder') {
      return;
    }
  }

  // 4. Assigning CREATOR Protection
  if (newTarget?.role === 'CREATOR' && currentTarget.role !== 'CREATOR') {
    fail(403, 'Assigning the CREATOR role is not permitted through account administration.');
  }

  // 5. Role Hierarchy Enforcement
  const effectiveNewRole = newTarget?.role || currentTarget.role;
  const effectiveNewBranch = newTarget?.branchId !== undefined ? newTarget.branchId : (currentTarget.branchId || '');
  const currentBranch = currentTarget.branchId || '';

  if (requesterRole === 'CREATOR') {
    // CREATOR can manage GM, MANAGER, and STAFF
    if (action !== 'create') {
      if (!['GM', 'MANAGER', 'STAFF'].includes(currentTarget.role)) {
        fail(403, `Cannot manage accounts with role "${currentTarget.role}".`);
      }
    }
    if (!['GM', 'MANAGER', 'STAFF'].includes(effectiveNewRole)) {
      fail(403, `Cannot assign role "${effectiveNewRole}".`);
    }
    return;
  }

  if (requesterRole === 'GM') {
    // GM cannot manage CREATOR or other GM accounts
    if (action !== 'create') {
      if (!['MANAGER', 'STAFF'].includes(currentTarget.role)) {
        fail(403, `General Managers cannot manage accounts with role "${currentTarget.role}".`);
      }
    }
    if (!['MANAGER', 'STAFF'].includes(effectiveNewRole)) {
      fail(403, `General Managers cannot assign role "${effectiveNewRole}".`);
    }
    return;
  }

  if (requesterRole === 'MANAGER') {
    // MANAGER can only manage STAFF in their own valid branch
    const managerBranch = requester.branchId?.trim();
    if (!managerBranch) {
      fail(403, 'A Manager must be assigned to a valid branch to administer accounts.');
    }

    if (action !== 'create') {
      if (currentTarget.role !== 'STAFF') {
        fail(403, `Managers can only manage Staff accounts, not "${currentTarget.role}".`);
      }
      if (currentBranch !== managerBranch) {
        fail(403, 'Managers can only manage accounts within their own branch.');
      }
      if (currentTarget.allBranches === true || (Array.isArray(currentTarget.branchIds) && currentTarget.branchIds.some(b => b !== managerBranch))) {
        fail(403, 'Managers cannot manage multi-branch accounts covering other branches.');
      }
    }

    if (effectiveNewRole !== 'STAFF') {
      fail(403, `Managers cannot promote accounts to "${effectiveNewRole}".`);
    }

    if (effectiveNewBranch !== managerBranch) {
      fail(403, 'Managers cannot assign accounts to other branches.');
    }

    if (newTarget?.allBranches === true || (Array.isArray(newTarget?.branchIds) && newTarget.branchIds.some(b => b !== managerBranch))) {
      fail(403, 'Managers cannot assign accounts to other branches.');
    }
    return;
  }

  fail(403, 'Unauthorized administrative action.');
}

/**
 * Validates email string format and length
 */
export function validateUserEmail(email: unknown): string {
  if (typeof email !== 'string' || !email.trim() || email.length > 254) {
    return fail(400, 'A valid email address is required.');
  }
  const clean = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(clean)) {
    return fail(400, 'Invalid email address format.');
  }
  return clean;
}

/**
 * Validates password strength & size
 */
export function validateUserPassword(password: unknown, required = false): string | undefined {
  if (password === undefined || password === null) {
    if (required) return fail(400, 'Password is required.');
    return undefined;
  }
  if (typeof password !== 'string') {
    return fail(400, 'Password must be a string.');
  }
  const trimmed = password.trim();
  if (required && trimmed.length < 6) {
    return fail(400, 'Password must be at least 6 characters long.');
  }
  if (trimmed.length > 4096) {
    return fail(400, 'Password cannot exceed 4096 characters.');
  }
  return trimmed || undefined;
}

/**
 * Validates display name
 */
export function validateDisplayName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    return fail(400, 'Display name is required.');
  }
  const clean = name.trim();
  if (clean.length > 100) {
    return fail(400, 'Display name cannot exceed 100 characters.');
  }
  return clean;
}

/**
 * Validates role string
 */
export function validateRole(role: unknown): Role {
  if (typeof role !== 'string' || !RECOGNIZED_ROLES.has(role as Role)) {
    return fail(400, `Role must be one of: ${Array.from(RECOGNIZED_ROLES).join(', ')}.`);
  }
  return role as Role;
}

/**
 * Main HTTP Handler Factory for User Account Administration
 */
export function createUserAdminHandler(deps: UserAdminDependencies) {
  return async (req: UserAdminRequest, res: UserAdminResponse): Promise<unknown> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');

    // CORS preflight handling
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
      // 1. Authenticate Request
      const authHeader = req.headers.authorization;
      if (typeof authHeader !== 'string' || !/^Bearer \S+$/.test(authHeader)) {
        return fail(401, 'Sign in with an authorized administrator account.');
      }
      const token = authHeader.slice(7);

      let requesterUid: string;
      try {
        const decoded = await deps.verifyToken(token);
        requesterUid = decoded.uid;
      } catch (err: any) {
        if (
          err?.code === 8 ||
          err?.status === 503 ||
          err?.code === 'RESOURCE_EXHAUSTED' ||
          err?.message?.includes('RESOURCE_EXHAUSTED')
        ) {
          return res.status(503).json({
            error: 'Firestore database service quota is currently exhausted. Please try again shortly.',
            code: 'quota/resource-exhausted'
          });
        }
        if (err?.code === 'auth/id-token-expired') {
          return fail(401, 'Your sign-in has expired. Please sign in again.');
        }
        if (err?.code === 'auth/id-token-revoked') {
          return fail(401, 'Your sign-in session was revoked. Please sign in again.');
        }
        if (
          err?.code === 'auth/internal-error' ||
          err?.code === 'auth/no-admin-credentials' ||
          err?.message?.includes('serviceUsageConsumer') ||
          err?.message?.includes('USER_PROJECT_DENIED') ||
          err?.message?.includes('Caller does not have required permission')
        ) {
          console.warn('Backend server credentials unavailable on host:', err?.message);
          return res.status(503).json({
            error: 'Server credentials unavailable on host. Client will execute operation directly.',
            code: 'auth/no-admin-credentials'
          });
        }
        return fail(401, 'Your sign-in has expired or was revoked. Please sign in again.');
      }

      // 2. Fetch Requester Profile
      const requester = await deps.getUser(requesterUid);
      if (!requester) {
        return fail(403, 'Requester account profile not found.');
      }
      if (requester.active !== true) {
        return fail(403, 'Inactive accounts cannot perform user administration.');
      }

      // 3. Parse and Validate Request Payload
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return fail(400, 'Invalid request body.');
      }

      const { action, data } = body as { action?: unknown; data?: unknown };
      if (typeof action !== 'string' || !['create', 'update', 'delete', 'reorder'].includes(action)) {
        return fail(400, 'Invalid action. Allowed actions: create, update, delete, reorder.');
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return fail(400, 'Action data is required.');
      }

      const timestamp = (deps.now || (() => new Date()))().toISOString();

      // ==========================================
      // ACTION: CREATE
      // ==========================================
      if (action === 'create') {
        const createData = data as Record<string, unknown>;
        const allowedKeys = new Set([
          'email', 'password', 'displayName', 'role', 'branchId', 'active', 'displayOrder',
          'allDepartments', 'departmentIds', 'allBranches', 'branchIds', 'allSuppliers', 'supplierIds', 'permissionMode', 'customPermissions'
        ]);
        for (const k of Object.keys(createData)) {
          if (!allowedKeys.has(k)) return fail(400, `Unexpected field in create request: ${k}`);
        }

        const email = validateUserEmail(createData.email);
        const password = validateUserPassword(createData.password, true)!;
        const displayName = validateDisplayName(createData.displayName);
        const role = validateRole(createData.role);
        const branchId = typeof createData.branchId === 'string' ? createData.branchId.trim() : '';
        const active = createData.active !== undefined ? Boolean(createData.active) : true;
        const displayOrder = typeof createData.displayOrder === 'number' ? createData.displayOrder : 0;
        const allDepartments = createData.allDepartments !== undefined ? Boolean(createData.allDepartments) : undefined;
        const departmentIds = Array.isArray(createData.departmentIds) ? (createData.departmentIds as string[]) : undefined;
        const allBranches = createData.allBranches !== undefined ? Boolean(createData.allBranches) : undefined;
        const branchIds = Array.isArray(createData.branchIds) ? (createData.branchIds as string[]) : undefined;
        const allSuppliers = createData.allSuppliers !== undefined ? Boolean(createData.allSuppliers) : undefined;
        const supplierIds = Array.isArray(createData.supplierIds) ? (createData.supplierIds as string[]) : undefined;
        const permissionMode = typeof createData.permissionMode === 'string' ? createData.permissionMode : undefined;
        const customPermissions = Array.isArray(createData.customPermissions) ? (createData.customPermissions as string[]) : undefined;

        // Check Permissions
        checkUserAdminPermission(
          requester,
          'NEW_USER',
          { role: 'STAFF', branchId },
          { role, branchId, active, allBranches, branchIds },
          'create'
        );

        const menuAccessError = menuAccessChangeError(requester, null, createData);
        if (menuAccessError) return fail(403, menuAccessError);

        // Multi-Step Execution with Compensation
        let createdAuthUid: string | null = null;
        try {
          // Step 1: Create Auth user
          const authResult = await deps.createUserAuth({
            email,
            password,
            displayName,
          });
          createdAuthUid = authResult.uid;

          const isEnterpriseRole = role === 'CREATOR' || role === 'GM';
          // Step 2: Create Firestore Profile
          const profileDoc: UserDoc = {
            id: createdAuthUid,
            username: email,
            displayName,
            role,
            branchId,
            active,
            displayOrder,
            allDepartments: isEnterpriseRole ? true : (allDepartments ?? true),
            departmentIds: departmentIds ?? [],
            allBranches: isEnterpriseRole ? true : (allBranches ?? false),
            branchIds: branchIds ?? [],
            allSuppliers: isEnterpriseRole ? true : (allSuppliers ?? true),
            supplierIds: supplierIds ?? [],
            permissionMode: permissionMode ?? (customPermissions && customPermissions.length > 0 ? 'CUSTOM' : 'INHERITED'),
            customPermissions: customPermissions ?? [],
            updatedAt: timestamp,
            updatedBy: requesterUid,
          };
          for (const key of Object.keys(profileDoc) as Array<keyof UserDoc>) {
            if (profileDoc[key] === undefined) {
              delete profileDoc[key];
            }
          }
          await deps.createUserProfile(createdAuthUid, profileDoc);

          return res.status(200).json({
            success: true,
            uid: createdAuthUid,
            message: `User ${displayName} created successfully.`,
          });
        } catch (stepErr: any) {
          // Compensation: If Firestore profile creation failed after Auth user was created,
          // safely delete the Auth user so we don't leave an active orphan account!
          if (createdAuthUid) {
            try {
              await deps.deleteUserAuth(createdAuthUid);
            } catch (cleanupErr) {
              console.error('Failed to cleanup orphan auth user:', createdAuthUid, cleanupErr);
            }
          }
          throw stepErr;
        }
      }

      // ==========================================
      // ACTION: UPDATE
      // ==========================================
      if (action === 'update') {
        const updateData = data as Record<string, unknown>;
        const allowedKeys = new Set([
          'id', 'email', 'password', 'displayName', 'role', 'branchId', 'active', 'displayOrder',
          'allDepartments', 'departmentIds', 'allBranches', 'branchIds', 'allSuppliers', 'supplierIds', 'permissionMode', 'customPermissions'
        ]);
        for (const k of Object.keys(updateData)) {
          if (!allowedKeys.has(k)) return fail(400, `Unexpected field in update request: ${k}`);
        }

        const targetId = typeof updateData.id === 'string' ? updateData.id.trim() : '';
        if (!targetId) return fail(400, 'Target user ID is required for updates.');

        // Load existing target
        const existingTarget = await deps.getUser(targetId);
        if (!existingTarget) {
          return fail(404, 'The target user was not found.');
        }

        // Validate any updated fields
        const newDisplayName = updateData.displayName !== undefined ? validateDisplayName(updateData.displayName) : undefined;
        const newPassword = updateData.password !== undefined ? validateUserPassword(updateData.password, false) : undefined;
        const newRole = updateData.role !== undefined ? validateRole(updateData.role) : undefined;
        const newBranchId = updateData.branchId !== undefined ? String(updateData.branchId).trim() : undefined;
        const newActive = updateData.active !== undefined ? Boolean(updateData.active) : undefined;
        const newDisplayOrder = typeof updateData.displayOrder === 'number' ? updateData.displayOrder : undefined;
        const newAllDepartments = updateData.allDepartments !== undefined ? Boolean(updateData.allDepartments) : undefined;
        const newDepartmentIds = Array.isArray(updateData.departmentIds) ? (updateData.departmentIds as string[]) : undefined;
        const newAllBranches = updateData.allBranches !== undefined ? Boolean(updateData.allBranches) : undefined;
        const newBranchIds = Array.isArray(updateData.branchIds) ? (updateData.branchIds as string[]) : undefined;
        const newAllSuppliers = updateData.allSuppliers !== undefined ? Boolean(updateData.allSuppliers) : undefined;
        const newSupplierIds = Array.isArray(updateData.supplierIds) ? (updateData.supplierIds as string[]) : undefined;
        const newPermissionMode = typeof updateData.permissionMode === 'string' ? updateData.permissionMode : undefined;
        const newCustomPermissions = Array.isArray(updateData.customPermissions) ? (updateData.customPermissions as string[]) : undefined;

        // Check Permissions for both existing target and resulting target state
        checkUserAdminPermission(
          requester,
          targetId,
          {
            role: existingTarget.role,
            branchId: existingTarget.branchId,
            active: existingTarget.active,
            allBranches: existingTarget.allBranches,
            branchIds: existingTarget.branchIds,
          },
          {
            role: newRole,
            branchId: newBranchId,
            active: newActive,
            allBranches: newAllBranches,
            branchIds: newBranchIds,
          },
          'update'
        );

        const menuAccessError = menuAccessChangeError(requester, existingTarget, updateData);
        if (menuAccessError) return fail(403, menuAccessError);

        // Step 1: Update Auth credentials (if password or displayName provided)
        const authUpdates: { password?: string; displayName?: string } = {};
        if (newPassword) authUpdates.password = newPassword;
        if (newDisplayName && newDisplayName !== existingTarget.displayName) authUpdates.displayName = newDisplayName;

        if (Object.keys(authUpdates).length > 0) {
          await deps.updateUserAuth(targetId, authUpdates);
        }

        // Step 2: Handle Explicit Account Deactivation or Reactivation Lifecycle
        let lifecycleWarning: string | undefined;

        if (newActive !== undefined && newActive !== existingTarget.active) {
          if (newActive === false) {
            // DEACTIVATION LIFECYCLE:
            // 1. Mark profile inactive in Firestore first (blocks database & API access immediately).
            const deactivePatch: Partial<UserDoc> = {
              active: false,
              updatedAt: timestamp,
              updatedBy: requesterUid,
            };
            if (newDisplayName !== undefined) deactivePatch.displayName = newDisplayName;
            if (newRole !== undefined) deactivePatch.role = newRole;
            if (newBranchId !== undefined) deactivePatch.branchId = newBranchId;
            if (newDisplayOrder !== undefined) deactivePatch.displayOrder = newDisplayOrder;

            await deps.updateUserProfile(targetId, deactivePatch, {
              role: existingTarget.role,
              branchId: existingTarget.branchId,
            });

            // 2. Disable Firebase Authentication account & revoke refresh tokens.
            try {
              await deps.updateUserAuth(targetId, { disabled: true });
              if (deps.revokeUserTokens) {
                await deps.revokeUserTokens(targetId);
              }
            } catch (authErr: any) {
              // Access remains blocked in Firestore; report incomplete Auth cleanup truthfully.
              console.error('Failed to disable Auth user during deactivation:', authErr);
              lifecycleWarning = 'User profile was marked inactive, but disabling Firebase Auth credentials encountered an issue. Account access remains blocked.';
            }

            return res.status(200).json({
              success: true,
              uid: targetId,
              warning: lifecycleWarning,
              message: lifecycleWarning || 'User account deactivated and active sessions revoked.',
            });
          } else {
            // REACTIVATION LIFECYCLE:
            // 1. Re-enable Firebase Authentication account.
            await deps.updateUserAuth(targetId, { disabled: false });

            // 2. Revoke previous tokens so old sessions cannot resume without fresh sign-in.
            if (deps.revokeUserTokens) {
              await deps.revokeUserTokens(targetId);
            }

            // 3. Mark profile active in Firestore.
            const reactivePatch: Partial<UserDoc> = {
              active: true,
              updatedAt: timestamp,
              updatedBy: requesterUid,
            };
            if (newDisplayName !== undefined) reactivePatch.displayName = newDisplayName;
            if (newRole !== undefined) reactivePatch.role = newRole;
            if (newBranchId !== undefined) reactivePatch.branchId = newBranchId;
            if (newDisplayOrder !== undefined) reactivePatch.displayOrder = newDisplayOrder;

            try {
              await deps.updateUserProfile(targetId, reactivePatch, {
                role: existingTarget.role,
                branchId: existingTarget.branchId,
              });
            } catch (profileErr: any) {
              // Compensation: Re-disable Auth if Firestore update fails so we don't leave Auth active while profile is inactive
              try {
                await deps.updateUserAuth(targetId, { disabled: true });
                if (deps.revokeUserTokens) await deps.revokeUserTokens(targetId);
              } catch (_) {}
              throw profileErr;
            }

            return res.status(200).json({
              success: true,
              uid: targetId,
              message: 'User account reactivated. The user must sign in with fresh credentials.',
            });
          }
        }

        // Step 3: Standard Profile Patch (active status unchanged)
        const profilePatch: Partial<UserDoc> = {
          updatedAt: timestamp,
          updatedBy: requesterUid,
        };
        if (newDisplayName !== undefined) profilePatch.displayName = newDisplayName;
        if (newRole !== undefined) profilePatch.role = newRole;
        if (newBranchId !== undefined) profilePatch.branchId = newBranchId;
        if (newDisplayOrder !== undefined) profilePatch.displayOrder = newDisplayOrder;
        if (newAllDepartments !== undefined) profilePatch.allDepartments = newAllDepartments;
        if (newDepartmentIds !== undefined) profilePatch.departmentIds = newDepartmentIds;
        if (newAllBranches !== undefined) profilePatch.allBranches = newAllBranches;
        if (newBranchIds !== undefined) profilePatch.branchIds = newBranchIds;
        if (newAllSuppliers !== undefined) profilePatch.allSuppliers = newAllSuppliers;
        if (newSupplierIds !== undefined) profilePatch.supplierIds = newSupplierIds;
        if (newPermissionMode !== undefined) {
          profilePatch.permissionMode = newPermissionMode;
        } else if (existingTarget.permissionMode === undefined && newCustomPermissions !== undefined) {
          profilePatch.permissionMode = newCustomPermissions.length > 0 ? 'CUSTOM' : 'INHERITED';
        }
        if (newCustomPermissions !== undefined) profilePatch.customPermissions = newCustomPermissions;

        // Concurrency guard: verify target didn't change concurrently
        await deps.updateUserProfile(targetId, profilePatch, {
          role: existingTarget.role,
          branchId: existingTarget.branchId,
        });

        return res.status(200).json({
          success: true,
          uid: targetId,
          message: 'User account updated successfully.',
        });
      }

      // ==========================================
      // ACTION: DELETE
      // ==========================================
      if (action === 'delete') {
        const deleteData = data as Record<string, unknown>;
        const targetId = typeof deleteData.id === 'string' ? deleteData.id.trim() : '';
        if (!targetId) return fail(400, 'Target user ID is required for deletion.');

        const existingTarget = await deps.getUser(targetId);
        if (!existingTarget) {
          return fail(404, 'The target user was not found.');
        }

        checkUserAdminPermission(
          requester,
          targetId,
          { role: existingTarget.role, branchId: existingTarget.branchId, active: existingTarget.active },
          undefined,
          'delete'
        );

        // Multi-Step Safe Delete:
        // 1. Block access first by marking inactive in Firestore and disabling Auth + revoking tokens
        try {
          await deps.updateUserProfile(targetId, {
            active: false,
            updatedAt: timestamp,
            updatedBy: requesterUid,
          });
        } catch (_) {}

        try {
          await deps.updateUserAuth(targetId, { disabled: true });
          if (deps.revokeUserTokens) await deps.revokeUserTokens(targetId);
        } catch (_) {}

        // 2. Delete Firestore profile
        await deps.deleteUserProfile(targetId);

        // 3. Delete Firebase Auth user
        let authCleanupWarning: string | undefined;
        try {
          await deps.deleteUserAuth(targetId);
        } catch (authErr: any) {
          if (authErr?.code !== 'auth/user-not-found') {
            console.warn('User profile deleted, but auth deletion encountered error:', authErr?.message);
            authCleanupWarning = 'User profile deleted and access blocked, but Auth account cleanup encountered an issue.';
          }
        }

        return res.status(200).json({
          success: true,
          uid: targetId,
          warning: authCleanupWarning,
          message: authCleanupWarning || 'User account deleted successfully.',
        });
      }

      // ==========================================
      // ACTION: REORDER
      // ==========================================
      if (action === 'reorder') {
        const reorderData = data as { items?: Array<{ id: string; displayOrder: number }> };
        if (!reorderData || !Array.isArray(reorderData.items) || reorderData.items.length === 0 || reorderData.items.length > 400) {
          return fail(400, 'Supply between 1 and 400 user positions.');
        }
        const ids = new Set<string>();
        for (const item of reorderData.items) {
          if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.includes('/') || !Number.isFinite(item.displayOrder) || ids.has(item.id)) {
            return fail(400, 'Each user position must have a unique ID and a finite display order.');
          }
          ids.add(item.id);
        }
        const changes: Array<{id: string; displayOrder: number; expectedDisplayOrder: number}> = [];
        for (const item of reorderData.items) {
          const target = await deps.getUser(item.id);
          if (!target) return fail(409, 'The user list has changed. Reload it and try again.');

          checkUserAdminPermission(
            requester,
            item.id,
            target,
            undefined,
            'reorder'
          );

          changes.push({id: item.id, displayOrder: item.displayOrder, expectedDisplayOrder: target.displayOrder || 0});
        }
        if (!deps.saveUserOrder) return fail(503, 'Saving user order is unavailable. Please try again later.');
        await deps.saveUserOrder(requesterUid, changes, timestamp);

        return res.status(200).json({ success: true, message: 'Display order updated.' });
      }

      return fail(400, 'Unsupported action.');
    } catch (err: any) {
      if (err instanceof UserAdminError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      if (err?.code === 'auth/email-already-exists') {
        return res.status(400).json({ error: 'This email address is already registered.' });
      }
      if (err?.code === 'auth/invalid-email') {
        return res.status(400).json({ error: 'Invalid email address.' });
      }
      if (err?.code === 'auth/weak-password') {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }
      if (
        err?.code === 8 ||
        err?.status === 503 ||
        err?.code === 'RESOURCE_EXHAUSTED' ||
        err?.message?.includes('RESOURCE_EXHAUSTED')
      ) {
        console.warn('User Admin Service Quota Exhausted:', err?.message);
        return res.status(503).json({
          error: 'Firestore database service quota is currently exhausted. Please try again shortly.',
          code: 'quota/resource-exhausted'
        });
      }
      console.error('Unhandled User Admin Service Error:', err);
      return res.status(500).json({ error: err?.message || 'An error occurred while managing the user account.' });
    }
  };
}
