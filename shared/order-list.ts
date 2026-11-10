import type {OrderRecord} from '../types.ts';

export function isOrderInList(order:OrderRecord,status:string) {
  if(status==='ARCHIVED')return order.archived===true;
  if(order.archived===true)return false;
  return status==='ALL'||order.status===status||
    status==='OPEN'&&order.status==='PLACED'&&order.receivedStatus!=='PROCESSED'||
    status==='PROCESSED'&&order.receivedStatus==='PROCESSED';
}
