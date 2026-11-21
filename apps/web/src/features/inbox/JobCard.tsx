import type { GroupListItem } from '@job-scout/shared';
import { forwardRef } from 'react';
import { Button } from '../../components/ui/Button.js';
import { postedAgo } from '../../lib/jobFormat.js';
import { BAND_LABEL, DEFAULT_THRESHOLDS, scoreBand } from '../../lib/triage.js';

const BAND_STYLE = {
  strong: 'border-[var(--success)] text-[var(--success)]',
  good: 'border-[var(--accent)] text-[var(--accent)]',
  maybe: 'border-[var(--warning)] text-[var(--warning)]',
  low: 'border-[var(--border)] text-[var(--muted)]',
} as const;

const SOURCE_LABEL: Record<string, string> = { reed: 'Reed', adzuna: 'Adzuna' };
const MODE_LABEL = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site' } as const;
const IR35_LABEL = { outside: 'Outside IR35', inside: 'Inside IR35' } as const;

/** The score as a ring plus a word (Strong/Good/Maybe), so colour is never the only signal. */
export function ScoreBadge({
  item,
  thresholds = DEFAULT_THRESHOLDS,
}: {
  item: GroupListItem;
  thresholds?: { badgeStrong: number; badgeGood: number; badgeMaybe: number } | undefined;
}) {
  if (item.finalScore === null) {
    return (
      <div
        className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 border-dashed border-[var(--border)] text-[var(--muted)]"
        title="First-pass estimate from text similarity; the AI has not assessed this job."
      >
        <span className="text-sm font-semibold">
          {item.prefilterScore === null ? '—' : `~${Math.round(item.prefilterScore)}`}
        </span>
        <span className="text-[10px]">Unrated</span>
      </div>
    );
  }
  const band = scoreBand(item.finalScore, thresholds);
  return (
    <div
      className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-4 ${BAND_STYLE[band]}`}
      title={`Overall score ${Math.round(item.finalScore)}`}
    >
      <span className="text-base leading-none font-bold">{Math.round(item.finalScore)}</span>
      <span className="text-[10px]">{BAND_LABEL[band]}</span>
    </div>
  );
}

type Props = {
  item: GroupListItem;
  focused: boolean;
  thresholds?: { badgeStrong: number; badgeGood: number; badgeMaybe: number } | undefined;
  onFocus: () => void;
  onOpen: () => void;
  onShortlist: () => void;
  onSkip: () => void;
};

export const JobCard = forwardRef<HTMLElement, Props>(function JobCard(
  { item, focused, thresholds, onFocus, onOpen, onShortlist, onSkip },
  ref,
) {
  const { job, assessment } = item;
  const title = job.title ?? 'Untitled role';
  const strengths = assessment?.status === 'ok' ? assessment.strengths.slice(0, 3) : [];
  const gaps = assessment?.status === 'ok' ? assessment.gaps.slice(0, 2) : [];
  const flags = assessment?.redFlags ?? [];

  return (
    <article
      ref={ref}
      aria-label={title}
      aria-current={focused || undefined}
      tabIndex={-1}
      onFocus={onFocus}
      className={`flex gap-3 rounded-lg border bg-[var(--surface)] p-4 ${
        focused ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]' : 'border-[var(--border)]'
      }`}
    >
      <ScoreBadge item={item} thresholds={thresholds} />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="font-semibold">
            <button
              type="button"
              className="text-left underline-offset-2 hover:underline"
              onClick={onOpen}
            >
              {title}
            </button>
          </h3>
          <span className="text-xs whitespace-nowrap text-[var(--muted)]">
            {postedAgo(job.postedAt)}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)]">
          {job.employerName ?? 'Unknown employer'} · {job.location ?? 'Location not stated'}
        </p>

        <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Key facts">
          <li className="rounded-full border border-[var(--border)] px-2 py-0.5 font-medium">
            {job.payText}
          </li>
          {job.employmentType ? (
            <li className="rounded-full border border-[var(--border)] px-2 py-0.5">
              {job.employmentType}
              {job.contractLengthMonths ? ` · ${job.contractLengthMonths} months` : ''}
            </li>
          ) : null}
          {job.ir35 && job.ir35 !== 'unknown' ? (
            <li className="rounded-full border border-[var(--border)] px-2 py-0.5">
              {IR35_LABEL[job.ir35]}
            </li>
          ) : null}
          {job.workMode && job.workMode !== 'unknown' ? (
            <li className="rounded-full border border-[var(--border)] px-2 py-0.5">
              {MODE_LABEL[job.workMode]}
              {assessment?.onsiteDaysPerWeek
                ? ` · ${assessment.onsiteDaysPerWeek} days on site`
                : ''}
            </li>
          ) : null}
          {job.source !== 'reed' ? (
            <li className="rounded-full border border-[var(--border)] px-2 py-0.5">
              via {SOURCE_LABEL[job.source] ?? job.source}
            </li>
          ) : null}
          {item.bestCv ? (
            <li className="rounded-full border border-[var(--border)] px-2 py-0.5">
              CV: {item.bestCv}
            </li>
          ) : null}
        </ul>

        {assessment?.status === 'ok' && assessment.headline ? (
          <p className="text-sm">{assessment.headline}</p>
        ) : null}
        {assessment?.status === 'failed' ? (
          <p className="text-sm text-[var(--muted)]">
            The AI could not assess this job; showing the first-pass estimate.
          </p>
        ) : null}
        {strengths.length > 0 || gaps.length > 0 ? (
          <ul className="grid gap-0.5 text-sm">
            {strengths.map((s) => (
              <li key={s}>
                <span aria-hidden="true">✓ </span>
                <span className="sr-only">Strength: </span>
                {s}
              </li>
            ))}
            {gaps.map((g) => (
              <li key={g} className="text-[var(--muted)]">
                <span aria-hidden="true">△ </span>
                <span className="sr-only">Gap: </span>
                {g}
              </li>
            ))}
          </ul>
        ) : null}
        {flags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Red flags">
            {flags.map((f) => (
              <li
                key={f}
                className="rounded-full border border-[var(--danger)] px-2 py-0.5 text-[var(--danger)]"
              >
                <span aria-hidden="true">⚠ </span>
                {f}
              </li>
            ))}
          </ul>
        ) : null}
        {item.alsoPostedBy.length > 0 ? (
          <p className="text-xs text-[var(--muted)]">
            Also posted by:{' '}
            {item.alsoPostedBy.map((p, i) => (
              <span key={p.id}>
                {i > 0 ? ', ' : ''}
                {p.employerName ?? 'unknown'} ({p.payText})
              </span>
            ))}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onShortlist} aria-keyshortcuts="a">
            Shortlist
          </Button>
          <Button onClick={onSkip} aria-keyshortcuts="x">
            Skip
          </Button>
          {job.url ? (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--surface-2)]"
              aria-keyshortcuts="o"
            >
              Open advert<span className="sr-only"> (new tab)</span>
            </a>
          ) : null}
          <Button variant="ghost" onClick={onOpen}>
            Details
          </Button>
        </div>
      </div>
    </article>
  );
});
