import type { RunSummary } from '@job-scout/shared';
import { useEffect } from 'react';
import { useRun } from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { formatStarted, runDuration } from '../../lib/format.js';
import { COUNT_COLUMNS, StatusBadge } from './parts.js';

/** Side panel with one run's progress, counters and errors. Escape or the button closes it. */
export function RunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const query = useRun(runId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label="Run details"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">Run details</h3>
        <Button variant="ghost" onClick={onClose} aria-label="Close run details">
          Close
        </Button>
      </div>

      {query.isPending ? <p aria-busy="true">Loading…</p> : null}
      {query.isError ? (
        <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
          <p>Could not load this run.</p>
          <Button className="mt-2" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {query.data ? <RunBody run={query.data} errors={query.data.errors} /> : null}
    </aside>
  );
}

function RunBody({
  run,
  errors,
}: {
  run: RunSummary & { pendingIngest: number; pendingScore: number };
  errors: { id: number; stage: string | null; ref: string | null; message: string | null }[];
}) {
  return (
    <div className="grid gap-4 text-sm">
      <div className="grid gap-1">
        <p>
          <StatusBadge status={run.status} phase={run.phase} />
        </p>
        <p>Started {formatStarted(run.startedAt)}</p>
        <p>
          {run.trigger === 'cron' ? 'Scheduled' : 'Started manually'} ·{' '}
          {runDuration(run.startedAt, run.finishedAt)}
        </p>
        {run.status === 'running' ? (
          <p className="text-[var(--muted)]">
            Waiting on {run.pendingIngest} task{run.pendingIngest === 1 ? '' : 's'}…
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {COUNT_COLUMNS.map(({ key, label }) => (
          <div key={key} className="flex justify-between border-b border-[var(--border)] py-1">
            <dt className="text-[var(--muted)]">{label}</dt>
            <dd className="font-medium">{run.counts[key] ?? 0}</dd>
          </div>
        ))}
        <div className="flex justify-between border-b border-[var(--border)] py-1">
          <dt className="text-[var(--muted)]">Reed calls</dt>
          <dd className="font-medium">{run.reedCalls}</dd>
        </div>
      </dl>

      <div>
        <h4 className="mb-1 font-semibold">Errors ({errors.length})</h4>
        {errors.length === 0 ? (
          <p className="text-[var(--muted)]">No errors.</p>
        ) : (
          <ul className="grid gap-2">
            {errors.map((e) => (
              <li key={e.id} className="rounded-md border border-[var(--danger)] p-2">
                <p className="font-medium">{e.stage ?? 'unknown stage'}</p>
                <p className="break-words">{e.message}</p>
                {e.ref ? <p className="break-all text-xs text-[var(--muted)]">{e.ref}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
