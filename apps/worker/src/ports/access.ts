export type AccessIdentity = { email: string | undefined };

/** Verifies a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`). Rejects when invalid. */
export interface AccessVerifier {
  verify(token: string): Promise<AccessIdentity>;
}
