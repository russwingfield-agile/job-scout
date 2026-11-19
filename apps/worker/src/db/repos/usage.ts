import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { usageDaily } from '../schema.js';

export type UsageRow = typeof usageDaily.$inferSelect;
export type UsageCounter = 'reedCalls' | 'llmCalls' | 'embedCalls' | 'neuronsEst';

const COLUMN = {
  reedCalls: usageDaily.reedCalls,
  llmCalls: usageDaily.llmCalls,
  embedCalls: usageDaily.embedCalls,
  neuronsEst: usageDaily.neuronsEst,
} as const;

export function usageRepo(db: Db) {
  return {
    async get(day: string): Promise<UsageRow | undefined> {
      return db.select().from(usageDaily).where(eq(usageDaily.day, day)).get();
    },

    /** Atomic `counter = counter + by` upsert for the given UTC day. */
    async increment(day: string, counter: UsageCounter, by: number): Promise<void> {
      const col = COLUMN[counter];
      await db
        .insert(usageDaily)
        .values({ day, [counter]: by })
        .onConflictDoUpdate({ target: usageDaily.day, set: { [counter]: sql`${col} + ${by}` } });
    },
  };
}
