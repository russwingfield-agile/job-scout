import { ReedJobDetailsSchema, ReedSearchResponseSchema } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { ReedAdapter } from '../../../src/adapters/reed/adapter.js';
import { AppError } from '../../../src/lib/errors.js';
import type { SearchQuery } from '../../../src/ports/source.js';
import { fakeReedHttp } from '../../fakes/fakeReedHttp.js';
import detailsContract from '../../fixtures/reed/real/details-contract-day-rate.json';
import detailsRemote from '../../fixtures/reed/real/details-contract-remote.json';
import detailsMissing from '../../fixtures/reed/real/details-missing-job.json';
import detailsPerm from '../../fixtures/reed/real/details-perm.json';
import searchAgile from '../../fixtures/reed/real/search-agile-coach-london-contract.json';
import searchScrum from '../../fixtures/reed/real/search-scrum-master-leeds-perm.json';

const NOW = new Date('2026-11-20T09:00:00.000Z');
const query: SearchQuery = {
  keywords: 'agile coach',
  location: 'London',
  radiusMiles: 25,
  employmentTypes: ['contract'],
  minSalary: null,
};

function setup() {
  const http = fakeReedHttp({
    search: searchAgile,
    details: {
      '57582935': detailsContract,
      '57562231': detailsRemote,
      '57522914': detailsPerm,
      '1': detailsMissing,
    },
  });
  return { http, adapter: new ReedAdapter(http) };
}

describe('recorded Reed responses (verified against the live API, 2026-11-20)', () => {
  it('parse with the shared schemas', () => {
    expect(ReedSearchResponseSchema.parse(searchAgile).results).toHaveLength(5);
    expect(ReedSearchResponseSchema.parse(searchScrum).totalResults).toBe(4);
    expect(ReedJobDetailsSchema.parse(detailsContract).salaryType).toBe('per day');
  });

  it('read null text fields as empty strings', () => {
    const blank = ReedJobDetailsSchema.parse(detailsMissing);
    expect(blank).toMatchObject({ jobId: 0, jobTitle: '', employerName: '', jobDescription: '' });
  });
});

describe('ReedAdapter.search', () => {
  it('maps hits to source-agnostic refs and returns the total', async () => {
    const { adapter, http } = setup();
    const { refs, total } = await adapter.search(query, 0, { runId: 'run-9' });

    expect(total).toBe(8);
    expect(refs).toHaveLength(5);
    expect(refs[0]).toEqual({
      sourceJobId: '57562231',
      title: 'Senior User Researcher - Remote',
      url: 'https://www.reed.co.uk/jobs/senior-user-researcher-remote/57562231',
      employerName: 'FDM Group',
      location: 'London',
      postedAt: '2026-11-12T00:00:00.000Z',
      applicationsCount: 21,
    });
    expect(http.calls[0]).toMatchObject({
      endpoint: 'search',
      params: { keywords: 'agile coach', contract: true, resultsToSkip: 0 },
      ctx: { runId: 'run-9' },
    });
  });

  it('requests later pages by offset', async () => {
    const { adapter, http } = setup();
    await adapter.search(query, 3);
    expect(http.calls[0]?.params.resultsToSkip).toBe(300);
  });

  it('builds a url and tolerates nulls when Reed omits them', async () => {
    const http = fakeReedHttp({
      search: {
        results: [{ jobId: 5, jobTitle: null, employerName: null, locationName: null, date: null }],
        totalResults: 1,
      },
    });
    const { refs } = await new ReedAdapter(http).search(query, 0);
    expect(refs[0]).toEqual({
      sourceJobId: '5',
      title: '',
      url: 'https://www.reed.co.uk/jobs/5',
      employerName: '',
      location: '',
      postedAt: null,
      applicationsCount: null,
    });
  });

  it('returns no refs past the last page', async () => {
    const http = fakeReedHttp({
      search: { results: [], totalResults: 68, ambiguousLocations: [] },
    });
    expect(await new ReedAdapter(http).search(query, 50)).toEqual({ refs: [], total: 68 });
  });
});

describe('ReedAdapter.details + normalise (real adverts)', () => {
  const ctx = { profileEmploymentTypes: ['contract' as const], now: NOW };

  it('contract with a day rate', async () => {
    const { adapter, http } = setup();
    const raw = await adapter.details('57582935', { runId: 'run-9' });
    expect(raw.sourceJobId).toBe('57582935');
    expect(http.calls[0]).toMatchObject({ endpoint: 'jobs/57582935', ctx: { runId: 'run-9' } });

    expect(adapter.normalise(raw, ctx)).toMatchObject({
      source: 'reed',
      sourceJobId: '57582935',
      title: 'Program Manager',
      employerName: 'Randstad Technologies',
      employmentType: 'contract',
      salaryText: '£640.00 - £850.00 per day',
      payMin: 640,
      payMax: 850,
      payPeriod: 'day',
      postedAt: '2026-11-17T00:00:00.000Z',
      expiresAt: '2026-12-29T00:00:00.000Z',
    });
  });

  it('contract quoted as an annual salary, remote role', async () => {
    const { adapter } = setup();
    expect(adapter.normalise(await adapter.details('57562231'), ctx)).toMatchObject({
      employmentType: 'contract',
      payMin: 50_000,
      payMax: 50_000,
      payPeriod: 'year',
      workMode: 'remote',
      contractLengthMonths: 4,
    });
  });

  it('permanent role has an annual range and no IR35', async () => {
    const { adapter } = setup();
    const job = adapter.normalise(await adapter.details('57522914'), {
      ...ctx,
      profileEmploymentTypes: ['permanent'],
    });
    expect(job).toMatchObject({
      employmentType: 'permanent',
      payMin: 30_000,
      payMax: 78_000,
      payPeriod: 'year',
      isAgency: true,
    });
    expect(job).not.toHaveProperty('ir35');
  });

  it("treats Reed's blank record for an unknown id as a permanent NOT_FOUND", async () => {
    const { adapter } = setup();
    const err = await adapter.details('1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('rejects a stored payload that is not a Reed advert', () => {
    const { adapter } = setup();
    expect(() => adapter.normalise({ sourceJobId: 'x', raw: { nonsense: true } }, ctx)).toThrow();
  });
});
