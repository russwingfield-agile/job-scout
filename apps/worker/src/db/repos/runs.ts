import { desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { runs } from '../schema.js';

export type RunRow = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export function runsRepo(db: Db) {
  return {
    /** Returns false when `slot_key` already exists (cron double-fire). */
    async insertIfNew(run: NewRun): Promise<boolean> {
      const inserted = await db
        .insert(runs)
        .values(run)
        .onConflictDoNothing()
        .returning({ id: runs.id });
      return inserted.length > 0;
    },

    async getById(id: string): Promise<RunRow | undefined> {
      return db.select().from(runs).where(eq(runs.id, id)).get();
    },

    async getBySlotKey(slotKey: string): Promise<RunRow | undefined> {
      return db.select().from(runs).where(eq(runs.slotKey, slotKey)).get();
    },

    async listRecent(limit: number): Promise<RunRow[]> {
      return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
    },
  };
}
