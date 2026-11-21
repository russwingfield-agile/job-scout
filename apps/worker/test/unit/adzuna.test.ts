import {
  type AdzunaResult,
  AdzunaResultSchema,
  AdzunaSearchResponseSchema,
} from '@job-scout/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdzunaAdapter } from '../../src/adapters/adzuna/adapter.js';
import { AdzunaClient, type AdzunaHttp } from '../../src/adapters/adzuna/client.js';
import { ADZUNA_PAGE_SIZE, buildAdzunaParams } from '../../src/adapters/adzuna/query.js';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { isExcerptDuplicate, normaliseEmployer } from '../../src/core/dedupe.js';
import { normaliseAdzunaJob } from '../../src/core/normaliseAdzuna.js';
import { AppError } from '../../src/lib/errors.js';
import type { SearchQuery } from '../../src/ports/source.js';
import type { SourceCall } from '../../src/ports/sourceCalls.js';

const NOW = new Date('2026-11-20T09:00:00.000Z');
const ctx = { profileEmploymentTypes: ['contract' as const], now: NOW };

const result = (over: Record<string, unknown> = {}) => ({
  id: 4821,
  title: 'Agile Coach',
  description: 'SAFe <strong>agile coach</strong> for a bank. Outside IR35. 6 month contract...',
  created: '2026-11-19T10:00:00Z',
  redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/4821?se=abc',
  company: { display_name: 'Acme Recruitment Ltd' },
  location: { display_name: 'London, Greater London', area: ['UK', 'London'] },
  salary_min: 550,
  salary_max: 650,
  salary_is_predicted: '0',
  contract_type: 'contract',
  ...over,
});
const parse = (over: Record<string, unknown> = {}): AdzunaResult =>
  AdzunaResultSchema.parse(result(over));

const query = (over: Partial<SearchQuery> = {}): SearchQuery => ({
  keywords: 'Agile Coach',
  location: 'London',
  radiusMiles: 25,
  employmentTypes: ['contract', 'permanent'],
  minSalary: null,
  ...over,
});

describe('buildAdzunaParams', () => {
  it('searches newest first with the keywords, place and a distance in kilometres', () => {
    expect(buildAdzunaParams(query())).toEqual({
      what: 'Agile Coach',
      where: 'London',
      distance: 40, // 25 miles
      results_per_page: ADZUNA_PAGE_SIZE,
      sort_by: 'date',
      'content-type': 'application/json',
    });
  });

  it('sends no place or distance for a location-free (Remote) search', () => {
    const p = buildAdzunaParams(query({ location: null }));
    expect(p).not.toHaveProperty('where');
    expect(p).not.toHaveProperty('distance');
  });

  it.each([
    [['contract'], { contract: 1 }],
    [['permanent'], { permanent: 1 }],
    [['contract', 'permanent'], {}],
    [['temp'], {}],
  ] as const)('employment types %j', (types, expected) => {
    const p = buildAdzunaParams(query({ employmentTypes: [...types] }));
    expect(p.contract).toBe((expected as { contract?: number }).contract);
    expect(p.permanent).toBe((expected as { permanent?: number }).permanent);
  });

  it('uses the minimum salary only for permanent-only searches', () => {
    expect(
      buildAdzunaParams(query({ employmentTypes: ['permanent'], minSalary: 70_000 })),
    ).toMatchObject({
      salary_min: 70_000,
    });
    expect(
      buildAdzunaParams(query({ employmentTypes: ['contract'], minSalary: 70_000 })),
    ).not.toHaveProperty('salary_min');
    expect(buildAdzunaParams(query({ minSalary: 70_000 }))).not.toHaveProperty('salary_min');
  });
});

describe('normaliseAdzunaJob', () => {
  it('reads a contract advert: day rate, IR35, length, agency, date and link', () => {
    const job = normaliseAdzunaJob(parse(), ctx);
    expect(job).toMatchObject({
      source: 'adzuna',
      sourceJobId: '4821',
      url: 'https://www.adzuna.co.uk/jobs/land/ad/4821?se=abc',
      title: 'Agile Coach',
      employerName: 'Acme Recruitment Ltd',
      isAgency: true,
      location: 'London, Greater London',
      employmentType: 'contract',
      payMin: 550,
      payMax: 650,
      payPeriod: 'day',
      ir35: 'outside',
      contractLengthMonths: 6,
      postedAt: '2026-11-19T10:00:00.000Z',
    });
    expect(job.descriptionText).toContain('SAFe agile coach for a bank');
    expect(job.descriptionText).not.toContain('<strong>');
  });

  it('treats a permanent salary as yearly', () => {
    const job = normaliseAdzunaJob(
      parse({
        contract_type: 'permanent',
        salary_min: 70_000,
        salary_max: 80_000,
        description: 'Lead role.',
      }),
      ctx,
    );
    expect(job).toMatchObject({
      employmentType: 'permanent',
      payMin: 70_000,
      payMax: 80_000,
      payPeriod: 'year',
    });
    expect(job).not.toHaveProperty('ir35');
  });

  it('ignores pay Adzuna guessed rather than the advert stating', () => {
    const job = normaliseAdzunaJob(
      parse({ salary_is_predicted: '1', description: 'No pay here.' }),
      ctx,
    );
    expect(job.payPeriod).toBe('unknown');
    expect(job).not.toHaveProperty('payMin');
  });

  it('takes pay quoted in the excerpt when the structured pay is missing', () => {
    const job = normaliseAdzunaJob(
      parse({
        salary_min: null,
        salary_max: null,
        description: 'Paying £600 - £650 per day. Outside IR35.',
      }),
      ctx,
    );
    expect(job).toMatchObject({ payMin: 600, payMax: 650, payPeriod: 'day' });
  });

  it('copes with missing company, location, description and date', () => {
    const job = normaliseAdzunaJob(
      parse({
        company: null,
        location: null,
        description: null,
        created: null,
        salary_min: null,
        salary_max: null,
      }),
      ctx,
    );
    expect(job).toMatchObject({
      employerName: 'Unknown employer',
      location: '',
      descriptionText: '',
      postedAt: NOW.toISOString(),
      isAgency: null,
    });
  });

  it('detects remote working from the wording', () => {
    expect(normaliseAdzunaJob(parse({ description: 'Fully remote role.' }), ctx).workMode).toBe(
      'remote',
    );
  });

  it('accepts a numeric id and survives being stored as JSON and read back', () => {
    const stored = JSON.parse(JSON.stringify(parse()));
    expect(normaliseAdzunaJob(AdzunaResultSchema.parse(stored), ctx).sourceJobId).toBe('4821');
  });
});

describe('AdzunaAdapter', () => {
  const body = { count: 120, results: [result(), result({ id: '4822', title: 'Scrum Master' })] };
  const fakeHttp = () => {
    const get = vi.fn(
      async (_path: string, _params: unknown, schema: { parse: (v: unknown) => unknown }) =>
        schema.parse(body),
    );
    return { http: { get } as unknown as AdzunaHttp, get };
  };

  it('asks for the right page (Adzuna counts from 1) and returns each hit with its whole record', async () => {
    const { http, get } = fakeHttp();
    const adapter = new AdzunaAdapter(http);
    expect(adapter).toMatchObject({ id: 'adzuna', inlineDetails: true });

    const page = await adapter.search(query(), 0, { runId: 'r1' });
    expect(get.mock.calls[0]?.[0]).toBe('jobs/gb/search/1');
    expect(page.total).toBe(120);
    expect(page.hasMore).toBe(true); // 50 of 120 so far
    expect(page.refs.map((r) => r.sourceJobId)).toEqual(['4821', '4822']);
    expect(page.refs[0]).toMatchObject({
      title: 'Agile Coach',
      employerName: 'Acme Recruitment Ltd',
    });
    expect(page.refs[0]?.raw).toBeTruthy();

    await adapter.search(query(), 2);
    expect(get.mock.calls[1]?.[0]).toBe('jobs/gb/search/3');
    expect((await adapter.search(query(), 2)).hasMore).toBe(false); // 150 >= 120
  });

  it('normalises what it returned, and has no separate advert to fetch', async () => {
    const { http } = fakeHttp();
    const adapter = new AdzunaAdapter(http);
    const [ref] = (await adapter.search(query(), 0)).refs;
    const stored = JSON.parse(JSON.stringify(ref?.raw));
    expect(adapter.normalise({ sourceJobId: '4821', raw: stored }, ctx).title).toBe('Agile Coach');
    await expect(adapter.details('4821')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      retryable: false,
    });
  });
});

describe('AdzunaClient', () => {
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const make = (respond: () => Response | Promise<Response>, calls: SourceCall[] = []) => {
    const fetchSpy = vi.fn(async (_url: string | URL | Request) => respond());
    const client = new AdzunaClient({
      appId: 'APPID123',
      appKey: 'SECRETKEY456',
      fetch: fetchSpy as unknown as typeof fetch,
      recorder: { record: async (c) => void calls.push(c) },
      now: () => 0,
    });
    return { client, fetchSpy, calls };
  };

  it('sends the credentials and parameters, and records the call without the key', async () => {
    const { client, fetchSpy, calls } = make(() => ok({ count: 0, results: [] }));
    await client.get(
      'jobs/gb/search/1',
      { what: 'coach', where: undefined, distance: 40 },
      AdzunaSearchResponseSchema,
      {
        runId: 'r1',
      },
    );

    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api.adzuna.com/v1/api/jobs/gb/search/1');
    expect(url.searchParams.get('app_id')).toBe('APPID123');
    expect(url.searchParams.get('app_key')).toBe('SECRETKEY456');
    expect(url.searchParams.get('what')).toBe('coach');
    expect(url.searchParams.get('distance')).toBe('40');
    expect(url.searchParams.has('where')).toBe(false);

    expect(calls).toEqual([
      { runId: 'r1', source: 'adzuna', endpoint: 'jobs/gb/search/1', status: 200, ms: 0 },
    ]);
    expect(JSON.stringify(calls)).not.toContain('SECRETKEY456');
  });

  it.each([
    [401, false, 'UPSTREAM_ERROR'],
    [403, false, 'UPSTREAM_ERROR'],
    [429, true, 'UPSTREAM_RATE_LIMIT'],
    [500, true, 'UPSTREAM_ERROR'],
    [404, false, 'UPSTREAM_ERROR'],
  ])('HTTP %i → retryable %s, never mentions the key', async (status, retryable, code) => {
    const { client, calls } = make(() => ok({}, status));
    const err = await client.get('p', {}, AdzunaSearchResponseSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code, retryable });
    expect(String((err as Error).message)).not.toMatch(/SECRETKEY456|APPID123/);
    expect(calls[0]?.status).toBe(status); // failed calls still count against the budget
  });

  it('treats a network failure as retryable and a wrong shape as permanent', async () => {
    const down = make(() => Promise.reject(new Error('socket hang up with SECRETKEY456')));
    const netErr = await down.client
      .get('p', {}, AdzunaSearchResponseSchema)
      .catch((e: unknown) => e);
    expect(netErr).toMatchObject({ retryable: true });
    expect(String((netErr as Error).message)).not.toContain('SECRETKEY456');
    expect(down.calls[0]?.status).toBe(0);

    const odd = make(() => ok({ nonsense: true }));
    await expect(odd.client.get('p', {}, AdzunaSearchResponseSchema)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('refuses to run without credentials, without making a request', async () => {
    const fetchSpy = vi.fn();
    const client = new AdzunaClient({
      appId: '',
      appKey: '',
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(client.get('p', {}, AdzunaSearchResponseSchema)).rejects.toMatchObject({
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not let a failing recorder break the request', async () => {
    const client = new AdzunaClient({
      appId: 'a',
      appKey: 'b',
      fetch: (async () => ok({ count: 0, results: [] })) as unknown as typeof fetch,
      recorder: { record: async () => Promise.reject(new Error('db down')) },
    });
    await expect(client.get('p', {}, AdzunaSearchResponseSchema)).resolves.toMatchObject({
      count: 0,
    });
  });
});

describe('excerpt de-duplication', () => {
  const D = DEFAULT_SETTINGS.dedupe;
  const job = (over = {}) => ({
    title: 'Agile Coach',
    location: 'London',
    employerName: 'Acme Recruitment Ltd',
    annualisedMin: null,
    annualisedMax: null,
    ...over,
  });

  it('matches the same title, city and employer however weak the text match', () => {
    expect(isExcerptDuplicate(0.2, job(), job({ employerName: 'ACME Recruitment' }), D).dup).toBe(
      true,
    );
  });

  it('needs a looser text match when the employer differs', () => {
    expect(isExcerptDuplicate(0.69, job(), job({ employerName: 'Other Co' }), D).dup).toBe(false);
    expect(isExcerptDuplicate(0.7, job(), job({ employerName: 'Other Co' }), D).dup).toBe(true);
  });

  it('never matches a different city or a different role', () => {
    expect(isExcerptDuplicate(0.99, job(), job({ location: 'Leeds' }), D).dup).toBe(false);
    expect(isExcerptDuplicate(0.99, job(), job({ title: 'Data Engineer' }), D).dup).toBe(false);
  });

  it('does not treat unknown employers as the same one', () => {
    expect(
      isExcerptDuplicate(0.5, job({ employerName: null }), job({ employerName: null }), D).dup,
    ).toBe(false);
  });

  it('normalises company names', () => {
    expect(normaliseEmployer('The Acme Group Ltd.')).toBe('acme');
    expect(normaliseEmployer(null)).toBe('');
  });
});
