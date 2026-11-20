import { env } from 'cloudflare:workers';
import type { GroupListResponse } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { createSourceCallRecorder } from '../../src/adapters/sourceCallRecorder.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import { startRun } from '../../src/pipeline/startRun.js';
import { FakeBus } from '../fakes/fakeBus.js';
import { FakeEmbedder } from '../fakes/fakeEmbedder.js';
import { FakeSource, reedJob, refFor } from '../fakes/fakeSource.js';
import { FakeVectorStore } from '../fakes/fakeVectorStore.js';

const repos = createRepos(createDb(env.DB));
const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;
const TABLES = [
  'runs',
  'run_errors',
  'processed_messages',
  'source_calls',
  'jobs',
  'job_groups',
  'job_profile_hits',
  'job_cv_similarity',
  'vectors',
  'search_profiles',
  'cvs',
  'usage_daily',
  'settings',
];

/** Run a real pipeline over a few jobs, so the API is tested against data the pipeline produced. */
async function populated() {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  const clock = { now: () => new Date('2026-11-20T07:00:00.000Z') };
  const good = reedJob(1);
  const lowRate = reedJob(2, { salary: '£300 - £350 per day', jobTitle: 'Agile Coach (low rate)' });
  const unrelated = reedJob(3, { jobTitle: 'Data Engineer' });
  const source = new FakeSource({
    pages: { 'Agile Coach': [[good, lowRate, unrelated].map(refFor)] },
    details: { '1': good, '2': lowRate, '3': unrelated },
  });
  const embedder = new FakeEmbedder();
  const vectors = new FakeVectorStore();
  const bus = new FakeBus();
  source.recorder = createSourceCallRecorder({ repos, clock });
  const deps = createContainer(env, { clock, embedder, vectors, bus, source, access: null });

  const now = clock.now().toISOString();
  await repos.cvs.insert({
    id: 'cv1',
    label: 'Agile Coach CV',
    r2Key: 'k',
    textMd: 'x',
    createdAt: now,
    updatedAt: now,
  });
  const [vector] = await embedder.embed([
    'Enterprise Agile Coach leading SAFe transformation programmes',
  ]);
  await vectors.upsert([{ id: 'cv:cv1', values: vector as number[], metadata: { kind: 'cv' } }]);
  await repos.profiles.insert(
    'p1',
    'cv1',
    {
      jobTitles: ['Agile Coach'],
      mustKeywords: [],
      excludeKeywords: [],
      locations: ['London'],
      radiusMiles: 25,
      employmentTypes: ['contract'],
      minDayRate: 500,
      minSalary: null,
      ir35Preference: 'any',
      workModes: [],
      maxOnsiteDays: null,
      active: true,
    },
    now,
  );
  await startRun(deps, { trigger: 'manual' });
  await bus.drain(deps);
  return deps;
}

const get = (deps: Awaited<ReturnType<typeof populated>>, query = '') =>
  createApp(() => deps).fetch(new Request(`http://localhost/api/groups${query}`), devEnv);

describe('GET /api/groups', () => {
  it('lists shortlisted jobs best-first with pay, IR35 and the best CV', async () => {
    const deps = await populated();
    const body = (await (await get(deps)).json()) as GroupListResponse;

    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    const scores = body.items.map((i) => i.prefilterScore as number);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1] as number);
    expect(body.items.map((i) => i.job.title).sort()).toEqual(['Agile Coach', 'Data Engineer']);

    const coach = body.items.find((i) => i.job.title === 'Agile Coach');
    expect(coach).toMatchObject({
      status: 'prefiltered',
      bestCv: 'Agile Coach CV',
      filterReason: null,
      job: {
        employmentType: 'contract',
        payText: '£600-£650/day',
        ir35: 'outside',
        contractLengthMonths: 6,
        url: 'https://www.reed.co.uk/jobs/1',
      },
    });
    // The better match (the actual coach role) ranks above the unrelated one.
    expect(body.items[0]?.job.title).toBe('Agile Coach');
  });

  it('lists filtered jobs with the reason they were hidden', async () => {
    const deps = await populated();
    const body = (await (await get(deps, '?show=filtered')).json()) as GroupListResponse;
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      status: 'filtered',
      prefilterScore: null,
      filterReason: 'below_min_day_rate',
      bestCv: null,
      job: { title: 'Agile Coach (low rate)', payText: '£300-£350/day' },
    });
  });

  it('honours the limit but still reports the full total', async () => {
    const deps = await populated();
    const body = (await (await get(deps, '?limit=1')).json()) as GroupListResponse;
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(2);
  });

  it('rejects an invalid query', async () => {
    const deps = await populated();
    expect((await get(deps, '?show=everything')).status).toBe(400);
    expect((await get(deps, '?limit=0')).status).toBe(400);
    expect((await get(deps, '?limit=500')).status).toBe(400);
  });

  it('is empty before any run', async () => {
    for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
    const deps = createContainer(env, { access: null });
    const body = (await (await get(deps)).json()) as GroupListResponse;
    expect(body).toEqual({ items: [], total: 0 });
  });
});
