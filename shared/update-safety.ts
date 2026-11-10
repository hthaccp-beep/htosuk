// Only in-memory flags; never stores form values, passwords or order contents.
const blockers = new Set<symbol>();
export function protectUpdate() {
  const id = Symbol();
  blockers.add(id);
  return () => { blockers.delete(id); };
}
export const updateBlockerCount = () => blockers.size;

export interface UpdateSafety {
  ready: boolean;
  signedIn: boolean;
  path: string;
  pending: number;
  drafts: boolean;
  protectedWork: number;
  editorOpen: boolean;
  enteredText: boolean;
  /** Opt-in from the mounted, audited Team list; never inferred from the URL alone. */
  teamListReady?: boolean;
}
export function updateHold(state: UpdateSafety): string {
  if (!state.ready) return 'Waiting for your workspace to finish opening.';
  if (state.pending) return 'An action is still processing. Wait for its result before updating.';
  if (state.drafts || state.protectedWork) return 'Save or finish your work, then open Overview to update. You do not need to send an order.';
  if (state.editorOpen || state.enteredText) return 'Finish and close the open form or dialogue before updating.';
  // Unknown/new screens fail closed. These are the existing read-only landing/list screens.
  const readyTeamList = state.path === '/settings' && state.teamListReady === true;
  if (state.signedIn && !readyTeamList && !['/', '/orders', '/deliveries', '/reports'].includes(state.path))
    return 'Save your work, then return to Overview to update safely.';
  return '';
}
