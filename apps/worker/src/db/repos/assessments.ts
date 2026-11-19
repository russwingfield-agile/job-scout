import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { assessments } from '../schema.js';

export type AssessmentRow = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;

export function assessmentsRepo(db: Db) {
  return {
    /** One assessment per group; rescoring replaces it. */
    async upsert(a: NewAssessment): Promise<void> {
      const { groupId, ...rest } = a;
      await db
        .insert(assessments)
        .values(a)
        .onConflictDoUpdate({ target: assessments.groupId, set: rest });
    },

    async getByGroup(groupId: string): Promise<AssessmentRow | undefined> {
      return db.select().from(assessments).where(eq(assessments.groupId, groupId)).get();
    },
  };
}
