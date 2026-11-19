import { HealthResponseSchema } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index.js';

describe('GET /api/health', () => {
  it('returns ok JSON from the worker fetch handler', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.safeParse(await res.json()).success).toBe(true);
  });
});
