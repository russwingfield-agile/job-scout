import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createSourceCallRecorder } from '../../src/adapters/sourceCallRecorder.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { handleMessage } from '../../src/pipeline/consume.js';
import { FetchMessageSchema } from '../../src/pipeline/messages.js';
import { startRun } from '../../src/pipeline/startRun.js';
import { adzunaHit, FakeAdzuna } from '../fakes/fakeAdzuna.js';
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
const NOW = new Date('2026-11-20T09:00:00.000Z');
const CV_TEXT = 'Enterprise Agile Coach leading SAFe transformation programmes across banking.';
const LONG =
  '<p>Lead the agile transformation for a large UK bank, coaching SAFe release trains and teams. Outside IR35. 6 month contract.</p>';

async function setup(opts: {
  reed: ReturnType<typeof reedJob>[];
  adzuna: ReturnType<typeof adzunaHit>[];
  settings?: Record<string, Record<string, unknown>>;
}) {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  const clock = { now: () => NOW };
  const now = NOW.toISOString();
  const settings = { thresholds: { prefilterMin: 0 }, ...opts.settings };
  for (const [key, value] of Object.entries(settings)) await repos.settings.put(key, value, now);

  const reed = new FakeSource({
    pages: { 'Agile Coach': [opts.reed.map(refFor)] },
    details: Object.fromEntries(opts.reed.map((j) => [String(j.jobId), j])),
  });
  const adzuna = new FakeAdzuna([opts.adzuna]);
  const recorder = createSourceCallRecorder({ repos, clock });
  reed.recorder = recorder;
  adzuna.recorder = recorder;

  const embedder = new FakeEmbedder();
  const vectors = new FakeVectorStore();
  const bus = new FakeBus();
  const llm = FakeLlm.always(assessmentJson());
  const deps = createContainer(env, {
    clock,
    embedder,
    vectors,
    bus,
    llm,
    source: reed,
    sources: { reed, adzuna },
    access: null,
  });
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
  return { deps, bus, reed, adzuna };
}

type S = Awaited<ReturnType<typeof setup>>;
async function runAll(s: S) {
  const started = await startRun(s.deps, { trigger: 'manual' });
  await s.bus.drain(s.deps);
  return (started as { runId: string }).runId;
}
const count = async (table: string, where = '1=1'): Promise<number> =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())
    ?.n ?? 0;

const uniqueText = (id: number) =>
  `<p>Unique role ${id} ${'w'.repeat(3)}${id} ${Array.from({ length: 12 }, (_, i) => `t${id}x${i}`).join(' ')}</p>`;

describe('running more than one job source', () => {
  it('searches every source and processes each source’s jobs with its own adapter', async () => {
    const s = await setup({
      reed: [reedJob(1, { jobDescription: uniqueText(1) })],
      adzuna: [
        adzunaHit(900, {
          title: 'Delivery Lead',
          description: 'Delivery lead for payments. Outside IR35.',
          company: { display_name: 'Other Co' },
        }),
      ],
    });
    const runId = await runAll(s);

    expect(s.reed.searches).toHaveLength(1);
    expect(s.adzuna.searches).toHaveLength(1);
    expect(s.reed.detailCalls).toEqual(['1']);
    expect(await count('jobs', "source = 'reed'")).toBe(1);
    expect(await count('jobs', "source = 'adzuna'")).toBe(1);
    expect(await count('job_groups')).toBe(2);

    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({
      status: 'completed',
      phase: 'done',
      pendingIngest: 0,
      pendingScore: 0,
    });
    expect(run?.countsJson).toMatchObject({ fetched: 2, new: 2, prefiltered: 2, llmScored: 2 });
  });

  it('keeps an Adzuna hit’s record from the search, and makes no extra request for it', async () => {
    const s = await setup({ reed: [], adzuna: [adzunaHit(901)] });
    await runAll(s);

    const job = await repos.jobs.getBySource('adzuna', '901');
    expect(job).toMatchObject({
      stage: 'processed',
      title: 'Agile Coach',
      employmentType: 'contract',
      payPeriod: 'day',
      payMin: 600,
    });
    expect(JSON.parse(job?.rawJson as string)).toMatchObject({
      title: 'Agile Coach',
      redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/901',
    });
    expect(job?.url).toBe('https://www.adzuna.co.uk/jobs/land/ad/901');
    // One search call, nothing else.
    expect(await count('source_calls', "source = 'adzuna'")).toBe(1);
    expect(await count('source_calls', "source = 'reed'")).toBe(1);
  });

  it('is not slowed down by the Reed budget: all inline adverts are processed even when Reed is capped', async () => {
    const hits = [1, 2, 3, 4, 5].map((i) =>
      adzunaHit(950 + i, {
        title: `Role ${i}`,
        description: `Totally different advert number ${i}. ${'x'.repeat(i)} Outside IR35.`,
        company: { display_name: `Co ${i}` },
      }),
    );
    const s = await setup({
      reed: [],
      adzuna: hits,
      settings: { budgets: { reedCallsPerRunCap: 1 } },
    });
    const runId = await runAll(s);
    const run = await repos.runs.getById(runId);
    expect(run?.countsJson).toMatchObject({ fetched: 5, new: 5 });
    expect(run?.countsJson).not.toHaveProperty('deferred');
    expect(await count('jobs', "source = 'adzuna' AND stage = 'processed'")).toBe(5);
  });

  it('treats the same role on Reed and Adzuna as one job, represented by the fuller Reed advert', async () => {
    const s = await setup({
      reed: [reedJob(7, { employerName: 'Acme Recruitment', jobDescription: LONG })],
      adzuna: [
        adzunaHit(907, {
          description:
            'Lead the agile transformation for a large UK bank, coaching SAFe release trains...',
        }),
      ],
    });
    const runId = await runAll(s);

    expect(await count('jobs')).toBe(2);
    expect(await count('job_groups')).toBe(1);
    const [group] = await repos.groups.listByStatus(['new', 'prefiltered']);
    const canonical = await repos.jobs.getById(group?.canonicalJobId as string);
    expect(canonical?.source).toBe('reed');
    expect((await repos.runs.getById(runId))?.countsJson).toMatchObject({ dupes: 1 });
  });

  it('does not merge different roles or different cities just because they share a source', async () => {
    const s = await setup({
      reed: [reedJob(8, { jobDescription: LONG })],
      adzuna: [
        adzunaHit(908, { title: 'Data Engineer', description: 'Build Spark pipelines.' }),
        adzunaHit(909, { location: { display_name: 'Leeds' } }),
      ],
    });
    await runAll(s);
    expect(await count('job_groups')).toBe(3);
  });

  it('stops searching Adzuna when its own budget is spent, without touching Reed or failing the run', async () => {
    const s = await setup({
      reed: [reedJob(10, { jobDescription: uniqueText(10) })],
      adzuna: [adzunaHit(910)],
      settings: { budgets: { adzunaDailyRequestBudget: 0 } },
    });
    const runId = await runAll(s);

    expect(s.adzuna.searches).toHaveLength(0);
    expect(s.reed.searches).toHaveLength(1);
    const run = await repos.runs.getById(runId);
    expect(run).toMatchObject({ status: 'completed', pendingIngest: 0 });
    expect(await count('jobs', "source = 'reed'")).toBe(1);
    const errors = await repos.runs.listErrors(runId, 5);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('adzuna budget exhausted');
  });

  it('a failing Adzuna search is recorded as an error and never stops Reed’s jobs', async () => {
    const s = await setup({
      reed: [reedJob(11, { jobDescription: uniqueText(11) })],
      adzuna: [adzunaHit(911)],
    });
    const { AppError } = await import('../../src/lib/errors.js');
    s.adzuna.searchError = () =>
      new AppError('UPSTREAM_ERROR', 'Adzuna rejected the app id or key (HTTP 401)', {
        retryable: false,
      });
    const runId = await runAll(s);

    expect(await count('jobs', "source = 'reed'")).toBe(1);
    expect((await repos.runs.getById(runId))?.status).toBe('completed');
    expect((await repos.runs.listErrors(runId, 5))[0]?.message).toContain('401');
  });
});

describe('source switches', () => {
  it('a message for a source that is not switched on is recorded as an error, not retried for ever', async () => {
    const s = await setup({ reed: [reedJob(20, { jobDescription: uniqueText(20) })], adzuna: [] });
    const { runId } = (await startRun(s.deps, { trigger: 'manual' })) as { runId: string };
    const reedMsg = s.bus.queue.find((q) => q.msg.type === 'fetch' && q.msg.source === 'reed')?.msg;
    s.bus.queue = [];
    const sent = { ...(reedMsg as object), source: 'jobsworth' };
    const result = await handleMessage(s.deps, sent, 4);

    expect(result).toEqual({ outcome: 'ack' });
    expect((await repos.runs.listErrors(runId, 5))[0]?.message).toContain(
      'jobsworth job source is not switched on',
    );
  });

  it('a fetch message queued before sources existed is treated as Reed’s', () => {
    const legacy = {
      v: 1,
      type: 'fetch',
      runId: 'r',
      profileIds: ['p'],
      queryKey: 'k',
      query: {
        keywords: 'k',
        location: null,
        radiusMiles: 25,
        employmentTypes: [],
        minSalary: null,
      },
      page: 0,
    };
    expect(FetchMessageSchema.parse(legacy).source).toBe('reed');
  });

  it('without Adzuna keys, only Reed is switched on', async () => {
    const deps = createContainer(env, { access: null });
    expect(Object.keys(deps.sources)).toEqual(['reed']);
  });
});
