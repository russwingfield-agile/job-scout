import { toIso } from '../lib/time.js';
import { finaliseRun } from './finaliseRun.js';
import { enqueueScoreKey, type PipelineMessage } from './messages.js';
import type { PipelineDeps } from './startRun.js';

/**
 * Stage D (SPEC §5.2): choose which groups the LLM will assess in this run.
 * - groups deferred earlier (budget ran out) go first;
 * - then first-pass candidates, best score first, up to `maxLlmPerRun` in all;
 * - candidates below `prefilterMin` become `below_threshold`; those above it that did not fit
 *   stay `prefiltered`, so a later run can pick them up.
 * Nothing selected → the run finishes.
 */
export async function selectForScoring(deps: PipelineDeps, runId: string): Promise<void> {
  const { repos, clock, bus, log } = deps;
  const { budgets, thresholds } = await deps.settings.get();

  const waiting = await repos.groups.listByStatus(['deferred', 'prefiltered']);
  const deferred = waiting.filter((g) => g.status === 'deferred');
  const fresh = waiting.filter((g) => g.status === 'prefiltered');
  const belowThreshold = fresh.filter((g) => (g.prefilterScore ?? 0) < thresholds.prefilterMin);
  const candidates = fresh
    .filter((g) => (g.prefilterScore ?? 0) >= thresholds.prefilterMin)
    .sort((a, b) => (b.prefilterScore ?? 0) - (a.prefilterScore ?? 0));

  await repos.groups.setStatusMany(
    belowThreshold.map((g) => g.id),
    'below_threshold',
  );

  const chosen = [...deferred, ...candidates].slice(0, budgets.maxLlmPerRun);
  if (chosen.length === 0) {
    await finaliseRun(deps, runId);
    return;
  }

  const now = toIso(clock.now());
  const claimed = await repos.runs.claimMany(
    runId,
    chosen.map((g) => enqueueScoreKey(runId, g.id)),
    'score',
    now,
  );
  const toScore = chosen.filter((g) => claimed.has(enqueueScoreKey(runId, g.id)));
  await repos.groups.setStatusMany(
    toScore.map((g) => g.id),
    'pending_llm',
  );
  const messages: PipelineMessage[] = toScore.map((g) => ({
    v: 1,
    type: 'score',
    runId,
    groupId: g.id,
  }));
  await bus.sendBatch(messages);
  log.info({ stage: 'select', runId, msg: 'groups queued for assessment', count: messages.length });
}
