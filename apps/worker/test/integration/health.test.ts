import { env } from 'cloudflare:workers';
import { HealthResponseSchema } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index.js';

describe('GET /api/health', () => {
  it('returns ok JSON from the worker fetch handler', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/health'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
    expect(HealthResponseSchema.safeParse(await res.json()).success).toBe(true);
  });

  it('returns the JSON error envelope for unknown /api routes', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/nope'), env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });
});
