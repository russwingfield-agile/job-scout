import { env } from 'cloudflare:workers';
import type { Settings } from '@job-scout/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import worker from '../../src/index.js';

const call = (method: string, body?: unknown) =>
  worker.fetch(
    new Request('http://localhost/api/settings', {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    }),
    env,
  );

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM settings').run();
});

describe('GET/PUT /api/settings', () => {
  it('returns the typed defaults when nothing is stored', async () => {
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect((await res.json()) as Settings).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial update, persists it, and keeps other fields at default', async () => {
    const put = await call('PUT', {
      budgets: { maxLlmPerRun: 10 },
      blocklist: { agencies: ['Spam Ltd'] },
    });
    expect(put.status).toBe(200);
    const updated = (await put.json()) as Settings;
    expect(updated.budgets.maxLlmPerRun).toBe(10);
    expect(updated.budgets.maxPagesPerQuery).toBe(DEFAULT_SETTINGS.budgets.maxPagesPerQuery);

    const got = (await (await call('GET')).json()) as Settings;
    expect(got.budgets.maxLlmPerRun).toBe(10);
    expect(got.blocklist.agencies).toEqual(['Spam Ltd']);
    expect(got.weights).toEqual(DEFAULT_SETTINGS.weights);
  });

  it('accumulates successive partial updates within a section', async () => {
    await call('PUT', { budgets: { maxLlmPerRun: 10 } });
    await call('PUT', { budgets: { maxPagesPerQuery: 5 } });
    const got = (await (await call('GET')).json()) as Settings;
    expect(got.budgets).toMatchObject({ maxLlmPerRun: 10, maxPagesPerQuery: 5 });
  });

  it('rejects an invalid value with the VALIDATION envelope and stores nothing', async () => {
    const res = await call('PUT', { thresholds: { prefilterMin: 150 } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; issues?: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.issues?.[0]?.path).toBe('thresholds.prefilterMin');

    const got = (await (await call('GET')).json()) as Settings;
    expect(got.thresholds).toEqual(DEFAULT_SETTINGS.thresholds);
  });

  it('enforces cross-field rules on the merged result (weights must sum to 1)', async () => {
    const res = await call('PUT', { weights: { finalFit: 0.9 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('sum to 1');
  });

  it('rejects a malformed schedule slot', async () => {
    const res = await call('PUT', { schedule: { sat: ['7am'] } });
    expect(res.status).toBe(400);
  });
});
