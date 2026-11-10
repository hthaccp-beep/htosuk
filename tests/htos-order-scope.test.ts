import test from 'node:test';
import assert from 'node:assert/strict';
import { assignedBranches, outgoingOrderPartitions, hasSupplierScope, linkedSupplierIds } from '../shared/order-scope.ts';
import { checkBranchAccess, checkSupplierAccess, validateOrderUpdate, validateOrderDeletion } from '../server/order-authorization.ts';

const user = { id: 'staff', active: true, role: 'STAFF', branchId: 'a', branchIds: ['b'], supplierIds: ['s1'] };
test('UI query scope and server scope include default and additional branches', () => {
  assert.deepEqual(assignedBranches(user), ['a', 'b']);
  assert.deepEqual(outgoingOrderPartitions(user), [{ branchId: 'a', supplierId: 's1' }, { branchId: 'b', supplierId: 's1' }]);
  assert.equal(checkBranchAccess(user, 'a'), true);
  assert.equal(checkBranchAccess(user, 'b'), true);
  assert.equal(checkBranchAccess(user, 'c'), false);
  assert.equal(checkSupplierAccess(user, 's2'), false);
});
test('explicit empty/disabled suppliers have no queries or server ordering access', () => {
  for (const scope of [{ supplierIds: [] }, { supplierIds: undefined, allSuppliers: false }]) {
    const restricted = { ...user, ...scope };
    assert.deepEqual(outgoingOrderPartitions(restricted), []);
    assert.equal(hasSupplierScope(restricted, 's1'), false);
    assert.equal(checkSupplierAccess(restricted, 's1'), false);
  }
});
test('all-branch scope retains selected suppliers; inactive admin has no scope', () => {
  assert.deepEqual(outgoingOrderPartitions({ ...user, allBranches: true }), [{ branchId: undefined, supplierId: 's1' }]);
  assert.deepEqual(outgoingOrderPartitions({ ...user, role: 'CREATOR', active: false }), []);
  assert.deepEqual(linkedSupplierIds(user, [{ id: 'internal-b', linkedBranchId: 'b' }, { id: 'internal-c', linkedBranchId: 'c' }]), ['internal-b']);
});
test('a draft author cannot keep editing or deleting after branch/supplier revocation', () => {
  for (const scope of [{ branchId: 'c' }, { supplierId: 's2' }]) {
    const order: any = { id: 'order', orderedByUserId: user.id, branchId: 'a', supplierId: 's1', status: 'DRAFT', createdAt: '2026-10-01', items: [], ...scope };
    assert.throws(() => validateOrderUpdate(user, order, { ...order }), /assigned branches or suppliers/);
    assert.throws(() => validateOrderDeletion(user, order), /assigned branches or suppliers/);
  }
});

test('session scope changes discard live and archived orders immediately', async () => {
  const { useAppStore } = await import('../store.ts');
  const profile = { ...user, username: 'test@example.invalid', displayName: 'Test' };
  const records = [{ id: 'cached-order' }] as any;
  useAppStore.setState({ currentUser: profile, orders: records, _liveOrders: records, _incomingOrders: records, _archivedOrders: records });
  useAppStore.getState().setCurrentUser({ ...profile, branchIds: [] });
  assert.deepEqual(useAppStore.getState().orders, []);
  assert.deepEqual(useAppStore.getState()._archivedOrders, []);
  useAppStore.setState({ currentUser: null });
});
