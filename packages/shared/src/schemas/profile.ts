import { z } from 'zod';
import { EmploymentTypeSchema, Ir35PreferenceSchema, WorkModeSchema } from './enums.js';

const tag = z.string().trim().min(1).max(100);

/** Editable search profile, one per CV (SPEC §6.2). */
export const SearchProfileInputSchema = z.object({
  cvId: z.string(),
  jobTitles: z.array(tag).min(1).max(20),
  mustKeywords: z.array(tag).max(30).default([]),
  excludeKeywords: z.array(tag).max(50).default([]),
  locations: z.array(tag).min(1).max(20),
  radiusMiles: z.number().int().min(0).max(200).default(25),
  employmentTypes: z.array(EmploymentTypeSchema).min(1),
  minDayRate: z.number().int().min(0).nullable().default(null),
  minSalary: z.number().int().min(0).nullable().default(null),
  ir35Preference: Ir35PreferenceSchema.default('any'),
  workModes: z.array(WorkModeSchema).default([]),
  maxOnsiteDays: z.number().int().min(0).max(5).nullable().default(null),
  active: z.boolean().default(true),
});
export type SearchProfileInput = z.input<typeof SearchProfileInputSchema>;

export const SearchProfileSchema = SearchProfileInputSchema.extend({
  id: z.string(),
  updatedAt: z.iso.datetime(),
});
export type SearchProfile = z.infer<typeof SearchProfileSchema>;

/** PUT /api/profiles/:id — the CV link is fixed after creation. */
export const UpdateSearchProfileSchema = SearchProfileInputSchema.omit({ cvId: true });
export type UpdateSearchProfile = z.infer<typeof UpdateSearchProfileSchema>;
