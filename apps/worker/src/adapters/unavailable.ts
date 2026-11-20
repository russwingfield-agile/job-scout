import { AppError } from '../lib/errors.js';

/**
 * Stand-in for a port whose Cloudflare binding is not configured in this deployment. Every method
 * rejects with NOT_CONFIGURED (HTTP 503) naming what is missing, so the failure is clear and only
 * reaches code paths that actually need the binding.
 */
export function unavailable<T extends object>(what: string): T {
  const failure = () =>
    Promise.reject(
      new AppError('NOT_CONFIGURED', `${what} is not configured for this deployment`, {
        retryable: false,
      }),
    );
  return new Proxy(
    {},
    // `then` must stay undefined so awaiting the proxy itself never mistakes it for a promise.
    { get: (_target, prop) => (prop === 'then' ? undefined : failure) },
  ) as T;
}
