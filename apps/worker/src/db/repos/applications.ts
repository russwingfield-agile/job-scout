import type { GroupStatus } from '@job-scout/shared';
import { and, count, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { applications, jobGroups, jobs, statusHistory } from '../schema.js';

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

    /** Jobs from this employer you skipped as agency spam. */
    async countAgencySpamSkips(employerName: string): Promise<number> {
      const row = await db
        .select({ n: count() })
        .from(applications)
        .innerJoin(jobGroups, eq(jobGroups.id, applications.groupId))
        .innerJoin(jobs, eq(jobs.id, jobGroups.canonicalJobId))
        .where(and(eq(applications.skipReason, 'agency_spam'), eq(jobs.employerName, employerName)))
        .get();
      return row?.n ?? 0;
    },

    /** Have you applied to a job from this employer? */
    async hasAppliedTo(employerName: string): Promise<boolean> {
      const row = await db
        .select({ n: count() })
        .from(applications)
        .innerJoin(jobGroups, eq(jobGroups.id, applications.groupId))
        .innerJoin(jobs, eq(jobs.id, jobGroups.canonicalJobId))
        .where(and(isNotNull(applications.appliedAt), eq(jobs.employerName, employerName)))
        .get();
      return (row?.n ?? 0) > 0;
    },

    /**
     * Posting ids of the jobs you most recently acted on in a way that says "more like this"
     * (applied or shortlisted) or "less like this" (skipped as not your skills).
     */
    async recentJobIds(kind: 'wanted' | 'unwanted', limit: number): Promise<string[]> {
      const where =
        kind === 'wanted'
          ? inArray(jobGroups.status, ['shortlisted', 'applied', 'interview', 'offer'])
          : eq(applications.skipReason, 'not_my_skills');
      const rows = await db
        .select({ id: jobGroups.canonicalJobId })
        .from(applications)
        .innerJoin(jobGroups, eq(jobGroups.id, applications.groupId))
        .where(where)
        .orderBy(desc(applications.updatedAt))
        .limit(limit);
      return rows.flatMap((r) => (r.id === null ? [] : [r.id]));
    },

    /** Jobs skipped since `since`, with the pay they offered and which CV matched them best. */
    async listSkipsSince(since: string) {
      return db
        .select({
          reason: applications.skipReason,
          bestCvId: jobGroups.bestCvId,
          payMin: jobs.payMin,
          payMax: jobs.payMax,
          payPeriod: jobs.payPeriod,
          annualisedMax: jobs.annualisedMax,
        })
        .from(applications)
        .innerJoin(jobGroups, eq(jobGroups.id, applications.groupId))
        .innerJoin(jobs, eq(jobs.id, jobGroups.canonicalJobId))
        .where(
          and(
            eq(jobGroups.status, 'skipped'),
            isNotNull(applications.skipReason),
            gte(applications.updatedAt, since),
          ),
        );
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
