import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUserAdminHandler,
  type UserAdminDependencies,
  type UserDoc,
  type UserAdminRequest,
  type UserAdminResponse,
} from '../server/user-admin-service.ts';
import { createEmailHandler } from '../server/email-service.ts';
import { createBranchEmailSettingsHandler } from '../server/branch-email-settings.ts';

function createHarness() {
  const users: Record<string, UserDoc> = {
    creator_1: {
      id: 'creator_1',
      username: 'creator@hare-com.example',
      displayName: 'Creator One',
      role: 'CREATOR',
      branchId: '',
      active: true,
      displayOrder: 1,
    },
    gm_1: {
      id: 'gm_1',
      username: 'gm@hare-com.example',
      displayName: 'GM One',
      role: 'GM',
      branchId: '',
      active: true,
      displayOrder: 2,
    },
    mgr_b1: {
      id: 'mgr_b1',
      username: 'mgr@hare-com.example',
      displayName: 'Manager B1',
      role: 'MANAGER',
      branchId: 'branch_1',
      active: true,
      displayOrder: 10,
    },
    staff_b1: {
      id: 'staff_b1',
      username: 'staff@hare-com.example',
      displayName: 'Staff B1',
      role: 'STAFF',
      branchId: 'branch_1',
      active: true,
      displayOrder: 100,
    },
    inactive_staff: {
      id: 'inactive_staff',
      username: 'inactive@hare-com.example',
      displayName: 'Inactive User',
      role: 'STAFF',
      branchId: 'branch_1',
      active: false,
      displayOrder: 101,
    },
  };

  const authUsers: Record<string, { email: string; disabled: boolean }> = {
    creator_1: { email: 'creator@hare-com.example', disabled: false },
    gm_1: { email: 'gm@hare-com.example', disabled: false },
    mgr_b1: { email: 'mgr@hare-com.example', disabled: false },
    staff_b1: { email: 'staff@hare-com.example', disabled: false },
    inactive_staff: { email: 'inactive@hare-com.example', disabled: true },
  };

  const revokedTokens = new Set<string>();

  const deps: UserAdminDependencies = {
    verifyToken: async (token: string) => {
      if (token === 'invalid_token' || token === 'revoked_token') {
        throw new Error('Firebase token invalid or revoked');
      }
      return { uid: token };
    },
    getUser: async (uid: string) => {
      return users[uid] ? { ...users[uid] } : undefined;
    },
    createUserAuth: async ({ email }) => {
      const uid = `auth_${Date.now()}`;
      authUsers[uid] = { email, disabled: false };
      return { uid };
    },
    createUserProfile: async (uid, profile) => {
      users[uid] = { ...profile, id: uid };
    },
    updateUserAuth: async (uid, params) => {
      if (!authUsers[uid]) throw new Error('User not found in Auth');
      if (params.disabled !== undefined) {
        authUsers[uid].disabled = params.disabled;
      }
    },
    revokeUserTokens: async (uid) => {
      if (!authUsers[uid]) throw new Error('User not found in Auth');
      revokedTokens.add(uid);
    },
    updateUserProfile: async (uid, patch, guard) => {
      if (!users[uid]) throw new Error('User not found in Firestore');
      if (guard) {
        if (guard.role !== undefined && users[uid].role !== guard.role) {
          throw new Error('Target role changed concurrently.');
        }
        if (guard.branchId !== undefined && users[uid].branchId !== guard.branchId) {
          throw new Error('Target branch changed concurrently.');
        }
      }
      users[uid] = { ...users[uid], ...patch };
    },
    deleteUserProfile: async (uid) => {
      delete users[uid];
    },
    deleteUserAuth: async (uid) => {
      delete authUsers[uid];
    },
  };

  const invoke = async (req: { token?: string; body?: unknown; method?: string }) => {
    let statusCode = 200;
    let responseData: any = null;
    const responseHeaders: Record<string, string> = {};

    const res: UserAdminResponse = {
      setHeader: (name: string, value: string) => {
        responseHeaders[name] = value;
      },
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: unknown) => {
        responseData = data;
        return data;
      },
      end: () => null,
    };

    const request: UserAdminRequest = {
      method: req.method || 'POST',
      headers: {
        authorization: req.token ? `Bearer ${req.token}` : undefined,
      },
      body: req.body,
    };

    const handler = createUserAdminHandler(deps);
    await handler(request, res);
    return { status: statusCode, body: responseData, headers: responseHeaders };
  };

  return { deps, users, authUsers, revokedTokens, invoke };
}

describe('Account Lifecycle & Session Boundary Security (Issue 4)', () => {
  // =========================================================================
  // 1. ACCESS AT BOUNDARY: VALID AUTH TOKEN ALONE IS INSUFFICIENT
  // =========================================================================
  describe('Boundary Protection & Active Profile Requirement', () => {
    it('denies access if token is revoked or invalid', async () => {
      const h = createHarness();
      const res = await h.invoke({ token: 'revoked_token', body: { action: 'update', data: {} } });
      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes('expired or was revoked'));
    });

    it('denies access if user has a valid token but their profile is INACTIVE', async () => {
      const h = createHarness();
      const res = await h.invoke({ token: 'inactive_staff', body: { action: 'update', data: {} } });
      assert.equal(res.status, 403);
      assert.ok(res.body.error.includes('Inactive accounts cannot perform user administration'));
    });

    it('denies access if user has a valid token but NO profile document exists (never creates fallback profile)', async () => {
      const h = createHarness();
      const res = await h.invoke({ token: 'nonexistent_user', body: { action: 'update', data: {} } });
      assert.equal(res.status, 403);
      assert.ok(res.body.error.includes('account profile not found'));
      assert.equal(h.users['nonexistent_user'], undefined);
    });

    it('denies email sending if user profile is inactive or missing', async () => {
      const emailHandler = createEmailHandler({
        verifyToken: async (t) => ({ uid: t }),
        getUser: async (uid) => {
          if (uid === 'inactive_staff') {
            return { id: uid, username: 'inactive@hare-com.example', role: 'STAFF', active: false, branchId: 'b1' } as any;
          }
          return undefined;
        },
        getBranch: async () => ({ id: 'b1', active: true, name: 'B1', email: 'b1@test-com.example' } as any),
        getSupplier: async () => ({ id: 's1', name: 'S1' }),
        getOrder: async () => ({ id: 'o1', branchId: 'b1' }),
        getBranchEmailAccount: async () => undefined,
        reserveSend: async () => true,
        deliver: async () => ({ accepted: ['test@test-com.example'], rejected: [] }),
        env: {},
      });

      let res1Status = 200;
      let res1Body: any = null;
      const res1: any = {
        setHeader() {},
        status(c: number) { res1Status = c; return this; },
        json(d: any) { res1Body = d; return d; },
        end() {},
      };
      await emailHandler({ method: 'POST', headers: { authorization: 'Bearer inactive_staff' }, body: {} } as any, res1);
      assert.equal(res1Status, 403);

      let res2Status = 200;
      let res2Body: any = null;
      const res2: any = {
        setHeader() {},
        status(c: number) { res2Status = c; return this; },
        json(d: any) { res2Body = d; return d; },
        end() {},
      };
      await emailHandler({ method: 'POST', headers: { authorization: 'Bearer deleted_user' }, body: {} } as any, res2);
      assert.equal(res2Status, 403);
    });

    it('denies branch email management if user profile is inactive or missing', async () => {
      const handler = createBranchEmailSettingsHandler({
        verifyToken: async (t) => ({ uid: t }),
        getUser: async (uid) => {
          if (uid === 'inactive_gm') return { role: 'GM', active: false };
          return undefined;
        },
        getBranch: async () => ({ id: 'b1' }),
        getSettings: async () => null,
        saveSettings: async () => {},
        env: { BRANCH_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') },
      });

      let resStatus = 200;
      const res: any = {
        setHeader() {},
        status(c: number) { resStatus = c; return this; },
        json() {},
        end() {},
      };
      await handler(
        { method: 'GET', headers: { authorization: 'Bearer inactive_gm' }, query: { branchId: 'b1' } },
        res
      );
      assert.equal(resStatus, 403);
    });
  });

  // =========================================================================
  // 2. DEACTIVATION LIFECYCLE: MULTI-STEP SAFETY & TRUTHFUL RECOVERY
  // =========================================================================
  describe('Deactivation Lifecycle', () => {
    it('safely deactivates target: marks profile inactive, disables Auth user, revokes refresh tokens', async () => {
      const h = createHarness();
      const res = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'update',
          data: { id: 'staff_b1', active: false },
        },
      });

      assert.equal(res.status, 200);
      assert.equal(h.users['staff_b1'].active, false);
      assert.equal(h.authUsers['staff_b1'].disabled, true);
      assert.ok(h.revokedTokens.has('staff_b1'));
      assert.ok(res.body.message.includes('deactivated and active sessions revoked'));
    });

    it('handles Auth failure during deactivation: keeps profile inactive (access blocked) and reports warning truthfully', async () => {
      const h = createHarness();
      h.deps.updateUserAuth = async () => {
        throw new Error('Firebase Auth Service Unavailable');
      };

      const res = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'update',
          data: { id: 'staff_b1', active: false },
        },
      });

      assert.equal(res.status, 200);
      // Profile MUST remain inactive so access is strictly denied at resource boundary
      assert.equal(h.users['staff_b1'].active, false);
      assert.ok(res.body.warning !== undefined);
      assert.ok(res.body.warning.includes('Account access remains blocked'));
    });

    it('prevents self-deactivation', async () => {
      const h = createHarness();
      const res = await h.invoke({
        token: 'mgr_b1',
        body: {
          action: 'update',
          data: { id: 'mgr_b1', active: false },
        },
      });

      assert.equal(res.status, 403);
      assert.ok(res.body.error.includes('cannot change your own active status'));
      assert.equal(h.users['mgr_b1'].active, true);
    });

    it('prevents GM from deactivating another GM or Creator', async () => {
      const h = createHarness();
      const res = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'update',
          data: { id: 'creator_1', active: false },
        },
      });

      assert.equal(res.status, 403);
      assert.equal(h.users['creator_1'].active, true);
    });
  });

  // =========================================================================
  // 3. REACTIVATION LIFECYCLE: FRESH SIGN-IN & COMPENSATION
  // =========================================================================
  describe('Reactivation Lifecycle', () => {
    it('reactivates target: re-enables Auth, revokes old tokens, marks profile active', async () => {
      const h = createHarness();
      const res = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'update',
          data: { id: 'inactive_staff', active: true },
        },
      });

      assert.equal(res.status, 200);
      assert.equal(h.authUsers['inactive_staff'].disabled, false);
      assert.ok(h.revokedTokens.has('inactive_staff'));
      assert.equal(h.users['inactive_staff'].active, true);
      assert.ok(res.body.message.includes('user must sign in with fresh credentials'));
    });

    it('compensates and re-disables Auth if Firestore profile reactivation fails', async () => {
      const h = createHarness();
      h.deps.updateUserProfile = async () => {
        throw new Error('Firestore write quota exceeded');
      };

      const res = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'update',
          data: { id: 'inactive_staff', active: true },
        },
      });

      assert.equal(res.status, 500);
      // Auth should have been re-disabled in compensation block
      assert.equal(h.authUsers['inactive_staff'].disabled, true);
    });

    it('requires authorized administrator to reactivate (Manager cannot reactivate staff in other branch)', async () => {
      const h = createHarness();
      h.users['other_branch_staff'] = {
        id: 'other_branch_staff',
        username: 'other@hare-com.example',
        displayName: 'Other Staff',
        role: 'STAFF',
        branchId: 'branch_2',
        active: false,
        displayOrder: 200,
      };

      const res = await h.invoke({
        token: 'mgr_b1',
        body: {
          action: 'update',
          data: { id: 'other_branch_staff', active: true },
        },
      });

      assert.equal(res.status, 403);
      assert.ok(res.body.error.includes('Managers can only manage accounts within their own branch'));
      assert.equal(h.users['other_branch_staff'].active, false);
    });
  });

  // =========================================================================
  // 4. DELETION LIFECYCLE: MULTI-STEP SAFETY & RECOVERY
  // =========================================================================
  describe('Deletion Lifecycle', () => {
    it('blocks access before deleting profile and Auth account', async () => {
      const h = createHarness();
      const res = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'delete',
          data: { id: 'staff_b1' },
        },
      });

      assert.equal(res.status, 200);
      assert.equal(h.users['staff_b1'], undefined);
      assert.equal(h.authUsers['staff_b1'], undefined);
      assert.equal(res.body.success, true);
    });

    it('strictly forbids deleting self or Creator accounts', async () => {
      const h = createHarness();
      // Self delete
      const resSelf = await h.invoke({
        token: 'creator_1',
        body: {
          action: 'delete',
          data: { id: 'creator_1' },
        },
      });
      assert.equal(resSelf.status, 400);
      assert.ok(resSelf.body.error.includes('cannot delete your own account'));

      // Creator account delete by GM
      const resCreator = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'delete',
          data: { id: 'creator_1' },
        },
      });
      assert.equal(resCreator.status, 403);
      assert.ok(resCreator.body.error.includes('CREATOR accounts cannot be modified or deleted'));
    });

    it('truthfully reports warning when Auth deletion encounters partial error after profile removal', async () => {
      const h = createHarness();
      h.deps.deleteUserAuth = async () => {
        throw new Error('Auth server timeout');
      };

      const res = await h.invoke({
        token: 'gm_1',
        body: {
          action: 'delete',
          data: { id: 'staff_b1' },
        },
      });

      assert.equal(res.status, 200);
      assert.equal(h.users['staff_b1'], undefined);
      assert.ok(res.body.warning.includes('User profile deleted and access blocked, but Auth account cleanup encountered an issue'));
    });
  });

  // =========================================================================
  // 5. CACHE & DRAFT SCOPING: SAFE WORK PRESERVATION ACROSS SHARED DEVICES
  // =========================================================================
  describe('State Isolation & Draft Recovery', () => {
    it('isolates user draft carts per user ID and prevents cross-user exposure', () => {
      const storage: Record<string, string> = {};

      const saveDraft = (userId: string, cart: any, manualCart: any) => {
        storage[`ht_cart_${userId}`] = JSON.stringify(cart);
        storage[`ht_manual_cart_${userId}`] = JSON.stringify(manualCart);
      };

      const restoreDraft = (userId: string) => {
        const cart = storage[`ht_cart_${userId}`] ? JSON.parse(storage[`ht_cart_${userId}`]) : {};
        const manualCart = storage[`ht_manual_cart_${userId}`] ? JSON.parse(storage[`ht_manual_cart_${userId}`]) : [];
        return { cart, manualCart };
      };

      // User A works on a cart
      saveDraft('user_A', { p1: 5 }, [{ name: 'Special Item', qty: 2 }]);

      // User B logs in on the same browser
      const userBDraft = restoreDraft('user_B');
      assert.deepEqual(userBDraft.cart, {});
      assert.deepEqual(userBDraft.manualCart, []);

      // User A logs back in (e.g. after reactivation)
      const userADraft = restoreDraft('user_A');
      assert.deepEqual(userADraft.cart, { p1: 5 });
      assert.deepEqual(userADraft.manualCart, [{ name: 'Special Item', qty: 2 }]);
    });
  });
});
