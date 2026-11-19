import { z } from 'zod';

export const EmploymentTypeSchema = z.enum(['contract', 'permanent', 'temp', 'unknown']);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

export const WorkModeSchema = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export type WorkMode = z.infer<typeof WorkModeSchema>;

export const Ir35Schema = z.enum(['inside', 'outside', 'unknown']);
export type Ir35 = z.infer<typeof Ir35Schema>;

export const PayPeriodSchema = z.enum(['day', 'hour', 'year', 'unknown']);
export type PayPeriod = z.infer<typeof PayPeriodSchema>;

export const Ir35PreferenceSchema = z.enum(['outside_only', 'prefer_outside', 'any']);
export type Ir35Preference = z.infer<typeof Ir35PreferenceSchema>;

export const GroupStatusSchema = z.enum([
  'filtered',
  'below_threshold',
  'pending_llm',
  'deferred',
  'prefiltered',
  'new',
  'shortlisted',
  'applied',
  'interview',
  'offer',
  'rejected',
  'skipped',
  'withdrawn',
]);
export type GroupStatus = z.infer<typeof GroupStatusSchema>;

export const SkipReasonSchema = z.enum([
  'rate_too_low',
  'location',
  'not_my_skills',
  'too_junior',
  'too_senior',
  'inside_ir35',
  'agency_spam',
  'already_applied_elsewhere',
  'other',
]);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const ClearanceSchema = z.enum(['none', 'BPSS', 'SC', 'DV', 'unknown']);
export type Clearance = z.infer<typeof ClearanceSchema>;

export const ApplyRecommendationSchema = z.enum(['strong_apply', 'apply', 'maybe', 'skip']);
export type ApplyRecommendation = z.infer<typeof ApplyRecommendationSchema>;

export const SeniorityMatchSchema = z.enum(['under', 'match', 'over']);
export type SeniorityMatch = z.infer<typeof SeniorityMatchSchema>;

export const RunTriggerSchema = z.enum(['cron', 'manual']);
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

export const RunStatusSchema = z.enum(['running', 'completed', 'failed', 'stale']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunPhaseSchema = z.enum(['ingest', 'scoring', 'done']);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const AssessmentStatusSchema = z.enum(['ok', 'failed']);
export type AssessmentStatus = z.infer<typeof AssessmentStatusSchema>;

export const CoverNoteKindSchema = z.enum(['cover_note', 'recruiter_message']);
export type CoverNoteKind = z.infer<typeof CoverNoteKindSchema>;

export const CoverNoteToneSchema = z.enum(['concise', 'warm', 'formal']);
export type CoverNoteTone = z.infer<typeof CoverNoteToneSchema>;
