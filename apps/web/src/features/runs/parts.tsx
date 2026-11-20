import type { RunPhase, RunStatus } from '@job-scout/shared';
import { Badge } from '../../components/ui/Badge.js';

/** The counters a run reports, in the order the Runs page shows them. */
export const COUNT_COLUMNS = [
  { key: 'fetched', label: 'Fetched' },
  { key: 'new', label: 'New' },
  { key: 'filtered', label: 'Filtered' },
  { key: 'dupes', label: 'Duplicates' },
  { key: 'prefiltered', label: 'Shortlisted by similarity' },
  { key: 'llmScored', label: 'Scored' },
] as const;

/** Counters shown only in a run's detail panel (the table is already wide). */
export const EXTRA_COUNTS = [
  { key: 'tooOld', label: 'Skipped (posted too long ago)' },
  { key: 'deferred', label: 'Left for the next run (Reed budget)' },
] as const;

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  stale: 'Timed out',
};

const PHASE_LABEL: Record<RunPhase, string> = {
  ingest: 'fetching',
  scoring: 'scoring',
  done: '',
};

/** Status as words (and a tone), never colour alone. */
export function StatusBadge({ status, phase }: { status: RunStatus; phase: RunPhase }) {
  const tone = status === 'completed' ? 'success' : status === 'running' ? 'neutral' : 'warning';
  const detail = status === 'running' && PHASE_LABEL[phase] ? ` — ${PHASE_LABEL[phase]}` : '';
  return (
    <Badge tone={tone}>
      {STATUS_LABEL[status]}
      {detail}
    </Badge>
  );
}
