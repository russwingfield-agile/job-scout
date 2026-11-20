import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobProfileHits, jobs } from '../schema.js';

export type JobRow = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobPatch = Partial<Omit<NewJob, 'id'>>;

/** Keep each statement under D1's 100 bound-parameter limit. */
const INSERT_CHUNK = 8;
const IN_CHUNK = 50;

export type KnownJob = { id: string; stage: JobRow['stage']; postedAt: string | null };

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

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

    /** Insert search hits that are not yet known; existing rows are left untouched. */
    async insertRefsIfNew(rows: NewJob[]): Promise<void> {
      for (const batch of chunks(rows, INSERT_CHUNK)) {
        await db
          .insert(jobs)
          .values(batch)
          .onConflictDoNothing({ target: [jobs.source, jobs.sourceJobId] });
      }
    },

    /** id, stage and posting time of each already-known (source, sourceJobId), keyed by sourceJobId. */
    async findBySourceIds(source: string, sourceJobIds: string[]): Promise<Map<string, KnownJob>> {
      const found = new Map<string, KnownJob>();
      for (const batch of chunks(sourceJobIds, IN_CHUNK)) {
        const rows = await db
          .select({
            id: jobs.id,
            sourceJobId: jobs.sourceJobId,
            stage: jobs.stage,
            postedAt: jobs.postedAt,
          })
          .from(jobs)
          .where(and(eq(jobs.source, source), inArray(jobs.sourceJobId, batch)));
        for (const r of rows) {
          found.set(r.sourceJobId, { id: r.id, stage: r.stage, postedAt: r.postedAt });
        }
      }
      return found;
    },

    /** Seen-but-unprocessed jobs posted within the window, newest first (a later run finishes them). */
    async listBacklog(limit: number, postedAfter: string): Promise<{ id: string }[]> {
      return db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(eq(jobs.stage, 'ref'), or(isNull(jobs.postedAt), gte(jobs.postedAt, postedAfter))),
        )
        .orderBy(desc(jobs.postedAt))
        .limit(limit);
    },

    /** Close out jobs we will not process (e.g. too old), recording why. */
    async markSkipped(ids: string[], reason: string): Promise<void> {
      for (const batch of chunks(ids, IN_CHUNK)) {
        await db
          .update(jobs)
          .set({ stage: 'processed', filterReason: reason })
          .where(inArray(jobs.id, batch));
      }
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

    async update(id: string, patch: JobPatch): Promise<void> {
      await db.update(jobs).set(patch).where(eq(jobs.id, id));
    },

    /** Record that these profiles' searches found the job (all of them, not just the first). */
    async addProfileHits(jobIds: string[], profileIds: string[], runId: string): Promise<void> {
      const rows = jobIds.flatMap((jobId) =>
        profileIds.map((profileId) => ({ jobId, profileId, runId })),
      );
      for (const batch of chunks(rows, 30)) {
        await db.insert(jobProfileHits).values(batch).onConflictDoNothing();
      }
    },

    async profileIdsFor(jobId: string): Promise<string[]> {
      const rows = await db
        .select({ profileId: jobProfileHits.profileId })
        .from(jobProfileHits)
        .where(eq(jobProfileHits.jobId, jobId));
      return rows.map((r) => r.profileId);
    },
  };
}
