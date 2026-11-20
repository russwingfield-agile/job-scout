import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { vectors } from '../schema.js';

export type VectorRow = typeof vectors.$inferSelect;
export type NewVector = typeof vectors.$inferInsert;

/** D1 allows 100 bound parameters per statement; stay well under it per chunk. */
const UPSERT_CHUNK = 10; // 6 columns each
const IN_CHUNK = 50;

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export function vectorsRepo(db: Db) {
  return {
    async upsertMany(rows: NewVector[]): Promise<void> {
      for (const batch of chunks(rows, UPSERT_CHUNK)) {
        await db
          .insert(vectors)
          .values(batch)
          .onConflictDoUpdate({
            target: vectors.id,
            set: {
              kind: sql`excluded.kind`,
              postedTs: sql`excluded.posted_ts`,
              groupId: sql`excluded.group_id`,
              embedding: sql`excluded.embedding`,
              createdAt: sql`excluded.created_at`,
            },
          });
      }
    },

    async getByIds(ids: string[]): Promise<VectorRow[]> {
      const found: VectorRow[] = [];
      for (const batch of chunks(ids, IN_CHUNK)) {
        found.push(...(await db.select().from(vectors).where(inArray(vectors.id, batch))));
      }
      return found;
    },

    async deleteByIds(ids: string[]): Promise<void> {
      for (const batch of chunks(ids, IN_CHUNK)) {
        await db.delete(vectors).where(inArray(vectors.id, batch));
      }
    },

    /** Every vector matching the filter (the caller ranks them). */
    async listCandidates(filter: {
      kind?: 'job' | 'cv' | undefined;
      postedTsGte?: number | undefined;
    }): Promise<VectorRow[]> {
      const conditions = [
        ...(filter.kind === undefined ? [] : [eq(vectors.kind, filter.kind)]),
        ...(filter.postedTsGte === undefined ? [] : [gte(vectors.postedTs, filter.postedTsGte)]),
      ];
      return db
        .select()
        .from(vectors)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    },
  };
}
