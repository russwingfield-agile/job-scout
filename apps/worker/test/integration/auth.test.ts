import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createContainer } from '../../src/container.js';
import { createApp } from '../../src/http/app.js';
import type { AccessVerifier } from '../../src/ports/access.js';

const OWNER = 'owner@example.com';

const prodEnv = (extra: Record<string, string> = {}) =>
  ({ DB: env.DB, ENV: 'production', DEV_BYPASS_AUTH: 'false', ...extra }) as unknown as Env;

const verifierFor = (identities: Record<string, string | undefined>): AccessVerifier => ({
  async verify(token) {
    if (!(token in identities)) throw new Error('bad token');
    return { email: identities[token] };
  },
});

function request(
  path: string,
  opts: { env: Env; access: AccessVerifier | null; token?: string; method?: string },
) {
  const app = createApp((e) => createContainer(e, { access: opts.access }));
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.token ? { 'Cf-Access-Jwt-Assertion': opts.token } : {},
    }),
    opts.env,
  );
}

describe('API auth guard', () => {
  it('leaves /api/health public', async () => {
    const res = await request('/api/health', { env: prodEnv(), access: null });
    expect(res.status).toBe(200);
  });

  it('fails closed when Access is not configured', async () => {
    const res = await request('/api/settings', { env: prodEnv(), access: null });
    expect(res.status).toBe(401);
  });

  it('rejects a request with no token', async () => {
    const res = await request('/api/settings', {
      env: prodEnv(),
      access: verifierFor({ good: OWNER }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request('/api/settings', {
      env: prodEnv(),
      access: verifierFor({ good: OWNER }),
      token: 'forged',
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token', async () => {
    const res = await request('/api/settings', {
      env: prodEnv(),
      access: verifierFor({ good: OWNER }),
      token: 'good',
    });
    expect(res.status).toBe(200);
  });

  it('enforces the OWNER_EMAIL allow-list (case-insensitive)', async () => {
    const access = verifierFor({ owner: 'Owner@Example.com', other: 'other@example.com' });
    const e = prodEnv({ OWNER_EMAIL: OWNER });
    expect((await request('/api/settings', { env: e, access, token: 'owner' })).status).toBe(200);
    expect((await request('/api/settings', { env: e, access, token: 'other' })).status).toBe(401);
  });

  it('only honours DEV_BYPASS_AUTH when ENV=dev', async () => {
    const bypassInProd = prodEnv({ DEV_BYPASS_AUTH: 'true' });
    expect((await request('/api/settings', { env: bypassInProd, access: null })).status).toBe(401);

    const bypassInDev = prodEnv({ ENV: 'dev', DEV_BYPASS_AUTH: 'true' });
    expect((await request('/api/settings', { env: bypassInDev, access: null })).status).toBe(200);
  });

  it('returns the JSON error envelope on 401', async () => {
    const res = await request('/api/settings', { env: prodEnv(), access: null });
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
