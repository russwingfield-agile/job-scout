import { describe, expect, it } from 'vitest';
import { R2Blobs } from '../../src/adapters/r2.js';
import { unavailable } from '../../src/adapters/unavailable.js';
import { type VectorizeLike, VectorizeStore } from '../../src/adapters/vectorize.js';
import { type AiLike, toAiError } from '../../src/adapters/workersai/binding.js';
import { WorkersAiEmbedder } from '../../src/adapters/workersai/embed.js';
import { WorkersAiLlm } from '../../src/adapters/workersai/llm.js';
import { WorkersAiDocParser } from '../../src/adapters/workersai/toMarkdown.js';
import { AppError } from '../../src/lib/errors.js';
import type { BlobStore } from '../../src/ports/blob.js';

/** A genuine ArrayBuffer (TextEncoder's own .buffer is typed as possibly shared). */
const arrayBuffer = (s: string): ArrayBuffer => new TextEncoder().encode(s).slice().buffer;

type Run = (model: string, input: Record<string, unknown>) => Promise<unknown>;

const fakeAi = (run: Run, toMarkdown: AiLike['toMarkdown'] = async () => []): AiLike => ({
  run,
  toMarkdown,
});
const fail =
  (err: unknown): Run =>
  async () => {
    throw err;
  };

describe('toAiError', () => {
  it('maps the daily neuron cap (error 3036) to a non-retryable BUDGET_EXHAUSTED', () => {
    for (const message of [
      '3036: you have used up your daily free allocation of 10,000 neurons',
      '3036',
    ]) {
      expect(toAiError(new Error(message), 'x')).toMatchObject({
        code: 'BUDGET_EXHAUSTED',
        retryable: false,
      });
    }
  });

  it('treats other failures as retryable upstream errors, and keeps AppErrors as they are', () => {
    expect(toAiError(new Error('boom'), 'LLM call')).toMatchObject({
      code: 'UPSTREAM_ERROR',
      retryable: true,
      message: expect.stringContaining('LLM call failed: boom'),
    });
    expect(toAiError('plain string', 'x').message).toContain('plain string');
    const own = new AppError('VALIDATION', 'mine');
    expect(toAiError(own, 'x')).toBe(own);
  });
});

describe('WorkersAiLlm', () => {
  const req = { model: '@cf/m', system: 'sys', user: 'usr', maxTokens: 100 };

  it('sends chat messages, limits and the JSON schema; reads text and usage', async () => {
    let sent: { model: string; input: Record<string, unknown> } | undefined;
    const llm = new WorkersAiLlm(
      fakeAi(async (model, input) => {
        sent = { model, input };
        return { response: '{"a":1}', usage: { prompt_tokens: 10, completion_tokens: 5 } };
      }),
    );
    const out = await llm.complete({ ...req, temperature: 0.2, jsonSchema: { type: 'object' } });
    expect(out).toEqual({ text: '{"a":1}', usage: { in: 10, out: 5 } });
    expect(sent).toEqual({
      model: '@cf/m',
      input: {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'usr' },
        ],
        max_tokens: 100,
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: { type: 'object' } },
      },
    });
  });

  it('omits optional parameters when not given', async () => {
    let input: Record<string, unknown> = {};
    const llm = new WorkersAiLlm(
      fakeAi(async (_m, i) => {
        input = i;
        return { response: 'hi' };
      }),
    );
    expect(await llm.complete(req)).toEqual({ text: 'hi' });
    expect(input).not.toHaveProperty('temperature');
    expect(input).not.toHaveProperty('response_format');
  });

  it('stringifies a pre-parsed JSON response and reads the OpenAI chat shape', async () => {
    const parsed = new WorkersAiLlm(fakeAi(async () => ({ response: { a: 1 } })));
    expect((await parsed.complete(req)).text).toBe('{"a":1}');
    const chat = new WorkersAiLlm(
      fakeAi(async () => ({ choices: [{ message: { content: 'from chat' } }] })),
    );
    expect((await chat.complete(req)).text).toBe('from chat');
  });

  it('ignores partial usage figures', async () => {
    const llm = new WorkersAiLlm(
      fakeAi(async () => ({ response: 'x', usage: { prompt_tokens: 10 } })),
    );
    expect(await llm.complete(req)).toEqual({ text: 'x' });
  });

  it('rejects empty and malformed responses', async () => {
    for (const reply of [{ response: '' }, {}, { choices: [] }]) {
      const err = await new WorkersAiLlm(fakeAi(async () => reply)).complete(req).catch((e) => e);
      expect(err).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: true });
    }
    const bad = await new WorkersAiLlm(fakeAi(async () => 'a string'))
      .complete(req)
      .catch((e) => e);
    expect(bad).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: false });
  });

  it('wraps thrown errors', async () => {
    const err = await new WorkersAiLlm(fakeAi(fail(new Error('3036 cap'))))
      .complete(req)
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'BUDGET_EXHAUSTED' });
  });
});

describe('WorkersAiEmbedder', () => {
  const unit = (n: number, dims: number) =>
    Array.from({ length: dims }, (_, i) => (i === n ? 1 : 0));

  it('embeds texts and returns vectors in order', async () => {
    let input: Record<string, unknown> = {};
    const embedder = new WorkersAiEmbedder(
      fakeAi(async (_m, i) => {
        input = i;
        return { shape: [2, 4], data: [unit(0, 4), unit(1, 4)] };
      }),
      '@cf/embed',
      4,
    );
    expect(await embedder.embed(['a', 'b'])).toEqual([unit(0, 4), unit(1, 4)]);
    expect(input).toEqual({ text: ['a', 'b'] });
    expect([embedder.model, embedder.dims]).toEqual(['@cf/embed', 4]);
  });

  it('splits large inputs into batches of 50', async () => {
    const sizes: number[] = [];
    const embedder = new WorkersAiEmbedder(
      fakeAi(async (_m, i) => {
        const texts = i.text as string[];
        sizes.push(texts.length);
        return { data: texts.map(() => unit(0, 3)) };
      }),
      'm',
      3,
    );
    expect(await embedder.embed(Array.from({ length: 120 }, (_, i) => `t${i}`))).toHaveLength(120);
    expect(sizes).toEqual([50, 50, 20]);
    expect(await embedder.embed([])).toEqual([]);
  });

  it.each([
    ['wrong dimensions', { data: [unit(0, 3)] }],
    ['too few vectors', { data: [] }],
    ['a malformed response', { nope: true }],
  ])('rejects %s', async (_label, reply) => {
    const embedder = new WorkersAiEmbedder(
      fakeAi(async () => reply),
      'm',
      4,
    );
    expect(await embedder.embed(['a']).catch((e) => e)).toMatchObject({
      code: 'UPSTREAM_ERROR',
      retryable: false,
    });
  });

  it('wraps thrown errors as retryable', async () => {
    const embedder = new WorkersAiEmbedder(fakeAi(fail(new Error('timeout'))), 'm', 4);
    expect(await embedder.embed(['a']).catch((e) => e)).toMatchObject({ retryable: true });
  });
});

describe('WorkersAiDocParser', () => {
  const file = {
    name: 'cv.pdf',
    bytes: arrayBuffer('%PDF-'),
    mime: 'application/pdf',
  };

  it('passes the file as a named blob and returns the markdown', async () => {
    let sent: { name: string; blob: Blob }[] = [];
    const parser = new WorkersAiDocParser(
      fakeAi(fail(new Error('unused')), async (files) => {
        sent = files;
        return [
          {
            name: 'cv.pdf',
            mimeType: 'application/pdf',
            format: 'markdown',
            tokens: 3,
            data: '# Jane',
          },
        ];
      }),
    );
    expect(await parser.toMarkdown(file)).toBe('# Jane');
    expect(sent[0]?.name).toBe('cv.pdf');
    expect(sent[0]?.blob.type).toBe('application/pdf');
    expect(sent[0]?.blob.size).toBe(5);
  });

  it('accepts plain-text results and tolerates a missing data field', async () => {
    const text = new WorkersAiDocParser(
      fakeAi(fail(new Error('x')), async () => [{ format: 'text', data: 'plain' }]),
    );
    expect(await text.toMarkdown(file)).toBe('plain');
    const empty = new WorkersAiDocParser(
      fakeAi(fail(new Error('x')), async () => [{ format: 'markdown' }]),
    );
    expect(await empty.toMarkdown(file)).toBe('');
  });

  it('turns a conversion error into a user-facing VALIDATION error', async () => {
    const parser = new WorkersAiDocParser(
      fakeAi(fail(new Error('x')), async () => [{ format: 'error', error: 'file is encrypted' }]),
    );
    const err = await parser.toMarkdown(file).catch((e) => e);
    expect(err).toMatchObject({ code: 'VALIDATION', retryable: false });
    expect(err.message).toContain('file is encrypted');

    const noReason = new WorkersAiDocParser(
      fakeAi(fail(new Error('x')), async () => [{ format: 'error' }]),
    );
    expect((await noReason.toMarkdown(file).catch((e) => e)).message).toBe(
      'Could not read this document',
    );
  });

  it('rejects an empty or malformed response and wraps thrown errors', async () => {
    for (const reply of [[], 'nope', [{ nothing: 1 }]]) {
      const parser = new WorkersAiDocParser(fakeAi(fail(new Error('x')), async () => reply));
      expect(await parser.toMarkdown(file).catch((e) => e)).toMatchObject({
        code: 'UPSTREAM_ERROR',
      });
    }
    const throws = new WorkersAiDocParser(
      fakeAi(fail(new Error('x')), async () => {
        throw new Error('binding down');
      }),
    );
    expect(await throws.toMarkdown(file).catch((e) => e)).toMatchObject({ retryable: true });
  });
});

describe('VectorizeStore', () => {
  function fakeIndex() {
    const calls: { method: string; args: unknown[] }[] = [];
    const index: VectorizeLike = {
      async upsert(...args) {
        calls.push({ method: 'upsert', args });
      },
      async query(...args) {
        calls.push({ method: 'query', args });
        return {
          matches: [
            {
              id: 'job:1',
              score: 0.93,
              metadata: { kind: 'job', posted_ts: 1_700_000_000_000, group_id: 'g1' },
            },
            { id: 'cv:1', score: 0.5, metadata: { kind: 'cv' } },
            { id: 'x', score: 0.1, metadata: null },
          ],
        };
      },
      async getByIds(...args) {
        calls.push({ method: 'getByIds', args });
        return [
          { id: 'a', values: new Float32Array([0.5, 0.25]) },
          { id: 'b', values: null },
          { id: 'c' },
        ];
      },
      async deleteByIds(...args) {
        calls.push({ method: 'deleteByIds', args });
      },
    };
    return { index, calls };
  }

  it('maps metadata to the indexed key names on upsert', async () => {
    const { index, calls } = fakeIndex();
    await new VectorizeStore(index).upsert([
      { id: 'job:1', values: [1], metadata: { kind: 'job', postedTs: 5, groupId: 'g' } },
      { id: 'cv:1', values: [2], metadata: { kind: 'cv' } },
    ]);
    expect(calls[0]?.args[0]).toEqual([
      { id: 'job:1', values: [1], metadata: { kind: 'job', posted_ts: 5, group_id: 'g' } },
      { id: 'cv:1', values: [2], metadata: { kind: 'cv' } },
    ]);
  });

  it('builds the Vectorize filter and maps matches back', async () => {
    const { index, calls } = fakeIndex();
    const store = new VectorizeStore(index);
    const matches = await store.query([1, 2], {
      topK: 5,
      filter: { kind: 'job', postedTsGte: 99 },
    });
    expect(calls[0]?.args).toEqual([
      [1, 2],
      { topK: 5, returnMetadata: 'all', filter: { kind: 'job', posted_ts: { $gte: 99 } } },
    ]);
    expect(matches).toEqual([
      {
        id: 'job:1',
        score: 0.93,
        metadata: { kind: 'job', postedTs: 1_700_000_000_000, groupId: 'g1' },
      },
      { id: 'cv:1', score: 0.5, metadata: { kind: 'cv' } },
      { id: 'x', score: 0.1, metadata: { kind: 'job' } },
    ]);
  });

  it('sends no filter when none is given, and supports partial filters', async () => {
    const { index, calls } = fakeIndex();
    const store = new VectorizeStore(index);
    await store.query([1], { topK: 1 });
    await store.query([1], { topK: 1, filter: {} });
    await store.query([1], { topK: 1, filter: { kind: 'cv' } });
    await store.query([1], { topK: 1, filter: { postedTsGte: 7 } });
    expect(calls.map((c) => (c.args[1] as { filter?: unknown }).filter)).toEqual([
      undefined,
      {},
      { kind: 'cv' },
      { posted_ts: { $gte: 7 } },
    ]);
  });

  it('returns plain number arrays and skips vectors without values', async () => {
    const { index } = fakeIndex();
    expect(await new VectorizeStore(index).getByIds(['a', 'b', 'c'])).toEqual([
      { id: 'a', values: [0.5, 0.25] },
    ]);
  });

  it('deletes by id', async () => {
    const { index, calls } = fakeIndex();
    await new VectorizeStore(index).deleteByIds(['a', 'b']);
    expect(calls[0]).toEqual({ method: 'deleteByIds', args: [['a', 'b']] });
  });
});

describe('R2Blobs', () => {
  function fakeBucket() {
    const store = new Map<string, { bytes: ArrayBuffer; type: string | undefined }>();
    return {
      store,
      bucket: {
        async put(
          key: string,
          value: ArrayBuffer,
          options?: { httpMetadata?: { contentType?: string } },
        ) {
          store.set(key, { bytes: value, type: options?.httpMetadata?.contentType });
        },
        async get(key: string) {
          const found = store.get(key);
          return found ? { arrayBuffer: async () => found.bytes } : null;
        },
        async delete(key: string) {
          store.delete(key);
        },
      },
    };
  }

  it('stores with a content type, reads back, and returns null for a missing key', async () => {
    const { bucket, store } = fakeBucket();
    const blobs: BlobStore = new R2Blobs(bucket);
    const data = arrayBuffer('hello');
    await blobs.put('cvs/1/a.pdf', data, 'application/pdf');
    expect(store.get('cvs/1/a.pdf')?.type).toBe('application/pdf');
    expect(await blobs.get('cvs/1/a.pdf')).toBe(data);
    expect(await blobs.get('nope')).toBeNull();
    await blobs.delete('cvs/1/a.pdf');
    expect(await blobs.get('cvs/1/a.pdf')).toBeNull();
  });
});

describe('unavailable', () => {
  it('rejects every method with NOT_CONFIGURED naming what is missing', async () => {
    const blobs = unavailable<BlobStore>('CV storage (R2)');
    const err = await blobs.get('k').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'NOT_CONFIGURED', status: 503, retryable: false });
    expect(err.message).toContain('CV storage (R2)');
    await expect(blobs.put('k', new ArrayBuffer(0), 'x')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('is not mistaken for a thenable when awaited', async () => {
    const stub = unavailable<BlobStore>('x');
    expect(await Promise.resolve(stub)).toBe(stub);
  });
});
