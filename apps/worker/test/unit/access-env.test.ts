import { describe, expect, it } from 'vitest';
import { accessVerifierFromEnv } from '../../src/adapters/access.js';

const env = (vars: Record<string, string | undefined>) => vars as unknown as Env;

describe('accessVerifierFromEnv', () => {
  it('is null (so the API fails closed) unless both Access settings are present', () => {
    expect(accessVerifierFromEnv(env({}))).toBeNull();
    expect(accessVerifierFromEnv(env({ ACCESS_AUD: 'aud' }))).toBeNull();
    expect(
      accessVerifierFromEnv(env({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' })),
    ).toBeNull();
    expect(accessVerifierFromEnv(env({ ACCESS_AUD: '', ACCESS_TEAM_DOMAIN: '' }))).toBeNull();
  });

  it('builds a verifier when both are set', () => {
    const verifier = accessVerifierFromEnv(
      env({ ACCESS_AUD: 'aud', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' }),
    );
    expect(verifier).not.toBeNull();
    expect(typeof verifier?.verify).toBe('function');
  });
});
