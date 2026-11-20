import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ReedClient } from '../../../src/adapters/reed/client.js';
import { AppError } from '../../../src/lib/errors.js';
import type { SourceCall } from '../../../src/ports/sourceCalls.js';

const schema = z.object({ ok: z.boolean() });

type Call = { url: string; init: RequestInit };

function setup(
  response: () => Response | Promise<Response>,
  opts: { recorderThrows?: boolean } = {},
) {
  const requests: Call[] = [];
  const recorded: SourceCall[] = [];
  const warnings: unknown[] = [];
  const clockValues = [1_000, 1_042];
  const client = new ReedClient({
    apiKey: 'test-key',
    fetch: async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return response();
    },
    recorder: {
      async record(call) {
        if (opts.recorderThrows) throw new Error('db down');
        recorded.push(call);
      },
    },
    log: { info() {}, warn: (f) => warnings.push(f), error() {} },
    now: () => clockValues.shift() ?? 0,
  });
  return { client, requests, recorded, warnings };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the request to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReedClient.get — success', () => {
  it('sends Basic auth (key as username, empty password) and encodes params', async () => {
    const { client, requests } = setup(() => json({ ok: true }));
    const result = await client.get(
      'search',
      { keywords: 'agile coach', resultsToTake: 100, contract: true, skipped: undefined },
      schema,
    );
    expect(result).toEqual({ ok: true });

    const [req] = requests;
    expect(req?.url).toBe(
      'https://www.reed.co.uk/api/1.0/search?keywords=agile+coach&resultsToTake=100&contract=true',
    );
    const headers = req?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa('test-key:')}`);
    expect(req?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits the query string when there are no params', async () => {
    const { client, requests } = setup(() => json({ ok: true }));
    await client.get('jobs/123', {}, schema);
    expect(requests[0]?.url).toBe('https://www.reed.co.uk/api/1.0/jobs/123');
  });

  it('records the call with status, duration and run id', async () => {
    const { client, recorded } = setup(() => json({ ok: true }));
    await client.get('search', {}, schema, { runId: 'run-1' });
    expect(recorded).toEqual([
      { runId: 'run-1', source: 'reed', endpoint: 'search', status: 200, ms: 42 },
    ]);
  });

  it('works without a recorder or logger and with the global fetch and clock', async () => {
    vi.stubGlobal('fetch', async () => json({ ok: true }));
    const client = new ReedClient({ apiKey: 'k' });
    expect(await client.get('search', {}, schema)).toEqual({ ok: true });
  });
});

describe('ReedClient.get — failures', () => {
  it.each([
    [401, 'UPSTREAM_ERROR', false],
    [403, 'UPSTREAM_ERROR', false],
    [429, 'UPSTREAM_RATE_LIMIT', true],
    [500, 'UPSTREAM_ERROR', true],
    [503, 'UPSTREAM_ERROR', true],
    [400, 'UPSTREAM_ERROR', false],
    [404, 'UPSTREAM_ERROR', false],
  ])('HTTP %s → %s, retryable=%s, still recorded', async (status, code, retryable) => {
    const { client, recorded } = setup(() => new Response('nope', { status }));
    const err = await failure(client.get('search', {}, schema));
    expect(err).toMatchObject({ code, retryable });
    expect(err.message).toContain(String(status));
    expect(recorded).toMatchObject([{ status, endpoint: 'search' }]);
  });

  it('treats a network error as retryable and records status 0', async () => {
    const { client, recorded } = setup(() => {
      throw new TypeError('fetch failed');
    });
    const err = await failure(client.get('search', {}, schema));
    expect(err).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: true });
    expect(err.cause).toBeInstanceOf(TypeError);
    expect(recorded).toMatchObject([{ status: 0 }]);
  });

  it('treats a timeout as retryable', async () => {
    const { client } = setup(() => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });
    expect(await failure(client.get('search', {}, schema))).toMatchObject({ retryable: true });
  });

  it('treats an unreadable body as retryable', async () => {
    const { client } = setup(() => new Response('<html>bad gateway</html>', { status: 200 }));
    expect(await failure(client.get('search', {}, schema))).toMatchObject({ retryable: true });
  });

  it('treats an unexpected response shape as permanent', async () => {
    const { client } = setup(() => json({ unexpected: true }));
    const err = await failure(client.get('jobs/1', {}, schema));
    expect(err).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: false });
    expect(err.message).toContain('jobs/1');
  });

  it('refuses to call out without an API key', async () => {
    const fetchSpy = vi.fn();
    const recorded: SourceCall[] = [];
    const client = new ReedClient({
      apiKey: '',
      fetch: fetchSpy,
      recorder: { record: async (c) => void recorded.push(c) },
    });
    const err = await failure(client.get('search', {}, schema));
    expect(err).toMatchObject({ retryable: false });
    expect(err.message).toContain('REED_API_KEY');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('never lets a recorder failure fail or mask the request', async () => {
    const ok = setup(() => json({ ok: true }), { recorderThrows: true });
    expect(await ok.client.get('search', {}, schema)).toEqual({ ok: true });
    expect(ok.warnings).toMatchObject([{ stage: 'reed', error: 'db down' }]);

    const bad = setup(() => new Response('', { status: 401 }), { recorderThrows: true });
    expect(await failure(bad.client.get('search', {}, schema))).toMatchObject({ retryable: false });
  });

  it('reports non-Error recorder failures too', async () => {
    const warnings: unknown[] = [];
    const client = new ReedClient({
      apiKey: 'k',
      fetch: async () => json({ ok: true }),
      recorder: {
        record: async () => {
          throw 'string failure';
        },
      },
      log: { info() {}, warn: (f) => warnings.push(f), error() {} },
    });
    await client.get('search', {}, schema);
    expect(warnings).toMatchObject([{ error: 'string failure' }]);
  });
});
