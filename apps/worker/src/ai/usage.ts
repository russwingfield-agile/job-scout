import { neuronRateFor } from '../config/neuronRates.js';
import { estimateNeurons } from '../core/neurons.js';
import type { Repos } from '../db/repos/index.js';
import { dayKey } from '../lib/time.js';
import type { Clock } from '../ports/clock.js';

/** Add one AI call to today's counters. Returns the neurons it was estimated to cost. */
export async function recordAiUsage(
  deps: { repos: Repos; clock: Clock },
  call: { kind: 'llm' | 'embed'; model: string; inTokens: number; outTokens: number },
): Promise<number> {
  const day = dayKey(deps.clock.now());
  const neurons = estimateNeurons(neuronRateFor(call.model), call.inTokens, call.outTokens);
  await deps.repos.usage.increment(day, call.kind === 'llm' ? 'llmCalls' : 'embedCalls', 1);
  await deps.repos.usage.increment(day, 'neuronsEst', neurons);
  return neurons;
}
