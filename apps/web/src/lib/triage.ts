import type { SkipReason } from '@job-scout/shared';

/** In this order: the number keys 1–9 pick them. */
export const SKIP_REASONS: { value: SkipReason; label: string }[] = [
  { value: 'rate_too_low', label: 'Rate too low' },
  { value: 'location', label: 'Wrong location' },
  { value: 'not_my_skills', label: 'Not my skills' },
  { value: 'too_junior', label: 'Too junior' },
  { value: 'too_senior', label: 'Too senior' },
  { value: 'inside_ir35', label: 'Inside IR35' },
  { value: 'agency_spam', label: 'Agency spam' },
  { value: 'already_applied_elsewhere', label: 'Already applied' },
  { value: 'other', label: 'Other' },
];

export type Band = 'strong' | 'good' | 'maybe' | 'low';

export const BAND_LABEL: Record<Band, string> = {
  strong: 'Strong',
  good: 'Good',
  maybe: 'Maybe',
  low: 'Low',
};

/** Strong / Good / Maybe by the thresholds in Settings (SPEC §7.4); below Maybe is Low. */
export function scoreBand(
  score: number,
  t: { badgeStrong: number; badgeGood: number; badgeMaybe: number },
): Band {
  if (score >= t.badgeStrong) return 'strong';
  if (score >= t.badgeGood) return 'good';
  if (score >= t.badgeMaybe) return 'maybe';
  return 'low';
}

export const DEFAULT_THRESHOLDS = { badgeStrong: 80, badgeGood: 65, badgeMaybe: 50 };

/** "£600-£650/day" plus the yearly equivalent when it is a day rate is out of scope; keep the text as stored. */
export const PIPELINE_COLUMNS = [
  { status: 'shortlisted', label: 'Shortlisted' },
  { status: 'applied', label: 'Applied' },
  { status: 'interview', label: 'Interview' },
  { status: 'offer', label: 'Offer' },
  { status: 'rejected', label: 'Rejected' },
] as const;

export const PIPELINE_STATUS_LABEL: Record<string, string> = {
  new: 'Inbox',
  prefiltered: 'Inbox',
  shortlisted: 'Shortlisted',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  skipped: 'Skipped',
  withdrawn: 'Withdrawn',
};

/** "in 3h", "tomorrow 07:00", "Mon 07:00": when the next scan runs, in UK time. */
export function formatNextScan(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'no scans scheduled';
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(at);
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeZone: 'Europe/London' }).format(d);
  if (day(at) === day(now)) return `today ${time}`;
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return `tomorrow ${time}`;
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: 'Europe/London',
  }).format(at);
  return `${weekday} ${time}`;
}
