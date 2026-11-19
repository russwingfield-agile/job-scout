import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { applications } from '../schema.js';

export type ApplicationRow = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

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
  };
}
