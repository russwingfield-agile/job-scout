import type { Cv } from '@job-scout/shared';
import { count, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { cvs } from '../schema.js';

type CvRow = typeof cvs.$inferSelect;
export type NewCv = typeof cvs.$inferInsert;

const toCv = (r: CvRow): Cv => ({
  id: r.id,
  label: r.label,
  r2Key: r.r2Key,
  filename: r.filename,
  textMd: r.textMd,
  summary: r.summaryJson ?? null,
  active: r.active,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export function cvsRepo(db: Db) {
  return {
    async insert(cv: NewCv): Promise<void> {
      await db.insert(cvs).values(cv);
    },

    async getById(id: string): Promise<Cv | undefined> {
      const row = await db.select().from(cvs).where(eq(cvs.id, id)).get();
      return row ? toCv(row) : undefined;
    },

    async list(): Promise<Cv[]> {
      const rows = await db.select().from(cvs).orderBy(desc(cvs.createdAt));
      return rows.map(toCv);
    },

    async countActive(): Promise<number> {
      const row = await db.select({ n: count() }).from(cvs).where(eq(cvs.active, true)).get();
      return row?.n ?? 0;
    },

    async update(id: string, patch: Partial<Omit<NewCv, 'id'>>): Promise<void> {
      await db.update(cvs).set(patch).where(eq(cvs.id, id));
    },

    /** Cascades to the CV's search profile. */
    async delete(id: string): Promise<void> {
      await db.delete(cvs).where(eq(cvs.id, id));
    },
  };
}
