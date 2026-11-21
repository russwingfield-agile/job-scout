import { env } from 'cloudflare:workers';
import type { CoverNote, GroupListResponse, Suggestion } from '@job-scout/shared';
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
  'cover_notes',
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
const CV_TEXT =
  'Jane Doe. Enterprise Agile Coach leading SAFe transformation programmes across banking.';
const NOW = new Date('2026-11-20T09:00:00.000Z');

const titles = [
  'Agile Coach',
  'Scrum Master',
  'Delivery Lead',
  'Programme Manager',
  'Product Owner',
  'Release Train Engineer',
];
const unique = (id: number, title: string) =>
  reedJob(id, {
    jobTitle: title,
    jobDescription: `<p>${title} role. Outside IR35. 6 month contract. ${Array.from({ length: 12 }, (_, i) => `w${id}x${i}`).join(' ')}</p>`,
  });

async function setup(
  jobs = titles.slice(0, 3).map((t, i) => unique(i + 1, t)),
  llmReply = assessmentJson(),
) {
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  const clock = { now: () => NOW };
  const now = NOW.toISOString();
  await repos.settings.put('thresholds', { prefilterMin: 0 }, now);
  const pages = { 'Agile Coach': [jobs.map(refFor)] };
  const details: Record<string, ReturnType<typeof reedJob>> = Object.fromEntries(
    jobs.map((j) => [String(j.jobId), j]),
  );
  const source = new FakeSource({ pages, details });
  source.recorder = createSourceCallRecorder({ repos, clock });
  const embedder = new FakeEmbedder();
  const vectors = new FakeVectorStore();
  const bus = new FakeBus();
  const llm = FakeLlm.always(llmReply);
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
      minDayRate: 550,
      minSalary: null,
      ir35Preference: 'any',
      workModes: [],
      maxOnsiteDays: null,
      active: true,
    },
    now,
  );
  const addLater = (job: ReturnType<typeof reedJob>) => {
    pages['Agile Coach'][0]?.push(refFor(job));
    details[String(job.jobId)] = job;
  };
  await startRun(deps, { trigger: 'manual' });
  await bus.drain(deps);
  return { deps, bus, llm, addLater };
}

type S = Awaited<ReturnType<typeof setup>>;
const call = (s: S, path: string, init?: RequestInit) =>
  createApp(() => s.deps).fetch(new Request(`http://localhost/api${path}`, init), devEnv);
const post = (s: S, path: string, body: unknown = {}) =>
  call(s, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const patch = (s: S, id: string, body: unknown) =>
  call(s, `/groups/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const inbox = async (s: S) =>
  ((await (await call(s, '/groups')).json()) as GroupListResponse).items;

describe('POST /api/groups/:id/cover-note', () => {
  const NOTE =
    'Dear Sam, I led a SAFe rollout across a bank. I would welcome a call this week. Jane Doe';

  it('writes from the best CV, stores the draft, and keeps earlier drafts', async () => {
    const s = await setup();
    s.llm.enqueue(NOTE, 'A second, different draft. Jane Doe');
    const [job] = await inbox(s);

    const res = await post(s, `/groups/${job?.id}/cover-note`, {
      tone: 'warm',
      kind: 'cover_note',
    });
    expect(res.status).toBe(201);
    const note = (await res.json()) as CoverNote;
    expect(note).toMatchObject({
      groupId: job?.id,
      cvId: 'cv1',
      kind: 'cover_note',
      tone: 'warm',
      text: NOTE,
    });

    const request = s.llm.requests.at(-1);
    expect(request?.system).toContain('at most 200 words');
    expect(request?.system).toContain('Friendly and personable');
    expect(request?.user).toContain('Jane Doe');
    expect(request?.jsonSchema).toBeUndefined(); // plain text, not JSON

    await post(s, `/groups/${job?.id}/cover-note`, {});
    const history = (await (await call(s, `/groups/${job?.id}/cover-notes`)).json()) as CoverNote[];
    expect(history).toHaveLength(2);
    expect(history[0]?.text).toBe('A second, different draft. Jane Doe');
    expect(history[1]?.text).toBe(NOTE);
  });

  it('uses the short limit for a recruiter message and trims an over-long answer', async () => {
    const s = await setup();
    const long = `${'Word '.repeat(150).trim()}. ${'More '.repeat(50).trim()}.`;
    s.llm.enqueue(long);
    const [job] = await inbox(s);
    const res = await post(s, `/groups/${job?.id}/cover-note`, { kind: 'recruiter_message' });
    const note = (await res.json()) as CoverNote;
    expect(s.llm.requests.at(-1)?.system).toContain('at most 90 words');
    expect(note.text.split(/\s+/).length).toBeLessThanOrEqual(90);
  });

  it('answers 404 for an unknown job, 400 with no CV, and 429 when the AI allowance is spent', async () => {
    const s = await setup();
    const [job] = await inbox(s);
    expect((await post(s, '/groups/nope/cover-note')).status).toBe(404);

    await repos.usage.increment('2026-11-20', 'neuronsEst', 10_000);
    expect((await post(s, `/groups/${job?.id}/cover-note`)).status).toBe(429);

    await env.DB.prepare('UPDATE cvs SET active = 0').run();
    await env.DB.prepare('UPDATE job_groups SET best_cv_id = NULL').run();
    expect((await post(s, `/groups/${job?.id}/cover-note`)).status).toBe(400);
    expect(await repos.coverNotes.listByGroup(job?.id as string)).toEqual([]);
  });

  it('rejects an unknown tone', async () => {
    const s = await setup();
    const [job] = await inbox(s);
    expect((await post(s, `/groups/${job?.id}/cover-note`, { tone: 'shouty' })).status).toBe(400);
  });
});

describe('feedback learning', () => {
  it('after you skip an agency’s jobs as spam, its next job is marked down with the reason', async () => {
    const s = await setup();
    for (const job of await inbox(s)) {
      await patch(s, job.id, { status: 'skipped', skipReason: 'agency_spam' });
    }

    s.addLater(unique(10, 'Release Train Engineer'));
    await startRun(s.deps, { trigger: 'manual' });
    await s.bus.drain(s.deps);

    const [fresh] = await inbox(s);
    expect(fresh?.job.title).toBe('Release Train Engineer');
    expect(fresh?.feedbackAdj).toBe(-10);
    expect(fresh?.feedbackReasons[0]).toMatch(/−10: you have skipped 3 jobs from this employer/);
    // The adjustment is part of the first-pass and final scores.
    const group = await repos.groups.getById(fresh?.id as string);
    expect(group?.feedbackAdj).toBe(-10);
    expect(fresh?.finalScore).not.toBeNull();
  });

  it('a job similar to one you applied for is nudged up', async () => {
    const s = await setup();
    const [first] = await inbox(s);
    await patch(s, first?.id as string, { status: 'applied', cvIdSent: 'cv1' });

    // Same role again from the same employer: applied-before (+5) and very similar (+5).
    s.addLater(
      reedJob(20, {
        jobTitle: first?.job.title,
        jobDescription: `<p>${first?.job.title} role. Outside IR35. 6 month contract.</p>`,
      }),
    );
    await startRun(s.deps, { trigger: 'manual' });
    await s.bus.drain(s.deps);

    const items = await inbox(s);
    const boosted = items.find((i) => i.feedbackAdj > 0);
    expect(boosted?.feedbackAdj).toBeGreaterThanOrEqual(5);
    expect(boosted?.feedbackReasons.join(' ')).toContain('applied to this employer before');
  });

  it('does nothing when you have not acted on anything', async () => {
    const s = await setup();
    for (const item of await inbox(s)) {
      expect(item).toMatchObject({ feedbackAdj: 0, feedbackReasons: [] });
    }
  });
});

describe('suggestions', () => {
  async function skipFive(s: S, extra: Record<string, unknown> = {}) {
    const jobs = [4, 5, 6, 7, 8].map((i) => unique(i + 30, titles[i % titles.length] as string));
    for (const j of jobs) s.addLater({ ...j, ...extra });
    await startRun(s.deps, { trigger: 'manual' });
    await s.bus.drain(s.deps);
    const items = await inbox(s);
    const targets = items.filter((i) =>
      jobs.some((j) => j.jobTitle === i.job.title && String(j.jobId)),
    );
    return { items, targets };
  }

  it('suggests a higher minimum day rate after repeated low-rate skips, and applies it on request', async () => {
    const s = await setup([]);
    const cheap = { salary: '£560 - £575 per day' };
    const { items } = await skipFive(s, cheap);
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items.slice(0, 5)) {
      await patch(s, item.id, { status: 'skipped', skipReason: 'rate_too_low' });
    }

    const list = (await (await call(s, '/suggestions')).json()) as Suggestion[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: 'min_day_rate',
      profileId: 'p1',
      actionLabel: 'Raise minimum to £600/day',
    });

    const applied = await post(s, '/suggestions/apply', { id: list[0]?.id });
    expect(applied.status).toBe(200);
    expect((await repos.profiles.getById('p1'))?.minDayRate).toBe(600);
    // Nothing else about the profile changed.
    expect((await repos.profiles.getById('p1'))?.locations).toEqual(['London']);
    expect((await (await call(s, '/suggestions')).json()) as Suggestion[]).toEqual([]);
  });

  it('can be dismissed, and stays dismissed', async () => {
    const s = await setup([]);
    const { items } = await skipFive(s);
    for (const item of items.slice(0, 5)) {
      await patch(s, item.id, { status: 'skipped', skipReason: 'inside_ir35' });
    }
    const [suggestion] = (await (await call(s, '/suggestions')).json()) as Suggestion[];
    expect(suggestion).toMatchObject({ kind: 'ir35' });

    expect((await post(s, '/suggestions/dismiss', { id: suggestion?.id })).status).toBe(200);
    expect((await (await call(s, '/suggestions')).json()) as Suggestion[]).toEqual([]);
    // Settings are untouched by the stored dismissal.
    expect((await call(s, '/settings')).status).toBe(200);
  });

  it('refuses to apply a suggestion that no longer applies, and says nothing with too few skips', async () => {
    const s = await setup();
    expect((await (await call(s, '/suggestions')).json()) as Suggestion[]).toEqual([]);
    expect((await post(s, '/suggestions/apply', { id: 'ir35:p1:outside_only' })).status).toBe(404);
  });
});
