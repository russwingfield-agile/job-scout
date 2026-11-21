import type { ZodType } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/log.js';
import type { SourceCallContext } from '../../ports/source.js';
import type { SourceCall, SourceCallRecorder } from '../../ports/sourceCalls.js';
import type { AdzunaParams } from './query.js';

const DEFAULT_BASE_URL = 'https://api.adzuna.com/v1/api';
const DEFAULT_TIMEOUT_MS = 15_000;

/** The slice of the client the adapter needs; tests substitute a fake. */
export interface AdzunaHttp {
  get<T>(
    path: string,
    params: AdzunaParams,
    schema: ZodType<T>,
    ctx?: SourceCallContext,
  ): Promise<T>;
}

export type AdzunaClientOptions = {
  appId: string;
  appKey: string;
  recorder?: SourceCallRecorder | undefined;
  log?: Logger | undefined;
  fetch?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
};

function errorForStatus(status: number): AppError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) {
    return new AppError('UPSTREAM_ERROR', `Adzuna rejected the app id or key (HTTP ${status})`, {
      retryable: false,
    });
  }
  if (status === 429) {
    return new AppError('UPSTREAM_RATE_LIMIT', 'Adzuna rate limit reached (HTTP 429)', {
      retryable: true,
    });
  }
  if (status >= 500) {
    return new AppError('UPSTREAM_ERROR', `Adzuna server error (HTTP ${status})`, {
      retryable: true,
    });
  }
  return new AppError('UPSTREAM_ERROR', `Adzuna returned HTTP ${status}`, { retryable: false });
}

/**
 * Adzuna API: the app id and key travel as query parameters, so they must never reach a log, an
 * error message or the recorded endpoint. Every request, failures included, is recorded so it
 * counts against the Adzuna budget.
 */
export class AdzunaClient implements AdzunaHttp {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: AdzunaClientOptions) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = opts.now ?? (() => performance.now());
  }

  async get<T>(
    path: string,
    params: AdzunaParams,
    schema: ZodType<T>,
    ctx: SourceCallContext = {},
  ): Promise<T> {
    if (!this.opts.appId || !this.opts.appKey) {
      throw new AppError('UPSTREAM_ERROR', 'The Adzuna app id and key are not configured', {
        retryable: false,
      });
    }

    const started = this.now();
    let status = 0;
    try {
      const res = await this.fetchFn(this.url(path, params), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = res.status;
      const httpError = errorForStatus(status);
      if (httpError) throw httpError;

      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) {
        throw new AppError('UPSTREAM_ERROR', `Unexpected Adzuna response shape for ${path}`, {
          retryable: false,
          cause: parsed.error,
        });
      }
      return parsed.data;
    } catch (err) {
      throw err instanceof AppError
        ? err
        : new AppError('UPSTREAM_ERROR', `Adzuna request failed: ${path}`, {
            retryable: true,
          });
    } finally {
      await this.record({
        runId: ctx.runId,
        source: 'adzuna',
        endpoint: path, // never the full URL: it carries the key
        status,
        ms: Math.round(this.now() - started),
      });
    }
  }

  private url(path: string, params: AdzunaParams): string {
    const query = new URLSearchParams({ app_id: this.opts.appId, app_key: this.opts.appKey });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return `${this.baseUrl}/${path}?${query.toString()}`;
  }

  private async record(call: SourceCall): Promise<void> {
    try {
      await this.opts.recorder?.record(call);
    } catch (err) {
      this.opts.log?.warn({
        stage: 'adzuna',
        msg: 'failed to record source call',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
