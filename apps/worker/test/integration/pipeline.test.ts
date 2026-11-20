import { env } from 'cloudflare:workers';
import type { RunDetail, RunSummary, UpdateSearchProfile } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { createSourceCallRecorder } from '../../src/adapters/sourceCallRecorder.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import { AppError } from '../../src/lib/errors.js';
import { handleMessage } from '../../src/pipeline/consume.js';
import { type PipelineMessage, QUEUE_MAX_RETRIES } from '../../src/pipeline/messages.js';
import { runScheduled } from '../../src/pipeline/scheduled.js';
import { startRun } from '../../src/pipeline/startRun.js';
import { FakeBus } from '../fakes/fakeBus.js';
import { FakeEmbedder } from '../fakes/fakeEmbedder.js';
import { FakeLlm } from '../fakes/fakeLlm.js';
import { FakeSource, reedJob, refFor } from '../fakes/fakeSource.js';
import { FakeVectorStore } from '../fakes/fakeVectorStore.js';
import { assessmentJson } from '../fixtures/assessment.js';

const repos = createRepos(createDb(env.DB));
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

/** A clock the test can move. */
class TestClock {
  constructor(public time: number) {}
  now() {
    return new Date(this.time);
  }
  advanceMinutes(n: number) {
    this.time += n * 60_000;
  }
}

const FRIDAY_0700 = Date.parse('2026-11-20T07:00:00.000Z');
const CV_TEXT = 'Enterprise Agile Coach leading SAFe transformation programmes across banking.';

const baseProfile: UpdateSearchProfile = {
  jobTitles: ['Agile Coach'],
  mustKeywords: [],
  excludeKeywords: ['graduate'],
  locations: ['London'],
  radiusMiles: 25,
  employmentTypes: ['contract'],
  minDayRate: 500,
  minSalary: null,
  ir35Preference: 'any',
  workModes: [],
  maxOnsiteDays: null,
  active: true,
};

// Five jobs for the "Agile Coach / London" search, over two pages.
const J1 = reedJob(1); // £600–650/day: passes
const J2 = reedJob(2, { salary: '£300 - £350 per day' }); // below the £500 minimum
const J3 = reedJob(3, { jobTitle: 'Graduate Agile Coach' }); // excluded keyword
const J4 = reedJob(4, { jobTitle: 'Scrum Master' }); // passes
const J5 = reedJob(5, { jobTitle: 'Agile Delivery Coach' }); // passes (page 2)
const DETAILS = Object.fromEntries([J1, J2, J3, J4, J5].map((j) => [String(j.jobId), j]));
const PAGES = { 'Agile Coach': [[J1, J2, J3].map(refFor), [J4, J5].map(refFor)] };

async function setup(
  opts: { profiles?: Partial<UpdateSearchProfile>[]; source?: FakeSource } = {},
) {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();

  const clock = new TestClock(FRIDAY_0700);
  const embedder = new FakeEmbedder();
  const vectors = new FakeVectorStore();
  const bus = new FakeBus();
  const source = opts.source ?? new FakeSource({ pages: PAGES, details: DETAILS });
  source.recorder = createSourceCallRecorder({ repos, clock });
  const llm = FakeLlm.always(assessmentJson());
  const now = clock.now().toISOString();
  // Every passing job goes to the model: the first-pass cut-off is tested in assessment.test.ts.
  await repos.settings.put('thresholds', { prefilterMin: 0 }, now);
  const deps = createContainer(env, { clock, embedder, vectors, bus, source, llm, access: null });

  const cvIds: string[] = [];
  for (const [i, patch] of (opts.profiles ?? [{}]).entries()) {
    const cvId = `cv${i + 1}`;
    cvIds.push(cvId);
    await repos.cvs.insert({
      id: cvId,
      label: `CV ${i + 1}`,
      r2Key: `k${i}`,
      textMd: CV_TEXT,
      createdAt: now,
      updatedAt: now,
    });
    const [vector] = await embedder.embed([CV_TEXT]);
    await vectors.upsert([
      { id: `cv:${cvId}`, values: vector as number[], metadata: { kind: 'cv' } },
    ]);
    await repos.profiles.insert(`p${i + 1}`, cvId, { ...baseProfile, ...patch }, now);
  }
  return { clock, embedder, vectors, bus, source, llm, deps };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const countRows = async (table: string, where = '1=1') =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())
    ?.n;

async function runAll(s: Setup, opts: { duplicate?: boolean } = {}) {
  const started = await startRun(s.deps, { trigger: 'manual' });
  await s.bus.drain(s.deps, opts);
  return started as { runId: string; queries: number };
}

describe('a full ingest run', () => {
  it('fetches both pages, processes every job once, and finishes with accurate counts', async () => {
    const s = await setup();
    const { runId, queries } = await runAll(s);

    expect(queries).toBe(1);
    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({
      status: 'completed',
      phase: 'done',
      pendingIngest: 0,
      pendingScore: 0,
    });
    expect(run?.finishedAt).toBe(s.clock.now().toISOString());
    expect(run?.countsJson).toEqual({
      fetched: 5,
      new: 5,
      filtered: 2,
      prefiltered: 3,
      llmScored: 3,
      inboxAdded: 3,
    });

    // Both pages were searched, each job's advert fetched exactly once.
    expect(s.source.searches.map((c) => c.page)).toEqual([0, 1]);
    expect(s.source.detailCalls.sort()).toEqual(['1', '2', '3', '4', '5']);

    const statusOf = async (sourceJobId: string) => {
      const job = await repos.jobs.getBySource('reed', sourceJobId);
      return { job, group: job?.groupId ? await repos.groups.getById(job.groupId) : undefined };
    };
    const ok = await statusOf('1');
    expect(ok.job).toMatchObject({
      stage: 'processed',
      title: 'Agile Coach',
      employmentType: 'contract',
      payMin: 600,
      payMax: 650,
      payPeriod: 'day',
      annualisedMin: 132_000,
      ir35: 'outside',
      filterReason: null,
    });
    expect(ok.group).toMatchObject({ status: 'new', canonicalJobId: ok.job?.id, runId });
    expect(ok.group?.prefilterScore).toBeGreaterThan(0);
    expect(ok.group?.finalScore).toBeGreaterThan(0);
    expect(ok.group?.bestCvId).toBe('cv1');

    const low = await statusOf('2');
    expect(low.job).toMatchObject({ stage: 'processed', filterReason: 'below_min_day_rate' });
    expect(low.group?.status).toBe('filtered');
    expect((await statusOf('3')).job?.filterReason).toBe('excluded_keyword:graduate');
    expect((await statusOf('4')).group?.status).toBe('new');
    expect((await statusOf('5')).group?.status).toBe('new');

    // Only passing jobs are embedded; each is compared with the one active CV.
    expect([...s.vectors.items.keys()].filter((k) => k.startsWith('job:'))).toHaveLength(3);
    expect(await countRows('job_cv_similarity')).toBe(3);
    expect(await countRows('job_groups')).toBe(5);
    expect(await countRows('job_profile_hits')).toBe(5);

    // Every enqueue and completion left exactly one marker: 2 fetch pages + 5 jobs + 3 assessments,
    // each twice.
    expect(await countRows('processed_messages')).toBe(20);
    expect(await countRows('assessments', "status = 'ok'")).toBe(3);
    expect(s.llm.requests).toHaveLength(3);
  });

  it('stops paging at the configured limit', async () => {
    const s = await setup();
    await repos.settings.put('budgets', { maxPagesPerQuery: 1 }, '2026-11-20T00:00:00.000Z');
    const { runId } = await runAll(s);
    expect(s.source.searches.map((c) => c.page)).toEqual([0]);
    expect((await repos.runs.getById(runId))?.countsJson).toMatchObject({ fetched: 3, new: 3 });
  });

  it('does not ask for another page when the source says there is none', async () => {
    const s = await setup({
      source: new FakeSource({
        pages: { 'Agile Coach': [[J1, J2].map(refFor)] },
        details: DETAILS,
      }),
    });
    await runAll(s);
    expect(s.source.searches).toHaveLength(1);
  });

  it('is unaffected by every message being delivered twice (at-least-once queues)', async () => {
    const s = await setup();
    const { runId } = await runAll(s, { duplicate: true });

    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({
      status: 'completed',
      phase: 'done',
      pendingIngest: 0,
      pendingScore: 0,
    });
    expect(run?.countsJson).toEqual({
      fetched: 10, // the fetch page was redelivered
      new: 5,
      filtered: 2,
      prefiltered: 3,
      llmScored: 3,
      inboxAdded: 3,
    });
    expect(await countRows('job_groups')).toBe(5);
    expect(await countRows('jobs')).toBe(5);
    expect(await countRows('processed_messages')).toBe(20);
    expect(s.source.detailCalls).toHaveLength(5);
    expect(s.llm.requests).toHaveLength(3); // the model is never paid for twice
    expect([...s.vectors.items.keys()].filter((k) => k.startsWith('job:'))).toHaveLength(3);
  });

  it('a second run straight afterwards finds nothing new and fetches no adverts', async () => {
    const s = await setup();
    await runAll(s);
    const detailCallsAfterFirst = s.source.detailCalls.length;

    const { runId } = await runAll(s);
    const second = await repos.runs.getById(runId);
    expect(second).toMatchObject({ status: 'completed', phase: 'done', pendingIngest: 0 });
    expect(second?.countsJson).toMatchObject({ fetched: 3 });
    expect(second?.countsJson).not.toHaveProperty('new');
    expect(s.source.detailCalls).toHaveLength(detailCallsAfterFirst);
    expect(await countRows('job_groups')).toBe(5);
    // It stopped after one page because that page produced no new work.
    expect(s.source.searches.filter((c) => c.page === 1)).toHaveLength(1);
  });

  it('picks up a job whose earlier run died before processing it', async () => {
    const s = await setup();
    await repos.jobs.insertRefsIfNew([
      {
        id: 'old-ref',
        source: 'reed',
        sourceJobId: '1',
        title: 'Agile Coach',
        createdAt: '2026-11-19T00:00:00.000Z',
      },
    ]);
    await runAll(s);
    expect((await repos.jobs.getById('old-ref'))?.stage).toBe('processed');
    expect(await countRows('jobs')).toBe(5);
  });

  it('with no active profile, completes immediately without calling the source', async () => {
    const s = await setup({ profiles: [{ active: false }] });
    const { runId, queries } = await runAll(s);
    expect(queries).toBe(0);
    expect(await repos.runs.getById(runId)).toMatchObject({ status: 'completed', phase: 'done' });
    expect(s.source.searches).toHaveLength(0);
  });

  it('ignores profiles whose CV is inactive', async () => {
    const s = await setup();
    await repos.cvs.update('cv1', { active: false });
    expect((await runAll(s)).queries).toBe(0);
  });

  it('merges identical searches from two profiles but credits both with every hit', async () => {
    const s = await setup({ profiles: [{}, {}] });
    const { queries } = await runAll(s);
    expect(queries).toBe(1);
    expect(s.source.searches.filter((c) => c.page === 0)).toHaveLength(1);
    expect(await countRows('job_profile_hits')).toBe(10); // 5 jobs × 2 profiles
    expect(await countRows('job_cv_similarity')).toBe(6); // 3 passing jobs × 2 CVs
  });

  it('a job must pass for only one of the profiles that found it', async () => {
    const s = await setup({ profiles: [{}, { minDayRate: 100, excludeKeywords: [] }] });
    const { runId } = await runAll(s);
    // The lenient profile accepts what the strict one rejects, so nothing is filtered.
    expect((await repos.runs.getById(runId))?.countsJson).toMatchObject({ prefiltered: 5 });
    expect(await countRows('job_groups', "status = 'filtered'")).toBe(0);
  });
});

describe('starting runs', () => {
  it('refuses a manual run while another is working, then allows one afterwards', async () => {
    const s = await setup();
    await startRun(s.deps, { trigger: 'manual' });
    await expect(startRun(s.deps, { trigger: 'manual' })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    await s.bus.drain(s.deps);
    await expect(startRun(s.deps, { trigger: 'manual' })).resolves.toMatchObject({ queries: 1 });
  });

  it('a cron slot starts one run however often it fires', async () => {
    const s = await setup();
    await runScheduled(s.deps);
    await runScheduled(s.deps);
    await runScheduled(s.deps);
    expect(await countRows('runs')).toBe(1);
    const run = await repos.runs.getBySlotKey('2026-11-20T07:00');
    expect(run).toMatchObject({ trigger: 'cron', status: 'running' });
    expect(s.bus.queue).toHaveLength(1);
  });

  it('starts nothing outside a scheduled hour or on a Saturday', async () => {
    const s = await setup();
    s.clock.time = Date.parse('2026-11-20T09:00:00Z'); // Friday 09:00
    await runScheduled(s.deps);
    s.clock.time = Date.parse('2026-11-21T07:00:00Z'); // Saturday 07:00
    await runScheduled(s.deps);
    expect(await countRows('runs')).toBe(0);
  });

  it('marks the run failed, and unblocks the next one, when the queue is unavailable', async () => {
    const s = await setup();
    s.bus.failSend = new AppError('NOT_CONFIGURED', 'Job queues are not configured');
    await expect(startRun(s.deps, { trigger: 'manual' })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    const [run] = await repos.runs.listRecent(1);
    expect(run).toMatchObject({ status: 'failed', phase: 'done' });
    expect(await repos.runs.listErrors(run?.id as string, 5)).toHaveLength(1);
    await expect(startRun(s.deps, { trigger: 'manual' })).resolves.toBeTruthy();
  });

  it('keeps a stuck run from blocking forever: it is marked stale after the timeout', async () => {
    const s = await setup();
    s.clock.time = Date.parse('2026-11-20T09:00:00Z'); // Friday 09:00: no scheduled slot in the next hour
    const { runId } = (await startRun(s.deps, { trigger: 'manual' })) as { runId: string };
    s.bus.queue = []; // the queued message is lost

    s.clock.advanceMinutes(29);
    await runScheduled(s.deps);
    expect((await repos.runs.getById(runId))?.status).toBe('running');

    s.clock.advanceMinutes(2);
    await runScheduled(s.deps);
    expect(await repos.runs.getById(runId)).toMatchObject({ status: 'stale', phase: 'done' });
    const [error] = await repos.runs.listErrors(runId, 5);
    expect(error).toMatchObject({ stage: 'recovery' });
    expect(error?.message).toContain('still waiting on 1 ingest');
    await expect(startRun(s.deps, { trigger: 'manual' })).resolves.toBeTruthy();
  });
});

describe('failures', () => {
  async function started(s: Setup) {
    const { runId } = (await startRun(s.deps, { trigger: 'manual' })) as { runId: string };
    const first = s.bus.queue[0]?.msg as PipelineMessage;
    return { runId, first };
  }

  it('retries a transient search failure with backoff and leaves the counter alone', async () => {
    const s = await setup();
    s.source.searchError = (n) =>
      n <= 2 ? new AppError('UPSTREAM_ERROR', 'Reed 503', { retryable: true }) : null;
    const { runId } = await runAll(s);

    const outcomes = s.bus.deliveries
      .filter((d) => d.msg.type === 'fetch' && d.msg.page === 0)
      .map((d) => d.outcome);
    expect(outcomes).toEqual(['retry', 'retry', 'ack']);
    expect(await repos.runs.getById(runId)).toMatchObject({
      status: 'completed',
      pendingIngest: 0,
    });
    expect(await repos.runs.listErrors(runId, 5)).toHaveLength(0);
  });

  it('asks the queue to retry with an increasing delay', async () => {
    const s = await setup();
    const { first } = await started(s);
    s.source.searchError = () => new AppError('UPSTREAM_ERROR', 'down', { retryable: true });
    const a = await handleMessage(s.deps, first, 1);
    const b = await handleMessage(s.deps, first, 2);
    expect(a).toMatchObject({ outcome: 'retry' });
    expect(b).toMatchObject({ outcome: 'retry' });
    expect((b as { delaySeconds: number }).delaySeconds).toBeGreaterThan(
      (a as { delaySeconds: number }).delaySeconds,
    );
  });

  it('gives up on the last attempt: records the error but still completes the message', async () => {
    const s = await setup();
    const { runId, first } = await started(s);
    s.source.searchError = () => new AppError('UPSTREAM_ERROR', 'Reed down', { retryable: true });

    expect(await handleMessage(s.deps, first, QUEUE_MAX_RETRIES)).toMatchObject({
      outcome: 'retry',
    });
    s.bus.queue = [];
    expect(await handleMessage(s.deps, first, QUEUE_MAX_RETRIES + 1)).toEqual({ outcome: 'ack' });

    expect(await repos.runs.getById(runId)).toMatchObject({
      status: 'completed',
      phase: 'done',
      pendingIngest: 0,
    });
    const [error] = await repos.runs.listErrors(runId, 5);
    expect(error).toMatchObject({ stage: 'fetch' });
    expect(error?.message).toContain('Reed down');
  });

  it('does not retry a permanent failure (bad API key) and completes the run', async () => {
    const s = await setup();
    s.source.searchError = () =>
      new AppError('UPSTREAM_ERROR', 'Reed rejected the API key (HTTP 401)', { retryable: false });
    const { runId } = await runAll(s);
    expect(s.bus.deliveries.map((d) => d.outcome)).toEqual(['ack']);
    expect(await repos.runs.getById(runId)).toMatchObject({
      status: 'completed',
      pendingIngest: 0,
    });
    expect((await repos.runs.listErrors(runId, 5))[0]?.message).toContain('401');
    expect(await countRows('jobs')).toBe(0);
  });

  it('stops fetching once the daily Reed budget is spent', async () => {
    const s = await setup();
    await repos.usage.increment('2026-11-20', 'reedCalls', 900);
    const { runId } = await runAll(s);
    expect(s.source.searches).toHaveLength(0);
    expect(await repos.runs.getById(runId)).toMatchObject({
      status: 'completed',
      pendingIngest: 0,
    });
    expect((await repos.runs.listErrors(runId, 5))[0]?.message).toContain('daily_budget');
  });

  it('a job that disappeared from Reed is closed out, not retried', async () => {
    const s = await setup({
      source: new FakeSource({
        pages: { 'Agile Coach': [[J1, J2].map(refFor)] },
        details: { '1': J1 },
      }),
    });
    const { runId } = await runAll(s);
    expect(await repos.jobs.getBySource('reed', '2')).toMatchObject({
      stage: 'processed',
      filterReason: 'no_longer_available',
      groupId: null,
    });
    expect(await repos.runs.getById(runId)).toMatchObject({
      status: 'completed',
      pendingIngest: 0,
    });
    expect(await repos.runs.listErrors(runId, 5)).toHaveLength(0);
    expect(s.bus.deliveries.every((d) => d.outcome === 'ack')).toBe(true);
  });

  it('resumes a half-processed job without duplicating its group or re-fetching its advert', async () => {
    const s = await setup({
      source: new FakeSource({
        pages: { 'Agile Coach': [[J1].map(refFor)] },
        details: { '1': J1 },
      }),
    });
    s.embedder.failNext = new Error('embedding service hiccup');
    const { runId } = await runAll(s);

    const processOutcomes = s.bus.deliveries
      .filter((d) => d.msg.type === 'process')
      .map((d) => d.outcome);
    expect(processOutcomes).toEqual(['retry', 'ack']);
    expect(s.source.detailCalls).toEqual(['1']); // the retry used the stored advert
    expect(await countRows('job_groups')).toBe(1);
    expect(await repos.jobs.getBySource('reed', '1')).toMatchObject({ stage: 'processed' });
    expect(await repos.runs.getById(runId)).toMatchObject({
      status: 'completed',
      pendingIngest: 0,
    });
    expect((await repos.runs.getById(runId))?.countsJson).toMatchObject({ prefiltered: 1 });
  });

  it('drops an invalid message without touching any run', async () => {
    const s = await setup();
    const { runId } = await started(s);
    expect(await handleMessage(s.deps, { type: 'mystery' }, 1)).toEqual({ outcome: 'ack' });
    expect(await handleMessage(s.deps, 'not even an object', 1)).toEqual({ outcome: 'ack' });
    expect((await repos.runs.getById(runId))?.pendingIngest).toBe(1);
  });
});

describe('Reed budget and job age', () => {
  const DAY = 86_400_000;
  const refAt = (job: ReturnType<typeof reedJob>, daysAgo: number) => ({
    ...refFor(job),
    postedAt: new Date(FRIDAY_0700 - daysAgo * DAY).toISOString(),
  });

  it('records adverts older than the ingest window but never fetches them in full', async () => {
    const fresh = reedJob(11);
    const old = reedJob(12);
    const s = await setup({
      source: new FakeSource({
        pages: { 'Agile Coach': [[refAt(fresh, 1), refAt(old, 30)]] },
        details: { '11': fresh, '12': old },
      }),
    });
    const { runId } = await runAll(s);

    expect(s.source.detailCalls).toEqual(['11']);
    expect(await repos.jobs.getBySource('reed', '12')).toMatchObject({
      stage: 'processed',
      filterReason: 'too_old',
      groupId: null,
    });
    expect((await repos.runs.getById(runId))?.countsJson).toMatchObject({
      fetched: 2,
      new: 1,
      tooOld: 1,
      prefiltered: 1,
    });
  });

  it('honours a longer ingest window from settings', async () => {
    const old = reedJob(12);
    const s = await setup({
      source: new FakeSource({
        pages: { 'Agile Coach': [[refAt(old, 30)]] },
        details: { '12': old },
      }),
    });
    await repos.settings.put('ingest', { maxAgeDays: 60 }, '2026-11-20T00:00:00.000Z');
    await runAll(s);
    expect(s.source.detailCalls).toEqual(['12']);
  });

  it('queues only what the run\x27s Reed budget can pay for, newest first, and defers the rest without errors', async () => {
    const jobs = [21, 22, 23, 24, 25, 26].map((id) => reedJob(id));
    const refs = jobs.map((j, i) => refAt(j, i)); // 21 is the newest, 26 the oldest
    const s = await setup({
      source: new FakeSource({
        pages: { 'Agile Coach': [refs] },
        details: Object.fromEntries(jobs.map((j) => [String(j.jobId), j])),
      }),
    });
    // 1 search + 3 adverts + 1 held back for a next page = a cap of 5.
    await repos.settings.put('budgets', { reedCallsPerRunCap: 5 }, '2026-11-20T00:00:00.000Z');
    const { runId } = await runAll(s);

    expect(s.source.detailCalls.sort()).toEqual(['21', '22', '23']);
    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({ status: 'completed', phase: 'done', pendingIngest: 0 });
    expect(run?.countsJson).toMatchObject({ fetched: 6, new: 6, deferred: 3 });
    expect(await repos.runs.listErrors(runId, 5)).toHaveLength(0);
    // The deferred jobs are still waiting, untouched.
    for (const id of ['24', '25', '26']) {
      expect(await repos.jobs.getBySource('reed', id)).toMatchObject({
        stage: 'ref',
        groupId: null,
      });
    }
    expect(await countRows('source_calls', `run_id = '${runId}'`)).toBe(4);
  });

  it('the next run finishes the deferred jobs straight from the database, before searching again', async () => {
    const jobs = [21, 22, 23, 24, 25, 26].map((id) => reedJob(id));
    const source = new FakeSource({
      pages: { 'Agile Coach': [jobs.map((j, i) => refAt(j, i))] },
      details: Object.fromEntries(jobs.map((j) => [String(j.jobId), j])),
    });
    const s = await setup({ source });
    await repos.settings.put('budgets', { reedCallsPerRunCap: 5 }, '2026-11-20T00:00:00.000Z');
    await runAll(s);
    expect(source.detailCalls).toHaveLength(3);

    // A roomier budget for the second run: the 3 waiting adverts are queued straight from the
    // database, after reserving the searches this run may still make.
    // (Through the service, which caches settings for the life of this test container.)
    await s.deps.settings.update({ budgets: { reedCallsPerRunCap: 10 } });
    const second = await startRun(s.deps, { trigger: 'manual' });
    expect(s.bus.pending('process')).toHaveLength(3);
    await s.bus.drain(s.deps);

    expect(source.detailCalls.sort()).toEqual(['21', '22', '23', '24', '25', '26']);
    expect(await repos.runs.getById(second?.runId as string)).toMatchObject({
      status: 'completed',
      pendingIngest: 0,
    });
    expect(await countRows('jobs', "stage = 'processed'")).toBe(6);
  });

  it('skips the whole backlog when the daily budget is already spent', async () => {
    const job = reedJob(31);
    const s = await setup({
      source: new FakeSource({
        pages: { 'Agile Coach': [[refAt(job, 1)]] },
        details: { '31': job },
      }),
    });
    await repos.jobs.insertRefsIfNew([
      {
        id: 'waiting',
        source: 'reed',
        sourceJobId: '99',
        title: 'Old ref',
        postedAt: new Date(FRIDAY_0700 - DAY).toISOString(),
        createdAt: '2026-11-19T00:00:00.000Z',
      },
    ]);
    await repos.usage.increment('2026-11-20', 'reedCalls', 899); // one call left today: not enough for the searches
    await startRun(s.deps, { trigger: 'manual' });
    expect(s.bus.pending('process')).toHaveLength(0);
  });

  it('jobs whose turn comes after the budget ran out are deferred, not reported as errors', async () => {
    const s = await setup();
    const { runId } = (await startRun(s.deps, { trigger: 'manual' })) as { runId: string };
    // Deliver just the search page, then the day's budget disappears before the jobs are processed.
    const first = s.bus.queue.shift();
    await handleMessage(s.deps, first?.msg, 1);
    await repos.usage.increment('2026-11-20', 'reedCalls', 900);
    await s.bus.drain(s.deps);

    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({ status: 'completed', phase: 'done', pendingIngest: 0 });
    expect(run?.countsJson).toMatchObject({ deferred: 3 });
    // The three jobs are deferred silently; the only error is the refused search for page 2.
    const errors = await repos.runs.listErrors(runId, 5);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ stage: 'fetch' });
    expect(errors[0]?.message).toContain('daily_budget');
    expect(await countRows('jobs', "stage = 'ref'")).toBe(3);
    expect(s.source.detailCalls).toHaveLength(0);
  });
});

describe('/api/runs', () => {
  const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;
  const call = (s: Setup, path: string, method = 'GET') =>
    createApp(() => s.deps).fetch(new Request(`http://localhost/api${path}`, { method }), devEnv);

  it('starts a run (202), lists it, and shows its detail and errors', async () => {
    const s = await setup();
    s.source.searchError = (n) =>
      n === 1
        ? new AppError('UPSTREAM_ERROR', 'Reed rejected the API key (HTTP 401)', {
            retryable: false,
          })
        : null;

    const res = await call(s, '/runs', 'POST');
    expect(res.status).toBe(202);
    const { runId, queries } = (await res.json()) as { runId: string; queries: number };
    expect(queries).toBe(1);

    // While it is working, a second request is refused.
    expect((await call(s, '/runs', 'POST')).status).toBe(409);

    await s.bus.drain(s.deps);

    const list = (await (await call(s, '/runs')).json()) as RunSummary[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: runId,
      trigger: 'manual',
      status: 'completed',
      phase: 'done',
      errorCount: 1,
    });

    const detail = (await (await call(s, `/runs/${runId}`)).json()) as RunDetail;
    expect(detail).toMatchObject({ id: runId, pendingIngest: 0, pendingScore: 0 });
    expect(detail.errors).toHaveLength(1);
    expect(detail.errors[0]).toMatchObject({ stage: 'fetch' });
    expect(detail.errors[0]?.message).toContain('401');
  });

  it('reports counts and Reed calls for a successful run', async () => {
    const s = await setup();
    await runAll(s);
    const [row] = (await (await call(s, '/runs')).json()) as RunSummary[];
    expect(row).toMatchObject({
      counts: { fetched: 5, new: 5, filtered: 2, prefiltered: 3, llmScored: 3, inboxAdded: 3 },
      reedCalls: 7,
      errorCount: 0,
    });
  });

  it('404s an unknown run', async () => {
    const s = await setup();
    expect((await call(s, '/runs/nope')).status).toBe(404);
  });

  it('answers 503 NOT_CONFIGURED when the job queues are not bound', async () => {
    await setup();
    const app = createApp((e) => createContainer(e, { access: null }));
    const res = await app.fetch(
      new Request('http://localhost/api/runs', { method: 'POST' }),
      devEnv,
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_CONFIGURED');
    expect(await repos.runs.findActive()).toBeUndefined();
  });
});
