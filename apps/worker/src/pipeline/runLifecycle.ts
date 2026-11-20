import { toIso } from '../lib/time.js';
import type { PipelineDeps } from './startRun.js';

/** Close a run. (M7 will add the cleanup that runs on the 17:00 slot.) */
export async function finaliseRun(deps: PipelineDeps, runId: string): Promise<void> {
  await deps.repos.runs.finish(runId, {
    status: 'completed',
    finishedAt: toIso(deps.clock.now()),
  });
}

/**
 * Stage D. Until M7 adds LLM assessment, scoring has nothing to select, so the run just finishes.
 * M7 replaces this with: pick the top groups by prefilter score, queue `score` messages.
 */
export async function selectForScoring(deps: PipelineDeps, runId: string): Promise<void> {
  await finaliseRun(deps, runId);
}

/**
 * Called when a run's pending-ingest counter hits zero. Only one caller wins the phase change, so
 * the run advances exactly once however many handlers observe zero.
 */
export async function advanceRun(deps: PipelineDeps, runId: string): Promise<void> {
  if (await deps.repos.runs.claimPhase(runId, 'ingest', 'scoring')) {
    await selectForScoring(deps, runId);
  }
}

/**
 * Safety net for runs whose counters never reach zero (a lost queue message, a crash between
 * claiming and sending): after `staleRunMinutes` they are marked stale so the next run can start.
 */
export async function recoverStaleRuns(deps: PipelineDeps): Promise<number> {
  const { budgets } = await deps.settings.get();
  const cutoff = toIso(new Date(deps.clock.now().getTime() - budgets.staleRunMinutes * 60_000));
  const stale = await deps.repos.runs.listStale(cutoff);
  const now = toIso(deps.clock.now());
  for (const run of stale) {
    await deps.repos.runs.addError(
      run.id,
      {
        stage: 'recovery',
        ref: run.id,
        message: `Run did not finish within ${budgets.staleRunMinutes} minutes (still waiting on ${run.pendingIngest} ingest and ${run.pendingScore} scoring tasks)`,
      },
      now,
    );
    await deps.repos.runs.finish(run.id, { status: 'stale', finishedAt: now });
  }
  return stale.length;
}
