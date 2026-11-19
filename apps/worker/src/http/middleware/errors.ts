import type { ApiErrorResponse } from '@job-scout/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AppError } from '../../lib/errors.js';
import { createLogger } from '../../lib/log.js';
import type { AppEnv } from '../types.js';

const requestIdOf = (c: Context<AppEnv>): string => c.get('requestId') ?? 'unknown';

/** Maps every thrown error to `{ error: { code, message, requestId } }` (plan §2.7). */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = requestIdOf(c);

  if (err instanceof AppError) {
    const body: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.issues ? { issues: err.issues } : {}),
      },
    };
    return c.json(body, err.status as 400);
  }

  if (err instanceof HTTPException) {
    const body: ApiErrorResponse = {
      error: {
        code: err.status === 404 ? 'NOT_FOUND' : err.status === 401 ? 'UNAUTHORIZED' : 'VALIDATION',
        message: err.message,
        requestId,
      },
    };
    return c.json(body, err.status as 400);
  }

  createLogger().error({
    stage: 'http',
    requestId,
    msg: 'unhandled error',
    error: err instanceof Error ? err.message : String(err),
  });
  const body: ApiErrorResponse = {
    error: { code: 'INTERNAL', message: 'Internal server error', requestId },
  };
  return c.json(body, 500);
};

export const onNotFound: NotFoundHandler<AppEnv> = (c) => {
  const body: ApiErrorResponse = {
    error: { code: 'NOT_FOUND', message: 'Not found', requestId: requestIdOf(c) },
  };
  return c.json(body, 404);
};
