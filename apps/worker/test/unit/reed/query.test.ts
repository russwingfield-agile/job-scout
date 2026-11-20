import { describe, expect, it } from 'vitest';
import { buildSearchParams, REED_PAGE_SIZE } from '../../../src/adapters/reed/query.js';
import type { SearchQuery } from '../../../src/ports/source.js';

const base: SearchQuery = {
  keywords: 'agile coach',
  location: 'London',
  radiusMiles: 25,
  employmentTypes: ['contract', 'permanent'],
  minSalary: null,
};

describe('buildSearchParams', () => {
  it('maps keywords, location and radius, and pages in blocks of 100', () => {
    expect(buildSearchParams({ ...base, employmentTypes: [] }, 0)).toEqual({
      keywords: 'agile coach',
      locationName: 'London',
      distanceFromLocation: 25,
      resultsToTake: 100,
      resultsToSkip: 0,
    });
    expect(buildSearchParams(base, 2).resultsToSkip).toBe(2 * REED_PAGE_SIZE);
  });

  it('omits location and radius for a location-free (remote) query', () => {
    const params = buildSearchParams({ ...base, location: null }, 0);
    expect(params).not.toHaveProperty('locationName');
    expect(params).not.toHaveProperty('distanceFromLocation');
  });

  it('sends only the true type flags (Reed ORs them)', () => {
    expect(buildSearchParams({ ...base, employmentTypes: ['contract'] }, 0)).toMatchObject({
      contract: true,
    });
    expect(buildSearchParams(base, 0)).toMatchObject({ contract: true, permanent: true });
    expect(buildSearchParams(base, 0)).not.toHaveProperty('temp');
    expect(buildSearchParams({ ...base, employmentTypes: ['temp'] }, 0)).toMatchObject({
      temp: true,
    });
  });

  it('treats all three types, none, or only unknown as "no type filter"', () => {
    for (const employmentTypes of [
      ['contract', 'permanent', 'temp'],
      [],
      ['unknown'],
    ] as SearchQuery['employmentTypes'][]) {
      const params = buildSearchParams({ ...base, employmentTypes }, 0);
      expect(params).not.toHaveProperty('contract');
      expect(params).not.toHaveProperty('permanent');
      expect(params).not.toHaveProperty('temp');
    }
  });

  it('sends minimumSalary only for permanent-only searches', () => {
    const q = { ...base, minSalary: 70_000 };
    expect(buildSearchParams({ ...q, employmentTypes: ['permanent'] }, 0)).toMatchObject({
      permanent: true,
      minimumSalary: 70_000,
    });
    expect(buildSearchParams(q, 0)).not.toHaveProperty('minimumSalary');
    expect(buildSearchParams({ ...q, employmentTypes: ['contract'] }, 0)).not.toHaveProperty(
      'minimumSalary',
    );
    expect(buildSearchParams({ ...base, employmentTypes: ['permanent'] }, 0)).not.toHaveProperty(
      'minimumSalary',
    );
  });
});
