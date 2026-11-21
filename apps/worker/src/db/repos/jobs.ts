import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
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

    /**
     * Passing, grouped postings from the last while: the pool a new posting is compared with.
     * Only the fields needed to compare; capped so one query stays small.
     */
    async listDedupeCandidates(postedAfter: string, excludeId: string, limit: number) {
      return db
        .select({
          id: jobs.id,
          groupId: jobs.groupId,
          source: jobs.source,
          employerName: jobs.employerName,
          title: jobs.title,
          location: jobs.location,
          annualisedMin: jobs.annualisedMin,
          annualisedMax: jobs.annualisedMax,
        })
        .from(jobs)
        .where(
          and(
            isNotNull(jobs.groupId),
            isNull(jobs.filterReason),
            ne(jobs.id, excludeId),
            gte(jobs.postedAt, postedAfter),
          ),
        )
        .orderBy(desc(jobs.postedAt))
        .limit(limit);
    },

    /** Delete jobs that never joined a group (seen-only, too old, gone), with their hits. Returns their ids. */
    async deleteUngrouped(): Promise<string[]> {
      const rows = await db.select({ id: jobs.id }).from(jobs).where(isNull(jobs.groupId));
      const ids = rows.map((r) => r.id);
      for (const batch of chunks(ids, IN_CHUNK)) {
        await db.delete(jobProfileHits).where(inArray(jobProfileHits.jobId, batch));
        await db.delete(jobs).where(inArray(jobs.id, batch));
      }
      return ids;
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

    /** Ids of every stored posting (used when deleting all data). */
    async listAllIds(): Promise<string[]> {
      return (await db.select({ id: jobs.id }).from(jobs)).map((r) => r.id);
    },

    /** Every posting in the given groups. */
    async listByGroups(groupIds: string[]): Promise<JobRow[]> {
      const rows: JobRow[] = [];
      for (const batch of chunks(groupIds, IN_CHUNK)) {
        rows.push(...(await db.select().from(jobs).where(inArray(jobs.groupId, batch))));
      }
      return rows;
    },

    async listByGroup(groupId: string): Promise<JobRow[]> {
      return db.select().from(jobs).where(eq(jobs.groupId, groupId));
    },

    async update(id: string, patch: JobPatch): Promise<void> {
      await db.update(jobs).set(patch).where(eq(jobs.id, id));
    },

    /**
     * Record that these profiles' searches found the job (all of them, not just the first).
     * `scoped` says whether the search was restricted to one of the profile's places. If a job is
     * found by both kinds of search it counts as scoped: a scoped hit is never downgraded.
     */
    async addProfileHits(
      jobIds: string[],
      profileIds: string[],
      runId: string,
      scoped: boolean,
    ): Promise<void> {
      const rows = jobIds.flatMap((jobId) =>
        profileIds.map((profileId) => ({ jobId, profileId, runId, scoped })),
      );
      for (const batch of chunks(rows, 25)) {
        await db
          .insert(jobProfileHits)
          .values(batch)
          .onConflictDoUpdate({
            target: [jobProfileHits.jobId, jobProfileHits.profileId],
            set: { scoped: sql`max(${jobProfileHits.scoped}, excluded.scoped)` },
          });
      }
    },

    /** Which profiles found the job, and whether each did so through a place-restricted search. */
    async profileHitsFor(jobId: string): Promise<{ profileId: string; scoped: boolean }[]> {
      return db
        .select({ profileId: jobProfileHits.profileId, scoped: jobProfileHits.scoped })
        .from(jobProfileHits)
        .where(eq(jobProfileHits.jobId, jobId));
    },
  };
}
