import type { SearchQuery } from '../../ports/source.js';

/** Adzuna's largest page. An API limit (50 documented in its examples), not a setting. */
export const ADZUNA_PAGE_SIZE = 50;

const KM_PER_MILE = 1.609344;

export type AdzunaParams = Record<string, string | number | undefined>;

/**
 * SearchQuery → Adzuna search parameters (the page number goes in the URL path, from 1).
 * - Newest first, so the paging logic ("stop when a page has nothing new") holds.
 * - `distance` is kilometres; it is sent only with a place.
 * - The `contract` / `permanent` flags are sent only when exactly one of those two is wanted.
 * - `salary_min` is sent only for permanent-only searches: for contracts it would be compared with
 *   a yearly figure and could drop good day-rate roles.
 * ASSUMPTION (unverified against live responses): parameter names as in Adzuna's public docs.
 */
export function buildAdzunaParams(q: SearchQuery): AdzunaParams {
  const wantsContract = q.employmentTypes.includes('contract');
  const wantsPermanent = q.employmentTypes.includes('permanent');
  const permanentOnly = wantsPermanent && !wantsContract && q.employmentTypes.length === 1;

  return {
    what: q.keywords,
    ...(q.location === null
      ? {}
      : { where: q.location, distance: Math.max(1, Math.round(q.radiusMiles * KM_PER_MILE)) }),
    ...(wantsContract && !wantsPermanent ? { contract: 1 } : {}),
    ...(permanentOnly ? { permanent: 1 } : {}),
    ...(permanentOnly && q.minSalary !== null ? { salary_min: q.minSalary } : {}),
    results_per_page: ADZUNA_PAGE_SIZE,
    sort_by: 'date',
    'content-type': 'application/json',
  };
}
