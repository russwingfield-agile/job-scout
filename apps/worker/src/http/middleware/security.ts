import { createMiddleware } from 'hono/factory';
import { AppError } from '../../lib/errors.js';
import type { AppEnv } from '../types.js';

/** Safety cap for JSON requests. CV uploads (multipart) have their own, larger, limit in Settings. */
const JSON_BODY_LIMIT_BYTES = 1_000_000;

/** Headers for API responses. (Pages and scripts get theirs from apps/web/public/_headers.) */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
};

/** Refuse oversized JSON bodies, and mark every API response with the standard security headers. */
export const security = createMiddleware<AppEnv>(async (c, next) => {
  const contentType = c.req.header('Content-Type') ?? '';
  const length = Number(c.req.header('Content-Length') ?? 0);
  if (!contentType.startsWith('multipart/') && length > JSON_BODY_LIMIT_BYTES) {
    throw new AppError('VALIDATION', 'That request is too large.', { status: 413 });
  }
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
});
