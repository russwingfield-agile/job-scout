import type { RunPhase } from '@job-scout/shared';
import { and, desc, eq, getTableColumns, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { processedMessages, runErrors, runs } from '../schema.js';

export type RunRow = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunErrorRow = typeof runErrors.$inferSelect;

export type RunCounter = 'ingest' | 'score';
export type CountKey =
  | 'fetched'
  | 'new'
  | 'filtered'
  | 'dupes'
  | 'prefiltered'
  | 'llmScored'
  | 'inboxAdded';

export type ClaimResult = { applied: boolean; pending: number | null };

/** D1 batches are transactional; keep each below a safe statement count. */
const CLAIMS_PER_BATCH = 20;

export function runsRepo(db: Db) {
  /**
   * The two statements of a claim, run as one transaction: adjust the run's pending counter unless
   * `key` was already claimed, then record the key. Because the key is recorded in the same batch,
   * a message (or an enqueue) can only ever move the counter once, however often it is redelivered.
   */
  const claimStatements = (
    runId: string,
    key: string,
    counter: RunCounter,
    delta: number,
    now: string,
  ) => {
    const column = counter === 'ingest' ? runs.pendingIngest : runs.pendingScore;
    const adjust = db
      .update(runs)
      .set(
        counter === 'ingest'
          ? { pendingIngest: sql`${column} + ${delta}` }
          : { pendingScore: sql`${column} + ${delta}` },
      )
      .where(
        and(
          eq(runs.id, runId),
          sql`NOT EXISTS (SELECT 1 FROM processed_messages WHERE key = ${key})`,
        ),
      )
      .returning({ ingest: runs.pendingIngest, score: runs.pendingScore });
    const mark = db.insert(processedMessages).values({ key, createdAt: now }).onConflictDoNothing();
    return [adjust, mark] as const;
  };

  return {
    /** Returns false when `slot_key` already exists (cron double-fire). */
    async insertIfNew(run: NewRun): Promise<boolean> {
      const inserted = await db
        .insert(runs)
        .values(run)
        .onConflictDoNothing()
        .returning({ id: runs.id });
      return inserted.length > 0;
    },

    async getById(id: string): Promise<RunRow | undefined> {
      return db.select().from(runs).where(eq(runs.id, id)).get();
    },

    async getBySlotKey(slotKey: string): Promise<RunRow | undefined> {
      return db.select().from(runs).where(eq(runs.slotKey, slotKey)).get();
    },

    async listRecent(limit: number): Promise<RunRow[]> {
      return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
    },

    /** Recent runs with their Reed call and error counts (for the Runs page). */
    async listRecentWithStats(limit: number) {
      return db
        .select({
          run: getTableColumns(runs),
          // The outer table must be named explicitly: drizzle would print a bare "id", which inside the
          // subquery resolves to the subquery table's own id column and always yields 0.
          reedCalls: sql<number>`(SELECT count(*) FROM source_calls WHERE source_calls.run_id = runs.id)`,
          errorCount: sql<number>`(SELECT count(*) FROM run_errors WHERE run_errors.run_id = runs.id)`,
        })
        .from(runs)
        .orderBy(desc(runs.startedAt))
        .limit(limit);
    },

    /** Runs that are still working (a new manual run must wait for them). */
    async findActive(): Promise<RunRow | undefined> {
      return db
        .select()
        .from(runs)
        .where(and(eq(runs.status, 'running'), inArray(runs.phase, ['ingest', 'scoring'])))
        .get();
    },

    async listStale(startedBefore: string): Promise<RunRow[]> {
      return db
        .select()
        .from(runs)
        .where(and(eq(runs.status, 'running'), lt(runs.startedAt, startedBefore)));
    },

    /** Atomically move `from` → `to`; true for exactly one caller, however many race. */
    async claimPhase(runId: string, from: RunPhase, to: RunPhase): Promise<boolean> {
      const moved = await db
        .update(runs)
        .set({ phase: to })
        .where(and(eq(runs.id, runId), eq(runs.phase, from)))
        .returning({ id: runs.id });
      return moved.length > 0;
    },

    async finish(
      runId: string,
      outcome: { status: 'completed' | 'failed' | 'stale'; finishedAt: string },
    ): Promise<void> {
      await db
        .update(runs)
        .set({ status: outcome.status, phase: 'done', finishedAt: outcome.finishedAt })
        .where(eq(runs.id, runId));
    },

    /** Move a pending counter by `delta`, once per `key`. */
    async claim(
      runId: string,
      key: string,
      counter: RunCounter,
      delta: number,
      now: string,
    ): Promise<ClaimResult> {
      const [adjust, mark] = claimStatements(runId, key, counter, delta, now);
      const [adjusted] = await db.batch([adjust, mark]);
      const row = adjusted[0];
      return row
        ? { applied: true, pending: counter === 'ingest' ? row.ingest : row.score }
        : { applied: false, pending: null };
    },

    /** `claim(+1)` for many keys; returns the keys that were new (the ones to actually enqueue). */
    async claimMany(
      runId: string,
      keys: string[],
      counter: RunCounter,
      now: string,
    ): Promise<Set<string>> {
      const applied = new Set<string>();
      for (let i = 0; i < keys.length; i += CLAIMS_PER_BATCH) {
        const batchKeys = keys.slice(i, i + CLAIMS_PER_BATCH);
        const statements = batchKeys.flatMap((key) => claimStatements(runId, key, counter, 1, now));
        const results = await db.batch(
          statements as unknown as [(typeof statements)[0], ...typeof statements],
        );
        for (const [index, key] of batchKeys.entries()) {
          if ((results[index * 2] as unknown[]).length > 0) applied.add(key);
        }
      }
      return applied;
    },

    /** Atomic `counts[key] += by` inside `counts_json` (concurrent handlers cannot lose updates). */
    async bumpCount(runId: string, key: CountKey, by: number): Promise<void> {
      if (by === 0) return;
      const path = `$.${key}`;
      await db.run(sql`
        UPDATE runs SET counts_json = json_set(
          coalesce(counts_json, '{}'),
          ${path},
          coalesce(json_extract(coalesce(counts_json, '{}'), ${path}), 0) + ${by}
        ) WHERE id = ${runId}`);
    },

    async addError(
      runId: string,
      error: { stage: string; ref: string; message: string },
      now: string,
    ): Promise<void> {
      await db.insert(runErrors).values({ runId, ...error, createdAt: now });
    },

    async listErrors(runId: string, limit: number): Promise<RunErrorRow[]> {
      return db
        .select()
        .from(runErrors)
        .where(eq(runErrors.runId, runId))
        .orderBy(desc(runErrors.id))
        .limit(limit);
    },
  };
}
