import type { Deps } from '../container.js';
import { planQueries } from '../core/queries.js';
import { AppError } from '../lib/errors.js';
import { newUlid } from '../lib/ids.js';
import { dayKey, toIso } from '../lib/time.js';
import {
  enqueueFetchKey,
  enqueueProcessKey,
  type FetchMessage,
  type PipelineMessage,
} from './messages.js';

const DAY_MS = 86_400_000;

export type PipelineDeps = Pick<
  Deps,
  'repos' | 'clock' | 'log' | 'settings' | 'source' | 'embedder' | 'vectors' | 'bus'
>;

export type StartRunInput = { trigger: 'cron'; slotKey: string } | { trigger: 'manual' };

/**
 * Stage A (SPEC §5.2): create the run and fan out one fetch message per planned query.
 * - cron: a second start for the same slot returns null (the slot key is unique).
 * - manual: refused (409) while another run is still working.
 * Returns null only for a duplicate cron slot.
 */
export async function startRun(
  deps: PipelineDeps,
  input: StartRunInput,
): Promise<{ runId: string; queries: number } | null> {
  const { repos, clock, bus, log } = deps;

  if (input.trigger === 'manual' && (await repos.runs.findActive())) {
    throw new AppError('CONFLICT', 'A run is already in progress. Wait for it to finish.');
  }

  const now = clock.now();
  const startedAt = toIso(now);
  const runId = newUlid(now);
  const created = await repos.runs.insertIfNew({
    id: runId,
    slotKey: input.trigger === 'cron' ? input.slotKey : `manual:${runId}`,
    trigger: input.trigger,
    status: 'running',
    phase: 'ingest',
    startedAt,
  });
  if (!created) return null;

  // Only profiles whose CV is active take part (an inactive CV stays stored but unsearched).
  const [profiles, cvs] = await Promise.all([repos.profiles.listActive(), repos.cvs.list()]);
  const activeCvIds = new Set(cvs.filter((cv) => cv.active).map((cv) => cv.id));
  const planned = planQueries(profiles.filter((p) => activeCvIds.has(p.cvId)));

  if (planned.length === 0) {
    log.info({ stage: 'startRun', runId, msg: 'no active search profiles; nothing to fetch' });
    await repos.runs.finish(runId, { status: 'completed', finishedAt: toIso(clock.now()) });
    return { runId, queries: 0 };
  }

  // Claim first (counts the work), then send: a lost send is caught by stale-run recovery.
  const keys = planned.map((q) => enqueueFetchKey(runId, q.queryKey, 0));
  const claimed = await repos.runs.claimMany(runId, keys, 'ingest', startedAt);
  const fetchMessages: FetchMessage[] = planned
    .filter((q) => claimed.has(enqueueFetchKey(runId, q.queryKey, 0)))
    .map((q) => ({
      v: 1,
      type: 'fetch',
      runId,
      profileIds: q.profileIds,
      queryKey: q.queryKey,
      query: q.query,
      page: 0,
    }));

  // Finish jobs that earlier runs saw but could not afford to process, newest first, within the
  // Reed budget left after reserving the searches this run is about to make.
  const { budgets, ingest } = await deps.settings.get();
  const usage = await repos.usage.get(dayKey(now));
  const reserve = planned.length * budgets.maxPagesPerQuery;
  const room = Math.max(
    0,
    Math.min(budgets.reedCallsPerRunCap, budgets.reedDailyRequestBudget - (usage?.reedCalls ?? 0)) -
      reserve,
  );
  const backlog =
    room > 0
      ? await repos.jobs.listBacklog(
          room,
          new Date(now.getTime() - ingest.maxAgeDays * DAY_MS).toISOString(),
        )
      : [];
  const backlogClaimed = await repos.runs.claimMany(
    runId,
    backlog.map((j) => enqueueProcessKey(runId, j.id)),
    'ingest',
    startedAt,
  );
  const messages: PipelineMessage[] = [
    ...fetchMessages,
    ...backlog
      .filter((j) => backlogClaimed.has(enqueueProcessKey(runId, j.id)))
      .map((j): PipelineMessage => ({ v: 1, type: 'process', runId, jobId: j.id })),
  ];

  try {
    await bus.sendBatch(messages);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repos.runs.addError(
      runId,
      { stage: 'startRun', ref: runId, message },
      toIso(clock.now()),
    );
    await repos.runs.finish(runId, { status: 'failed', finishedAt: toIso(clock.now()) });
    throw err;
  }
  log.info({
    stage: 'startRun',
    runId,
    msg: 'run started',
    trigger: input.trigger,
    queries: fetchMessages.length,
    backlog: messages.length - fetchMessages.length,
  });
  return { runId, queries: fetchMessages.length };
}
