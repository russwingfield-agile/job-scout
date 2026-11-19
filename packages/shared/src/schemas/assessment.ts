import { z } from 'zod';
import {
  ApplyRecommendationSchema,
  ClearanceSchema,
  EmploymentTypeSchema,
  Ir35Schema,
  PayPeriodSchema,
  SeniorityMatchSchema,
  WorkModeSchema,
} from './enums.js';

const score = z.number().min(0).max(100);

/** Extracted fields the LLM returns alongside the score (SPEC §7.3). */
export const AssessmentExtractedSchema = z.object({
  employment_type: EmploymentTypeSchema,
  pay_min: z.number().nullable(),
  pay_max: z.number().nullable(),
  pay_period: PayPeriodSchema,
  ir35: Ir35Schema,
  contract_length_months: z.number().nullable(),
  start: z.string().nullable(),
  work_mode: WorkModeSchema,
  onsite_days_per_week: z.number().nullable(),
  location: z.string().nullable(),
  clearance: ClearanceSchema,
  hiring_company: z.string().nullable(),
  agency: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  reference: z.string().nullable(),
  closing_date: z.string().nullable(),
});
export type AssessmentExtracted = z.infer<typeof AssessmentExtractedSchema>;

/** Validated LLM output for one job group (SPEC §7.3). */
export const AssessmentResultSchema = z.object({
  fit_score: score,
  best_cv_id: z.string(),
  cv_scores: z.array(z.object({ cv_id: z.string(), score })),
  headline: z.string().max(140),
  strengths: z.array(z.string()).max(5),
  gaps: z.array(z.string()).max(5),
  red_flags: z.array(z.string()),
  seniority_match: SeniorityMatchSchema,
  extracted: AssessmentExtractedSchema,
  apply_recommendation: ApplyRecommendationSchema,
  confidence: z.number().min(0).max(1),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;
