import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUserAuthorizedForBranch,
  isUserAuthorizedForDepartment,
  isSupplierAvailableAtBranch,
  isSupplierSupportingDepartment,
  isSupplierPermittedForUser,
  isSupplierEligibleForOrder,
  filterSuppliersForOrdering,
  getUserAuthorizedBranches,
  getUserAuthorizedDepartments,
} from '../utils/accessControl.ts';
import {
  validateOrderCreation,
  checkBranchAccess,
  checkDepartmentAccess,
  checkSupplierAccess,
  OrderAuthorizationError,
} from '../server/order-authorization.ts';
import { checkUserAdminPermission } from '../server/user-admin-service.ts';
import type { User, Branch, Supplier, Department, OrderRecord } from '../types.ts';

// ---------------------------------------------------------------------------
// TEST FIXTURES & DATA SEEDING
// ---------------------------------------------------------------------------

const departments: Department[] = [
  { id: 'dept_front', name: 'Front of House', code: 'FRONT', archived: false, displayOrder: 10 },
  { id: 'dept_kitchen', name: 'Kitchen', code: 'KITCHEN', archived: false, displayOrder: 20 },
  { id: 'dept_sushi', name: 'Sushi', code: 'SUSHI', archived: false, displayOrder: 30 },
];

const branches: Branch[] = [
  { id: 'branch_a', name: 'Branch A (Bloomsbury)', code: 'HT01', active: true },
  { id: 'branch_b', name: 'Branch B (Piccadilly)', code: 'HT02', active: true },
  { id: 'branch_c', name: 'Branch C (Blackfriars)', code: 'HT03', active: true },
  { id: 'branch_d', name: 'Branch D (Ealing)', code: 'HT04', active: true },
];

const suppliers: Supplier[] = [
  {
    id: 'sup_japanese',
    name: 'Japanese Food Supplier',
    email: 'orders@japanesefood.test',
    active: true,
    allDepartments: false,
    departmentIds: ['dept_sushi'],
    allBranches: true,
    availableBranchIds: [],
    deliveryRules: {},
    deliverySchedules: {},
    branchAccountCodes: {},
  },
  {
    id: 'sup_fish',
    name: 'Fish Supplier',
    email: 'orders@fishsupplier.test',
    active: true,
    allDepartments: false,
    departmentIds: ['dept_sushi', 'dept_kitchen'],
    allBranches: false,
    availableBranchIds: ['branch_a', 'branch_c'], // Serves Branch A and C, but NOT Branch B!
    deliveryRules: {},
    deliverySchedules: {},
    branchAccountCodes: {},
  },
  {
    id: 'sup_meat',
    name: 'Meat Supplier',
    email: 'orders@meatsupplier.test',
    active: true,
    allDepartments: false,
    departmentIds: ['dept_kitchen'], // Kitchen only, NOT Sushi
    allBranches: true,
    availableBranchIds: [],
    deliveryRules: {},
    deliverySchedules: {},
    branchAccountCodes: {},
  },
  {
    id: 'sup_produce',
    name: 'Fresh Fruit & Veg Supplier',
    email: 'orders@produce.test',
    active: true,
    allDepartments: true,
    departmentIds: [],
    allBranches: true,
    availableBranchIds: [],
    deliveryRules: {},
    deliverySchedules: {},
    branchAccountCodes: {},
  },
  {
    id: 'sup_retired',
    name: 'Old Packaging Supplier (Retired)',
    email: 'orders@oldpkg.test',
    active: false, // Inactive / retired
    allDepartments: true,
    departmentIds: [],
    allBranches: true,
    availableBranchIds: [],
    deliveryRules: {},
    deliverySchedules: {},
    branchAccountCodes: {},
  },
];

// Synthetic Test User: Sushi Chef A (Requirement 1 & 5)
const sushiChefA: User = {
  id: 'user_sushi_chef_a',
  username: 'sushi.chef.a@hareandtortoise-co-uk.example',
  displayName: 'Sushi Chef A',
  role: 'STAFF',
  branchId: 'branch_a', // Preferred/default branch for convenience
  active: true,
  allDepartments: false,
  departmentIds: ['dept_sushi'], // Department: Sushi
  allBranches: false,
  branchIds: ['branch_a', 'branch_b', 'branch_c'], // Authorized branches: A, B, C (NOT D)
  allSuppliers: false,
  supplierIds: ['sup_japanese', 'sup_fish'], // Permitted: Japanese Food Supplier and Fish Supplier
  customPermissions: [
    'create_orders',
    'edit_drafts',
    'submit_orders',
    'view_order_history',
    'view_prices',
  ],
};

// ---------------------------------------------------------------------------
// TEST SUITE: MULTI-BRANCH SUSHI WORKFLOW & CORE REQUIREMENTS
// ---------------------------------------------------------------------------

test('Requirement 1 & 5: Chef has one permanent login and is authorized for branches A, B, and C', () => {
  assert.equal(isUserAuthorizedForBranch(sushiChefA, 'branch_a'), true);
  assert.equal(isUserAuthorizedForBranch(sushiChefA, 'branch_b'), true);
  assert.equal(isUserAuthorizedForBranch(sushiChefA, 'branch_c'), true);

  // Unauthorized branch D must be rejected
  assert.equal(isUserAuthorizedForBranch(sushiChefA, 'branch_d'), false);
  assert.equal(isUserAuthorizedForBranch(sushiChefA, 'non_existent_branch'), false);

  // Inactive user must be denied all access
  const inactiveChef = { ...sushiChefA, active: false };
  assert.equal(isUserAuthorizedForBranch(inactiveChef, 'branch_a'), false);

  // Empty selection must never mean unrestricted access
  const emptyChef = { ...sushiChefA, branchId: undefined, branchIds: [], allBranches: false };
  assert.equal(isUserAuthorizedForBranch(emptyChef, 'branch_a'), false);
});

test('Requirement 3 & 7: Single department assignment auto-resolves to Sushi', () => {
  const authorizedDepts = getUserAuthorizedDepartments(sushiChefA, departments);
  assert.equal(authorizedDepts.length, 1);
  assert.equal(authorizedDepts[0].id, 'dept_sushi');
  assert.equal(authorizedDepts[0].name, 'Sushi');

  assert.equal(isUserAuthorizedForDepartment(sushiChefA, 'dept_sushi'), true);
  assert.equal(isUserAuthorizedForDepartment(sushiChefA, 'dept_kitchen'), false);
  assert.equal(isUserAuthorizedForDepartment(sushiChefA, 'dept_front'), false);
});

test('Requirement 4 & 7: Branch resolution handles single vs multi-branch prompt', () => {
  const multiBranches = getUserAuthorizedBranches(sushiChefA, branches);
  assert.equal(multiBranches.length, 3);
  assert.deepEqual(multiBranches.map(b => b.id), ['branch_a', 'branch_b', 'branch_c']);

  // Single-branch staff member
  const singleBranchStaff: User = {
    ...sushiChefA,
    id: 'user_staff_single',
    branchId: 'branch_a',
    branchIds: ['branch_a'],
    allBranches: false,
  };
  const singleBranches = getUserAuthorizedBranches(singleBranchStaff, branches);
  assert.equal(singleBranches.length, 1);
  assert.equal(singleBranches[0].id, 'branch_a');
});

test('Requirement 6: 6-Condition Supplier Filtering Matrix on Monday at Branch A', () => {
  // Monday: Chef works at Branch A
  const eligibleAtA = filterSuppliersForOrdering(
    sushiChefA,
    suppliers,
    'branch_a',
    'dept_sushi',
    true // has create_orders action permission
  );

  const eligibleIdsAtA = eligibleAtA.map(s => s.id);
  // Both Japanese Food Supplier and Fish Supplier are permitted and serve Branch A
  assert.equal(eligibleIdsAtA.includes('sup_japanese'), true, 'Japanese Food Supplier must be visible at Branch A');
  assert.equal(eligibleIdsAtA.includes('sup_fish'), true, 'Fish Supplier must be visible at Branch A');

  // Meat Supplier does not support Sushi department -> hidden
  assert.equal(eligibleIdsAtA.includes('sup_meat'), false, 'Meat Supplier must not be visible for Sushi');

  // Produce Supplier serves Branch A & supports all depts, but is NOT permitted for the chef -> hidden
  assert.equal(eligibleIdsAtA.includes('sup_produce'), false, 'Produce Supplier must not be visible because chef only has Japanese & Fish permitted');

  // Retired supplier must never appear in new ordering
  assert.equal(eligibleIdsAtA.includes('sup_retired'), false, 'Retired supplier must be hidden');
});

test('Requirement 6: 6-Condition Supplier Filtering Matrix on Tuesday at Branch B', () => {
  // Tuesday: Chef works at Branch B
  const eligibleAtB = filterSuppliersForOrdering(
    sushiChefA,
    suppliers,
    'branch_b',
    'dept_sushi',
    true
  );

  const eligibleIdsAtB = eligibleAtB.map(s => s.id);
  // Japanese Food Supplier serves All Branches -> visible at Branch B
  assert.equal(eligibleIdsAtB.includes('sup_japanese'), true, 'Japanese Food Supplier must be visible at Branch B');

  // Fish Supplier serves Branch A and C, but NOT Branch B -> MUST BE HIDDEN at Branch B
  assert.equal(eligibleIdsAtB.includes('sup_fish'), false, 'Fish Supplier must be HIDDEN at Branch B because it does not serve Branch B');

  // Meat Supplier does not support Sushi -> hidden
  assert.equal(eligibleIdsAtB.includes('sup_meat'), false);
  // Unauthorized produce supplier -> hidden
  assert.equal(eligibleIdsAtB.includes('sup_produce'), false);
});

test('Requirement 6: Unauthorized branch D yields zero eligible suppliers', () => {
  // Chef is NOT authorized for Branch D
  const eligibleAtD = filterSuppliersForOrdering(
    sushiChefA,
    suppliers,
    'branch_d',
    'dept_sushi',
    true
  );
  assert.equal(eligibleAtD.length, 0, 'No suppliers should be returned for unauthorized branch');
});

test('Requirement 4: Action permissions gate order creation and submission', () => {
  // If user lacks create_orders permission, filterSuppliersForOrdering returns empty list
  const eligibleWithoutPermission = filterSuppliersForOrdering(
    sushiChefA,
    suppliers,
    'branch_a',
    'dept_sushi',
    false // lacks create_orders
  );
  assert.equal(eligibleWithoutPermission.length, 0);

  // Staff without submit_orders permission cannot submit
  const viewOnlyChef: User = {
    ...sushiChefA,
    customPermissions: ['view_order_history'],
  };
  assert.equal(isSupplierEligibleForOrder(viewOnlyChef, suppliers[0], 'branch_a', 'dept_sushi', false), false);
});

test('Requirement 8 & 11: Server order authorization validates branch, department, supplier and creates immutable audit record', () => {
  const validDraft: Partial<OrderRecord> = {
    id: 'ord_12345678',
    orderedByUserId: sushiChefA.id,
    orderedByNameSnapshot: sushiChefA.displayName,
    branchId: 'branch_b',
    branchNameSnapshot: 'Branch B (Piccadilly)',
    departmentId: 'dept_sushi',
    departmentNameSnapshot: 'Sushi',
    supplierId: 'sup_japanese',
    supplierNameSnapshot: 'Japanese Food Supplier',
    createdAt: new Date().toISOString(),
    status: 'PLACED',
    items: [],
    manualItems: [],
  };

  // Valid order for authorized Branch B, Sushi department, and Japanese Food Supplier passes
  const validated = validateOrderCreation(sushiChefA as any, validDraft);
  assert.equal(validated.branchId, 'branch_b');
  assert.equal(validated.departmentId, 'dept_sushi');
  assert.equal(validated.supplierId, 'sup_japanese');

  // Attempting to submit for unauthorized Branch D must fail
  assert.throws(() => {
    validateOrderCreation(sushiChefA as any, {
      ...validDraft,
      branchId: 'branch_d',
    });
  }, (err: any) => err instanceof OrderAuthorizationError && err.status === 403);

  // Attempting to submit for unauthorized Department (Kitchen) must fail
  assert.throws(() => {
    validateOrderCreation(sushiChefA as any, {
      ...validDraft,
      departmentId: 'dept_kitchen',
    });
  }, (err: any) => err instanceof OrderAuthorizationError && err.status === 403);

  // Attempting to submit for unauthorized Supplier (Meat Supplier) must fail
  assert.throws(() => {
    validateOrderCreation(sushiChefA as any, {
      ...validDraft,
      supplierId: 'sup_meat',
    });
  }, (err: any) => err instanceof OrderAuthorizationError && err.status === 403);

  // Attempting to create order under another user ID must fail
  assert.throws(() => {
    validateOrderCreation(sushiChefA as any, {
      ...validDraft,
      orderedByUserId: 'user_impostor',
    });
  }, (err: any) => err instanceof OrderAuthorizationError && err.status === 403);
});

test('Requirement 10: Historical order visibility respects branch, department, supplier and view_other_users_orders', () => {
  const pastOrders: OrderRecord[] = [
    // 1. Chef's own Sushi order at Branch A
    {
      id: 'ord_own_a',
      branchId: 'branch_a',
      branchNameSnapshot: 'Branch A',
      supplierId: 'sup_japanese',
      supplierNameSnapshot: 'Japanese Food Supplier',
      orderedByUserId: sushiChefA.id,
      orderedByNameSnapshot: sushiChefA.displayName,
      departmentId: 'dept_sushi',
      departmentNameSnapshot: 'Sushi',
      createdAt: '2026-09-01T10:00:00Z',
      items: [],
      manualItems: [],
      status: 'PLACED',
      emailTo: 'orders@japanesefood.test',
    },
    // 2. Another user's Sushi order at Branch A (e.g. previous shift chef)
    {
      id: 'ord_other_sushi_a',
      branchId: 'branch_a',
      branchNameSnapshot: 'Branch A',
      supplierId: 'sup_japanese',
      supplierNameSnapshot: 'Japanese Food Supplier',
      orderedByUserId: 'user_sushi_chef_b',
      orderedByNameSnapshot: 'Sushi Chef B',
      departmentId: 'dept_sushi',
      departmentNameSnapshot: 'Sushi',
      createdAt: '2026-09-02T10:00:00Z',
      items: [],
      manualItems: [],
      status: 'PLACED',
      emailTo: 'orders@japanesefood.test',
    },
    // 3. Another user's Kitchen order at Branch A
    {
      id: 'ord_other_kitchen_a',
      branchId: 'branch_a',
      branchNameSnapshot: 'Branch A',
      supplierId: 'sup_meat',
      supplierNameSnapshot: 'Meat Supplier',
      orderedByUserId: 'user_kitchen_chef',
      orderedByNameSnapshot: 'Kitchen Chef',
      departmentId: 'dept_kitchen',
      departmentNameSnapshot: 'Kitchen',
      createdAt: '2026-09-03T10:00:00Z',
      items: [],
      manualItems: [],
      status: 'PLACED',
      emailTo: 'orders@meatsupplier.test',
    },
    // 4. Order at Branch D (outside chef's authorized branches)
    {
      id: 'ord_branch_d',
      branchId: 'branch_d',
      branchNameSnapshot: 'Branch D',
      supplierId: 'sup_japanese',
      supplierNameSnapshot: 'Japanese Food Supplier',
      orderedByUserId: 'user_ealing_chef',
      orderedByNameSnapshot: 'Ealing Chef',
      departmentId: 'dept_sushi',
      departmentNameSnapshot: 'Sushi',
      createdAt: '2026-09-04T10:00:00Z',
      items: [],
      manualItems: [],
      status: 'PLACED',
      emailTo: 'orders@japanesefood.test',
    },
    // 5. Order with retired supplier (from past year)
    {
      id: 'ord_retired_sup',
      branchId: 'branch_a',
      branchNameSnapshot: 'Branch A',
      supplierId: 'sup_japanese', // was permitted
      supplierNameSnapshot: 'Japanese Food Supplier',
      orderedByUserId: sushiChefA.id,
      orderedByNameSnapshot: sushiChefA.displayName,
      departmentId: 'dept_sushi',
      departmentNameSnapshot: 'Sushi',
      createdAt: '2025-09-01T10:00:00Z',
      items: [],
      manualItems: [],
      status: 'PLACED',
      emailTo: 'orders@japanesefood.test',
    },
  ];

  // A) Standard chef WITHOUT view_other_users_orders: sees ONLY own orders within authorized scope
  const filteredStandard = pastOrders.filter(o => {
    if (!isUserAuthorizedForBranch(sushiChefA, o.branchId)) return false;
    if (sushiChefA.departmentIds && o.departmentId && !sushiChefA.departmentIds.includes(o.departmentId)) return false;
    if (sushiChefA.allSuppliers === false && sushiChefA.supplierIds && !sushiChefA.supplierIds.includes(o.supplierId)) return false;
    // Without view_other_users_orders:
    if (o.orderedByUserId !== sushiChefA.id) return false;
    return true;
  });

  assert.equal(filteredStandard.length, 2);
  assert.deepEqual(filteredStandard.map(o => o.id), ['ord_own_a', 'ord_retired_sup']);

  // B) Handover scenario: Admin/GM grants view_other_users_orders to Sushi Chef A
  const handoverChef: User = {
    ...sushiChefA,
    customPermissions: [...sushiChefA.customPermissions!, 'view_other_users_orders'],
  };

  const filteredHandover = pastOrders.filter(o => {
    if (!isUserAuthorizedForBranch(handoverChef, o.branchId)) return false;
    if (handoverChef.departmentIds && o.departmentId && !handoverChef.departmentIds.includes(o.departmentId)) return false;
    if (handoverChef.allSuppliers === false && handoverChef.supplierIds && !handoverChef.supplierIds.includes(o.supplierId)) return false;
    // With view_other_users_orders: can view other users' orders within authorized branch & dept!
    return true;
  });

  // Handover chef sees: ord_own_a, ord_other_sushi_a, ord_retired_sup
  // DOES NOT see: ord_other_kitchen_a (wrong dept) or ord_branch_d (wrong branch)
  assert.equal(filteredHandover.length, 3);
  assert.deepEqual(filteredHandover.map(o => o.id), ['ord_own_a', 'ord_other_sushi_a', 'ord_retired_sup']);
  assert.equal(filteredHandover.some(o => o.id === 'ord_other_kitchen_a'), false, 'Kitchen orders must remain hidden');
  assert.equal(filteredHandover.some(o => o.id === 'ord_branch_d'), false, 'Branch D orders must remain hidden');
});

test('Requirement 12: Manager cannot administer cross-branch users or users outside their branch', () => {
  const branchAManager = {
    id: 'user_manager_a',
    role: 'MANAGER',
    branchId: 'branch_a',
    active: true,
  };

  // Branch A manager trying to modify Sushi Chef A (who covers branch_a, branch_b, branch_c)
  // Must be rejected because Sushi Chef A covers branches beyond manager's branch!
  assert.throws(() => {
    checkUserAdminPermission(
      branchAManager as any,
      sushiChefA.id,
      {
        role: 'STAFF',
        branchId: 'branch_a',
        active: true,
        branchIds: sushiChefA.branchIds,
      },
      {
        role: 'STAFF',
        branchId: 'branch_a',
        active: true,
        branchIds: sushiChefA.branchIds,
      },
      'update'
    );
  }, (err: any) => err.status === 403);

  // GM can manage cross-branch users
  const gmUser = {
    id: 'user_gm',
    role: 'GM',
    active: true,
  };

  assert.doesNotThrow(() => {
    checkUserAdminPermission(
      gmUser as any,
      sushiChefA.id,
      {
        role: 'STAFF',
        branchId: 'branch_a',
        active: true,
        branchIds: sushiChefA.branchIds,
      },
      {
        role: 'STAFF',
        branchId: 'branch_a',
        active: true,
        branchIds: ['branch_a', 'branch_b', 'branch_c'],
      },
      'update'
    );
  });
});
