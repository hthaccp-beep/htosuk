import type {User, OrderRecord, Supplier, Branch} from '../types.ts';
import {hasIncomingBranchScope} from './order-scope.ts';
/** Workspace owners can dispatch for active internal branches; other roles need an explicit assignment. */
export function supplierDispatchAccess(user: User | null, order: OrderRecord, suppliers: Supplier[], branches: Branch[]) {
  if (!user || user.active !== true) return {allowed:false, reason:'An active account is required.'};
  if (order.status !== 'PLACED' || order.archived) return {allowed:false, reason:'Only active placed orders can be processed.'};
  const supplier = suppliers.find(s => s.id === order.supplierId);
  const branchId = supplier?.linkedBranchId || (!supplier ? order.supplierId : '');
  const branch = branches.find(b => b.id === branchId && b.active === true && b.actsAsSupplier === true);
  if ((supplier && !supplier.active) || !branch) return {allowed:false, reason:'Only an active internal supplier branch can process this order.'};
  const assigned = hasIncomingBranchScope(user,branch.id);
  return assigned ? {allowed:true} : {allowed:false, reason:'Only staff assigned to internal supplier branch "' + branch.name + '" may fulfill this order.'};
}
