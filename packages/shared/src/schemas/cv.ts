import { z } from 'zod';
import { SearchProfileSchema } from './profile.js';

/** LLM-generated CV summary stored in `cvs.summary_json` (IMPLEMENTATION_PLAN M4). */
export const CvSummarySchema = z.object({
  headline: z.string(),
  seniority: z.string(),
  yearsExperience: z.number().min(0),
  skills: z.array(z.string()),
  sectors: z.array(z.string()),
  suggestedTitles: z.array(z.string()),
  suggestedKeywords: z.array(z.string()),
});
export type CvSummary = z.infer<typeof CvSummarySchema>;

export const CvSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  r2Key: z.string(),
  filename: z.string().nullable(),
  textMd: z.string(),
  summary: CvSummarySchema.nullable(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Cv = z.infer<typeof CvSchema>;

/** GET /api/cvs rows: no CV text and no storage key. */
export const CvListItemSchema = CvSchema.omit({ textMd: true, r2Key: true }).extend({
  profileId: z.string().nullable(),
});
export type CvListItem = z.infer<typeof CvListItemSchema>;

/** One CV with its extracted text and search profile. */
export const CvDetailSchema = CvSchema.omit({ r2Key: true }).extend({
  profile: SearchProfileSchema.nullable(),
});
export type CvDetail = z.infer<typeof CvDetailSchema>;

/**
 * Result of creating, editing or re-analysing a CV. `warnings` lists steps that failed without
 * losing the CV (no text extracted, summary or embedding failed); "Re-analyse" retries them.
 */
export const CvMutationResponseSchema = z.object({
  cv: CvDetailSchema,
  warnings: z.array(z.string()),
});
export type CvMutationResponse = z.infer<typeof CvMutationResponseSchema>;

export const UpdateCvRequestSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  textMd: z.string().max(200_000).optional(),
  active: z.boolean().optional(),
});
export type UpdateCvRequest = z.infer<typeof UpdateCvRequestSchema>;

export const CvListResponseSchema = z.array(CvListItemSchema);
