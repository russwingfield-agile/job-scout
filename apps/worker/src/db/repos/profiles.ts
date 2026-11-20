import type { SearchProfile, UpdateSearchProfile } from '@job-scout/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { searchProfiles } from '../schema.js';

type ProfileRow = typeof searchProfiles.$inferSelect;

const toProfile = (r: ProfileRow): SearchProfile => ({
  id: r.id,
  cvId: r.cvId,
  jobTitles: r.jobTitlesJson,
  mustKeywords: r.mustKeywordsJson ?? [],
  excludeKeywords: r.excludeKeywordsJson ?? [],
  locations: r.locationsJson,
  radiusMiles: r.radiusMiles ?? 25,
  employmentTypes: r.employmentTypesJson,
  minDayRate: r.minDayRate,
  minSalary: r.minSalary,
  ir35Preference: r.ir35Preference ?? 'any',
  workModes: r.workModesJson ?? [],
  maxOnsiteDays: r.maxOnsiteDays,
  active: r.active,
  updatedAt: r.updatedAt,
});

const toColumns = (p: UpdateSearchProfile, updatedAt: string) => ({
  jobTitlesJson: p.jobTitles,
  mustKeywordsJson: p.mustKeywords,
  excludeKeywordsJson: p.excludeKeywords,
  locationsJson: p.locations,
  radiusMiles: p.radiusMiles,
  employmentTypesJson: p.employmentTypes,
  minDayRate: p.minDayRate,
  minSalary: p.minSalary,
  ir35Preference: p.ir35Preference,
  workModesJson: p.workModes,
  maxOnsiteDays: p.maxOnsiteDays,
  active: p.active,
  updatedAt,
});

export function profilesRepo(db: Db) {
  return {
    async insert(id: string, cvId: string, profile: UpdateSearchProfile, now: string) {
      await db.insert(searchProfiles).values({ id, cvId, ...toColumns(profile, now) });
    },

    async getById(id: string): Promise<SearchProfile | undefined> {
      const row = await db.select().from(searchProfiles).where(eq(searchProfiles.id, id)).get();
      return row ? toProfile(row) : undefined;
    },

    async getByCvId(cvId: string): Promise<SearchProfile | undefined> {
      const row = await db.select().from(searchProfiles).where(eq(searchProfiles.cvId, cvId)).get();
      return row ? toProfile(row) : undefined;
    },

    async list(): Promise<SearchProfile[]> {
      const rows = await db.select().from(searchProfiles);
      return rows.map(toProfile);
    },

    async deleteByCvId(cvId: string): Promise<void> {
      await db.delete(searchProfiles).where(eq(searchProfiles.cvId, cvId));
    },

    async listActive(): Promise<SearchProfile[]> {
      const rows = await db.select().from(searchProfiles).where(eq(searchProfiles.active, true));
      return rows.map(toProfile);
    },

    async update(id: string, profile: UpdateSearchProfile, now: string): Promise<void> {
      await db.update(searchProfiles).set(toColumns(profile, now)).where(eq(searchProfiles.id, id));
    },
  };
}
