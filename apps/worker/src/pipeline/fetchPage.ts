import { canSpendReed } from '../core/budget.js';
import { AppError } from '../lib/errors.js';
import { dayKey, toIso } from '../lib/time.js';
import {
  enqueueFetchKey,
  enqueueProcessKey,
  type FetchMessage,
  type PipelineMessage,
} from './messages.js';
import type { PipelineDeps } from './startRun.js';

/**
 * Stage B: one page of one search. Records every hit, queues full processing for jobs we have not
 * yet processed, and queues the next page while pages keep turning up new jobs.
 * Everything here is idempotent, so a redelivered message repeats no work and moves no counter twice.
 */
export async function fetchPage(deps: PipelineDeps, msg: FetchMessage): Promise<void> {
  const { repos, clock, source, bus } = deps;
  const { budgets } = await deps.settings.get();
  const now = toIso(clock.now());

  const usage = await repos.usage.get(dayKey(clock.now()));
  const decision = canSpendReed(
    {
      usedToday: usage?.reedCalls ?? 0,
      usedThisRun: await repos.sourceCalls.countByRun(msg.runId),
      n: 1,
    },
    budgets,
  );
  if (!decision.ok) {
    throw new AppError('BUDGET_EXHAUSTED', `Reed budget exhausted (${decision.reason})`);
  }

  const { refs, hasMore } = await source.search(msg.query, msg.page, { runId: msg.runId });
  await repos.runs.bumpCount(msg.runId, 'fetched', refs.length);

  // Remember every hit; rows we already know are left untouched.
  const known = await repos.jobs.findBySourceIds(
    source.id,
    refs.map((r) => r.sourceJobId),
  );
  const unseen = refs.filter((r) => !known.has(r.sourceJobId));
  await repos.jobs.insertRefsIfNew(
    unseen.map((r) => ({
      id: crypto.randomUUID(),
      source: source.id,
      sourceJobId: r.sourceJobId,
      url: r.url,
      title: r.title,
      employerName: r.employerName,
      location: r.location,
      postedAt: r.postedAt,
      createdAt: now,
    })),
  );
  const rows = await repos.jobs.findBySourceIds(
    source.id,
    refs.map((r) => r.sourceJobId),
  );
  await repos.jobs.addProfileHits(
    [...rows.values()].map((r) => r.id),
    msg.profileIds,
    msg.runId,
  );
  await repos.runs.bumpCount(msg.runId, 'new', unseen.length);

  // Queue processing for every job still at the "seen in a search" stage, once per run: a job
  // found by two queries, or redelivered with this message, is claimed (and queued) only once.
  const pending = [...rows.values()].filter((r) => r.stage === 'ref');
  const claimed = await repos.runs.claimMany(
    msg.runId,
    pending.map((r) => enqueueProcessKey(msg.runId, r.id)),
    'ingest',
    now,
  );
  const outgoing: PipelineMessage[] = pending
    .filter((r) => claimed.has(enqueueProcessKey(msg.runId, r.id)))
    .map((r) => ({ v: 1, type: 'process', runId: msg.runId, jobId: r.id }));

  // Keep paging only while this page produced new work, up to the configured page limit.
  const nextPage = msg.page + 1;
  if (outgoing.length > 0 && hasMore && nextPage < budgets.maxPagesPerQuery) {
    const key = enqueueFetchKey(msg.runId, msg.queryKey, nextPage);
    if ((await repos.runs.claimMany(msg.runId, [key], 'ingest', now)).has(key)) {
      outgoing.push({ ...msg, page: nextPage });
    }
  }

  await bus.sendBatch(outgoing);
}
