import type { CoverNote } from '@job-scout/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { coverNotes } from '../schema.js';

type Row = typeof coverNotes.$inferSelect;
export type NewCoverNote = typeof coverNotes.$inferInsert;

const toNote = (r: Row): CoverNote => ({
  id: r.id,
  groupId: r.groupId ?? '',
  cvId: r.cvId,
  kind: r.kind ?? 'cover_note',
  tone: r.tone ?? 'concise',
  text: r.text ?? '',
  createdAt: r.createdAt ?? '',
});

export function coverNotesRepo(db: Db) {
  return {
    async insert(note: NewCoverNote): Promise<void> {
      await db.insert(coverNotes).values(note);
    },

    /** Newest first: regenerating keeps the earlier drafts. */
    async listByGroup(groupId: string): Promise<CoverNote[]> {
      const rows = await db
        .select()
        .from(coverNotes)
        .where(eq(coverNotes.groupId, groupId))
        .orderBy(desc(coverNotes.createdAt), desc(sql`rowid`));
      return rows.map(toNote);
    },
  };
}
