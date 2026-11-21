import { callLimitsFor, canSpendCalls } from '../core/budget.js';
import { AppError } from '../lib/errors.js';
import { dayKey, toIso } from '../lib/time.js';
import {
  enqueueFetchKey,
  enqueueProcessKey,
  type FetchMessage,
  type PipelineMessage,
} from './messages.js';
import type { PipelineDeps } from './startRun.js';

const DAY_MS = 86_400_000;
/** One search call held back so a following page can still be fetched. */
const NEXT_PAGE_RESERVE = 1;

const newestFirst = (a: { postedAt: string | null }, b: { postedAt: string | null }): number =>
  (b.postedAt ?? '').localeCompare(a.postedAt ?? '');

/**
 * Stage B: one page of one search. Records every hit, queues full processing for jobs we have not
 * yet processed — newest first, and only as many as the Reed budget can pay for — and queues the
 * next page while pages keep turning up work.
 * Everything here is idempotent, so a redelivered message repeats no work and moves no counter twice.
 */
export async function fetchPage(deps: PipelineDeps, msg: FetchMessage): Promise<void> {
  const { repos, clock, bus } = deps;
  const source = deps.sources[msg.source];
  if (!source) {
    throw new AppError('NOT_CONFIGURED', `The ${msg.source} job source is not switched on`, {
      retryable: false,
    });
  }
  const { budgets, ingest } = await deps.settings.get();
  const now = toIso(clock.now());
  const today = dayKey(clock.now());

  const usageBefore = await repos.usage.get(today);
  const usedToday =
    source.id === 'reed'
      ? (usageBefore?.reedCalls ?? 0)
      : await repos.sourceCalls.countBySourceSince(source.id, `${today}T00:00:00.000Z`);
  const decision = canSpendCalls(
    {
      usedToday,
      usedThisRun: await repos.sourceCalls.countByRun(msg.runId, source.id),
      n: 1,
    },
    callLimitsFor(source.id, budgets),
  );
  if (!decision.ok) {
    throw new AppError('BUDGET_EXHAUSTED', `${source.id} budget exhausted (${decision.reason})`);
  }

  const { refs, hasMore } = await source.search(msg.query, msg.page, { runId: msg.runId });
  await repos.runs.bumpCount(msg.runId, 'fetched', refs.length);

  // Adverts older than the ingest window are recorded (so we never look at them again) but are
  // never fetched in full: the Inbox shows recent jobs, and each advert costs a Reed call.
  const oldestAllowed = clock.now().getTime() - ingest.maxAgeDays * DAY_MS;
  const isTooOld = (postedAt: string | null): boolean =>
    postedAt !== null && Date.parse(postedAt) < oldestAllowed;

  const known = await repos.jobs.findBySourceIds(
    source.id,
    refs.map((r) => r.sourceJobId),
  );
  const unseen = refs.filter((r) => !known.has(r.sourceJobId));
  await repos.jobs.insertRefsIfNew(
    unseen.map((r) => {
      const old = isTooOld(r.postedAt);
      return {
        id: crypto.randomUUID(),
        source: source.id,
        sourceJobId: r.sourceJobId,
        url: r.url,
        title: r.title,
        employerName: r.employerName,
        location: r.location,
        postedAt: r.postedAt,
        createdAt: now,
        ...(r.raw === undefined ? {} : { rawJson: JSON.stringify(r.raw) }),
        ...(old ? { stage: 'processed' as const, filterReason: 'too_old' } : {}),
      };
    }),
  );
  const unseenTooOld = unseen.filter((r) => isTooOld(r.postedAt)).length;

  const rows = await repos.jobs.findBySourceIds(
    source.id,
    refs.map((r) => r.sourceJobId),
  );
  await repos.jobs.addProfileHits(
    [...rows.values()].map((r) => r.id),
    msg.profileIds,
    msg.runId,
    // A search with no place (the "Remote" one) returns the whole country; mark its hits so the
    // filters can require those jobs to be remote.
    msg.query.location !== null,
  );

  // Jobs seen by an earlier run but never processed: close out the ones that have since aged out.
  const agedOut = [...rows.values()].filter((r) => r.stage === 'ref' && isTooOld(r.postedAt));
  await repos.jobs.markSkipped(
    agedOut.map((r) => r.id),
    'too_old',
  );
  await repos.runs.bumpCount(msg.runId, 'tooOld', unseenTooOld + agedOut.length);
  await repos.runs.bumpCount(msg.runId, 'new', unseen.length - unseenTooOld);

  // Queue only what the Reed budget can pay for (each job costs one call), newest first. The rest
  // stay at "seen" and are picked up by a later run: deferred, not failed.
  const pending = [...rows.values()]
    .filter((r) => r.stage === 'ref' && !isTooOld(r.postedAt))
    .sort(newestFirst);
  const [queued, finished, usageNow, callsThisRun] = await Promise.all([
    repos.runs.countClaims('enq:process', msg.runId),
    repos.runs.countClaims('done:process', msg.runId),
    repos.usage.get(today),
    repos.sourceCalls.countByRun(msg.runId, 'reed'),
  ]);
  const inFlight = queued - finished; // queued adverts that will each make a call
  const room = Math.max(
    0,
    Math.min(
      budgets.reedCallsPerRunCap - callsThisRun - inFlight - NEXT_PAGE_RESERVE,
      budgets.reedDailyRequestBudget - (usageNow?.reedCalls ?? 0) - inFlight - NEXT_PAGE_RESERVE,
    ),
  );
  // Sources that return the advert in the search need no further request, so nothing limits them.
  const affordable = source.inlineDetails ? pending : pending.slice(0, room);
  await repos.runs.bumpCount(msg.runId, 'deferred', pending.length - affordable.length);

  // Claim before sending, once per run: a job found by two queries, or redelivered with this
  // message, is queued only once.
  const claimed = await repos.runs.claimMany(
    msg.runId,
    affordable.map((r) => enqueueProcessKey(msg.runId, r.id)),
    'ingest',
    now,
  );
  const outgoing: PipelineMessage[] = affordable
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
