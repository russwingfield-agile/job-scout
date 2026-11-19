import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { AccessVerifier } from '../ports/access.js';

export type AccessConfig = {
  teamDomain: string;
  aud: string;
  /** Override for tests; defaults to the team's remote JWKS endpoint. */
  jwks?: JWTVerifyGetKey;
};

const normaliseDomain = (d: string) => d.replace(/^https?:\/\//, '').replace(/\/+$/, '');

export function createAccessVerifier(config: AccessConfig): AccessVerifier {
  const domain = normaliseDomain(config.teamDomain);
  const issuer = `https://${domain}`;
  const jwks = config.jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, jwks, { audience: config.aud, issuer });
      return { email: typeof payload.email === 'string' ? payload.email : undefined };
    },
  };
}

type AccessEnv = { ACCESS_AUD?: string; ACCESS_TEAM_DOMAIN?: string };

/** Null when Access is not configured; the auth middleware then fails closed. */
export function accessVerifierFromEnv(env: Env): AccessVerifier | null {
  const { ACCESS_AUD, ACCESS_TEAM_DOMAIN } = env as Env & AccessEnv;
  if (!ACCESS_AUD || !ACCESS_TEAM_DOMAIN) return null;
  return createAccessVerifier({ teamDomain: ACCESS_TEAM_DOMAIN, aud: ACCESS_AUD });
}
