import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useRuns, useStartRun } from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';
import { formatStarted, runDuration } from '../../lib/format.js';
import { COUNT_COLUMNS, StatusBadge } from './parts.js';
import { RunDrawer } from './RunDrawer.js';

export function RunsPage() {
  const runs = useRuns();
  const start = useStartRun();
  const toast = useToast();
  const [openRun, setOpenRun] = useState<string | null>(null);

  const anyRunning = runs.data?.some((r) => r.status === 'running') ?? false;

  const runNow = () =>
    start
      .mutateAsync()
      .then((r) =>
        toast.push(
          'success',
          r.queries === 0
            ? 'Nothing to search: no active search profile. Add or activate one on the CVs page.'
            : `Run started: ${r.queries} search${r.queries === 1 ? '' : 'es'} queued.`,
        ),
      )
      .catch((err: unknown) =>
        toast.push('error', err instanceof ApiError ? err.message : 'Could not start a run.'),
      );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Runs</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Job Scout scans automatically on weekdays at 07:00, 12:00 and 17:00 (and Sundays at
            17:00), UK time.
          </p>
        </div>
        <Button
          variant="primary"
          loading={start.isPending}
          disabled={anyRunning}
          onClick={() => void runNow()}
        >
          {anyRunning ? 'Run in progress' : 'Run now'}
        </Button>
      </div>

      {runs.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading runs" className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-[var(--surface-2)]" />
          ))}
        </div>
      ) : null}

      {runs.isError ? (
        <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
          <p>Could not load the run history.</p>
          <Button className="mt-2" onClick={() => void runs.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {runs.data && runs.data.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          No runs yet. Click <strong>Run now</strong> to scan for jobs, or wait for the next
          scheduled scan.
        </p>
      ) : null}

      {runs.data && runs.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Recent runs, newest first</caption>
            <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
              <tr>
                <th scope="col" className="p-3">
                  Started
                </th>
                <th scope="col" className="p-3">
                  Trigger
                </th>
                <th scope="col" className="p-3">
                  Status
                </th>
                {COUNT_COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="p-3 text-right">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="p-3 text-right">
                  Reed calls
                </th>
                <th scope="col" className="p-3">
                  Duration
                </th>
                <th scope="col" className="p-3 text-right">
                  Errors
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => (
                <tr key={run.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => setOpenRun(run.id)}
                      className="text-left font-medium underline decoration-dotted underline-offset-2"
                      aria-label={`Open details of the run started ${formatStarted(run.startedAt)}`}
                    >
                      {formatStarted(run.startedAt)}
                    </button>
                  </td>
                  <td className="p-3">{run.trigger === 'cron' ? 'Scheduled' : 'Manual'}</td>
                  <td className="p-3">
                    <StatusBadge status={run.status} phase={run.phase} />
                  </td>
                  {COUNT_COLUMNS.map((c) => (
                    <td key={c.key} className="p-3 text-right tabular-nums">
                      {run.counts[c.key] ?? 0}
                    </td>
                  ))}
                  <td className="p-3 text-right tabular-nums">{run.reedCalls}</td>
                  <td className="p-3">{runDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="p-3 text-right tabular-nums">{run.errorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {openRun ? <RunDrawer runId={openRun} onClose={() => setOpenRun(null)} /> : null}
    </div>
  );
}
