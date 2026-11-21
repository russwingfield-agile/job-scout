import { and, count, eq, gte } from 'drizzle-orm';
import type { Db } from '../client.js';
import { sourceCalls } from '../schema.js';

export type NewSourceCall = typeof sourceCalls.$inferInsert;

export function sourceCallsRepo(db: Db) {
  return {
    async insert(call: NewSourceCall): Promise<void> {
      await db.insert(sourceCalls).values(call);
    },

    /** Upstream requests made so far by one run (for the per-run cap), optionally for one source. */
    async countByRun(runId: string, source?: string): Promise<number> {
      const row = await db
        .select({ n: count() })
        .from(sourceCalls)
        .where(
          source === undefined
            ? eq(sourceCalls.runId, runId)
            : and(eq(sourceCalls.runId, runId), eq(sourceCalls.source, source)),
        )
        .get();
      return row?.n ?? 0;
    },

    /** Requests made to one source since `since` (an ISO time), for its daily budget. */
    async countBySourceSince(source: string, since: string): Promise<number> {
      const row = await db
        .select({ n: count() })
        .from(sourceCalls)
        .where(and(eq(sourceCalls.source, source), gte(sourceCalls.createdAt, since)))
        .get();
      return row?.n ?? 0;
    },
  };
}
