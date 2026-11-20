import type { GroupStatus } from '@job-scout/shared';
import { and, asc, count, desc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  applications,
  assessments,
  cvs,
  jobCvSimilarity,
  jobGroups,
  jobProfileHits,
  jobs,
  vectors,
} from '../schema.js';

export type GroupRow = typeof jobGroups.$inferSelect;
export type NewGroup = typeof jobGroups.$inferInsert;
export type GroupPatch = Partial<Omit<NewGroup, 'id'>>;

const IN_CHUNK = 50;

/** Optional narrowing of the job list (the Inbox filter bar). */
export type GroupFilters = {
  type?: 'contract' | 'permanent' | undefined;
  cvId?: string | undefined;
  minScore?: number | undefined;
  workMode?: 'remote' | 'hybrid' | 'onsite' | undefined;
  ir35?: 'inside' | 'outside' | undefined;
  /** Only jobs posted on or after this ISO time. */
  postedSince?: string | undefined;
};

function filterConditions(f: GroupFilters): SQL[] {
  const score = sql`coalesce(${jobGroups.finalScore}, ${jobGroups.prefilterScore})`;
  return [
    ...(f.type ? [eq(jobs.employmentType, f.type)] : []),
    ...(f.cvId ? [eq(jobGroups.bestCvId, f.cvId)] : []),
    ...(f.minScore !== undefined ? [sql`${score} >= ${f.minScore}`] : []),
    ...(f.workMode ? [eq(jobs.workMode, f.workMode)] : []),
    ...(f.ir35 ? [eq(jobs.ir35, f.ir35)] : []),
    ...(f.postedSince ? [gte(jobs.postedAt, f.postedSince)] : []),
  ];
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

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

    async setStatusMany(ids: string[], status: GroupStatus): Promise<void> {
      for (const batch of chunks(ids, IN_CHUNK)) {
        await db.update(jobGroups).set({ status }).where(inArray(jobGroups.id, batch));
      }
    },

    /**
     * Jobs to show, best first: by final score once assessed, otherwise by first-pass score, then
     * newest. Carries the advert, the best CV's label, the assessment and what you recorded.
     */
    async listWithJobs(statuses: GroupStatus[], limit: number, filters: GroupFilters = {}) {
      return db
        .select({
          group: jobGroups,
          job: jobs,
          bestCv: cvs.label,
          assessment: assessments,
          application: applications,
        })
        .from(jobGroups)
        .innerJoin(jobs, eq(jobs.id, jobGroups.canonicalJobId))
        .leftJoin(cvs, eq(cvs.id, jobGroups.bestCvId))
        .leftJoin(assessments, eq(assessments.groupId, jobGroups.id))
        .leftJoin(applications, eq(applications.groupId, jobGroups.id))
        .where(and(inArray(jobGroups.status, statuses), ...filterConditions(filters)))
        .orderBy(
          desc(sql`coalesce(${jobGroups.finalScore}, ${jobGroups.prefilterScore})`),
          desc(jobs.postedAt),
        )
        .limit(limit);
    },

    /** One group with its advert, best CV, assessment and application, whatever its status. */
    async getWithJob(id: string) {
      return db
        .select({
          group: jobGroups,
          job: jobs,
          bestCv: cvs.label,
          assessment: assessments,
          application: applications,
        })
        .from(jobGroups)
        .innerJoin(jobs, eq(jobs.id, jobGroups.canonicalJobId))
        .leftJoin(cvs, eq(cvs.id, jobGroups.bestCvId))
        .leftJoin(assessments, eq(assessments.groupId, jobGroups.id))
        .leftJoin(applications, eq(applications.groupId, jobGroups.id))
        .where(eq(jobGroups.id, id))
        .get();
    },

    async countByStatus(statuses: GroupStatus[], filters: GroupFilters = {}): Promise<number> {
      const row = await db
        .select({ n: count() })
        .from(jobGroups)
        .innerJoin(jobs, eq(jobs.id, jobGroups.canonicalJobId))
        .where(and(inArray(jobGroups.status, statuses), ...filterConditions(filters)))
        .get();
      return row?.n ?? 0;
    },

    /** Groups first seen since `since` that are waiting for your decision. */
    async countInboxSince(since: string): Promise<number> {
      const row = await db
        .select({ n: count() })
        .from(jobGroups)
        .where(and(eq(jobGroups.status, 'new'), gte(jobGroups.firstSeenAt, since)))
        .get();
      return row?.n ?? 0;
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
      return db
        .select()
        .from(jobCvSimilarity)
        .where(eq(jobCvSimilarity.groupId, groupId))
        .orderBy(desc(jobCvSimilarity.similarity), asc(jobCvSimilarity.cvId));
    },

    /** A posting joined this group: bump `last_seen_at`, and the "since you acted" count if actioned. */
    async notePosting(id: string, now: string, actioned: boolean): Promise<void> {
      await db
        .update(jobGroups)
        .set({
          lastSeenAt: now,
          ...(actioned
            ? { newPostingsSinceAction: sql`${jobGroups.newPostingsSinceAction} + 1` }
            : {}),
        })
        .where(eq(jobGroups.id, id));
    },

    /**
     * Fold `loser` into `winner` in one transaction: postings move over, the loser's scores,
     * assessment and vectors' group tags go, and the loser row is deleted.
     */
    async mergeInto(winnerId: string, loserId: string): Promise<void> {
      await db.batch([
        db.update(jobs).set({ groupId: winnerId }).where(eq(jobs.groupId, loserId)),
        db.update(vectors).set({ groupId: winnerId }).where(eq(vectors.groupId, loserId)),
        db.delete(jobCvSimilarity).where(eq(jobCvSimilarity.groupId, loserId)),
        db.delete(assessments).where(eq(assessments.groupId, loserId)),
        db.delete(jobGroups).where(eq(jobGroups.id, loserId)),
      ]);
    },

    /** Filtered groups first seen before `cutoff` (retention clean-up). */
    async listFilteredBefore(cutoff: string): Promise<string[]> {
      const rows = await db
        .select({ id: jobGroups.id })
        .from(jobGroups)
        .where(and(eq(jobGroups.status, 'filtered'), lt(jobGroups.firstSeenAt, cutoff)));
      return rows.map((r) => r.id);
    },

    /**
     * Remove groups and everything hanging off them: postings, hits, similarities and assessment.
     * Returns the job ids removed, so the caller can delete their vectors (`job:{id}`).
     */
    async deleteWithJobs(groupIds: string[]): Promise<string[]> {
      const jobIds: string[] = [];
      for (const batch of chunks(groupIds, IN_CHUNK)) {
        const rows = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(inArray(jobs.groupId, batch));
        const ids = rows.map((r) => r.id);
        jobIds.push(...ids);
        for (const part of chunks(ids, IN_CHUNK)) {
          await db.delete(jobProfileHits).where(inArray(jobProfileHits.jobId, part));
        }
        await db.delete(jobs).where(inArray(jobs.groupId, batch));
        await db.delete(jobCvSimilarity).where(inArray(jobCvSimilarity.groupId, batch));
        await db.delete(assessments).where(inArray(assessments.groupId, batch));
        await db.delete(jobGroups).where(inArray(jobGroups.id, batch));
      }
      return jobIds;
    },
  };
}
