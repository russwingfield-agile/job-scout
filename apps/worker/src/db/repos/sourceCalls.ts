import { count, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { sourceCalls } from '../schema.js';

export type NewSourceCall = typeof sourceCalls.$inferInsert;

export function sourceCallsRepo(db: Db) {
  return {
    async insert(call: NewSourceCall): Promise<void> {
      await db.insert(sourceCalls).values(call);
    },

    /** Upstream requests made so far by one run (for the per-run cap). */
    async countByRun(runId: string): Promise<number> {
      const row = await db
        .select({ n: count() })
        .from(sourceCalls)
        .where(eq(sourceCalls.runId, runId))
        .get();
      return row?.n ?? 0;
    },
  };
}
