import type { EmploymentType, SearchProfile } from '@job-scout/shared';
import type { SearchQuery } from '../ports/source.js';

export type PlannedQuery = {
  /** Stable identity of the query's parameters, used to merge identical queries across profiles. */
  queryKey: string;
  query: SearchQuery;
  /** Every profile that wants this query: hits are attributed to all of them. */
  profileIds: string[];
};

const isRemote = (location: string): boolean => location.trim().toLowerCase() === 'remote';

/**
 * Expand search profiles into source queries: one per (job title × location). A "Remote" location
 * means no location filter. Identical queries from different profiles are merged into one (saving
 * Reed calls) while remembering which profiles asked for it.
 */
export function planQueries(profiles: SearchProfile[]): PlannedQuery[] {
  const planned = new Map<string, PlannedQuery>();

  for (const profile of profiles) {
    for (const title of profile.jobTitles) {
      for (const rawLocation of profile.locations) {
        const location = isRemote(rawLocation) ? null : rawLocation.trim();
        const types: EmploymentType[] = [...profile.employmentTypes].sort();
        const queryKey = JSON.stringify([
          title.trim().toLowerCase(),
          location?.toLowerCase() ?? null,
          profile.radiusMiles,
          types,
          profile.minSalary,
        ]);

        const existing = planned.get(queryKey);
        if (existing) {
          if (!existing.profileIds.includes(profile.id)) existing.profileIds.push(profile.id);
        } else {
          planned.set(queryKey, {
            queryKey,
            profileIds: [profile.id],
            query: {
              keywords: title.trim(),
              location,
              radiusMiles: profile.radiusMiles,
              employmentTypes: types,
              minSalary: profile.minSalary,
            },
          });
        }
      }
    }
  }
  return [...planned.values()];
}
