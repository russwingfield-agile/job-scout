import { isLastSlotOfDay } from '../core/schedule.js';
import { toIso } from '../lib/time.js';
import { cleanup } from './cleanup.js';
import type { PipelineDeps } from './startRun.js';

/**
 * Close a run. After the last scheduled run of the day, also apply retention. A failing clean-up
 * is logged and recorded against the run but never stops the run from finishing.
 */
export async function finaliseRun(deps: PipelineDeps, runId: string): Promise<void> {
  const { repos, clock, log } = deps;
  const run = await repos.runs.getById(runId);
  const { schedule } = await deps.settings.get();

  if (run?.slotKey && isLastSlotOfDay(run.slotKey, clock.now(), schedule)) {
    try {
      const removed = await cleanup(deps);
      log.info({ stage: 'cleanup', runId, msg: 'retention applied', removed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ stage: 'cleanup', runId, msg: 'retention failed', error: message });
      await repos.runs.addError(
        runId,
        { stage: 'cleanup', ref: runId, message },
        toIso(clock.now()),
      );
    }
  }

  await repos.runs.finish(runId, { status: 'completed', finishedAt: toIso(clock.now()) });
}
