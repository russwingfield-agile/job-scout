import type { CvListItem } from '@job-scout/shared';
import { useSearchParams } from 'react-router';
import type { GroupFilterParams, GroupView } from '../../api/queries.js';

const VIEWS: { value: GroupView; label: string }[] = [
  { value: 'shortlist', label: 'Inbox' },
  { value: 'more', label: 'Lower matches' },
  { value: 'filtered', label: 'Filtered out' },
];

const SINCE = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
];

const selectClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm';

const oneOf = <T extends string>(v: string | null, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

/** Filters live in the URL (so a filtered view can be bookmarked or reloaded). */
export function useInboxFilters(): {
  params: GroupFilterParams;
  set: (key: string, value: string) => void;
  clear: () => void;
  active: boolean;
} {
  const [search, setSearch] = useSearchParams();
  const num = (key: string): number | undefined => {
    const n = Number(search.get(key));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const params: GroupFilterParams = {
    show: oneOf(search.get('view'), ['shortlist', 'more', 'filtered'] as const) ?? 'shortlist',
    type: oneOf(search.get('type'), ['contract', 'permanent'] as const),
    cvId: search.get('cv') || undefined,
    minScore: num('min'),
    workMode: oneOf(search.get('mode'), ['remote', 'hybrid', 'onsite'] as const),
    ir35: oneOf(search.get('ir35'), ['inside', 'outside'] as const),
    postedWithinDays: num('since'),
  };
  return {
    params,
    set: (key, value) =>
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    clear: () =>
      setSearch(
        (prev) => {
          const view = prev.get('view');
          return view ? new URLSearchParams({ view }) : new URLSearchParams();
        },
        { replace: true },
      ),
    active: ['type', 'cv', 'min', 'mode', 'ir35', 'since'].some((k) => search.has(k)),
  };
}

type Props = {
  filters: ReturnType<typeof useInboxFilters>;
  cvs: CvListItem[];
};

export function FilterBar({ filters, cvs }: Props) {
  const { params, set, clear, active } = filters;
  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Which jobs" className="flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={params.show === v.value}
            onClick={() => set('view', v.value === 'shortlist' ? '' : v.value)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              params.show === v.value
                ? 'border-[var(--accent)] bg-[var(--surface-2)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface)]'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Filters</legend>
        <fieldset className="flex">
          <legend className="sr-only">Contract or permanent</legend>
          {[
            { value: '', label: 'All' },
            { value: 'contract', label: 'Contract' },
            { value: 'permanent', label: 'Perm' },
          ].map((o, i, all) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={(params.type ?? '') === o.value}
              onClick={() => set('type', o.value)}
              className={`border px-3 py-1.5 text-sm ${i === 0 ? 'rounded-l-md' : ''} ${
                i === all.length - 1 ? 'rounded-r-md' : ''
              } ${
                (params.type ?? '') === o.value
                  ? 'border-[var(--accent)] bg-[var(--surface-2)] font-semibold'
                  : 'border-[var(--border)] bg-[var(--surface)]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </fieldset>

        <label className="flex items-center gap-1 text-sm">
          <span className="sr-only">CV</span>
          <select
            className={selectClass}
            value={params.cvId ?? ''}
            onChange={(e) => set('cv', e.target.value)}
            aria-label="Best CV"
          >
            <option value="">Any CV</option>
            {cvs.map((cv) => (
              <option key={cv.id} value={cv.id}>
                {cv.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-sm">
          Min score
          <select
            className={selectClass}
            value={String(params.minScore ?? '')}
            onChange={(e) => set('min', e.target.value)}
          >
            <option value="">Any</option>
            {[50, 65, 80].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </label>

        <select
          className={selectClass}
          value={params.workMode ?? ''}
          onChange={(e) => set('mode', e.target.value)}
          aria-label="Work mode"
        >
          <option value="">Any work mode</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On site</option>
        </select>

        <select
          className={selectClass}
          value={params.ir35 ?? ''}
          onChange={(e) => set('ir35', e.target.value)}
          aria-label="IR35"
        >
          <option value="">Any IR35</option>
          <option value="outside">Outside IR35</option>
          <option value="inside">Inside IR35</option>
        </select>

        <select
          className={selectClass}
          value={String(params.postedWithinDays ?? '')}
          onChange={(e) => set('since', e.target.value)}
          aria-label="Posted"
        >
          {SINCE.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {active ? (
          <button type="button" onClick={clear} className="text-sm underline">
            Clear filters
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
