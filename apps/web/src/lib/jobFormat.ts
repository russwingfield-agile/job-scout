/** "today", "yesterday" or "N days ago"; "—" when unknown. `now` is injectable for tests. */
export function postedAgo(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return '—';
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const FILTER_REASONS: Record<string, string> = {
  below_min_day_rate: 'Below your minimum day rate',
  below_min_salary: 'Below your minimum salary',
  inside_ir35: 'Inside IR35',
  no_matching_profile: 'No matching search profile',
  too_old: 'Posted too long ago',
  no_longer_available: 'No longer on Reed',
};

const FILTER_REASON_PREFIXES: Record<string, (value: string) => string> = {
  employment_type: (v) => `Not a type you want (${v})`,
  excluded_keyword: (v) => `Contains "${v}"`,
  work_mode: (v) => `Work mode: ${v}`,
  blocked_employer: (v) => `Blocked employer: ${v}`,
  blocked_keyword: (v) => `Blocked word: ${v}`,
};

/** Turn stored reason codes ("below_min_day_rate; excluded_keyword:graduate") into plain words. */
export function describeFilterReason(reason: string | null): string {
  if (!reason) return '—';
  return reason
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const known = FILTER_REASONS[part];
      if (known) return known;
      const [code = '', ...rest] = part.split(':');
      const describe = FILTER_REASON_PREFIXES[code];
      return describe ? describe(rest.join(':')) : part;
    })
    .join('; ');
}
