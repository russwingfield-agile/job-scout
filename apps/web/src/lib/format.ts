const LONDON = 'Europe/London';

const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: LONDON,
});

/** "20 Nov 2026, 07:00" in UK time, the zone the schedule runs in. */
export const formatStarted = (iso: string): string => dateTime.format(new Date(iso));

/** "45s", "3m 05s", "1h 02m"; milliseconds below a second round up to "1s". */
export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Duration of a run, or "running…" until it has finished. */
export function runDuration(startedAt: string, finishedAt: string | null): string {
  return finishedAt === null
    ? 'running…'
    : formatDuration(new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}
