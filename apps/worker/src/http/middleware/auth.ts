import { createMiddleware } from 'hono/factory';
import { AppError } from '../../lib/errors.js';
import type { AppEnv } from '../types.js';

/** Routes that stay reachable without authentication (liveness probes). */
const PUBLIC_PATHS = new Set(['/api/health']);

type AuthEnv = { OWNER_EMAIL?: string };

/**
 * Verifies the Cloudflare Access JWT on every /api request. Fails closed: if Access is not
 * configured the API is unreachable, never open. `DEV_BYPASS_AUTH` only counts when `ENV=dev`.
 */
export const auth = createMiddleware<AppEnv>(async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  if (c.env.ENV === 'dev' && c.env.DEV_BYPASS_AUTH === 'true') return next();

  const { access } = c.var.deps;
  if (!access) throw new AppError('UNAUTHORIZED', 'Authentication is not configured');

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) throw new AppError('UNAUTHORIZED', 'Missing access token');

  let email: string | undefined;
  try {
    ({ email } = await access.verify(token));
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid access token');
  }

  // Defence in depth: when an owner is configured, only that identity gets in.
  const owner = (c.env as Env & AuthEnv).OWNER_EMAIL;
  if (owner && email?.toLowerCase() !== owner.toLowerCase()) {
    throw new AppError('UNAUTHORIZED', 'Not authorised');
  }
  await next();
});
