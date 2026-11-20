import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1VectorStore } from '../../src/adapters/d1Vectors.js';
import { createContainer } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createApp } from '../../src/http/app.js';
import type { Clock } from '../../src/ports/clock.js';
import { FakeEmbedder } from '../fakes/fakeEmbedder.js';
import { FakeLlm } from '../fakes/fakeLlm.js';
import { FakeBlobStore, FakeDocParser } from '../fakes/fakeStorage.js';

const repos = createRepos(createDb(env.DB));
const clock: Clock = { now: () => new Date('2026-11-20T09:00:00.000Z') };
const store = new D1VectorStore(repos.vectors, clock);

/** Unit-ish vectors along chosen axes, so expected rankings are obvious. */
const axis = (i: number, weight = 1) => {
  const v = new Array<number>(8).fill(0);
  v[i] = weight;
  return v;
};
const near = (i: number, j: number) => axis(i).map((x, k) => x + (k === j ? 0.3 : 0));

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM vectors').run();
  await env.DB.prepare('DELETE FROM cvs').run();
  await env.DB.prepare('DELETE FROM search_profiles').run();
});

describe('D1VectorStore', () => {
  it('ranks by cosine similarity and respects topK', async () => {
    await store.upsert([
      { id: 'job:a', values: axis(0), metadata: { kind: 'job', postedTs: 100, groupId: 'g-a' } },
      { id: 'job:b', values: near(0, 1), metadata: { kind: 'job', postedTs: 200 } },
      { id: 'job:c', values: axis(5), metadata: { kind: 'job', postedTs: 300 } },
    ]);

    const top2 = await store.query(axis(0), { topK: 2 });
    expect(top2.map((m) => m.id)).toEqual(['job:a', 'job:b']);
    expect(top2[0]?.score).toBeCloseTo(1, 5);
    expect(top2[0]?.score).toBeGreaterThan(top2[1]?.score as number);
    expect(top2[0]?.metadata).toEqual({ kind: 'job', postedTs: 100, groupId: 'g-a' });
    expect(top2[1]?.metadata).toEqual({ kind: 'job', postedTs: 200 });

    expect((await store.query(axis(5), { topK: 1 }))[0]?.id).toBe('job:c');
    expect(await store.query(axis(0), { topK: 10 })).toHaveLength(3);
  });

  it('filters by kind and by posting time before ranking', async () => {
    await store.upsert([
      { id: 'cv:1', values: axis(0), metadata: { kind: 'cv' } },
      { id: 'job:old', values: axis(0), metadata: { kind: 'job', postedTs: 1_000 } },
      { id: 'job:new', values: near(0, 2), metadata: { kind: 'job', postedTs: 9_000 } },
    ]);

    expect(
      (await store.query(axis(0), { topK: 5, filter: { kind: 'cv' } })).map((m) => m.id),
    ).toEqual(['cv:1']);
    expect(
      (await store.query(axis(0), { topK: 5, filter: { kind: 'job' } })).map((m) => m.id),
    ).toEqual(['job:old', 'job:new']);
    expect(
      (await store.query(axis(0), { topK: 5, filter: { kind: 'job', postedTsGte: 5_000 } })).map(
        (m) => m.id,
      ),
    ).toEqual(['job:new']);
    expect((await store.query(axis(0), { topK: 5, filter: {} })).map((m) => m.id).sort()).toEqual([
      'cv:1',
      'job:new',
      'job:old',
    ]);
    expect(
      await store.query(axis(0), { topK: 5, filter: { kind: 'job', postedTsGte: 99_999 } }),
    ).toEqual([]);
  });

  it('overwrites a vector with the same id', async () => {
    await store.upsert([{ id: 'cv:1', values: axis(0), metadata: { kind: 'cv' } }]);
    await store.upsert([{ id: 'cv:1', values: axis(3), metadata: { kind: 'cv' } }]);

    const [only] = await store.getByIds(['cv:1']);
    expect(only?.values[3]).toBeCloseTo(1, 6);
    expect(only?.values[0]).toBe(0);
    expect(await store.query(axis(3), { topK: 5 })).toHaveLength(1);
  });

  it('gets and deletes by id, ignoring ids that do not exist', async () => {
    await store.upsert([
      { id: 'cv:1', values: axis(0), metadata: { kind: 'cv' } },
      { id: 'cv:2', values: axis(1), metadata: { kind: 'cv' } },
    ]);
    expect((await store.getByIds(['cv:1', 'cv:2', 'cv:missing'])).map((v) => v.id).sort()).toEqual([
      'cv:1',
      'cv:2',
    ]);

    await store.deleteByIds(['cv:1', 'cv:missing']);
    expect((await store.getByIds(['cv:1', 'cv:2'])).map((v) => v.id)).toEqual(['cv:2']);
    expect(await store.getByIds([])).toEqual([]);
    await store.deleteByIds([]);
  });

  it('handles more rows and ids than one SQL statement allows', async () => {
    const items = Array.from({ length: 57 }, (_, i) => ({
      id: `job:${i}`,
      values: axis(i % 8),
      metadata: { kind: 'job' as const, postedTs: i },
    }));
    await store.upsert(items);

    expect(await store.query(axis(0), { topK: 100 })).toHaveLength(57);
    expect(await store.getByIds(items.map((i) => i.id))).toHaveLength(57);
    await store.deleteByIds(items.map((i) => i.id));
    expect(await store.query(axis(0), { topK: 100 })).toHaveLength(0);
  });

  it('keeps 768-dimension vectors intact', async () => {
    const embedder = new FakeEmbedder();
    const [a, b] = await embedder.embed(['agile coach safe transformation', 'quantum physicist']);
    await store.upsert([
      { id: 'cv:a', values: a as number[], metadata: { kind: 'cv' } },
      { id: 'cv:b', values: b as number[], metadata: { kind: 'cv' } },
    ]);
    const [match] = await store.query(a as number[], { topK: 1 });
    expect(match?.id).toBe('cv:a');
    expect(match?.score).toBeCloseTo(1, 5);
  });
});

describe('CV upload using the built-in D1 vector store', () => {
  it('stores the CV fingerprint in D1 when Vectorize is not configured', async () => {
    const SUMMARY = {
      headline: 'Agile Coach',
      seniority: 'senior',
      yearsExperience: 10,
      skills: ['SAFe'],
      sectors: ['Banking'],
      suggestedTitles: ['Agile Coach'],
      suggestedKeywords: ['SAFe'],
    };
    // No `vectors` override: the default container must fall back to D1.
    const app = createApp((e) =>
      createContainer(e, {
        clock,
        access: null,
        blobs: new FakeBlobStore(),
        docs: new FakeDocParser(
          '# Jane Doe\nAgile Coach with ten years of SAFe experience in banking and retail.',
        ),
        embedder: new FakeEmbedder(),
        llm: FakeLlm.always(JSON.stringify(SUMMARY)),
      }),
    );
    const devEnv = { DB: env.DB, ENV: 'dev', DEV_BYPASS_AUTH: 'true' } as unknown as Env;

    const form = new FormData();
    form.set(
      'file',
      new File([new TextEncoder().encode('%PDF-1.7 x')], 'cv.pdf', { type: 'application/pdf' }),
    );
    const res = await app.fetch(
      new Request('http://localhost/api/cvs', { method: 'POST', body: form }),
      devEnv,
    );
    expect(res.status).toBe(201);
    const { cv, warnings } = (await res.json()) as { cv: { id: string }; warnings: string[] };
    expect(warnings).toEqual([]);

    const [stored] = await repos.vectors.getByIds([`cv:${cv.id}`]);
    expect(stored?.kind).toBe('cv');

    // Deleting the CV removes its fingerprint too.
    const del = await app.fetch(
      new Request(`http://localhost/api/cvs/${cv.id}`, { method: 'DELETE' }),
      devEnv,
    );
    expect(del.status).toBe(204);
    expect(await repos.vectors.getByIds([`cv:${cv.id}`])).toEqual([]);
  });
});
