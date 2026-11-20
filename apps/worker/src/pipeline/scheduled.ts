import { dueSlot } from '../core/schedule.js';
import { recoverStaleRuns } from './runLifecycle.js';
import { type PipelineDeps, startRun } from './startRun.js';

/**
 * The hourly cron tick: clean up stuck runs, then start a run if the local-time schedule says one
 * is due. Never throws, because a failing tick must not hide the next one.
 */
export async function runScheduled(deps: PipelineDeps): Promise<void> {
  try {
    const stale = await recoverStaleRuns(deps);
    if (stale > 0) deps.log.warn({ stage: 'scheduled', msg: 'marked stale runs', count: stale });

    const { schedule } = await deps.settings.get();
    const slot = dueSlot(deps.clock.now(), schedule);
    if (!slot) {
      deps.log.info({ stage: 'scheduled', msg: 'no slot due this hour' });
      return;
    }
    const started = await startRun(deps, { trigger: 'cron', slotKey: slot.slotKey });
    deps.log.info({
      stage: 'scheduled',
      msg: started ? 'run started' : 'slot already started',
      slotKey: slot.slotKey,
    });
  } catch (err) {
    deps.log.error({
      stage: 'scheduled',
      msg: 'scheduled tick failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
