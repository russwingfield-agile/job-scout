import { HealthResponseSchema } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';

describe('HealthResponseSchema', () => {
  it('accepts a well-formed health payload', () => {
    const parsed = HealthResponseSchema.safeParse({
      ok: true,
      version: '0.0.0',
      time: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects ok=false and non-ISO timestamps', () => {
    expect(HealthResponseSchema.safeParse({ ok: false, version: '1', time: 'x' }).success).toBe(
      false,
    );
  });
});
