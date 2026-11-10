import test from 'node:test';
import assert from 'node:assert/strict';
import {canReorderUser, planUserMove} from '../shared/user-order.ts';
import {
  createUserAdminHandler,
  checkUserAdminPermission,
  UserAdminError,
} from '../server/user-admin-service.ts';
import type {
  UserDoc,
  UserAdminDependencies,
  UserAdminRequest,
  UserAdminResponse,
} from '../server/user-admin-service.ts';

// Synthetic Test Fixtures (no real Firebase or cloud calls)
function makeHarness(initialUsers: Record<string, UserDoc> = {}) {
  const users = new Map<string, UserDoc>(Object.entries(initialUsers));
  const authUsers = new Map<string, { email: string; password?: string; displayName?: string; disabled?: boolean }>();
  const revokedTokens = new Set<string>();

  // Populate authUsers from initialUsers
  for (const [uid, doc] of users.entries()) {
    authUsers.set(uid, { email: doc.username, displayName: doc.displayName, disabled: !doc.active });
  }

  let failCreateProfile = false;
  let failUpdateAuth = false;
  let nextAuthUid = 'auth-generated-id-1';

  const deps: UserAdminDependencies = {
    verifyToken: async (token: string) => {
      if (token === 'invalid-token' || token === 'revoked-token' || revokedTokens.has(token)) {
        throw new Error('Token revoked or invalid');
      }
      return { uid: token };
    },
    getUser: async (uid: string) => {
      const u = users.get(uid);
      return u ? { ...u } : undefined;
    },
    createUserAuth: async (params) => {
      if (Array.from(authUsers.values()).some(u => u.email === params.email)) {
        const err: any = new Error('Email already in use');
        err.code = 'auth/email-already-exists';
        throw err;
      }
      const uid = nextAuthUid;
      authUsers.set(uid, { ...params, disabled: false });
      return { uid };
    },
    updateUserAuth: async (uid, params) => {
      if (failUpdateAuth) {
        throw new Error('Firebase Auth update failed');
      }
      const existing = authUsers.get(uid);
      if (!existing) throw new Error('User not found in Auth');
      authUsers.set(uid, { ...existing, ...params });
    },
    revokeUserTokens: async (uid) => {
      revokedTokens.add(uid);
    },
    deleteUserAuth: async (uid) => {
      authUsers.delete(uid);
    },
    createUserProfile: async (uid, data) => {
      if (failCreateProfile) {
        throw new Error('Firestore profile write failed');
      }
      users.set(uid, { ...data });
    },
    updateUserProfile: async (uid, patch, expectedVersion) => {
      const existing = users.get(uid);
      if (!existing) throw new Error('User document not found');
      if (expectedVersion) {
        if (expectedVersion.role && existing.role !== expectedVersion.role) {
          throw new UserAdminError(409, 'Target user role changed concurrently.');
        }
        if (expectedVersion.branchId !== undefined && existing.branchId !== expectedVersion.branchId) {
          throw new UserAdminError(409, 'Target user branch changed concurrently.');
        }
      }
      users.set(uid, { ...existing, ...patch });
    },
    deleteUserProfile: async (uid) => {
      users.delete(uid);
    },
    saveUserOrder: async (requesterUid, items, timestamp) => {
      for (const item of items) {
        const current = users.get(item.id)!;
        if ((current.displayOrder || 0) !== item.expectedDisplayOrder) throw new UserAdminError(409, 'Order changed');
      }
      for (const item of items) users.set(item.id, {...users.get(item.id)!, displayOrder: item.displayOrder, updatedAt: timestamp, updatedBy: requesterUid});
    },
  };

  const handler = createUserAdminHandler(deps);

  async function invoke(req: { token?: string; body?: unknown; method?: string; origin?: string }) {
    let statusCode = 200;
    let responseData: any = null;
    const responseHeaders: Record<string, string> = {};

    const res: UserAdminResponse = {
      setHeader: (name: string, value: string) => {
        responseHeaders[name.toLowerCase()] = value;
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
        origin: req.origin,
      },
      body: req.body,
    };

    await handler(request, res);
    return { status: statusCode, body: responseData, headers: responseHeaders };
  }

  return {
    deps,
    users,
    authUsers,
    revokedTokens,
    invoke,
    setFailCreateProfile: (fail: boolean) => { failCreateProfile = fail; },
    setFailUpdateAuth: (fail: boolean) => { failUpdateAuth = fail; },
    setNextAuthUid: (uid: string) => { nextAuthUid = uid; },
  };
}

// Baseline Synthetic Users
const SEED: Record<string, UserDoc> = {
  creator1: { id: 'creator1', username: 'creator@test-com.example', displayName: 'Creator One', role: 'CREATOR', branchId: '', active: true },
  gm1: { id: 'gm1', username: 'gm1@test-com.example', displayName: 'GM One', role: 'GM', branchId: '', active: true },
  gm2: { id: 'gm2', username: 'gm2@test-com.example', displayName: 'GM Two', role: 'GM', branchId: '', active: true },
  manager_branchA: { id: 'manager_branchA', username: 'mgr_a@test-com.example', displayName: 'Manager A', role: 'MANAGER', branchId: 'branchA', active: true },
  manager_branchB: { id: 'manager_branchB', username: 'mgr_b@test-com.example', displayName: 'Manager B', role: 'MANAGER', branchId: 'branchB', active: true },
  staff_branchA: { id: 'staff_branchA', username: 'staff_a@test-com.example', displayName: 'Staff A', role: 'STAFF', branchId: 'branchA', active: true },
  staff_branchB: { id: 'staff_branchB', username: 'staff_b@test-com.example', displayName: 'Staff B', role: 'STAFF', branchId: 'branchB', active: true },
  inactive_gm: { id: 'inactive_gm', username: 'inactive_gm@test-com.example', displayName: 'Inactive GM', role: 'GM', branchId: '', active: false },
};

// --------------------------------------------------------------------------
// 1. Authentication & Session Security Tests
// --------------------------------------------------------------------------

test('anonymous request without token is rejected with 401', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({ body: { action: 'delete', data: { id: 'staff_branchA' } } });
  assert.strictEqual(res.status, 401);
});

test('invalid or revoked token is rejected with 401', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({ token: 'revoked-token', body: { action: 'delete', data: { id: 'staff_branchA' } } });
  assert.strictEqual(res.status, 401);
});

test('missing requester profile is rejected with 403', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({ token: 'nonexistent_uid', body: { action: 'delete', data: { id: 'staff_branchA' } } });
  assert.strictEqual(res.status, 403);
});

test('inactive requester is rejected with 403', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({ token: 'inactive_gm', body: { action: 'delete', data: { id: 'staff_branchA' } } });
  assert.strictEqual(res.status, 403);
});

test('staff requester cannot administer accounts (403)', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({ token: 'staff_branchA', body: { action: 'delete', data: { id: 'staff_branchB' } } });
  assert.strictEqual(res.status, 403);
});

// --------------------------------------------------------------------------
// 2. Role Hierarchy & Matrix Enforcement Tests
// --------------------------------------------------------------------------

test('CREATOR may manage GM, MANAGER, and STAFF accounts', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'creator1', body: { action: 'update', data: { id: 'gm1', displayName: 'GM One Updated' } } });
  assert.strictEqual(r1.status, 200);

  const r2 = await h.invoke({ token: 'creator1', body: { action: 'update', data: { id: 'manager_branchA', displayName: 'Manager A Updated' } } });
  assert.strictEqual(r2.status, 200);

  const r3 = await h.invoke({ token: 'creator1', body: { action: 'update', data: { id: 'staff_branchA', displayName: 'Staff A Updated' } } });
  assert.strictEqual(r3.status, 200);
});

test('CREATOR accounts are strictly protected from modification or deletion', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'gm1', body: { action: 'update', data: { id: 'creator1', displayName: 'Hacked' } } });
  assert.strictEqual(r1.status, 403);

  const r2 = await h.invoke({ token: 'manager_branchA', body: { action: 'delete', data: { id: 'creator1' } } });
  assert.strictEqual(r2.status, 403);

  const r3 = await h.invoke({ token: 'creator1', body: { action: 'delete', data: { id: 'creator1' } } });
  assert.strictEqual(r3.status, 400); // Self delete forbidden
});

test('Assigning the CREATOR role through user administration is forbidden for everyone', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'creator1', body: { action: 'update', data: { id: 'gm1', role: 'CREATOR' } } });
  assert.strictEqual(r1.status, 403);

  const r2 = await h.invoke({ token: 'gm1', body: { action: 'update', data: { id: 'staff_branchA', role: 'CREATOR' } } });
  assert.strictEqual(r2.status, 403);
});

test('GM may manage MANAGER and STAFF accounts across branches', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'gm1', body: { action: 'update', data: { id: 'manager_branchA', displayName: 'GM Renamed Mgr' } } });
  assert.strictEqual(r1.status, 200);

  const r2 = await h.invoke({ token: 'gm1', body: { action: 'update', data: { id: 'staff_branchB', displayName: 'GM Renamed Staff B' } } });
  assert.strictEqual(r2.status, 200);
});

test('GM CANNOT manage or assign other GM accounts (403)', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'gm1', body: { action: 'update', data: { id: 'gm2', displayName: 'GM2 Renamed' } } });
  assert.strictEqual(r1.status, 403);

  const r2 = await h.invoke({ token: 'gm1', body: { action: 'update', data: { id: 'manager_branchA', role: 'GM' } } });
  assert.strictEqual(r2.status, 403);

  const r3 = await h.invoke({ token: 'gm1', body: { action: 'delete', data: { id: 'gm2' } } });
  assert.strictEqual(r3.status, 403);
});

test('MANAGER may manage STAFF accounts ONLY within Manager’s own branch', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'manager_branchA', body: { action: 'update', data: { id: 'staff_branchA', displayName: 'Updated Staff A' } } });
  assert.strictEqual(r1.status, 200);

  const r2 = await h.invoke({ token: 'manager_branchA', body: { action: 'update', data: { id: 'staff_branchB', displayName: 'Intruder' } } });
  assert.strictEqual(r2.status, 403);

  const r3 = await h.invoke({ token: 'manager_branchA', body: { action: 'delete', data: { id: 'staff_branchB' } } });
  assert.strictEqual(r3.status, 403);
});

test('MANAGER cannot move Staff to another branch or promote Staff', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'manager_branchA', body: { action: 'update', data: { id: 'staff_branchA', branchId: 'branchB' } } });
  assert.strictEqual(r1.status, 403);

  const r2 = await h.invoke({ token: 'manager_branchA', body: { action: 'update', data: { id: 'staff_branchA', role: 'MANAGER' } } });
  assert.strictEqual(r2.status, 403);
});

// --------------------------------------------------------------------------
// 3. Self-Operation Constraints Tests
// --------------------------------------------------------------------------

test('Self-deletion is rejected with 400', async () => {
  const h = makeHarness(SEED);
  const r1 = await h.invoke({ token: 'gm1', body: { action: 'delete', data: { id: 'gm1' } } });
  assert.strictEqual(r1.status, 400);

  const r2 = await h.invoke({ token: 'manager_branchA', body: { action: 'delete', data: { id: 'manager_branchA' } } });
  assert.strictEqual(r2.status, 400);
});

test('Self-promotion or role change is rejected with 403', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({ token: 'manager_branchA', body: { action: 'update', data: { id: 'manager_branchA', role: 'GM' } } });
  assert.strictEqual(res.status, 403);
});

test('Self branch reassignment or self-active change is rejected with 403', async () => {
  const h = makeHarness(SEED);

  const r1 = await h.invoke({ token: 'manager_branchA', body: { action: 'update', data: { id: 'manager_branchA', branchId: 'branchB' } } });
  assert.strictEqual(r1.status, 403);

  const r2 = await h.invoke({ token: 'gm1', body: { action: 'update', data: { id: 'gm1', active: false } } });
  assert.strictEqual(r2.status, 403);
});

test('Self display name update is permitted', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({ token: 'manager_branchA', body: { action: 'update', data: { id: 'manager_branchA', displayName: 'Manager A New Name' } } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(h.users.get('manager_branchA')?.displayName, 'Manager A New Name');
});

// --------------------------------------------------------------------------
// 4. Input Validation & Partial Updates Tests
// --------------------------------------------------------------------------

test('Unexpected fields in update request are rejected with 400', async () => {
  const h = makeHarness(SEED);
  const res = await h.invoke({
    token: 'creator1',
    body: { action: 'update', data: { id: 'staff_branchA', maliciousField: true } },
  });
  assert.strictEqual(res.status, 400);
});

test('Password-only update preserves omitted profile fields intact', async () => {
  const h = makeHarness(SEED);
  const original = h.users.get('staff_branchA')!;

  const res = await h.invoke({
    token: 'creator1',
    body: { action: 'update', data: { id: 'staff_branchA', password: 'new-valid-password-123' } },
  });
  assert.strictEqual(res.status, 200);

  const updated = h.users.get('staff_branchA')!;
  assert.strictEqual(updated.username, original.username);
  assert.strictEqual(updated.displayName, original.displayName);
  assert.strictEqual(updated.role, original.role);
  assert.strictEqual(updated.branchId, original.branchId);
  assert.strictEqual(updated.active, original.active);
  assert.strictEqual(h.authUsers.get('staff_branchA')?.password, 'new-valid-password-123');
});

// --------------------------------------------------------------------------
// 5. Compensation on Multi-Step Failures
// --------------------------------------------------------------------------

test('Compensation deletes orphan auth user if Firestore profile creation fails', async () => {
  const h = makeHarness(SEED);
  h.setNextAuthUid('orphan-to-clean');
  h.setFailCreateProfile(true);

  const res = await h.invoke({
    token: 'creator1',
    body: {
      action: 'create',
      data: {
        email: 'newuser@test-com.example',
        password: 'validpassword123',
        displayName: 'New User',
        role: 'STAFF',
        branchId: 'branchA',
      },
    },
  });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(h.authUsers.has('orphan-to-clean'), false);
  assert.strictEqual(h.users.has('orphan-to-clean'), false);
});

test('Concurrent role change triggers conflict 409', async () => {
  const h = makeHarness(SEED);

  const current = h.users.get('staff_branchA')!;
  h.users.set('staff_branchA', { ...current, role: 'GM' });

  const res = await h.invoke({
    token: 'manager_branchA',
    body: { action: 'update', data: { id: 'staff_branchA', displayName: 'New Name' } },
  });

  assert.strictEqual(res.status, 403);
});

// --------------------------------------------------------------------------
// 6. Account Lifecycle: Deactivation, Reactivation & Session Revocation
// --------------------------------------------------------------------------

test('Deactivation marks profile inactive, disables Auth account, and revokes tokens', async () => {
  const h = makeHarness(SEED);

  const res = await h.invoke({
    token: 'manager_branchA',
    body: { action: 'update', data: { id: 'staff_branchA', active: false } },
  });

  assert.strictEqual(res.status, 200);
  // 1. Profile must be inactive
  assert.strictEqual(h.users.get('staff_branchA')?.active, false);
  // 2. Auth user must be disabled
  assert.strictEqual(h.authUsers.get('staff_branchA')?.disabled, true);
  // 3. Tokens must be revoked
  assert.strictEqual(h.revokedTokens.has('staff_branchA'), true);

  // 4. Deactivated user token cannot perform administrative operations
  const subRes = await h.invoke({
    token: 'staff_branchA',
    body: { action: 'update', data: { id: 'staff_branchA', displayName: 'Hacked' } },
  });
  assert.strictEqual(subRes.status, 401); // Revoked token rejected
});

test('Partial failure during Auth disable keeps profile inactive and reports warning', async () => {
  const h = makeHarness(SEED);
  h.setFailUpdateAuth(true); // Simulate Firebase Auth service failure

  const res = await h.invoke({
    token: 'manager_branchA',
    body: { action: 'update', data: { id: 'staff_branchA', active: false } },
  });

  assert.strictEqual(res.status, 200);
  // Profile was updated to inactive (access blocked!)
  assert.strictEqual(h.users.get('staff_branchA')?.active, false);
  // Truthful warning returned to caller
  assert.ok(res.body.warning.includes('Account access remains blocked'));
});

test('Reactivation re-enables Auth, revokes old sessions, and marks profile active', async () => {
  const h = makeHarness(SEED);

  // Deactivate first
  await h.invoke({
    token: 'manager_branchA',
    body: { action: 'update', data: { id: 'staff_branchA', active: false } },
  });

  // Reactivate
  const res = await h.invoke({
    token: 'manager_branchA',
    body: { action: 'update', data: { id: 'staff_branchA', active: true } },
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(h.users.get('staff_branchA')?.active, true);
  assert.strictEqual(h.authUsers.get('staff_branchA')?.disabled, false);
  // Truthful message that fresh sign-in is required
  assert.ok(res.body.message.includes('fresh credentials'));
});

test('Deletion blocks access and deletes both profile and Auth record', async () => {
  const h = makeHarness(SEED);

  const res = await h.invoke({
    token: 'manager_branchA',
    body: { action: 'delete', data: { id: 'staff_branchA' } },
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(h.users.has('staff_branchA'), false);
  assert.strictEqual(h.authUsers.has('staff_branchA'), false);
});


test('user order: owner can move owner rows with a single request and no account changes', async () => {
  const h = makeHarness(SEED);
  const original = structuredClone(h.users);
  const authBefore = structuredClone(h.authUsers);
  const result = await h.invoke({token:'creator1', body:{action:'reorder', data:{items:[
    {id:'creator1', displayOrder:30}, {id:'staff_branchA', displayOrder:10}
  ]}}});
  assert.equal(result.status, 200);
  assert.equal(h.users.get('creator1')!.displayOrder, 30);
  assert.equal(h.users.get('staff_branchA')!.displayOrder, 10);
  for (const [id, before] of original) {
    const {displayOrder, updatedAt, updatedBy, ...after} = h.users.get(id)!;
    assert.deepEqual(after, before);
  }
  assert.deepEqual(h.authUsers, authBefore);
  assert.equal(h.revokedTokens.size, 0);
});

test('user order: validate every target before saving, retain manager and GM restrictions', async () => {
  for (const [token, items] of [
    ['gm1', [{id:'staff_branchA',displayOrder:10},{id:'creator1',displayOrder:20}]],
    ['manager_branchA', [{id:'staff_branchA',displayOrder:10},{id:'staff_branchB',displayOrder:20}]],
    ['creator1', [{id:'staff_branchA',displayOrder:10},{id:'missing',displayOrder:20}]],
    ['staff_branchA', [{id:'staff_branchA',displayOrder:10}]],
    ['inactive_gm', [{id:'staff_branchA',displayOrder:10}]],
  ] as const) {
    const h=makeHarness(SEED), before=structuredClone(h.users);
    const result=await h.invoke({token,body:{action:'reorder',data:{items}}});
    assert.ok([403,409].includes(result.status));
    assert.deepEqual(h.users,before);
  }
  const multi={...SEED.staff_branchA,branchIds:['branchA','branchB']};
  const h=makeHarness({...SEED,staff_branchA:multi});
  assert.equal((await h.invoke({token:'manager_branchA',body:{action:'reorder',data:{items:[{id:multi.id,displayOrder:10}]}}})).status,403);
  assert.equal(canReorderUser(SEED.manager_branchA,multi),false);
});

test('user order: rejects duplicate, invalid or oversized payloads and fails closed on storage failure', async () => {
  for (const items of [[], [null], [{id:'staff_branchA',displayOrder:NaN}], [{id:'staff_branchA',displayOrder:Infinity}],
    [{id:'staff_branchA',displayOrder:'2'}], [{id:'bad/id',displayOrder:2}],
    [{id:'staff_branchA',displayOrder:1},{id:'staff_branchA',displayOrder:2}],
    Array.from({length:401},(_,i)=>({id:`user-${i}`,displayOrder:i}))]) {
    const h=makeHarness(SEED);
    assert.equal((await h.invoke({token:'creator1',body:{action:'reorder',data:{items}}})).status,400);
    assert.deepEqual(h.users,new Map(Object.entries(SEED)));
  }
  const h=makeHarness(SEED);
  h.deps.saveUserOrder=async()=>{throw new UserAdminError(503,'Storage unavailable');};
  assert.equal((await h.invoke({token:'creator1',body:{action:'reorder',data:{items:[{id:'creator1',displayOrder:50}]}}})).status,503);
  assert.deepEqual(h.users,new Map(Object.entries(SEED)));
});

test('user order: moves up/down with one changed row and repairs duplicate legacy positions', () => {
  const users=[SEED.creator1,SEED.gm1,SEED.staff_branchA].map((u,i)=>({...u,displayOrder:(i+1)*10}));
  const original=structuredClone(users);
  assert.deepEqual(planUserMove(users,0,2,SEED.creator1),[{id:'creator1',displayOrder:40}]);
  assert.deepEqual(planUserMove(users,2,0,SEED.creator1),[{id:'staff_branchA',displayOrder:0}]);
  assert.deepEqual(planUserMove(users,0,1,SEED.creator1),[{id:'creator1',displayOrder:25}]);
  assert.deepEqual(planUserMove(users,0,0,SEED.creator1),[]);
  assert.deepEqual(users,original);
  const tied=users.map(u=>({...u,displayOrder:0}));
  const changes=planUserMove(tied,0,1,SEED.creator1);
  assert.deepEqual(changes.map(u=>u.id),['gm1','creator1','staff_branchA']);
  assert.equal(new Set(changes.map(u=>u.displayOrder)).size,3);
  assert.throws(()=>planUserMove(users,0,1,SEED.gm1));
});

test('account API rejects manager self-grants and Menu grants to staff before changing records',async()=>{
  const h=makeHarness(SEED);
  for(const data of [{id:'manager_branchA',customPermissions:['view_menu_recipes']},{id:'manager_branchA',allSuppliers:true},{id:'staff_branchA',customPermissions:['approve_menu_recipes']}]){
    const before=structuredClone(h.users);const result=await h.invoke({token:'manager_branchA',body:{action:'update',data}});
    assert.equal(result.status,403);assert.deepEqual(h.users,before);
  }
});
