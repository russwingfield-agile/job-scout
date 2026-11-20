import type { Repos } from '../db/repos/index.js';
import { dayKey, toIso } from '../lib/time.js';
import type { Clock } from '../ports/clock.js';
import type { SourceCallRecorder } from '../ports/sourceCalls.js';

/** Persists each upstream request and counts Reed calls against today's budget. */
export function createSourceCallRecorder(deps: { repos: Repos; clock: Clock }): SourceCallRecorder {
  return {
    async record(call) {
      const now = deps.clock.now();
      await deps.repos.sourceCalls.insert({
        runId: call.runId ?? null,
        source: call.source,
        endpoint: call.endpoint,
        status: call.status,
        ms: call.ms,
        createdAt: toIso(now),
      });
      if (call.source === 'reed') await deps.repos.usage.increment(dayKey(now), 'reedCalls', 1);
    },
  };
}
