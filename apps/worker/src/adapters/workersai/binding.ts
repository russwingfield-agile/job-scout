import { AppError } from '../../lib/errors.js';

/** The slice of the Workers AI binding we use (`env.AI`). */
export interface AiLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  toMarkdown(files: { name: string; blob: Blob }[]): Promise<unknown>;
}

/** Workers AI error 3036: the daily free allocation of neurons is used up. */
const NEURON_CAP = /\b3036\b|daily free allocation/i;

/** Turn anything a Workers AI call throws into an AppError the queue/route layers understand. */
export function toAiError(err: unknown, what: string): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (NEURON_CAP.test(message)) {
    return new AppError('BUDGET_EXHAUSTED', 'Workers AI daily neuron allocation is used up', {
      retryable: false,
      cause: err,
    });
  }
  return new AppError('UPSTREAM_ERROR', `Workers AI ${what} failed: ${message}`, {
    retryable: true,
    cause: err,
  });
}
