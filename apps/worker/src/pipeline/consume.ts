import { backoffSeconds } from '../core/backoff.js';
import { AppError } from '../lib/errors.js';
import { toIso } from '../lib/time.js';
import { assessGroup } from './assessGroup.js';
import { fetchPage } from './fetchPage.js';
import { finaliseRun } from './finaliseRun.js';
import {
  completionKey,
  type PipelineMessage,
  PipelineMessageSchema,
  QUEUE_MAX_RETRIES,
  type ScoreMessage,
} from './messages.js';
import { processJob } from './processJob.js';
import { advanceRun } from './runLifecycle.js';
import type { PipelineDeps } from './startRun.js';

export type MessageOutcome = { outcome: 'ack' } | { outcome: 'retry'; delaySeconds: number };

const refOf = (m: PipelineMessage): string => {
  switch (m.type) {
    case 'fetch':
      return `${m.queryKey}#${m.page}`;
    case 'process':
      return m.jobId;
    case 'score':
      return m.groupId;
  }
};

/** Score messages count against the run's scoring counter, the others against ingest. */
const counterOf = (m: PipelineMessage): 'ingest' | 'score' =>
  m.type === 'score' ? 'score' : 'ingest';

/**
 * Assess one group. A redelivered message finds the group already past `pending_llm` and does
 * nothing, so the model is never paid for twice.
 */
async function scoreGroup(deps: PipelineDeps, msg: ScoreMessage): Promise<void> {
  const group = await deps.repos.groups.getById(msg.groupId);
  if (group?.status !== 'pending_llm') return;
  await assessGroup(deps, msg.groupId, msg.runId);
}

/** Errors we do not recognise are treated as transient (a D1 hiccup, say) and retried. */
const isRetryable = (err: unknown): boolean => !(err instanceof AppError) || err.retryable;

/**
 * Run one queue message to completion. Contract with the queue:
 * - success → ack, and the run's pending counter drops by one (once, whatever the redeliveries);
 * - transient failure with attempts left → retry with backoff, counter untouched;
 * - permanent failure, or the last attempt → the error is written to `run_errors`, the message is
 *   *completed* anyway so the run is never left waiting, and acked.
 * Invalid messages are logged and acked: retrying cannot make them valid.
 */
export async function handleMessage(
  deps: PipelineDeps,
  body: unknown,
  attempt: number,
): Promise<MessageOutcome> {
  const parsed = PipelineMessageSchema.safeParse(body);
  if (!parsed.success) {
    deps.log.error({ stage: 'queue', msg: 'invalid message dropped', error: parsed.error.message });
    return { outcome: 'ack' };
  }
  const msg = parsed.data;

  try {
    if (msg.type === 'fetch') await fetchPage(deps, msg);
    else if (msg.type === 'process') await processJob(deps, msg);
    else await scoreGroup(deps, msg);
  } catch (err) {
    if (isRetryable(err) && attempt <= QUEUE_MAX_RETRIES) {
      deps.log.warn({
        stage: msg.type,
        runId: msg.runId,
        msg: 'transient failure; will retry',
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      return { outcome: 'retry', delaySeconds: backoffSeconds(attempt) };
    }
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error({
      stage: msg.type,
      runId: msg.runId,
      msg: 'giving up on message',
      error: message,
    });
    await deps.repos.runs.addError(
      msg.runId,
      { stage: msg.type, ref: refOf(msg), message },
      toIso(deps.clock.now()),
    );
    // A group we could not assess is not lost: a later run picks it up again.
    if (msg.type === 'score') await deps.repos.groups.setStatus(msg.groupId, 'deferred');
  }

  const counter = counterOf(msg);
  const done = await deps.repos.runs.claim(
    msg.runId,
    completionKey(msg),
    counter,
    -1,
    toIso(deps.clock.now()),
  );
  if (done.applied && done.pending === 0) {
    if (counter === 'ingest') await advanceRun(deps, msg.runId);
    else await finaliseRun(deps, msg.runId);
  }
  return { outcome: 'ack' };
}
