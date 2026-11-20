import { env } from 'cloudflare:workers';
import type { GroupListResponse } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { createSourceCallRecorder } from '../../src/adapters/sourceCallRecorder.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import { handleMessage } from '../../src/pipeline/consume.js';
import { startRun } from '../../src/pipeline/startRun.js';
import { FakeBus } from '../fakes/fakeBus.js';
import { FakeEmbedder } from '../fakes/fakeEmbedder.js';
import { FakeLlm } from '../fakes/fakeLlm.js';
import { FakeSource, reedJob, refFor } from '../fakes/fakeSource.js';
import { FakeVectorStore } from '../fakes/fakeVectorStore.js';
import { assessmentJson, validAssessment } from '../fixtures/assessment.js';

const repos = createRepos(createDb(env.DB));
const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;
const TABLES = [
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

class TestClock {
  constructor(public time: number) {}
  now() {
    return new Date(this.time);
  }
}

const FRIDAY_0700 = Date.parse('2026-11-20T07:00:00.000Z');
const FRIDAY_1700 = Date.parse('2026-11-20T17:00:00.000Z');
const CV_TEXT = 'Enterprise Agile Coach leading SAFe transformation programmes across banking.';

// Three jobs that pass the filters. Different titles make their first-pass scores differ.
const JOBS = [
  reedJob(1),
  reedJob(2, { jobTitle: 'Agile Delivery Coach' }),
  reedJob(3, { jobTitle: 'Scrum Master' }),
];

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup(
  opts: {
    settings?: Record<string, Record<string, unknown>>;
    llm?: FakeLlm;
    startTime?: number;
  } = {},
) {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  const clock = new TestClock(opts.startTime ?? FRIDAY_0700);
  const now = clock.now().toISOString();
  const settings = { thresholds: { prefilterMin: 0 }, ...opts.settings };
  for (const [key, value] of Object.entries(settings)) await repos.settings.put(key, value, now);

  const embedder = new FakeEmbedder();
  const vectors = new FakeVectorStore();
  const bus = new FakeBus();
  const source = new FakeSource({
    pages: { 'Agile Coach': [JOBS.map(refFor)] },
    details: Object.fromEntries(JOBS.map((j) => [String(j.jobId), j])),
  });
  source.recorder = createSourceCallRecorder({ repos, clock });
  const llm = opts.llm ?? FakeLlm.always(assessmentJson());
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
  return { clock, bus, llm, deps, vectors, source };
}

async function runAll(s: Setup) {
  const started = await startRun(s.deps, { trigger: 'manual' });
  await s.bus.drain(s.deps);
  return (started as { runId: string }).runId;
}

const statuses = async () =>
  Object.fromEntries(
    (
      await repos.groups.listByStatus([
        'prefiltered',
        'pending_llm',
        'deferred',
        'new',
        'below_threshold',
        'filtered',
      ])
    ).map((g) => [g.canonicalJobId, g.status]),
  );

describe('selecting what the model assesses', () => {
  it('assesses at most maxLlmPerRun groups, best first-pass score first, and leaves the rest for later', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 2 } } });
    const runId = await runAll(s);

    const groups = await repos.groups.listByStatus(['new', 'prefiltered']);
    const scored = groups.filter((g) => g.status === 'new');
    const waiting = groups.filter((g) => g.status === 'prefiltered');
    expect(scored).toHaveLength(2);
    expect(waiting).toHaveLength(1);
    // Everything that was scored had a first-pass score at least as good as the one left waiting.
    for (const g of scored) {
      expect(g.prefilterScore as number).toBeGreaterThanOrEqual(
        waiting[0]?.prefilterScore as number,
      );
    }
    expect(s.llm.requests).toHaveLength(2);
    expect(await repos.runs.getById(runId)).toMatchObject({
      status: 'completed',
      phase: 'done',
      pendingScore: 0,
    });

    // The next run picks the waiting one up.
    await runAll(s);
    expect((await repos.groups.getById(waiting[0]?.id as string))?.status).toBe('new');
    expect(s.llm.requests).toHaveLength(3);
  });

  it('sends groups below the first-pass cut-off nowhere, and still finishes the run', async () => {
    const s = await setup({ settings: { thresholds: { prefilterMin: 101 } } });
    const runId = await runAll(s);
    expect(s.llm.requests).toHaveLength(0);
    expect(Object.values(await statuses())).toEqual([
      'below_threshold',
      'below_threshold',
      'below_threshold',
    ]);
    expect(await repos.runs.getById(runId)).toMatchObject({ status: 'completed', phase: 'done' });
  });

  it('puts groups that were deferred earlier ahead of everything else', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 1 } } });
    await runAll(s); // scores the best of the three
    const first = (await repos.groups.listByStatus(['prefiltered'])).sort(
      (a, b) => (a.prefilterScore as number) - (b.prefilterScore as number),
    )[0];
    // Make the worst of the remaining two "deferred": it must now beat the better-scoring one.
    await repos.groups.setStatus(first?.id as string, 'deferred');
    await runAll(s);
    expect((await repos.groups.getById(first?.id as string))?.status).toBe('new');
  });
});

describe('the assessment', () => {
  it('is stored with its model, prompt version and a final score, and moves the job to the Inbox', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 1 } } });
    const runId = await runAll(s);

    const [group] = await repos.groups.listByStatus(['new']);
    expect(group?.finalScore).toBeGreaterThan(0);
    expect(group?.bestCvId).toBe('cv1');
    const stored = await repos.assessments.getByGroup(group?.id as string);
    expect(stored).toMatchObject({
      status: 'ok',
      fitScore: 80,
      bestCvId: 'cv1',
      promptVersion: 'assess@1',
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    });
    expect(stored?.resultJson?.headline).toBe('Strong SAFe coaching match');
    expect((await repos.runs.getById(runId))?.countsJson).toMatchObject({
      llmScored: 1,
      inboxAdded: 1,
    });

    // The model saw the advert and the CV, and was asked for the assessment schema.
    const request = s.llm.requests[0];
    expect(request?.user).toContain('Title:');
    expect(request?.user).toContain('CV id: cv1');
    expect(request?.user).toContain(CV_TEXT);
    expect(request?.jsonSchema).toBeTruthy();
    expect((await repos.usage.get('2026-11-20'))?.llmCalls).toBe(1);
  });

  it('removes a contact the advert does not contain and fills in only what our parser left unknown', async () => {
    const reply = validAssessment({
      extracted: {
        ...validAssessment().extracted,
        contact_email: 'recruiter@made-up.example',
        work_mode: 'hybrid',
        ir35: 'inside', // our parser already found "outside": it must win
      },
    });
    const s = await setup({
      llm: FakeLlm.always(JSON.stringify(reply)),
      settings: { budgets: { maxLlmPerRun: 1 } },
    });
    await runAll(s);

    const [group] = await repos.groups.listByStatus(['new']);
    const stored = await repos.assessments.getByGroup(group?.id as string);
    expect(stored?.resultJson?.extracted.contact_email).toBeNull();
    const job = await repos.jobs.getById(group?.canonicalJobId as string);
    expect(job?.workMode).toBe('hybrid');
    expect(job?.ir35).toBe('outside');
  });

  it('keeps the job in the Inbox with its first-pass score when the model cannot produce valid output', async () => {
    const s = await setup({ llm: FakeLlm.always('I am sorry, I cannot help with that.') });
    const runId = await runAll(s);

    expect(await countWhere('assessments', "status = 'failed'")).toBe(3);
    const groups = await repos.groups.listByStatus(['new']);
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.finalScore).toBeNull();
      expect(g.prefilterScore).toBeGreaterThan(0);
    }
    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({ status: 'completed', pendingScore: 0 });
    expect(run?.countsJson).toMatchObject({ inboxAdded: 3 });
    expect(run?.countsJson).not.toHaveProperty('llmScored');

    // The list still shows them, flagged as failed.
    const body = (await (await listGroups(s)).json()) as GroupListResponse;
    expect(body.items[0]).toMatchObject({ finalScore: null, assessment: { status: 'failed' } });
  });

  it('defers everything, without errors, when today’s AI budget is spent, then catches up next time', async () => {
    const s = await setup();
    await repos.usage.increment('2026-11-20', 'neuronsEst', 10_000);
    const runId = await runAll(s);

    expect(s.llm.requests).toHaveLength(0);
    expect(Object.values(await statuses())).toEqual(['deferred', 'deferred', 'deferred']);
    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({ status: 'completed', phase: 'done', pendingScore: 0 });
    expect(run?.countsJson).toMatchObject({ deferred: 3 });
    expect(await repos.runs.listErrors(runId, 5)).toHaveLength(0);

    s.clock.time += 86_400_000; // tomorrow: a fresh allowance
    await runAll(s);
    expect(Object.values(await statuses())).toEqual(['new', 'new', 'new']);
  });

  it('never assesses the same group twice when its message is delivered twice', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 1 } } });
    await startRun(s.deps, { trigger: 'manual' });
    await s.bus.drain(s.deps, { duplicate: true });
    expect(s.llm.requests).toHaveLength(1);
    const run = (await repos.runs.listRecent(1))[0];
    expect(run).toMatchObject({ status: 'completed', pendingScore: 0 });
    expect(run?.countsJson).toMatchObject({ llmScored: 1, inboxAdded: 1 });
  });

  it('ignores a score message for a group that is no longer waiting, without calling the model', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 1 } } });
    const runId = await runAll(s);
    const [done] = await repos.groups.listByStatus(['new']);

    const result = await handleMessage(
      s.deps,
      { v: 1, type: 'score', runId, groupId: done?.id },
      1,
    );
    expect(result).toEqual({ outcome: 'ack' });
    expect(s.llm.requests).toHaveLength(1);
  });

  it('defers a group, and still completes the run, when scoring it keeps failing', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 1 } } });
    const { runId } = (await startRun(s.deps, { trigger: 'manual' })) as { runId: string };
    // Process everything up to the point where the score message is queued.
    while (s.bus.pending('score').length === 0) {
      const next = s.bus.queue.shift();
      await handleMessage(s.deps, next?.msg, 1);
    }
    const message = s.bus.queue.find((q) => q.msg.type === 'score')?.msg;
    s.bus.queue = [];
    const original = s.deps.repos.assessments.upsert;
    s.deps.repos.assessments.upsert = async () => {
      throw new Error('database unavailable');
    };
    const result = await handleMessage(s.deps, message, 4); // the last attempt
    s.deps.repos.assessments.upsert = original;

    expect(result).toEqual({ outcome: 'ack' });
    expect(Object.values(await statuses()).sort()).toEqual([
      'deferred',
      'prefiltered',
      'prefiltered',
    ]);
    expect(await repos.runs.getById(runId)).toMatchObject({ status: 'completed', pendingScore: 0 });
    expect((await repos.runs.listErrors(runId, 5))[0]?.message).toContain('database unavailable');
  });
});

describe('POST /api/groups/:id/rescore', () => {
  const post = (s: Setup, id: string) =>
    createApp(() => s.deps).fetch(
      new Request(`http://localhost/api/groups/${id}/rescore`, { method: 'POST' }),
      devEnv,
    );

  it('assesses the job again and replaces the stored assessment', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 1 } } });
    await runAll(s);
    const [group] = await repos.groups.listByStatus(['new']);
    s.llm.enqueue(assessmentJson({ fit_score: 20, headline: 'Second opinion' }));

    const res = await post(s, group?.id as string);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'scored' });
    const stored = await repos.assessments.getByGroup(group?.id as string);
    expect(stored).toMatchObject({ fitScore: 20 });
    expect(stored?.resultJson?.headline).toBe('Second opinion');
    expect((await repos.groups.getById(group?.id as string))?.status).toBe('new');
  });

  it('works on a job the first pass left waiting, moving it to the Inbox', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 0 } } });
    await runAll(s);
    const [group] = await repos.groups.listByStatus(['prefiltered']);
    expect((await post(s, group?.id as string)).status).toBe(200);
    expect((await repos.groups.getById(group?.id as string))?.status).toBe('new');
  });

  it('leaves a job you have already acted on in its state', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 0 } } });
    await runAll(s);
    const [group] = await repos.groups.listByStatus(['prefiltered']);
    await repos.groups.setStatus(group?.id as string, 'applied');
    expect((await post(s, group?.id as string)).status).toBe(200);
    expect((await repos.groups.getById(group?.id as string))?.status).toBe('applied');
  });

  it('answers 404 for an unknown job and 429 when the AI allowance is spent, changing nothing', async () => {
    const s = await setup({ settings: { budgets: { maxLlmPerRun: 1 } } });
    await runAll(s);
    expect((await post(s, 'nope')).status).toBe(404);

    const [group] = await repos.groups.listByStatus(['new']);
    await repos.usage.increment('2026-11-20', 'neuronsEst', 10_000);
    const res = await post(s, group?.id as string);
    expect(res.status).toBe(429);
    expect((await repos.groups.getById(group?.id as string))?.status).toBe('new');
    expect(s.llm.requests).toHaveLength(1);
  });
});

describe('clean-up after the last run of the day', () => {
  async function oldFilteredGroup(s: Setup) {
    const old = '2026-09-01T00:00:00.000Z';
    await repos.groups.insert({
      id: 'old-group',
      canonicalJobId: 'old-job',
      status: 'filtered',
      firstSeenAt: old,
      lastSeenAt: old,
    });
    await repos.jobs.insertRefsIfNew([
      { id: 'old-job', source: 'reed', sourceJobId: '999', groupId: 'old-group', createdAt: old },
    ]);
    await s.vectors.upsert([
      { id: 'job:old-job', values: [1, 0, 0], metadata: { kind: 'job', groupId: 'old-group' } },
    ]);
  }

  it('removes filtered jobs older than the retention period, with their vectors', async () => {
    const s = await setup({ startTime: FRIDAY_1700 });
    await oldFilteredGroup(s);
    await s.deps.repos.runs.insertIfNew({
      id: 'r17',
      slotKey: '2026-11-20T17:00',
      trigger: 'cron',
      status: 'running',
      phase: 'ingest',
      startedAt: s.clock.now().toISOString(),
    });
    const { finaliseRun } = await import('../../src/pipeline/finaliseRun.js');
    await finaliseRun(s.deps, 'r17');

    expect(await repos.groups.getById('old-group')).toBeUndefined();
    expect(await repos.jobs.getById('old-job')).toBeUndefined();
    expect(s.vectors.items.has('job:old-job')).toBe(false);
    expect(await repos.runs.getById('r17')).toMatchObject({ status: 'completed', phase: 'done' });
  });

  it('does nothing after a run that is not the last of the day, or a manual run', async () => {
    const s = await setup();
    await oldFilteredGroup(s);
    const { finaliseRun } = await import('../../src/pipeline/finaliseRun.js');
    for (const [id, slotKey] of [
      ['r07', '2026-11-20T07:00'],
      ['rm', 'manual:rm'],
    ] as const) {
      await repos.runs.insertIfNew({
        id,
        slotKey,
        trigger: slotKey.startsWith('manual') ? 'manual' : 'cron',
        status: 'running',
        phase: 'ingest',
        startedAt: s.clock.now().toISOString(),
      });
      await finaliseRun(s.deps, id);
    }
    expect(await repos.groups.getById('old-group')).toBeDefined();
  });

  it('keeps recent filtered jobs and every job that passed the filters', async () => {
    const s = await setup({ startTime: FRIDAY_1700 });
    await runAll(s);
    await repos.groups.insert({
      id: 'recent',
      canonicalJobId: null,
      status: 'filtered',
      firstSeenAt: '2026-11-15T00:00:00.000Z',
      lastSeenAt: '2026-11-15T00:00:00.000Z',
    });
    const { cleanup } = await import('../../src/pipeline/cleanup.js');
    expect(await cleanup(s.deps)).toBe(0);
    expect(await repos.groups.getById('recent')).toBeDefined();
    expect(await countWhere('job_groups', "status = 'new'")).toBe(3);
  });
});

async function countWhere(table: string, where: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).first<{
    n: number;
  }>();
  return row?.n ?? 0;
}

const listGroups = (s: Setup) =>
  createApp(() => s.deps).fetch(new Request('http://localhost/api/groups'), devEnv);
