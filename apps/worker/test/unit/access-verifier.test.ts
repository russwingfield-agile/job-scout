import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAccessVerifier } from '../../src/adapters/access.js';

const TEAM = 'example.cloudflareaccess.com';
const AUD = 'test-aud-tag';

let privateKey: CryptoKey;
let verifier: ReturnType<typeof createAccessVerifier>;

const sign = (claims: { aud?: string; iss?: string; exp?: string; email?: string }) =>
  new SignJWT(claims.email ? { email: claims.email } : {})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setAudience(claims.aud ?? AUD)
    .setIssuer(claims.iss ?? `https://${TEAM}`)
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? '5m')
    .sign(privateKey);

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  verifier = createAccessVerifier({
    teamDomain: `https://${TEAM}/`,
    aud: AUD,
    jwks: createLocalJWKSet({ keys: [jwk] }),
  });
});

describe('createAccessVerifier', () => {
  it('accepts a correctly signed token and returns the email', async () => {
    expect(await verifier.verify(await sign({ email: 'me@example.com' }))).toEqual({
      email: 'me@example.com',
    });
  });

  it('rejects the wrong audience', async () => {
    await expect(verifier.verify(await sign({ aud: 'someone-else' }))).rejects.toThrow();
  });

  it('rejects the wrong issuer', async () => {
    await expect(
      verifier.verify(await sign({ iss: 'https://evil.example.com' })),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    await expect(verifier.verify(await sign({ exp: '-1m' }))).rejects.toThrow();
  });

  it('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setAudience(AUD)
      .setIssuer(`https://${TEAM}`)
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(verifier.verify(forged)).rejects.toThrow();
  });
});
