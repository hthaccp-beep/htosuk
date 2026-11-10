// Kept independent of Firebase so UI queries and server checks share one scope.
export interface OrderScopeUser {
  id?: string;
  active: boolean;
  role: string;
  branchId?: string;
  branchIds?: string[];
  allBranches?: boolean;
  supplierIds?: string[];
  allSuppliers?: boolean;
  permissionMode?: string;
  customPermissions?: string[];
}

export interface OrderPartition { branchId?: string; supplierId?: string }

// Receiving/dispatching belongs to the supplying branch, not to everyone who
// can order from that supplier. The workspace owner retains oversight.
export function hasIncomingBranchScope(user: OrderScopeUser, branchId: string) {
  return user.active === true && Boolean(branchId) &&
    (user.role === 'CREATOR' || user.branchId === branchId || user.branchIds?.includes(branchId) === true);
}

export function incomingSupplierBranches<T extends {id:string;active:boolean;actsAsSupplier?:boolean}>(user: OrderScopeUser, branches:T[]) {
  return branches.filter(branch=>branch.active && branch.actsAsSupplier && hasIncomingBranchScope(user,branch.id));
}

export function incomingOrderSupplierIds(user: OrderScopeUser, suppliers:Array<{id:string;linkedBranchId?:string}>, branches:Array<{id:string;active:boolean;actsAsSupplier?:boolean}>) {
  const ids=new Set(incomingSupplierBranches(user,branches).map(branch=>branch.id));
  // Legacy internal orders used the branch ID directly. An external supplier
  // with the same ID must not be mistaken for that internal branch.
  return uniqueIds([...suppliers.filter(s=>s.linkedBranchId && ids.has(s.linkedBranchId)).map(s=>s.id),...Array.from(ids).filter(id=>!suppliers.some(s=>s.id===id))]);
}

export function isGlobalAdministrator(user: OrderScopeUser) {
  return user.active === true && ['CREATOR', 'GM'].includes(user.role);
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))].sort();
}

// null means unrestricted; an empty array means no assignments.
export function assignedBranches(user: OrderScopeUser): string[] | null {
  if (!user.active) return [];
  if (isGlobalAdministrator(user) || user.allBranches === true) return null;
  return uniqueIds([...(user.branchIds || []), ...(user.branchId ? [user.branchId] : [])]);
}

export function assignedSuppliers(user: OrderScopeUser): string[] | null {
  if (!user.active) return [];
  if (isGlobalAdministrator(user) || user.allSuppliers === true) return null;
  if (Array.isArray(user.supplierIds)) return uniqueIds(user.supplierIds);
  return user.allSuppliers === false ? [] : null; // Legacy profile compatibility.
}

export function hasBranchScope(user: OrderScopeUser, branchId: string) {
  const ids = assignedBranches(user);
  return Boolean(branchId) && (ids === null || ids.includes(branchId));
}

export function hasSupplierScope(user: OrderScopeUser, supplierId: string) {
  const ids = assignedSuppliers(user);
  return Boolean(supplierId) && (ids === null || ids.includes(supplierId));
}

export function outgoingOrderPartitions(user: OrderScopeUser): OrderPartition[] {
  const branches = assignedBranches(user);
  const suppliers = assignedSuppliers(user);
  // Exact equality queries avoid Firestore's disjunction limits and prove scope to rules.
  return (branches ?? [undefined]).flatMap(branchId =>
    (suppliers ?? [undefined]).map(supplierId => ({ branchId, supplierId })));
}

export function linkedSupplierIds(user: OrderScopeUser, suppliers: Array<{ id: string; linkedBranchId?: string }>) {
  return uniqueIds(suppliers.filter(s => s.linkedBranchId && hasIncomingBranchScope(user, s.linkedBranchId)).map(s => s.id));
}

export function orderScopeKey(user: OrderScopeUser | null, rolePermissions?: unknown) {
  return user ? JSON.stringify([user.id, user.active, user.role, assignedBranches(user), assignedSuppliers(user),user.branchId,user.branchIds,user.permissionMode,user.customPermissions,rolePermissions]) : '';
}

// Keep the same authorized result union, querying a covered partition only once.
export function historyOrderPartitions(user: OrderScopeUser, suppliers: Array<{ id: string; linkedBranchId?: string }>, incomingIds=linkedSupplierIds(user,suppliers)): OrderPartition[] {
  const candidates: OrderPartition[] = [...outgoingOrderPartitions(user), ...incomingIds.map(supplierId => ({ supplierId }))];
  const unique = [...new Map(candidates.map(p => [JSON.stringify([p.branchId || '', p.supplierId || '']), p])).values()];
  return unique.filter(p => !unique.some(other => other !== p &&
    (!other.branchId || other.branchId === p.branchId) &&
    (!other.supplierId || other.supplierId === p.supplierId)));
}
