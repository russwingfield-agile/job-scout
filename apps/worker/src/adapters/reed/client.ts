import type { ZodType } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/log.js';
import type { SourceCallContext } from '../../ports/source.js';
import type { SourceCall, SourceCallRecorder } from '../../ports/sourceCalls.js';

const DEFAULT_BASE_URL = 'https://www.reed.co.uk/api/1.0';
const DEFAULT_TIMEOUT_MS = 15_000;

export type ReedParams = Record<string, string | number | boolean | undefined>;

/** The slice of the client the adapter needs; tests substitute a fake. */
export interface ReedHttp {
  get<T>(
    endpoint: string,
    params: ReedParams,
    schema: ZodType<T>,
    ctx?: SourceCallContext,
  ): Promise<T>;
}

export type ReedClientOptions = {
  apiKey: string;
  recorder?: SourceCallRecorder | undefined;
  log?: Logger | undefined;
  fetch?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  /** Monotonic millisecond clock, injectable for tests. */
  now?: (() => number) | undefined;
};

/** Map a non-2xx HTTP status to an error whose `retryable` flag tells the queue what to do. */
function errorForStatus(status: number): AppError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) {
    return new AppError('UPSTREAM_ERROR', `Reed rejected the API key (HTTP ${status})`, {
      retryable: false,
    });
  }
  if (status === 429) {
    return new AppError('UPSTREAM_RATE_LIMIT', 'Reed rate limit reached (HTTP 429)', {
      retryable: true,
    });
  }
  if (status >= 500) {
    return new AppError('UPSTREAM_ERROR', `Reed server error (HTTP ${status})`, {
      retryable: true,
    });
  }
  return new AppError('UPSTREAM_ERROR', `Reed returned HTTP ${status}`, { retryable: false });
}

/**
 * Reed Jobseeker API over HTTP Basic auth (key as username, empty password). Every request —
 * including failures — is reported to the recorder so it counts against the daily budget.
 */
export class ReedClient implements ReedHttp {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: ReedClientOptions) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = opts.now ?? (() => performance.now());
  }

  async get<T>(
    endpoint: string,
    params: ReedParams,
    schema: ZodType<T>,
    ctx: SourceCallContext = {},
  ): Promise<T> {
    if (!this.opts.apiKey) {
      throw new AppError('UPSTREAM_ERROR', 'REED_API_KEY is not configured', { retryable: false });
    }

    const started = this.now();
    let status = 0;
    try {
      const res = await this.fetchFn(this.url(endpoint, params), {
        headers: {
          Authorization: `Basic ${btoa(`${this.opts.apiKey}:`)}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = res.status;
      const httpError = errorForStatus(status);
      if (httpError) throw httpError;

      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) {
        throw new AppError('UPSTREAM_ERROR', `Unexpected Reed response shape for ${endpoint}`, {
          retryable: false,
          cause: parsed.error,
        });
      }
      return parsed.data;
    } catch (err) {
      // Network failure, timeout or unreadable body: transient, so let the queue retry.
      throw err instanceof AppError
        ? err
        : new AppError('UPSTREAM_ERROR', `Reed request failed: ${endpoint}`, {
            retryable: true,
            cause: err,
          });
    } finally {
      await this.record({
        runId: ctx.runId,
        source: 'reed',
        endpoint,
        status,
        ms: Math.round(this.now() - started),
      });
    }
  }

  private url(endpoint: string, params: ReedParams): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const qs = query.toString();
    return `${this.baseUrl}/${endpoint}${qs ? `?${qs}` : ''}`;
  }

  /** Bookkeeping must never fail the request it describes. */
  private async record(call: SourceCall): Promise<void> {
    try {
      await this.opts.recorder?.record(call);
    } catch (err) {
      this.opts.log?.warn({
        stage: 'reed',
        msg: 'failed to record source call',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
