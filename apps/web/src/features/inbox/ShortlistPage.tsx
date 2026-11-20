import type { GroupListItem, Ir35, WorkMode } from '@job-scout/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useClearJobs, useGroups } from '../../api/queries.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';
import { describeFilterReason, postedAgo } from '../../lib/jobFormat.js';

const IR35_LABEL: Record<Ir35, string> = {
  outside: 'Outside IR35',
  inside: 'Inside IR35',
  unknown: 'Not stated',
};
const MODE_LABEL: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On site',
  unknown: '—',
};

function Row({ item, filtered }: { item: GroupListItem; filtered: boolean }) {
  const { job } = item;
  return (
    <tr className="border-b border-[var(--border)] align-top last:border-0">
      <td className="p-3 tabular-nums">
        {filtered ? (
          <span className="text-xs text-[var(--muted)]">
            {describeFilterReason(item.filterReason)}
          </span>
        ) : item.finalScore !== null ? (
          <strong title="Overall score from the AI assessment">
            {Math.round(item.finalScore)}
          </strong>
        ) : (
          <span
            className="text-[var(--muted)]"
            title="First-pass score from text similarity. The AI has not assessed this job yet."
          >
            {item.prefilterScore === null ? '—' : `~${Math.round(item.prefilterScore)}`}
          </span>
        )}
      </td>
      <td className="p-3">
        {job.url ? (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
          >
            {job.title ?? 'Untitled role'}
            <span className="sr-only"> (opens the advert on Reed)</span>
          </a>
        ) : (
          <span className="font-medium">{job.title ?? 'Untitled role'}</span>
        )}
        <div className="text-xs text-[var(--muted)]">
          {job.employmentType ?? ''}
          {job.contractLengthMonths ? ` · ${job.contractLengthMonths} months` : ''}
        </div>
        {item.assessment?.status === 'ok' ? (
          <div className="mt-1 grid gap-0.5 text-xs">
            {item.assessment.headline ? <p>{item.assessment.headline}</p> : null}
            {item.assessment.redFlags.length > 0 ? (
              <p className="text-[var(--muted)]">⚠ {item.assessment.redFlags.join(' · ')}</p>
            ) : null}
          </div>
        ) : null}
        {item.assessment?.status === 'failed' ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            The AI could not assess this job; showing the first-pass score.
          </p>
        ) : null}
      </td>
      <td className="p-3">{job.employerName ?? '—'}</td>
      <td className="p-3">{job.location ?? '—'}</td>
      <td className="p-3 whitespace-nowrap">{job.payText}</td>
      <td className="p-3">{job.ir35 ? IR35_LABEL[job.ir35] : '—'}</td>
      <td className="p-3">{job.workMode ? MODE_LABEL[job.workMode] : '—'}</td>
      <td className="p-3 whitespace-nowrap">{postedAgo(job.postedAt)}</td>
      <td className="p-3">{item.bestCv ?? '—'}</td>
    </tr>
  );
}

/**
 * A plain list of the jobs found so far, best first-pass match at the top. This is the plan's
 * "early-value" view: the full Inbox (filters, shortlist/skip actions, AI-ranked cards) is M8.
 */
export function ShortlistPage() {
  const [showFiltered, setShowFiltered] = useState(false);
  const groups = useGroups(showFiltered ? 'filtered' : 'shortlist');
  const clear = useClearJobs();
  const toast = useToast();

  const clearAll = () => {
    const sure = window.confirm(
      'Forget every job found so far? The next scan finds and scores them again with your current CV, filters and settings. Jobs you have acted on are kept.',
    );
    if (!sure) return;
    clear
      .mutateAsync()
      .then((r) =>
        toast.push('success', `Cleared ${r.removed} jobs. Run a scan on the Runs page to refill.`),
      )
      .catch((err: unknown) =>
        toast.push('error', err instanceof ApiError ? err.message : 'Could not clear jobs.'),
      );
  };
  const items = groups.data?.items ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-xl font-semibold">Shortlist</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Jobs found by your scans, best first. A plain number is the AI's overall score. A number
          with ~ is a first-pass estimate from text similarity, for jobs the AI has not assessed
          yet. The full Inbox with Shortlist and Skip buttons is coming.
        </p>
      </div>

      <div>
        <Button variant="danger" loading={clear.isPending} onClick={clearAll}>
          Clear all found jobs
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showFiltered}
          onChange={(e) => setShowFiltered(e.target.checked)}
        />
        Show jobs that were hidden by my filters, with the reason
      </label>

      {groups.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading jobs" className="grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-[var(--surface-2)]" />
          ))}
        </div>
      ) : null}

      {groups.isError ? (
        <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
          <p>Could not load your jobs.</p>
          <Button className="mt-2" onClick={() => void groups.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {groups.data && items.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          {showFiltered
            ? 'No jobs have been filtered out yet.'
            : 'No jobs yet. Go to Runs and click Run now to scan Reed. Jobs appear here as soon as they are processed.'}
        </p>
      ) : null}

      {groups.data && items.length > 0 ? (
        <>
          <p className="text-sm">
            <Badge>
              Showing {items.length} of {groups.data.total}
            </Badge>
          </p>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <caption className="sr-only">
                {showFiltered
                  ? 'Jobs hidden by your filters'
                  : 'Shortlisted jobs, best match first'}
              </caption>
              <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
                <tr>
                  <th scope="col" className="p-3">
                    {showFiltered ? 'Why hidden' : 'Match'}
                  </th>
                  <th scope="col" className="p-3">
                    Role
                  </th>
                  <th scope="col" className="p-3">
                    Employer / agency
                  </th>
                  <th scope="col" className="p-3">
                    Location
                  </th>
                  <th scope="col" className="p-3">
                    Pay
                  </th>
                  <th scope="col" className="p-3">
                    IR35
                  </th>
                  <th scope="col" className="p-3">
                    Work mode
                  </th>
                  <th scope="col" className="p-3">
                    Posted
                  </th>
                  <th scope="col" className="p-3">
                    Best CV
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <Row key={item.id} item={item} filtered={showFiltered} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--muted)]">Adverts open on Reed in a new tab.</p>
        </>
      ) : null}
    </div>
  );
}
