import type { WorkMode } from '@job-scout/shared';

export type WorkModeConfidence = 'high' | 'low' | 'none';
export type WorkModeDetection = {
  mode: WorkMode;
  /** Days in the office per week (monthly figures converted). Undefined when none is stated. */
  onsiteDaysPerWeek?: number;
  confidence: WorkModeConfidence;
};

const WEEKS_PER_MONTH = 52 / 12;
const FULL_WEEK_DAYS = 5;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const NUM = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five)`;

const PLACE = String.raw`(?:(?:in|at|to)\s+(?:the|our|their|a)\s+(?:\w+\s+)?office|(?:the|our)\s+office|in[- ]office|on[- ]?site|at\s+(?:the\s+)?(?:client|customer)(?:'s)?(?:\s+(?:site|office)s?)?)`;
const FREQ = String.raw`(?:(?:a|per|each|every|\/)\s*(?<freq>week|wk|month|mth))?`;

// "2 days a week in the office", "1 day per month on site", "2-3 days at the client site"
const DAYS_THEN_PLACE = new RegExp(
  String.raw`(?:(?<lo>${NUM})\s*(?:-|to)\s*)?(?<hi>${NUM})\s*days?\s*${FREQ}\s*(?:\w+\s+){0,2}?${PLACE}`,
);
// "onsite 2 days per week", "in the office: 3 days a week"
const PLACE_THEN_DAYS = new RegExp(
  String.raw`${PLACE}\s*[:,-]?\s*(?:\w+\s+){0,2}?(?:(?<lo>${NUM})\s*(?:-|to)\s*)?(?<hi>${NUM})\s*days?\s*${FREQ}`,
);

const HYBRID = /\bhybrid\b/;
const REMOTE =
  /(?<![a-z])(?:fully\s+remote|100%\s*remote|remote[- ](?:first|only|working|role|position|contract|opportunity|based)|work(?:ing)?\s+(?:fully\s+)?(?:remotely|from\s+home)|wfh|home[- ]?based|(?:location|based)\s*[:-]?\s*remote|\(remote\))(?![a-z])/;
const ONSITE_STRONG =
  /(?:fully\s+(?:on[- ]?site|office[- ]based)|100%\s*(?:on[- ]?site|office)|office[- ]based|on[- ]?site\s+(?:role|position|only)|full[- ]time\s+(?:on[- ]?site|in\s+(?:the\s+)?office))/;
const ONSITE_WEAK = /(?<![a-z])on[- ]?site(?![a-z])/;
const LOCATION_REMOTE = /^\s*(?:remote|home\s*working|work\s*from\s*home|wfh)\s*$/;

const toNumber = (s: string): number => NUMBER_WORDS[s] ?? Number(s);

function findOnsiteDays(text: string): number | null {
  const m = DAYS_THEN_PLACE.exec(text) ?? PLACE_THEN_DAYS.exec(text);
  if (!m) return null;
  const groups = m.groups as Record<string, string | undefined>;
  const days = toNumber(groups.hi as string);
  const perMonth = groups.freq === 'month' || groups.freq === 'mth';
  return perMonth ? Math.round((days / WEEKS_PER_MONTH) * 100) / 100 : days;
}

/**
 * Remote / hybrid / onsite from advert wording, plus days in the office per week when stated.
 * Heuristic only — the LLM refines it (SPEC §4.4). Days win over keywords: "2 days in the office"
 * is hybrid; five or more is onsite.
 */
export function detectWorkMode(text: string, hints: { location?: string } = {}): WorkModeDetection {
  const t = text.toLowerCase().replace(/[‐-―−]/g, '-');

  const days = findOnsiteDays(t);
  if (days !== null) {
    return {
      mode: days >= FULL_WEEK_DAYS ? 'onsite' : 'hybrid',
      onsiteDaysPerWeek: days,
      confidence: 'high',
    };
  }
  if (HYBRID.test(t)) return { mode: 'hybrid', confidence: 'high' };
  if (REMOTE.test(t) || LOCATION_REMOTE.test((hints.location ?? '').toLowerCase())) {
    return { mode: 'remote', confidence: 'high' };
  }
  if (ONSITE_STRONG.test(t)) return { mode: 'onsite', confidence: 'high' };
  if (ONSITE_WEAK.test(t)) return { mode: 'onsite', confidence: 'low' };
  return { mode: 'unknown', confidence: 'none' };
}
