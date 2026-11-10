import {subscribeProtectedRecords} from './secureRead';
import {isDatabaseQuotaError} from '../shared/database-errors.ts';
import { collection, query, where, onSnapshot, type Firestore, type QueryConstraint } from 'firebase/firestore';
import type { OrderPartition } from '../shared/order-scope.ts';
import type { OrderRecord } from '../types.ts';
import {shareFirestore} from '../hooks/sharedFirestore';

export function scopedOrderQuery(db: Firestore, partition: OrderPartition, ...extra: QueryConstraint[]) {
  const constraints: QueryConstraint[] = [];
  if (partition.branchId) constraints.push(where('branchId', '==', partition.branchId));
  if (partition.supplierId) constraints.push(where('supplierId', '==', partition.supplierId));
  return query(collection(db, 'orders'), ...constraints, ...extra);
}

export function subscribeOrderPartitions(db: Firestore, partitions: OrderPartition[], onOrders: (orders: OrderRecord[]) => void, onError: (error: unknown) => void, scope='',redacted=false) {
  const buckets = new Map<number, OrderRecord[]>();
  let disposed = false;
  const publish = () => {
    if (disposed) return;
    const merged = new Map<string, OrderRecord>();
    for (const orders of buckets.values()) for (const order of orders) merged.set(order.id, order);
    onOrders([...merged.values()]);
  };
  onOrders([]);
  const unsubscribers = partitions.map((partition, index) => shareFirestore<OrderRecord[]>(scope,'orders:partition:'+JSON.stringify([partition.branchId||'',partition.supplierId||'']),
   (next,error)=>redacted?subscribeProtectedRecords({resource:'orders',...partition},next,error):onSnapshot(scopedOrderQuery(db, partition),snap=>next(snap.docs.map(d=>({...d.data(),id:d.id,_hasPendingWrites:d.metadata.hasPendingWrites} as OrderRecord))),error), value => {
    if (disposed) return;
    buckets.set(index, value);
    publish();
  }, error => {
    if (disposed) return;
    if(!isDatabaseQuotaError(error)){buckets.delete(index);publish();}
    onError(error);
  }));
  return () => { disposed = true; unsubscribers.forEach(unsubscribe => unsubscribe()); };
}
