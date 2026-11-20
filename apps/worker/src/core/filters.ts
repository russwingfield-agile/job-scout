import type { NormalisedJob, SearchProfile, Settings } from '@job-scout/shared';
import { annualise } from './parse/pay.js';
import { isRemoteLocation } from './queries.js';

export type FilterResult = { pass: boolean; reasons: string[] };

type Blocklist = Settings['blocklist'];
type Working = Settings['working'];
type FilterJob = Pick<
  NormalisedJob,
  | 'title'
  | 'employerName'
  | 'descriptionText'
  | 'employmentType'
  | 'payMin'
  | 'payMax'
  | 'payPeriod'
  | 'workMode'
  | 'ir35'
>;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive containment ("junior" must not match "juniper"). */
export function containsWord(text: string, word: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeRegex(word.toLowerCase())}(?![a-z0-9])`).test(
    text.toLowerCase(),
  );
}

const CONTRACT_LIKE = new Set(['contract', 'temp']);

/** How a profile came to find a job. `scoped`: a search restricted to one of the profile's places. */
export type FoundBy = { scoped: boolean };

/**
 * Hard filters for one profile (SPEC §7.1). Unknown values — no pay, unknown IR35, unknown work
 * mode, unknown employment type — pass: we only reject on evidence. The one exception is a job
 * found *only* by the location-free "Remote" search, which returns jobs from all over the country:
 * it must itself be remote, so an unknown work mode does not pass.
 */
export function evaluateFilters(
  job: FilterJob,
  profile: SearchProfile,
  blocklist: Blocklist,
  working: Working,
  foundBy: FoundBy = { scoped: true },
): FilterResult {
  const reasons: string[] = [];
  const text = `${job.title}\n${job.descriptionText}`;

  const acceptsRemote = profile.locations.some(isRemoteLocation);
  if (!foundBy.scoped && !(acceptsRemote && job.workMode === 'remote')) {
    reasons.push('not_remote');
  }

  if (job.employmentType !== 'unknown' && !profile.employmentTypes.includes(job.employmentType)) {
    reasons.push(`employment_type:${job.employmentType}`);
  }

  for (const keyword of profile.excludeKeywords) {
    if (containsWord(text, keyword)) reasons.push(`excluded_keyword:${keyword}`);
  }

  const { max } = annualise(
    { min: job.payMin ?? null, max: job.payMax ?? job.payMin ?? null, period: job.payPeriod },
    working,
  );
  if (max !== null) {
    const contractLike =
      CONTRACT_LIKE.has(job.employmentType) ||
      (job.employmentType === 'unknown' && job.payPeriod !== 'year');
    if (contractLike && profile.minDayRate !== null) {
      if (max < profile.minDayRate * working.workingDaysPerYear) reasons.push('below_min_day_rate');
    } else if (!contractLike && profile.minSalary !== null && max < profile.minSalary) {
      reasons.push('below_min_salary');
    }
  }

  if (profile.ir35Preference === 'outside_only' && job.ir35 === 'inside') {
    reasons.push('inside_ir35');
  }

  if (
    profile.workModes.length > 0 &&
    job.workMode !== 'unknown' &&
    !profile.workModes.includes(job.workMode)
  ) {
    reasons.push(`work_mode:${job.workMode}`);
  }

  const employer = job.employerName.toLowerCase();
  const blockedEmployer = [...blocklist.employers, ...blocklist.agencies].find((name) =>
    employer.includes(name.toLowerCase()),
  );
  if (blockedEmployer !== undefined) reasons.push(`blocked_employer:${blockedEmployer}`);
  for (const keyword of blocklist.keywords) {
    if (containsWord(text, keyword)) reasons.push(`blocked_keyword:${keyword}`);
  }

  return { pass: reasons.length === 0, reasons };
}

/**
 * A job passes if it passes for *any* profile that found it. When none pass, the reasons are those
 * of the profile that came closest (fewest), so the "why was this hidden" text stays short.
 */
export function evaluateAcrossProfiles(
  job: FilterJob,
  finders: { profile: SearchProfile; foundBy: FoundBy }[],
  blocklist: Blocklist,
  working: Working,
): FilterResult {
  if (finders.length === 0) return { pass: false, reasons: ['no_matching_profile'] };
  const results = finders.map((f) =>
    evaluateFilters(job, f.profile, blocklist, working, f.foundBy),
  );
  const passing = results.find((r) => r.pass);
  if (passing) return passing;
  return results.reduce((best, r) => (r.reasons.length < best.reasons.length ? r : best));
}
