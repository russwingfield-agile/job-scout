import type { GroupStatus } from '@job-scout/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobGroups } from '../schema.js';

export type GroupRow = typeof jobGroups.$inferSelect;
export type NewGroup = typeof jobGroups.$inferInsert;

export function groupsRepo(db: Db) {
  return {
    async insert(group: NewGroup): Promise<void> {
      await db.insert(jobGroups).values(group);
    },

    async getById(id: string): Promise<GroupRow | undefined> {
      return db.select().from(jobGroups).where(eq(jobGroups.id, id)).get();
    },

    async setStatus(id: string, status: GroupStatus): Promise<void> {
      await db.update(jobGroups).set({ status }).where(eq(jobGroups.id, id));
    },
  };
}
