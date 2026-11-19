import type { Db } from '../client.js';
import { settings } from '../schema.js';

export function settingsRepo(db: Db) {
  return {
    /** Stored per-section overrides, keyed by section name. */
    async getAll(): Promise<Record<string, unknown>> {
      const rows = await db.select().from(settings);
      return Object.fromEntries(rows.map((r) => [r.key, r.valueJson]));
    },

    async put(key: string, value: unknown, now: string): Promise<void> {
      await db
        .insert(settings)
        .values({ key, valueJson: value, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson: value, updatedAt: now } });
    },
  };
}
