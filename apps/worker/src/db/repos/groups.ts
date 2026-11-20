import type { GroupStatus } from '@job-scout/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobCvSimilarity, jobGroups } from '../schema.js';

export type GroupRow = typeof jobGroups.$inferSelect;
export type NewGroup = typeof jobGroups.$inferInsert;
export type GroupPatch = Partial<Omit<NewGroup, 'id'>>;

export function groupsRepo(db: Db) {
  return {
    async insert(group: NewGroup): Promise<void> {
      await db.insert(jobGroups).values(group);
    },

    async getById(id: string): Promise<GroupRow | undefined> {
      return db.select().from(jobGroups).where(eq(jobGroups.id, id)).get();
    },

    async update(id: string, patch: GroupPatch): Promise<void> {
      await db.update(jobGroups).set(patch).where(eq(jobGroups.id, id));
    },

    async setStatus(id: string, status: GroupStatus): Promise<void> {
      await db.update(jobGroups).set({ status }).where(eq(jobGroups.id, id));
    },

    async listByStatus(statuses: GroupStatus[]): Promise<GroupRow[]> {
      return db.select().from(jobGroups).where(inArray(jobGroups.status, statuses));
    },

    /** Replace the similarity of a group to each given CV. */
    async saveSimilarities(
      groupId: string,
      rows: { cvId: string; similarity: number }[],
    ): Promise<void> {
      for (const row of rows) {
        await db
          .insert(jobCvSimilarity)
          .values({ groupId, cvId: row.cvId, similarity: row.similarity })
          .onConflictDoUpdate({
            target: [jobCvSimilarity.groupId, jobCvSimilarity.cvId],
            set: { similarity: row.similarity },
          });
      }
    },

    async similaritiesFor(groupId: string) {
      return db.select().from(jobCvSimilarity).where(eq(jobCvSimilarity.groupId, groupId));
    },
  };
}
