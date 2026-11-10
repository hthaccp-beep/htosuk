type OrderedUser = {
  id: string; role: string; active?: boolean; branchId?: string;
  allBranches?: boolean; branchIds?: string[]; displayOrder?: number;
};

export function canReorderUser(actor: OrderedUser | null | undefined, target: OrderedUser): boolean {
  if (actor?.active !== true) return false;
  if (actor.role === 'CREATOR') return ['CREATOR', 'GM', 'MANAGER', 'STAFF'].includes(target.role);
  if (actor.role === 'GM') return ['MANAGER', 'STAFF'].includes(target.role);
  return actor.role === 'MANAGER' && !!actor.branchId?.trim() && target.role === 'STAFF'
    && target.branchId === actor.branchId && !target.allBranches
    && !(target.branchIds || []).some(id => id !== actor.branchId);
}

export function planUserMove(users: OrderedUser[], source: number, destination: number, actor: OrderedUser | null | undefined) {
  if (source === destination) return [];
  if (!users[source] || !users[destination] || !canReorderUser(actor, users[source])) {
    throw new Error('You cannot rearrange this account.');
  }
  const ordered = [...users];
  const [moved] = ordered.splice(source, 1);
  ordered.splice(destination, 0, moved);
  const before = ordered[destination - 1]?.displayOrder ?? 0;
  const after = ordered[destination + 1]?.displayOrder ?? 0;
  const rank = destination === 0 ? after - 10 : destination === ordered.length - 1 ? before + 10 : before + (after - before) / 2;
  if (Number.isFinite(rank) && (destination === 0 || rank > before) && (destination === ordered.length - 1 || rank < after)) {
    return [{id: moved.id, displayOrder: rank}];
  }
  // Older imports can contain equal ranks. Repair those ranks in the same save.
  const changes = ordered.map((user, index) => ({user, displayOrder: (index + 1) * 10}))
    .filter(({user, displayOrder}) => user.displayOrder !== displayOrder);
  if (changes.some(({user}) => !canReorderUser(actor, user))) {
    throw new Error('These accounts have overlapping positions. Ask the workspace owner to rearrange this list.');
  }
  return changes.map(({user, displayOrder}) => ({id: user.id, displayOrder}));
}
