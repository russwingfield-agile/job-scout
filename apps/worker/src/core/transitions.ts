import type { GroupStatus } from '@job-scout/shared';

/** States you put a job in by acting on it. */
const USER_STATES: ReadonlySet<GroupStatus> = new Set([
  'shortlisted',
  'applied',
  'interview',
  'offer',
  'rejected',
  'skipped',
  'withdrawn',
]);

export const isUserState = (status: GroupStatus): boolean => USER_STATES.has(status);

/**
 * May a job move from `from` to `to`? You can act on any job you have not acted on yet, move
 * freely between your own states (so a mis-click or an undo is always possible), and send a job
 * back to the Inbox (`new`). Nothing can be moved *into* the system's own states by hand, and a
 * job never "moves" to where it already is.
 */
export function canTransition(from: GroupStatus, to: GroupStatus): boolean {
  if (from === to) return false;
  if (to === 'new') return isUserState(from);
  return isUserState(to);
}

/** Moving to `applied` must say which CV was sent (SPEC §9.1). */
export const requiresCvSent = (to: GroupStatus): boolean => to === 'applied';

/** Where a job returns to when sent back to the Inbox: assessed jobs are `new`, the rest wait to be assessed. */
export const restoredStatus = (hasAssessment: boolean): GroupStatus =>
  hasAssessment ? 'new' : 'prefiltered';
