import type { GroupListItem, SkipReason } from '@job-scout/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client.js';
import { useCvs, useGroups, useUpdateGroup } from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';
import { postedAgo } from '../../lib/jobFormat.js';
import { PIPELINE_COLUMNS, SKIP_REASONS } from '../../lib/triage.js';

type Target =
  | 'shortlisted'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'skipped'
  | 'withdrawn'
  | 'new';

const MOVES: { value: Target; label: string }[] = [
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'new', label: 'Back to Inbox' },
];

/** Asks which CV you sent and when, as moving to Applied requires (SPEC §9.1). */
function ApplyDialog({
  title,
  cvs,
  defaultCvId,
  onConfirm,
  onCancel,
}: {
  title: string;
  cvs: { id: string; label: string }[];
  defaultCvId: string | null;
  onConfirm: (cvIdSent: string, appliedAt: string) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [cvId, setCvId] = useState(defaultCvId ?? cvs[0]?.id ?? '');
  const [date, setDate] = useState(today);
  return (
    <div
      role="dialog"
      aria-label={`Applied to ${title}`}
      className="fixed top-24 left-1/2 z-40 w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
    >
      <h3 className="mb-3 font-semibold">Applied to “{title}”</h3>
      <div className="grid gap-3 text-sm">
        <label className="grid gap-1">
          Which CV did you send?
          <select
            value={cvId}
            onChange={(e) => setCvId(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
          >
            {cvs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          When did you apply?
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
          />
        </label>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={!cvId || !date}
            onClick={() => onConfirm(cvId, new Date(`${date}T12:00:00`).toISOString())}
          >
            Save
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function PipelineCard({
  item,
  onMove,
  onOpen,
}: {
  item: GroupListItem;
  onMove: (to: Target) => void;
  onOpen: () => void;
}) {
  return (
    <li className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
      <button
        type="button"
        onClick={onOpen}
        className="text-left font-semibold underline-offset-2 hover:underline"
      >
        {item.job.title ?? 'Untitled role'}
      </button>
      <p className="text-[var(--muted)]">
        {item.job.employerName ?? '—'} · {item.job.payText}
      </p>
      <p className="text-xs text-[var(--muted)]">
        {item.finalScore === null ? '' : `Score ${Math.round(item.finalScore)} · `}
        {item.application?.appliedAt
          ? `Applied ${postedAgo(item.application.appliedAt)}`
          : `Posted ${postedAgo(item.job.postedAt)}`}
      </p>
      {item.newPostingsSinceAction > 0 ? (
        <p className="mt-1 text-xs font-medium">
          +{item.newPostingsSinceAction} new posting{item.newPostingsSinceAction === 1 ? '' : 's'}{' '}
          since you acted
        </p>
      ) : null}
      {item.application?.skipReason ? (
        <p className="text-xs text-[var(--muted)]">
          Reason: {SKIP_REASONS.find((r) => r.value === item.application?.skipReason)?.label}
        </p>
      ) : null}
      <label className="mt-2 block text-xs">
        <span className="sr-only">Move {item.job.title ?? 'job'} to</span>
        <select
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value as Target)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-1"
        >
          <option value="">Move to…</option>
          {MOVES.filter((m) => m.value !== item.status).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

/** Your jobs by stage. Move a card with its menu; Applied asks which CV you sent. */
export function PipelinePage() {
  const groups = useGroups({ show: 'pipeline' });
  const cvs = useCvs();
  const update = useUpdateGroup();
  const toast = useToast();
  const navigate = useNavigate();
  const [showClosed, setShowClosed] = useState(false);
  const [applying, setApplying] = useState<GroupListItem | null>(null);

  const items = groups.data?.items ?? [];
  const fail = (err: unknown) =>
    toast.push('error', err instanceof ApiError ? err.message : 'That did not work. Try again.');

  const move = (
    item: GroupListItem,
    to: Target,
    extra: { cvIdSent?: string; appliedAt?: string; skipReason?: SkipReason } = {},
  ) =>
    update.mutate(
      { id: item.id, update: { status: to, ...extra } },
      {
        onSuccess: () => toast.push('success', `Moved “${item.job.title ?? 'job'}”.`),
        onError: fail,
      },
    );

  const onMove = (item: GroupListItem, to: Target) =>
    to === 'applied' ? setApplying(item) : move(item, to);
  const columns = showClosed
    ? [
        ...PIPELINE_COLUMNS,
        { status: 'skipped', label: 'Skipped' },
        { status: 'withdrawn', label: 'Withdrawn' },
      ]
    : PIPELINE_COLUMNS;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Pipeline</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          Show skipped and withdrawn
        </label>
      </div>

      {groups.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading pipeline"
          className="h-40 animate-pulse rounded-lg bg-[var(--surface-2)]"
        />
      ) : null}
      {groups.isError ? (
        <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
          <p>Could not load your pipeline.</p>
          <Button className="mt-2" onClick={() => void groups.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {groups.data && items.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          Nothing here yet. Shortlist a job in the Inbox and it appears under Shortlisted.
        </p>
      ) : null}

      {groups.data && items.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {columns.map((col) => {
            const cards = items.filter((i) => i.status === col.status);
            return (
              <section key={col.status} aria-label={col.label} className="grid content-start gap-2">
                <h3 className="text-sm font-semibold">
                  {col.label} <span className="text-[var(--muted)]">({cards.length})</span>
                </h3>
                <ul className="grid gap-2">
                  {cards.map((item) => (
                    <PipelineCard
                      key={item.id}
                      item={item}
                      onMove={(to) => onMove(item, to)}
                      onOpen={() => navigate(`/job/${item.id}`, { state: { from: '/pipeline' } })}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}

      {applying ? (
        <ApplyDialog
          title={applying.job.title ?? 'this job'}
          cvs={(cvs.data ?? []).map((c) => ({ id: c.id, label: c.label }))}
          defaultCvId={applying.bestCvId}
          onCancel={() => setApplying(null)}
          onConfirm={(cvIdSent, appliedAt) => {
            move(applying, 'applied', { cvIdSent, appliedAt });
            setApplying(null);
          }}
        />
      ) : null}
    </div>
  );
}
