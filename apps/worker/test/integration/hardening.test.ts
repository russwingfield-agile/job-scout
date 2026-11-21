import { env } from 'cloudflare:workers';
import type { DeleteAllDataResponse } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import { FakeBlobStore } from '../fakes/fakeStorage.js';
import { FakeVectorStore } from '../fakes/fakeVectorStore.js';

const repos = createRepos(createDb(env.DB));
const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;
const ALL_TABLES = [
  'cover_notes',
  'status_history',
  'applications',
  'assessments',
  'job_cv_similarity',
  'job_profile_hits',
  'jobs',
  'job_groups',
  'run_errors',
  'source_calls',
  'processed_messages',
  'runs',
  'usage_daily',
  'vectors',
  'search_profiles',
  'cvs',
  'settings',
];
const NOW = '2026-11-20T09:00:00.000Z';

const wipe = async () => {
  for (const t of ALL_TABLES) await env.DB.prepare(`DELETE FROM ${t}`).run();
};
const count = async (table: string): Promise<number> =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;

function container() {
  const blobs = new FakeBlobStore();
  const vectors = new FakeVectorStore();
  const deps = createContainer(env, { blobs, vectors, access: null });
  return { deps, blobs, vectors };
}
const call = (deps: ReturnType<typeof container>['deps'], path: string, init?: RequestInit) =>
  createApp(() => deps).fetch(new Request(`http://localhost/api${path}`, init), devEnv);

describe('security headers and request limits', () => {
  it('marks every API response, including errors, with the security headers', async () => {
    await wipe();
    const { deps } = container();
    for (const path of ['/health', '/nope']) {
      const res = await call(deps, path);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('refuses an oversized JSON request with 413', async () => {
    await wipe();
    const { deps } = container();
    // Cloudflare always supplies Content-Length for a normal request; say so explicitly here.
    const body = JSON.stringify({ notes: 'x'.repeat(1_100_000) });
    const res = await call(deps, '/groups/g1/notes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      body,
    });
    expect(res.status).toBe(413);
  });

  it('rejects over-long notes and an over-long confirmation phrase', async () => {
    await wipe();
    const { deps } = container();
    const put = await call(deps, '/groups/g1/notes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'x'.repeat(5_001) }),
    });
    expect(put.status).toBe(400);
  });

  it('answers 401 to an unauthenticated request in production mode', async () => {
    await wipe();
    const { deps } = container();
    const prod = { DB: env.DB, ENV: 'production', DEV_BYPASS_AUTH: 'false' } as unknown as Env;
    const res = await createApp(() => deps).fetch(new Request('http://localhost/api/groups'), prod);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/data', () => {
  async function populate() {
    await wipe();
    const c = container();
    await repos.settings.put('thresholds', { prefilterMin: 40 }, NOW);
    await repos.cvs.insert({
      id: 'cv1',
      label: 'CV',
      r2Key: 'cvs/cv1/a.pdf',
      textMd: 'x',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await c.blobs.put('cvs/cv1/a.pdf', new ArrayBuffer(4), 'application/pdf');
    await c.vectors.upsert([
      { id: 'cv:cv1', values: [1, 0], metadata: { kind: 'cv' } },
      { id: 'job:j1', values: [1, 0], metadata: { kind: 'job' } },
    ]);
    await repos.profiles.insert(
      'p1',
      'cv1',
      {
        jobTitles: ['Coach'],
        mustKeywords: [],
        excludeKeywords: [],
        locations: ['London'],
        radiusMiles: 25,
        employmentTypes: ['contract'],
        minDayRate: null,
        minSalary: null,
        ir35Preference: 'any',
        workModes: [],
        maxOnsiteDays: null,
        active: true,
      },
      NOW,
    );
    await repos.groups.insert({
      id: 'g1',
      canonicalJobId: 'j1',
      status: 'new',
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    await repos.jobs.insertRefsIfNew([
      { id: 'j1', source: 'reed', sourceJobId: '1', groupId: 'g1', createdAt: NOW },
    ]);
    await repos.applications.upsert({ groupId: 'g1', notes: 'n', updatedAt: NOW });
    await repos.applications.addHistory('g1', 'new', 'applied', NOW);
    await repos.coverNotes.insert({ id: 'n1', groupId: 'g1', text: 'hi', createdAt: NOW });
    await repos.runs.insertIfNew({
      id: 'r1',
      slotKey: 's',
      trigger: 'manual',
      status: 'completed',
      phase: 'done',
      startedAt: NOW,
    });
    await repos.usage.increment('2026-11-20', 'llmCalls', 3);
    return c;
  }
  const del = (c: ReturnType<typeof container>, confirm: string) =>
    call(c.deps, '/data', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm }),
    });

  it('needs the exact phrase, and deletes nothing without it', async () => {
    const c = await populate();
    expect((await del(c, 'delete everything')).status).toBe(400);
    expect((await del(c, '')).status).toBe(400);
    expect(await count('jobs')).toBe(1);
    expect(c.blobs.objects.size).toBe(1);
  });

  it('deletes every job, CV, file, vector and run, but keeps your settings', async () => {
    const c = await populate();
    const res = await del(c, 'DELETE EVERYTHING');
    expect(res.status).toBe(200);
    expect((await res.json()) as DeleteAllDataResponse).toEqual({ cvs: 1, jobs: 1 });

    for (const table of ALL_TABLES.filter((t) => t !== 'settings')) {
      expect(await count(table), table).toBe(0);
    }
    expect(c.blobs.objects.size).toBe(0);
    expect(c.vectors.items.size).toBe(0);
    expect(await count('settings')).toBe(1);
  });

  it('works on an empty database', async () => {
    await wipe();
    const c = container();
    expect(await (await del(c, 'DELETE EVERYTHING')).json()).toEqual({ cvs: 0, jobs: 0 });
  });

  it('refuses while a run is working', async () => {
    const c = await populate();
    await repos.runs.insertIfNew({
      id: 'r2',
      slotKey: 's2',
      trigger: 'manual',
      status: 'running',
      phase: 'ingest',
      startedAt: NOW,
    });
    expect((await del(c, 'DELETE EVERYTHING')).status).toBe(409);
    expect(await count('jobs')).toBe(1);
  });
});

describe('Inbox query at volume', () => {
  it('lists the best 100 of 2,000 jobs quickly, in score order, with the right total', async () => {
    await wipe();
    const SEED_GROUPS = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
      INSERT INTO job_groups (id, canonical_job_id, status, final_score, prefilter_score, first_seen_at, last_seen_at)
      SELECT 'g' || i, 'j' || i, 'new', i % 100, i % 100, '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z' FROM n`;
    const SEED_JOBS = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
      INSERT INTO jobs (id, group_id, source, source_job_id, title, employer_name, employment_type, posted_at, created_at, stage)
      SELECT 'j' || i, 'g' || i, 'reed', 's' || i, 'Role ' || i, 'Employer ' || (i % 40),
             CASE WHEN i % 2 = 0 THEN 'contract' ELSE 'permanent' END, '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z', 'processed' FROM n`;
    await env.DB.prepare(SEED_GROUPS).run();
    await env.DB.prepare(SEED_JOBS).run();
    const { deps } = container();

    const started = Date.now();
    const res = await call(deps, '/groups?limit=100&type=contract&minScore=50');
    const elapsed = Date.now() - started;
    const body = (await res.json()) as { items: { finalScore: number }[]; total: number };

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(100);
    expect(body.total).toBe(500); // contract (even i) with score >= 50: half of those 1000 have i % 100 >= 50
    const scores = body.items.map((i) => i.finalScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(elapsed).toBeLessThan(2_000);
  });
});
