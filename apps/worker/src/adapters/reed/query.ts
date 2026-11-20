import type { EmploymentType } from '@job-scout/shared';
import type { SearchQuery } from '../../ports/source.js';
import type { ReedParams } from './client.js';

/** Reed's maximum page size (verified: 101 is silently capped to 100). An API limit, not a setting. */
export const REED_PAGE_SIZE = 100;

/** Reed's employment-type filters. They OR together; sending none means "all types". */
const TYPE_FLAGS = ['contract', 'permanent', 'temp'] as const satisfies readonly EmploymentType[];

/**
 * SearchQuery → Reed `search` parameters.
 * - Only `true` flags are sent (`contract=false` is ignored by Reed), and asking for all three
 *   types is the same as asking for none.
 * - `minimumSalary` is sent only for permanent-only searches: for contracts Reed compares it with
 *   day rates, which would silently drop good roles.
 * - `distanceFromLocation` is sent only with a location.
 */
export function buildSearchParams(q: SearchQuery, page: number): ReedParams {
  const wanted = TYPE_FLAGS.filter((t) => q.employmentTypes.includes(t));
  const filterByType = wanted.length > 0 && wanted.length < TYPE_FLAGS.length;
  const permanentOnly = wanted.length === 1 && wanted[0] === 'permanent';

  return {
    keywords: q.keywords,
    ...(q.location === null
      ? {}
      : { locationName: q.location, distanceFromLocation: q.radiusMiles }),
    ...(filterByType ? Object.fromEntries(wanted.map((t) => [t, true])) : {}),
    ...(permanentOnly && q.minSalary !== null ? { minimumSalary: q.minSalary } : {}),
    resultsToTake: REED_PAGE_SIZE,
    resultsToSkip: page * REED_PAGE_SIZE,
  };
}
