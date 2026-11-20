import type { ApiErrorCode } from '@job-scout/shared';

export type ErrorIssue = { path: string; message: string };

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  UPSTREAM_RATE_LIMIT: 502,
  UPSTREAM_ERROR: 502,
  BUDGET_EXHAUSTED: 429,
  LLM_INVALID_OUTPUT: 502,
  CONFLICT: 409,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

const DEFAULT_RETRYABLE: Record<ApiErrorCode, boolean> = {
  VALIDATION: false,
  NOT_FOUND: false,
  UNAUTHORIZED: false,
  UPSTREAM_RATE_LIMIT: true,
  UPSTREAM_ERROR: true,
  BUDGET_EXHAUSTED: false,
  LLM_INVALID_OUTPUT: false,
  CONFLICT: false,
  NOT_CONFIGURED: false,
  INTERNAL: false,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly status: number;
  readonly issues: ErrorIssue[] | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number; issues?: ErrorIssue[]; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE[code];
    this.status = opts.status ?? DEFAULT_STATUS[code];
    this.issues = opts.issues;
  }
}
