import type { Settings } from '@job-scout/shared';

type Schedule = Settings['schedule'];
type DayGroup = 'mon-fri' | 'sat' | 'sun';

const DAY_GROUP: Record<string, DayGroup> = {
  Mon: 'mon-fri',
  Tue: 'mon-fri',
  Wed: 'mon-fri',
  Thu: 'mon-fri',
  Fri: 'mon-fri',
  Sat: 'sat',
  Sun: 'sun',
};

/** Calendar parts of `now` in the given time zone, via Intl (Workers have no date library). */
export function localParts(
  now: Date,
  timeZone: string,
): { date: string; hour: string; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value as string;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: get('hour'),
    weekday: get('weekday'),
  };
}

export type DueSlot = {
  /** Unique per slot, e.g. "2026-11-20T07:00"; the run table's UNIQUE `slot_key`. */
  slotKey: string;
  /** The configured slot that matched, e.g. "07:00". */
  slot: string;
};

/**
 * Is a scheduled scan due now? The cron fires hourly (at :00 UTC), so a slot matches when the
 * *local* hour equals the slot's hour; minutes in the slot are ignored. Local time makes this
 * correct across the GMT/BST changes. Firing twice in one local hour (e.g. when clocks go back)
 * yields the same slot key, which the unique constraint turns into a single run.
 */
export function dueSlot(now: Date, schedule: Schedule): DueSlot | null {
  const { date, hour, weekday } = localParts(now, schedule.timezone);
  const group = DAY_GROUP[weekday] as DayGroup;
  const slot = schedule[group].find((s) => s.slice(0, 2) === hour);
  return slot === undefined ? null : { slotKey: `${date}T${slot}`, slot };
}
