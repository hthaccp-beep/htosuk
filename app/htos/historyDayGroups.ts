const dateKey = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
const dateLabel = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',year:'numeric'});

/** Group an already sorted, permission-filtered list by the London order date. */
export function historyDayGroups<T extends {createdAt:string}>(orders:T[]) {
  const groups = new Map<string,{key:string;label:string;orders:T[]}>();
  for (const order of orders) {
    const date = new Date(order.createdAt);
    const valid = Number.isFinite(date.getTime());
    const key = valid ? dateKey.format(date) : 'unknown';
    let group = groups.get(key);
    if (!group) {
      group = {key,label:valid ? dateLabel.format(date) : 'Order date unavailable',orders:[]};
      groups.set(key,group);
    }
    group.orders.push(order);
  }
  return [...groups.values()];
}
