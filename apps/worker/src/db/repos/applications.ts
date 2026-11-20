import type { GroupStatus } from '@job-scout/shared';
import { and, count, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { applications, statusHistory } from '../schema.js';

export type ApplicationRow = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

const IN_CHUNK = 50;

export function applicationsRepo(db: Db) {
  return {
    async upsert(a: NewApplication): Promise<void> {
      const { groupId, ...rest } = a;
      await db
        .insert(applications)
        .values(a)
        .onConflictDoUpdate({ target: applications.groupId, set: rest });
    },

    async getByGroup(groupId: string): Promise<ApplicationRow | undefined> {
      return db.select().from(applications).where(eq(applications.groupId, groupId)).get();
    },

    /** Applications for many groups at once, keyed by group id. */
    async listByGroups(groupIds: string[]): Promise<Map<string, ApplicationRow>> {
      const found = new Map<string, ApplicationRow>();
      for (let i = 0; i < groupIds.length; i += IN_CHUNK) {
        const rows = await db
          .select()
          .from(applications)
          .where(inArray(applications.groupId, groupIds.slice(i, i + IN_CHUNK)));
        for (const row of rows) found.set(row.groupId, row);
      }
      return found;
    },

    async addHistory(
      groupId: string,
      from: GroupStatus | null,
      to: GroupStatus,
      at: string,
    ): Promise<void> {
      await db.insert(statusHistory).values({ groupId, fromStatus: from, toStatus: to, at });
    },

    /** Newest first. */
    async historyFor(groupId: string) {
      return db
        .select()
        .from(statusHistory)
        .where(eq(statusHistory.groupId, groupId))
        .orderBy(desc(statusHistory.id));
    },

    /** How many times a job was moved to `to` since `since` (e.g. applications this week). */
    async countMovesSince(to: GroupStatus, since: string): Promise<number> {
      const row = await db
        .select({ n: count() })
        .from(statusHistory)
        .where(and(eq(statusHistory.toStatus, to), gte(statusHistory.at, since)))
        .get();
      return row?.n ?? 0;
    },
  };
}
