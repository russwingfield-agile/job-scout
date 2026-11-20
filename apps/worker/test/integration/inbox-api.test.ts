import { env } from 'cloudflare:workers';
import type { GroupDetail, GroupListResponse, StatsResponse } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { createSourceCallRecorder } from '../../src/adapters/sourceCallRecorder.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import { startRun } from '../../src/pipeline/startRun.js';
import { FakeBus } from '../fakes/fakeBus.js';
import { FakeEmbedder } from '../fakes/fakeEmbedder.js';
import { FakeLlm } from '../fakes/fakeLlm.js';
import { FakeSource, reedJob, refFor } from '../fakes/fakeSource.js';
import { FakeVectorStore } from '../fakes/fakeVectorStore.js';
import { assessmentJson } from '../fixtures/assessment.js';

const repos = createRepos(createDb(env.DB));
const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;
const TABLES = [
  'status_history',
  'applications',
  'assessments',
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
const CV_TEXT = 'Enterprise Agile Coach leading SAFe transformation programmes across banking.';
const NOW = new Date('2026-11-20T09:00:00.000Z');

const JOBS = [
  reedJob(1), // contract, outside IR35, £600-650/day
  reedJob(2, {
    jobTitle: 'Agile Delivery Coach',
    contractType: 'Permanent',
    salary: '£90,000 - £100,000 per annum',
    salaryType: 'per annum',
    jobDescription: '<p>Permanent delivery coach role. Hybrid, two days in the office.</p>',
  }),
  reedJob(3, {
    jobTitle: 'Scrum Master',
    jobDescription: '<p>Scrum master for a payments team. Inside IR35. 3 month contract.</p>',
  }),
];

async function populated() {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  const clock = { now: () => NOW };
  const now = NOW.toISOString();
  await repos.settings.put('thresholds', { prefilterMin: 0 }, now);
  const embedder = new FakeEmbedder();
  const vectors = new FakeVectorStore();
  const bus = new FakeBus();
  const source = new FakeSource({
    pages: { 'Agile Coach': [JOBS.map(refFor)] },
    details: Object.fromEntries(JOBS.map((j) => [String(j.jobId), j])),
  });
  source.recorder = createSourceCallRecorder({ repos, clock });
  const llm = FakeLlm.always(assessmentJson());
  const deps = createContainer(env, { clock, embedder, vectors, bus, source, llm, access: null });

  await repos.cvs.insert({
    id: 'cv1',
    label: 'Agile Coach CV',
    r2Key: 'k',
    textMd: CV_TEXT,
    createdAt: now,
    updatedAt: now,
  });
  const [vector] = await embedder.embed([CV_TEXT]);
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
      employmentTypes: ['contract', 'permanent'],
      minDayRate: null,
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

type Deps = Awaited<ReturnType<typeof populated>>;
const call = (deps: Deps, path: string, init?: RequestInit) =>
  createApp(() => deps).fetch(new Request(`http://localhost/api${path}`, init), devEnv);
const list = async (deps: Deps, query = ''): Promise<GroupListResponse> =>
  (await (await call(deps, `/groups${query}`)).json()) as GroupListResponse;
const patch = (deps: Deps, id: string, body: unknown) =>
  call(deps, `/groups/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const idOf = async (deps: Deps, title: string) =>
  (await list(deps)).items.find((i) => i.job.title === title)?.id as string;

describe('GET /api/groups filters', () => {
  it('shows assessed jobs awaiting a decision, with AI detail and posting info', async () => {
    const deps = await populated();
    const body = await list(deps);
    expect(body.total).toBe(3);
    expect(body.items[0]).toMatchObject({
      status: 'new',
      bestCvId: 'cv1',
      alsoPostedBy: [],
      newPostingsSinceAction: 0,
      application: null,
      assessment: { status: 'ok', headline: 'Strong SAFe coaching match', seniorityMatch: 'match' },
    });
    expect(body.items[0]?.finalScore).toBeGreaterThan(0);
  });

  it.each([
    ['?type=permanent', ['Agile Delivery Coach']],
    ['?type=contract', ['Agile Coach', 'Scrum Master']],
    ['?ir35=inside', ['Scrum Master']],
    ['?ir35=outside', ['Agile Coach']],
    ['?cvId=cv1', ['Agile Coach', 'Agile Delivery Coach', 'Scrum Master']],
    ['?cvId=other', []],
    ['?minScore=100', []],
    ['?minScore=0', ['Agile Coach', 'Agile Delivery Coach', 'Scrum Master']],
    ['?postedWithinDays=30', ['Agile Coach', 'Agile Delivery Coach', 'Scrum Master']],
    ['?postedWithinDays=1', []],
  ])('%s', async (query, titles) => {
    const deps = await populated();
    const body = await list(deps, query);
    expect(body.items.map((i) => i.job.title).sort()).toEqual([...titles].sort());
    expect(body.total).toBe(titles.length);
  });

  it('rejects an unknown filter value', async () => {
    const deps = await populated();
    expect((await call(deps, '/groups?type=freelance')).status).toBe(400);
    expect((await call(deps, '/groups?show=everything')).status).toBe(400);
  });
});

describe('PATCH /api/groups/:id', () => {
  it('shortlisting moves a job from the Inbox to the pipeline and records history', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Agile Coach');
    const res = await patch(deps, id, { status: 'shortlisted' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'shortlisted' });

    expect((await list(deps)).total).toBe(2);
    const pipeline = await list(deps, '?show=pipeline');
    expect(pipeline.items.map((i) => i.id)).toEqual([id]);
    const history = await repos.applications.historyFor(id);
    expect(history[0]).toMatchObject({ fromStatus: 'new', toStatus: 'shortlisted' });
  });

  it('skipping records the reason; sending it back restores it to the Inbox', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Scrum Master');
    await patch(deps, id, { status: 'skipped', skipReason: 'inside_ir35' });
    expect((await repos.applications.getByGroup(id))?.skipReason).toBe('inside_ir35');
    expect((await list(deps)).total).toBe(2);

    const res = await patch(deps, id, { status: 'new' });
    expect(await res.json()).toEqual({ status: 'new' });
    expect((await list(deps)).total).toBe(3);
  });

  it('puts an unassessed job back to waiting for assessment, not into the Inbox as assessed', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Scrum Master');
    await env.DB.prepare('DELETE FROM assessments WHERE group_id = ?').bind(id).run();
    await patch(deps, id, { status: 'skipped' });
    expect(await (await patch(deps, id, { status: 'new' })).json()).toEqual({
      status: 'prefiltered',
    });
  });

  it('applying needs a real CV, and records when and with what', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Agile Coach');
    expect((await patch(deps, id, { status: 'applied' })).status).toBe(400);
    expect((await patch(deps, id, { status: 'applied', cvIdSent: 'ghost' })).status).toBe(400);

    const ok = await patch(deps, id, {
      status: 'applied',
      cvIdSent: 'cv1',
      appliedAt: '2026-11-19T10:00:00.000Z',
      notes: 'Via recruiter',
    });
    expect(ok.status).toBe(200);
    expect(await repos.applications.getByGroup(id)).toMatchObject({
      cvIdSent: 'cv1',
      appliedAt: '2026-11-19T10:00:00.000Z',
      notes: 'Via recruiter',
    });

    // Later moves keep what was recorded, and need no CV again.
    expect((await patch(deps, id, { status: 'interview' })).status).toBe(200);
    expect(await repos.applications.getByGroup(id)).toMatchObject({ cvIdSent: 'cv1' });
    const shown = (await list(deps, '?show=pipeline')).items[0];
    expect(shown).toMatchObject({
      status: 'interview',
      application: { cvIdSent: 'cv1', notes: 'Via recruiter' },
    });
  });

  it('refuses a move that is not allowed, and an unknown job', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Agile Coach');
    expect((await patch(deps, id, { status: 'new' })).status).toBe(409); // already in the Inbox
    expect((await patch(deps, 'nope', { status: 'shortlisted' })).status).toBe(404);
    expect((await patch(deps, id, { status: 'prefiltered' })).status).toBe(400); // not a state you can set
  });
});

describe('GET /api/groups/:id', () => {
  it('returns the whole picture of one job', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Agile Coach');
    await patch(deps, id, { status: 'shortlisted' });

    const res = await call(deps, `/groups/${id}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as GroupDetail;
    expect(detail.item).toMatchObject({ id, status: 'shortlisted' });
    expect(detail.postings).toHaveLength(1);
    expect(detail.postings[0]).toMatchObject({ payText: '£600-£650/day' });
    expect(detail.descriptionText).toContain('SAFe agile coach');
    expect(detail.assessment).toMatchObject({ fit_score: 80, best_cv_id: 'cv1' });
    expect(detail.cvScores).toEqual([
      { cvId: 'cv1', label: 'Agile Coach CV', similarity: expect.any(Number), score: 80 },
    ]);
    expect(detail.history).toEqual([
      { id: expect.any(Number), from: 'new', to: 'shortlisted', at: expect.any(String) },
    ]);
  });

  it('finds a job whatever its state, and 404s an unknown one', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Agile Coach');
    await patch(deps, id, { status: 'withdrawn' });
    expect((await call(deps, `/groups/${id}`)).status).toBe(200);
    expect((await call(deps, '/groups/nope')).status).toBe(404);
  });
});

describe('GET /api/stats', () => {
  it('summarises the Inbox, your pipeline, the next scan and AI use', async () => {
    const deps = await populated();
    await patch(deps, await idOf(deps, 'Agile Coach'), {
      status: 'applied',
      cvIdSent: 'cv1',
    });
    await patch(deps, await idOf(deps, 'Scrum Master'), { status: 'shortlisted' });

    const stats = (await (await call(deps, '/stats')).json()) as StatsResponse;
    expect(stats).toMatchObject({
      newToday: 1,
      inbox: 1,
      shortlisted: 1,
      appliedThisWeek: 1,
      nextScanAt: '2026-11-20T12:00:00.000Z',
    });
    expect(stats.aiBudgetPercent).toBeGreaterThanOrEqual(0);
    expect(stats.aiBudgetPercent).toBeLessThanOrEqual(100);
  });
});

describe('PUT /api/groups/:id/notes', () => {
  it('saves notes without changing the job’s state or what else was recorded', async () => {
    const deps = await populated();
    const id = await idOf(deps, 'Agile Coach');
    await patch(deps, id, { status: 'applied', cvIdSent: 'cv1' });
    const res = await call(deps, `/groups/${id}/notes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'Spoke to Sam, call Tuesday' }),
    });
    expect(res.status).toBe(200);
    expect(await repos.applications.getByGroup(id)).toMatchObject({
      notes: 'Spoke to Sam, call Tuesday',
      cvIdSent: 'cv1',
    });
    expect((await repos.groups.getById(id))?.status).toBe('applied');
    const missing = await call(deps, '/groups/nope/notes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'x' }),
    });
    expect(missing.status).toBe(404);
  });
});
