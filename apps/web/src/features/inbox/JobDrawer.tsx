import type { GroupDetail } from '@job-scout/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useGroup, useRescore, useSaveNotes } from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';
import { formatStarted } from '../../lib/format.js';
import { postedAgo } from '../../lib/jobFormat.js';
import { PIPELINE_STATUS_LABEL } from '../../lib/triage.js';
import { CoverNotePanel } from './CoverNotePanel.js';
import { ScoreBadge } from './JobCard.js';

export const DRAWER_TABS = [
  'Overview',
  'Postings',
  'Advert',
  'Cover note',
  'Notes & history',
] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number];
const TABS = DRAWER_TABS;
type Tab = DrawerTab;

/** Side panel with everything about one job. Deep-linkable (/job/:id); Escape closes it. */
export function JobDrawer({
  groupId,
  onClose,
  initialTab = 'Overview',
}: {
  groupId: string;
  onClose: () => void;
  initialTab?: DrawerTab;
}) {
  const query = useGroup(groupId);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select');
      if (e.key === 'Escape' && !typing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const detail = query.data;
  return (
    <aside
      role="dialog"
      aria-label="Job details"
      className="fixed inset-y-0 right-0 z-30 w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">{detail?.item.job.title ?? 'Job details'}</h3>
        <Button variant="ghost" onClick={onClose} aria-label="Close job details">
          Close
        </Button>
      </div>

      {query.isPending ? <p aria-busy="true">Loading…</p> : null}
      {query.isError ? (
        <div role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm">
          <p>
            {query.error instanceof ApiError && query.error.status === 404
              ? 'This job no longer exists.'
              : 'Could not load this job.'}
          </p>
          <Button className="mt-2" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {detail ? (
        <>
          <div role="tablist" aria-label="Sections" className="mb-4 flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  tab === t
                    ? 'border-[var(--accent)] font-semibold text-[var(--accent)]'
                    : 'border-[var(--border)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'Overview' ? <Overview detail={detail} /> : null}
          {tab === 'Postings' ? <Postings detail={detail} /> : null}
          {tab === 'Advert' ? <Advert detail={detail} /> : null}
          {tab === 'Cover note' ? (
            <CoverNotePanel groupId={groupId} defaultCvId={detail.item.bestCvId} />
          ) : null}
          {tab === 'Notes & history' ? <NotesAndHistory detail={detail} /> : null}
        </>
      ) : null}
    </aside>
  );
}

const List = ({ title, items, tone }: { title: string; items: string[]; tone?: 'danger' }) =>
  items.length === 0 ? null : (
    <div>
      <h4 className="mb-1 font-semibold">{title}</h4>
      <ul className={`grid gap-0.5 text-sm ${tone === 'danger' ? 'text-[var(--danger)]' : ''}`}>
        {items.map((i) => (
          <li key={i}>• {i}</li>
        ))}
      </ul>
    </div>
  );

function Overview({ detail }: { detail: GroupDetail }) {
  const { item, assessment, cvScores } = detail;
  const rescore = useRescore(item.id);
  const toast = useToast();
  const doRescore = () =>
    rescore
      .mutateAsync()
      .then((r) =>
        toast.push(
          'success',
          r.outcome === 'scored' ? 'Assessed again.' : 'The AI could not assess this job.',
        ),
      )
      .catch((err: unknown) =>
        toast.push('error', err instanceof ApiError ? err.message : 'Could not reassess.'),
      );

  return (
    <div className="grid gap-4 text-sm">
      <div className="flex items-center gap-3">
        <ScoreBadge item={item} />
        <div>
          <p className="font-medium">
            {item.job.employerName ?? 'Unknown employer'} · {item.job.location ?? 'No location'}
          </p>
          <p className="text-[var(--muted)]">
            {item.job.payText} · posted {postedAgo(item.job.postedAt)} ·{' '}
            {PIPELINE_STATUS_LABEL[item.status] ?? item.status}
          </p>
        </div>
      </div>

      {assessment ? (
        <>
          <p>{assessment.headline}</p>
          <p className="text-[var(--muted)]">
            Seniority: {assessment.seniority_match} · recommendation:{' '}
            {assessment.apply_recommendation.replace('_', ' ')} · confidence{' '}
            {Math.round(assessment.confidence * 100)}%
          </p>
          <List title="Strengths" items={assessment.strengths} />
          <List title="Gaps" items={assessment.gaps} />
          <List title="Red flags" items={assessment.red_flags} tone="danger" />
        </>
      ) : (
        <p className="text-[var(--muted)]">
          {item.assessment?.status === 'failed'
            ? 'The AI could not assess this job.'
            : 'The AI has not assessed this job yet.'}
        </p>
      )}

      {item.feedbackReasons.length > 0 ? (
        <div>
          <h4 className="mb-1 font-semibold">
            How your past choices changed this score ({item.feedbackAdj > 0 ? '+' : ''}
            {item.feedbackAdj})
          </h4>
          <ul className="grid gap-0.5">
            {item.feedbackReasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h4 className="mb-1 font-semibold">How each CV matches</h4>
        <ul className="grid gap-2">
          {cvScores.map((c) => {
            const pct = c.score ?? (c.similarity === null ? null : Math.round(c.similarity * 100));
            return (
              <li key={c.cvId}>
                <div className="flex justify-between">
                  <span>{c.label}</span>
                  <span>
                    {pct === null ? '—' : `${pct}${c.score === null ? '% text match' : ''}`}
                  </span>
                </div>
                <div className="h-2 rounded bg-[var(--surface-2)]" aria-hidden="true">
                  <div
                    className="h-2 rounded bg-[var(--accent)]"
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button loading={rescore.isPending} onClick={() => void doRescore()}>
          Assess again
        </Button>
        {item.job.url ? (
          <a
            href={item.job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--surface-2)]"
          >
            Open advert<span className="sr-only"> (new tab)</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Postings({ detail }: { detail: GroupDetail }) {
  return (
    <ul className="grid gap-3 text-sm">
      {detail.postings.map((p) => (
        <li key={p.id} className="rounded-md border border-[var(--border)] p-3">
          <p className="font-medium">
            {p.employerName ?? 'Unknown'}{' '}
            {p.isAgency ? <span className="text-[var(--muted)]">(agency)</span> : null}
          </p>
          <p className="text-[var(--muted)]">
            {p.payText} · {p.location ?? 'No location'} · posted {postedAgo(p.postedAt)}
          </p>
          <p className="mt-1 flex gap-3">
            {p.url ? (
              <a className="underline" href={p.url} target="_blank" rel="noopener noreferrer">
                Reed advert<span className="sr-only"> (new tab)</span>
              </a>
            ) : null}
            {p.externalApplyUrl ? (
              <a
                className="underline"
                href={p.externalApplyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Apply on the employer’s site<span className="sr-only"> (new tab)</span>
              </a>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Plain text, not HTML: adverts are untrusted, and text is all that is needed to read one. */
function Advert({ detail }: { detail: GroupDetail }) {
  return detail.descriptionText ? (
    <p className="text-sm leading-relaxed whitespace-pre-wrap">{detail.descriptionText}</p>
  ) : (
    <p className="text-sm text-[var(--muted)]">No advert text was stored.</p>
  );
}

function NotesAndHistory({ detail }: { detail: GroupDetail }) {
  const { item } = detail;
  const save = useSaveNotes(item.id);
  const toast = useToast();
  const [notes, setNotes] = useState(item.application?.notes ?? '');

  return (
    <div className="grid gap-4 text-sm">
      <div>
        <label htmlFor="job-notes" className="mb-1 block font-semibold">
          Notes
        </label>
        <textarea
          id="job-notes"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
        />
        <Button
          className="mt-2"
          loading={save.isPending}
          onClick={() =>
            save
              .mutateAsync(notes)
              .then(() => toast.push('success', 'Notes saved.'))
              .catch(() => toast.push('error', 'Could not save your notes.'))
          }
        >
          Save notes
        </Button>
      </div>
      <div>
        <h4 className="mb-1 font-semibold">History</h4>
        {detail.history.length === 0 ? (
          <p className="text-[var(--muted)]">
            Nothing yet. Shortlist, skip or apply to start a history.
          </p>
        ) : (
          <ul className="grid gap-1">
            {detail.history.map((h) => (
              <li key={h.id}>
                {PIPELINE_STATUS_LABEL[h.from ?? ''] ?? h.from ?? 'Start'} →{' '}
                <strong>{PIPELINE_STATUS_LABEL[h.to ?? ''] ?? h.to}</strong>
                {h.at ? (
                  <span className="text-[var(--muted)]"> · {formatStarted(h.at)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
