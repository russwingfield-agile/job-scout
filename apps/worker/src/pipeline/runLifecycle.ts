import { toIso } from '../lib/time.js';
import { selectForScoring } from './selectForScoring.js';
import type { PipelineDeps } from './startRun.js';

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
