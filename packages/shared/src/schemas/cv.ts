import { z } from 'zod';

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
