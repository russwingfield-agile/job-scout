import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobs } from '../schema.js';

export type JobRow = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export function jobsRepo(db: Db) {
  return {
    /** INSERT OR IGNORE on (source, source_job_id). True when the row was newly inserted. */
    async insertIfNew(job: NewJob): Promise<boolean> {
      const inserted = await db
        .insert(jobs)
        .values(job)
        .onConflictDoNothing({ target: [jobs.source, jobs.sourceJobId] })
        .returning({ id: jobs.id });
      return inserted.length > 0;
    },

    async getById(id: string): Promise<JobRow | undefined> {
      return db.select().from(jobs).where(eq(jobs.id, id)).get();
    },

    async getBySource(source: string, sourceJobId: string): Promise<JobRow | undefined> {
      return db
        .select()
        .from(jobs)
        .where(and(eq(jobs.source, source), eq(jobs.sourceJobId, sourceJobId)))
        .get();
    },

    async listByGroup(groupId: string): Promise<JobRow[]> {
      return db.select().from(jobs).where(eq(jobs.groupId, groupId));
    },
  };
}
