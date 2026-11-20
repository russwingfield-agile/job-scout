import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReedAdapter } from '../../src/adapters/reed/adapter.js';
import { createSourceCallRecorder } from '../../src/adapters/sourceCallRecorder.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import type { Clock } from '../../src/ports/clock.js';
import { fakeReedHttp } from '../fakes/fakeReedHttp.js';
import detailsContract from '../fixtures/reed/real/details-contract-day-rate.json';
import detailsRemote from '../fixtures/reed/real/details-contract-remote.json';
import searchAgile from '../fixtures/reed/real/search-agile-coach-london-contract.json';

const repos = createRepos(createDb(env.DB));
const clock: Clock = { now: () => new Date('2026-11-20T09:00:00.000Z') };
const TODAY = '2026-11-20';

beforeEach(async () => {
  for (const table of ['source_calls', 'usage_daily', 'settings']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('source call recorder', () => {
  it('stores each call and counts Reed calls toward today’s budget', async () => {
    const recorder = createSourceCallRecorder({ repos, clock });
    await recorder.record({
      runId: 'run-1',
      source: 'reed',
      endpoint: 'search',
      status: 200,
      ms: 120,
    });
    await recorder.record({
      runId: 'run-1',
      source: 'reed',
      endpoint: 'jobs/1',
      status: 429,
      ms: 80,
    });
    await recorder.record({ source: 'reed', endpoint: 'search', status: 0, ms: 15000 });

    expect((await repos.usage.get(TODAY))?.reedCalls).toBe(3);
    expect(await repos.sourceCalls.countByRun('run-1')).toBe(2);
    expect(await repos.sourceCalls.countByRun('nope')).toBe(0);

    const { results } = await env.DB.prepare(
      'SELECT run_id, endpoint, status, ms, created_at FROM source_calls ORDER BY id',
    ).all();
    expect(results[0]).toEqual({
      run_id: 'run-1',
      endpoint: 'search',
      status: 200,
      ms: 120,
      created_at: '2026-11-20T09:00:00.000Z',
    });
    expect(results[2]).toMatchObject({ run_id: null, status: 0 });
  });

  it('does not count other sources against the Reed budget', async () => {
    const recorder = createSourceCallRecorder({ repos, clock });
    await recorder.record({ source: 'adzuna', endpoint: 'search', status: 200, ms: 5 });
    expect(await repos.usage.get(TODAY)).toBeUndefined();
    expect(await repos.sourceCalls.countByRun('x')).toBe(0);
  });
});

describe('POST /api/dev/reed-probe', () => {
  const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;
  const prodEnv = { DB: env.DB, ENV: 'production', DEV_BYPASS_AUTH: 'false' } as unknown as Env;

  const source = () =>
    new ReedAdapter(
      fakeReedHttp({
        search: searchAgile,
        details: { '57562231': detailsRemote, '57582935': detailsContract },
      }),
    );

  const app = (overrides: { source?: ReedAdapter; access?: null } = {}) =>
    createApp((e) =>
      createContainer(e, {
        clock,
        source: overrides.source ?? source(),
        access: null,
        ...overrides,
      }),
    );

  const post = (
    a: ReturnType<typeof app>,
    e: Env,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    a.fetch(
      new Request('http://localhost/api/dev/reed-probe', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
      e,
    );

  it('returns refs and normalised jobs for the first hits', async () => {
    const res = await post(app(), devEnv, {
      keywords: 'agile coach',
      location: 'London',
      detailsCount: 2,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      refs: unknown[];
      jobs: { sourceJobId: string; payPeriod: string }[];
    };
    expect(body.total).toBe(8);
    expect(body.refs).toHaveLength(5);
    expect(body.jobs.map((j) => [j.sourceJobId, j.payPeriod])).toEqual([
      ['57562231', 'year'],
      ['57582935', 'day'],
    ]);
  });

  it('applies defaults (3 details, contract + permanent) and validates the body', async () => {
    const http = fakeReedHttp({ search: searchAgile, anyDetails: detailsContract });
    const ok = await post(app({ source: new ReedAdapter(http) }), devEnv, {
      keywords: 'agile coach',
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { jobs: unknown[] }).jobs).toHaveLength(3);
    // One search plus three details, sent with contract + permanent flags.
    expect(http.calls.map((c) => c.endpoint)).toHaveLength(4);
    expect(http.calls[0]?.params).toMatchObject({ contract: true, permanent: true });

    const bad = await post(app(), devEnv, { keywords: '' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('is invisible (404) outside dev, even for an authenticated caller', async () => {
    const access = { verify: async () => ({ email: 'me@example.com' }) };
    const a = createApp((e) => createContainer(e, { clock, source: source(), access }));
    const res = await post(
      a,
      prodEnv,
      { keywords: 'agile coach' },
      { 'Cf-Access-Jwt-Assertion': 't' },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('refuses once the daily Reed budget is spent', async () => {
    await repos.usage.increment(TODAY, 'reedCalls', 899);
    const res = await post(app(), devEnv, { keywords: 'agile coach', detailsCount: 3 });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BUDGET_EXHAUSTED');
    expect(body.error.message).toContain('daily_budget');
  });

  it('honours a lowered budget from settings', async () => {
    await repos.settings.put('budgets', { reedDailyRequestBudget: 2 }, '2026-11-20T00:00:00.000Z');
    const res = await post(app(), devEnv, { keywords: 'agile coach', detailsCount: 3 });
    expect(res.status).toBe(429);
  });
});
