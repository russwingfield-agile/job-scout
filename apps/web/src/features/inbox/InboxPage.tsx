import type { GroupListItem, SkipReason } from '@job-scout/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client.js';
import {
  useClearJobs,
  useCvs,
  useGroups,
  useStats,
  useThresholds,
  useUpdateGroup,
} from '../../api/queries.js';
import { Button } from '../../components/ui/Button.js';
import { useToast } from '../../components/ui/Toast.js';
import { describeFilterReason } from '../../lib/jobFormat.js';
import { formatNextScan, SKIP_REASONS } from '../../lib/triage.js';
import { FilterBar, useInboxFilters } from './FilterBar.js';
import { JobCard } from './JobCard.js';
import type { DrawerTab } from './JobDrawer.js';
import { SkipReasonPicker } from './SkipReasonPicker.js';
import { SuggestionCards } from './SuggestionCards.js';

const SHORTCUTS: [string, string][] = [
  ['j / k', 'Next / previous job'],
  ['a', 'Shortlist'],
  ['x', 'Skip (then 1–9 to give a reason)'],
  ['o', 'Open the advert on Reed'],
  ['c', 'Write a cover note'],
  ['Enter', 'Open details'],
  ['?', 'Show or hide this help'],
];

/** Typing in a field, or a dialog taking the keys: leave the keyboard alone. */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.closest('input, textarea, select, [contenteditable]') !== null;

/** The jobs waiting for your decision. Every action is optimistic and can be undone. */
export function InboxPage({ paused = false }: { paused?: boolean }) {
  const filters = useInboxFilters();
  const { params } = filters;
  const groups = useGroups(params);
  const cvs = useCvs();
  const stats = useStats();
  const thresholds = useThresholds();
  const update = useUpdateGroup();
  const clear = useClearJobs();
  const toast = useToast();
  const navigate = useNavigate();

  const items = groups.data?.items ?? [];
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<GroupListItem | null>(null);
  const [help, setHelp] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const decidable = params.show !== 'filtered';
  const focused = items.find((i) => i.id === focusedId) ?? items[0] ?? null;

  useEffect(() => {
    if (focused) cardRefs.current.get(focused.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);

  const fail = (err: unknown) =>
    toast.push('error', err instanceof ApiError ? err.message : 'That did not work. Try again.');

  const act = (
    item: GroupListItem,
    change: Parameters<typeof update.mutate>[0]['update'],
    verb: string,
  ) => {
    const next = items[items.findIndex((i) => i.id === item.id) + 1] ?? items[0];
    setFocusedId(next && next.id !== item.id ? next.id : null);
    update.mutate(
      { id: item.id, update: change },
      {
        onSuccess: () =>
          toast.push('success', `${verb} “${item.job.title ?? 'job'}”.`, {
            label: 'Undo',
            onClick: () =>
              update.mutate({ id: item.id, update: { status: 'new' } }, { onError: fail }),
          }),
        onError: fail,
      },
    );
  };

  const shortlist = (item: GroupListItem) => act(item, { status: 'shortlisted' }, 'Shortlisted');
  const skip = (item: GroupListItem, reason: SkipReason) => {
    setSkipping(null);
    act(item, { status: 'skipped', skipReason: reason }, 'Skipped');
  };
  const openDetail = (item: GroupListItem, tab?: DrawerTab) =>
    navigate(`/job/${item.id}`, { state: { from: '/inbox', ...(tab ? { tab } : {}) } });

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;

      if (skipping) {
        const n = Number(e.key);
        if (n >= 1 && n <= SKIP_REASONS.length) {
          e.preventDefault();
          const reason = SKIP_REASONS[n - 1];
          if (reason) skip(skipping, reason.value);
        } else if (e.key === 'Escape') setSkipping(null);
        return;
      }
      if (e.key === '?') return setHelp((h) => !h);
      if (e.key === 'Escape') return setHelp(false);
      if (items.length === 0) return;

      const index = Math.max(
        0,
        items.findIndex((i) => i.id === focused?.id),
      );
      if (e.key === 'j') setFocusedId(items[Math.min(items.length - 1, index + 1)]?.id ?? null);
      else if (e.key === 'k') setFocusedId(items[Math.max(0, index - 1)]?.id ?? null);
      else if (!focused) return;
      else if (e.key === 'Enter') openDetail(focused);
      else if (e.key === 'c') openDetail(focused, 'Cover note');
      else if (e.key === 'o' && focused.job.url) window.open(focused.job.url, '_blank', 'noopener');
      else if (decidable && e.key === 'a') shortlist(focused);
      else if (decidable && e.key === 'x') setSkipping(focused);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
      .catch(fail);
  };

  const emptyText =
    params.show === 'filtered'
      ? 'No jobs have been filtered out yet.'
      : params.show === 'more'
        ? 'No lower matches. Everything that passed your filters was a good first-pass match.'
        : filters.active
          ? 'No jobs match these filters.'
          : stats.data
            ? `You're all caught up. Next scan ${formatNextScan(stats.data.nextScanAt)}.`
            : 'No jobs yet. Go to Runs and click Run now to scan Reed.';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Inbox</h2>
        <Button variant="ghost" onClick={() => setHelp(true)} aria-keyshortcuts="?">
          Keyboard shortcuts
        </Button>
      </div>

      <SuggestionCards />

      <FilterBar filters={filters} cvs={cvs.data ?? []} />

      {groups.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading jobs" className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg bg-[var(--surface-2)]" />
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
          {emptyText}
        </p>
      ) : null}

      {groups.data && items.length > 0 ? (
        <>
          <p className="text-sm text-[var(--muted)]">
            Showing {items.length} of {groups.data.total}
          </p>
          <div className="grid gap-3" aria-live="polite">
            {items.map((item) =>
              params.show === 'filtered' ? (
                <article
                  key={item.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
                >
                  <h3 className="font-semibold">{item.job.title ?? 'Untitled role'}</h3>
                  <p className="text-[var(--muted)]">
                    {item.job.employerName ?? '—'} · {item.job.location ?? '—'} · {item.job.payText}
                  </p>
                  <p className="mt-1">Hidden because: {describeFilterReason(item.filterReason)}</p>
                  {item.job.url ? (
                    <a
                      className="underline"
                      href={item.job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open advert<span className="sr-only"> (new tab)</span>
                    </a>
                  ) : null}
                </article>
              ) : (
                <JobCard
                  key={item.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(item.id, el);
                    else cardRefs.current.delete(item.id);
                  }}
                  item={item}
                  focused={focused?.id === item.id}
                  thresholds={thresholds.data}
                  onFocus={() => setFocusedId(item.id)}
                  onOpen={() => openDetail(item)}
                  onShortlist={() => shortlist(item)}
                  onSkip={() => setSkipping(item)}
                />
              ),
            )}
          </div>
        </>
      ) : null}

      <div className="pt-4">
        <Button variant="danger" loading={clear.isPending} onClick={clearAll}>
          Clear all found jobs
        </Button>
      </div>

      {skipping ? (
        <SkipReasonPicker
          title={skipping.job.title ?? 'this job'}
          onPick={(reason) => skip(skipping, reason)}
          onCancel={() => setSkipping(null)}
        />
      ) : null}

      {help ? (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="fixed top-20 left-1/2 z-40 w-80 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
        >
          <h3 className="mb-2 font-semibold">Keyboard shortcuts</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {SHORTCUTS.map(([key, what]) => (
              <div key={key} className="contents">
                <dt>
                  <kbd className="rounded border border-[var(--border)] px-1">{key}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <Button className="mt-3" onClick={() => setHelp(false)}>
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}
