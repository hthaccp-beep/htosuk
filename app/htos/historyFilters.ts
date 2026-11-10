import type {OrderRecord} from '../../types';
import {isOrderInList} from '../../shared/order-list';

type HistoryOrder = Pick<OrderRecord,'id'|'branchId'|'supplierId'|'branchNameSnapshot'|'supplierNameSnapshot'|'status'|'receivedStatus'|'archived'>;

// Only use the orders already loaded within the user's existing access scope.
export function historySuppliers(orders: readonly HistoryOrder[]) {
  const suppliers = new Map<string,string>();
  for (const order of orders) {
    if (!suppliers.has(order.supplierId)) suppliers.set(order.supplierId,order.supplierNameSnapshot || 'Unnamed supplier');
  }
  return [...suppliers].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'en-GB'));
}

export function matchesHistoryFilters(order: OrderRecord, filters:{branchId:string;supplierId:string;status:string;search:string}) {
  const query=filters.search.trim().toLowerCase();
  const text=`${order.supplierNameSnapshot} ${order.branchNameSnapshot} ${order.id}`.toLowerCase();
  const matchesSearch=query.startsWith('#')
    ? order.id.toLowerCase().includes(query.slice(1))
    : text.includes(query);
  return (!filters.branchId||order.branchId===filters.branchId)
    &&(!filters.supplierId||order.supplierId===filters.supplierId)
    &&isOrderInList(order,filters.status)&&matchesSearch;
}
