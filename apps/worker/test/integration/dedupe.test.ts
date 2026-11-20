import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createSourceCallRecorder } from '../../src/adapters/sourceCallRecorder.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { handleMessage } from '../../src/pipeline/consume.js';
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
const CV_TEXT = 'Enterprise Agile Coach leading SAFe transformation programmes across banking.';
const LONG = `<p>${'Lead the agile transformation for a large UK bank, coaching SAFe release trains and teams. '.repeat(6)}</p>`;

type Posting = ReturnType<typeof reedJob>;
const posting = (id: number, over: Record<string, unknown> = {}): Posting =>
  reedJob(id, { employerName: `Agency ${id}`, jobDescription: LONG, ...over });

async function setup(initial: Posting[]) {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  const clock = { now: () => new Date('2026-11-20T07:00:00.000Z') };
  const now = clock.now().toISOString();
  await repos.settings.put('thresholds', { prefilterMin: 0 }, now);

  const pages: { 'Agile Coach': ReturnType<typeof refFor>[][] } = {
    'Agile Coach': [initial.map(refFor)],
  };
  const details: Record<string, Posting> = Object.fromEntries(
    initial.map((j) => [String(j.jobId), j]),
  );
  const source = new FakeSource({ pages, details });
  source.recorder = createSourceCallRecorder({ repos, clock });
  const embedder = new FakeEmbedder();
  const vectors = new FakeVectorStore();
  const bus = new FakeBus();
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
  const addLater = (job: Posting) => {
    pages['Agile Coach'][0]?.push(refFor(job));
    details[String(job.jobId)] = job;
  };
  return { clock, deps, bus, llm, details, addLater };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function runAll(s: Setup) {
  const started = await startRun(s.deps, { trigger: 'manual' });
  await s.bus.drain(s.deps);
  return (started as { runId: string }).runId;
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('de-duplication', () => {
  it('puts the same role from three agencies in one group, represented by the fullest posting', async () => {
    const s = await setup([
      posting(41, { salary: '' }),
      posting(42),
      posting(43, { jobDescription: `${LONG}<p>Start date flexible.</p>` }),
    ]);
    const runId = await runAll(s);

    expect(await count('jobs')).toBe(3);
    expect(await count('job_groups')).toBe(1);
    const [group] = await repos.groups.listByStatus(['new', 'prefiltered']);
    expect(await repos.jobs.listByGroup(group?.id as string)).toHaveLength(3);
    // 42 and 43 both state pay; 43 has the longer description.
    const canonical = await repos.jobs.getById(group?.canonicalJobId as string);
    expect(canonical?.sourceJobId).toBe('43');
    const run = await repos.runs.getById(runId);
    expect(run?.countsJson).toMatchObject({ prefiltered: 1, dupes: 2, llmScored: 1 });
    expect(s.llm.requests).toHaveLength(1); // assessed once for the whole group
  });

  it('keeps different roles apart', async () => {
    const s = await setup([
      posting(51),
      posting(52, {
        jobTitle: 'Data Engineer',
        jobDescription: '<p>Build Spark pipelines on AWS for a retailer.</p>',
      }),
    ]);
    await runAll(s);
    expect(await count('job_groups')).toBe(2);
  });

  it('a later posting joins an already-assessed group without a new assessment or a new card', async () => {
    const s = await setup([posting(61)]);
    await runAll(s);
    const [group] = await repos.groups.listByStatus(['new']);
    const before = await repos.assessments.getByGroup(group?.id as string);

    s.addLater(posting(62));
    await runAll(s);

    expect(await count('job_groups')).toBe(1);
    expect(await repos.jobs.listByGroup(group?.id as string)).toHaveLength(2);
    expect((await repos.groups.getById(group?.id as string))?.status).toBe('new');
    expect(await repos.assessments.getByGroup(group?.id as string)).toEqual(before);
    expect(s.llm.requests).toHaveLength(1);
  });

  it('counts a new posting for a job you have already acted on, without changing its state', async () => {
    const s = await setup([posting(71)]);
    await runAll(s);
    const [group] = await repos.groups.listByStatus(['new']);
    await repos.groups.setStatus(group?.id as string, 'applied');

    s.addLater(posting(72));
    await runAll(s);

    expect(await repos.groups.getById(group?.id as string)).toMatchObject({
      status: 'applied',
      newPostingsSinceAction: 1,
    });
    expect(await count('job_groups')).toBe(1);
  });

  it('folds a newer group into an older one when two postings were processed at the same time', async () => {
    const s = await setup([posting(81)]);
    await runAll(s);
    const [older] = await repos.groups.listByStatus(['new']);

    // Simulate the race: the second posting already started a group of its own.
    s.addLater(posting(82));
    const now = s.clock.now().toISOString();
    await repos.groups.insert({
      id: 'newer',
      canonicalJobId: 'job82',
      status: 'prefiltered',
      firstSeenAt: '2026-11-21T00:00:00.000Z',
      lastSeenAt: now,
    });
    await repos.jobs.insertRefsIfNew([
      { id: 'job82', source: 'reed', sourceJobId: '82', groupId: 'newer', createdAt: now },
    ]);
    await repos.jobs.addProfileHits(['job82'], ['p1'], 'race', true);
    await repos.runs.insertIfNew({
      id: 'race',
      slotKey: 'manual:race',
      trigger: 'manual',
      status: 'running',
      phase: 'ingest',
      startedAt: now,
    });
    const result = await handleMessage(
      s.deps,
      { v: 1, type: 'process', runId: 'race', jobId: 'job82' },
      1,
    );

    expect(result).toEqual({ outcome: 'ack' });
    expect(await repos.groups.getById('newer')).toBeUndefined();
    expect(await repos.groups.getById(older?.id as string)).toBeDefined();
    expect((await repos.jobs.getById('job82'))?.groupId).toBe(older?.id);
    expect(await count('job_groups')).toBe(1);
  });
});
