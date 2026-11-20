import { z } from 'zod';
import { EmploymentTypeSchema } from './enums.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24h)');
const slots = z.array(hhmm).max(24);
const fraction = z.number().min(0).max(1);
const nonNegInt = z.number().int().min(0);
const posInt = z.number().int().min(1);

export const ScheduleSettingsSchema = z.object({
  timezone: z.string().min(1),
  'mon-fri': slots,
  sat: slots,
  sun: slots,
});

const WeightsBaseSchema = z.object({
  /** final = round(fit*w + sim*w + freshness*w) + feedback_adj  (SPEC §7.4) */
  finalFit: fraction,
  finalPrefilterSim: fraction,
  finalFreshness: fraction,
  /** cosine bounds mapped onto 0–100 (SPEC §7.2); calibrate with real data */
  simLow: fraction,
  simHigh: fraction,
  bonusTitleMatch: z.number().min(0).max(20),
  bonusPayDisclosed: z.number().min(0).max(20),
  bonusIr35Outside: z.number().min(0).max(20),
  /** freshness tiers: younger than N hours → score; older than all tiers → freshnessFloor */
  freshnessTiers: z
    .array(z.object({ maxHours: z.number().positive(), score: z.number().min(0).max(100) }))
    .min(1),
  freshnessFloor: z.number().min(0).max(100),
});

export const WeightsSettingsSchema = WeightsBaseSchema.refine(
  (w) => Math.abs(w.finalFit + w.finalPrefilterSim + w.finalFreshness - 1) <= 0.001,
  'Final-score weights must sum to 1',
).refine((w) => w.simLow < w.simHigh, 'simLow must be below simHigh');

const ThresholdsBaseSchema = z.object({
  prefilterMin: z.number().min(0).max(100),
  badgeStrong: z.number().min(0).max(100),
  badgeGood: z.number().min(0).max(100),
  badgeMaybe: z.number().min(0).max(100),
});

export const ThresholdsSettingsSchema = ThresholdsBaseSchema.refine(
  (t) => t.badgeStrong > t.badgeGood && t.badgeGood > t.badgeMaybe,
  'Badge thresholds must satisfy strong > good > maybe',
);

export const BudgetsSettingsSchema = z.object({
  maxLlmPerRun: nonNegInt,
  maxPagesPerQuery: posInt,
  reedDailyRequestBudget: nonNegInt,
  reedCallsPerRunCap: nonNegInt,
  aiDailyNeuronBudget: nonNegInt,
  /** switch to the fallback model once this fraction of the neuron budget is spent */
  fallbackModelAtFraction: fraction,
  staleRunMinutes: posInt,
});

export const ModelsSettingsSchema = z.object({
  embedding: z.string().min(1),
  embeddingDims: posInt,
  scoring: z.string().min(1),
  fallback: z.string().min(1),
  coverNote: z.string().min(1),
});

export const DedupeSettingsSchema = z.object({
  similarity: fraction,
  titleTokenSetRatio: fraction,
  payBandTolerance: fraction,
  lookbackDays: posInt,
  topK: posInt,
});

export const FeedbackSettingsSchema = z.object({
  agencySpamSkips: posInt,
  agencySpamPenalty: z.number().min(-10).max(0),
  previousApplyBonus: z.number().min(0).max(10),
  appliedSimilarityThreshold: fraction,
  appliedSimilarityBonus: z.number().min(0).max(10),
  skippedSimilarityThreshold: fraction,
  skippedSimilarityPenalty: z.number().min(-10).max(0),
  recentVectorCount: posInt,
  suggestionMinSkips: posInt,
  suggestionWindowDays: posInt,
  suggestionRateBuffer: nonNegInt,
});

export const AssessmentSettingsSchema = z.object({
  maxJobTokens: posInt,
  maxCvTokens: posInt,
  fullTextCvCount: posInt,
});

export const BlocklistSettingsSchema = z.object({
  employers: z.array(z.string().trim().min(1)).max(500),
  agencies: z.array(z.string().trim().min(1)).max(500),
  keywords: z.array(z.string().trim().min(1)).max(500),
});

export const WorkingSettingsSchema = z.object({
  workingDaysPerYear: z.number().int().min(100).max(260),
  /** Used to annualise hourly rates (hour × hoursPerDay × workingDaysPerYear). */
  hoursPerDay: z.number().min(1).max(24),
});

export const RetentionSettingsSchema = z.object({
  filteredDays: posInt,
});

export const CvSettingsSchema = z.object({
  maxActive: posInt,
  maxUploadBytes: posInt,
  profileDefaults: z.object({
    radiusMiles: nonNegInt,
    locations: z.array(z.string().min(1)).min(1),
    employmentTypes: z.array(EmploymentTypeSchema).min(1),
  }),
});

export const SettingsSchema = z.object({
  schedule: ScheduleSettingsSchema,
  weights: WeightsSettingsSchema,
  thresholds: ThresholdsSettingsSchema,
  budgets: BudgetsSettingsSchema,
  models: ModelsSettingsSchema,
  dedupe: DedupeSettingsSchema,
  feedback: FeedbackSettingsSchema,
  assessment: AssessmentSettingsSchema,
  blocklist: BlocklistSettingsSchema,
  working: WorkingSettingsSchema,
  retention: RetentionSettingsSchema,
  cvs: CvSettingsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SETTINGS_SECTIONS = Object.keys(SettingsSchema.shape) as (keyof Settings)[];

/**
 * Partial update: any subset of sections, each a subset of its fields. The server merges this over
 * the stored overrides and re-validates the full result with `SettingsSchema`, so cross-field
 * rules (weights sum to 1, badge ordering) are enforced on the merged value.
 */
export const SettingsPatchSchema = z.object({
  schedule: ScheduleSettingsSchema.partial().optional(),
  weights: WeightsBaseSchema.partial().optional(),
  thresholds: ThresholdsBaseSchema.partial().optional(),
  budgets: BudgetsSettingsSchema.partial().optional(),
  models: ModelsSettingsSchema.partial().optional(),
  dedupe: DedupeSettingsSchema.partial().optional(),
  feedback: FeedbackSettingsSchema.partial().optional(),
  assessment: AssessmentSettingsSchema.partial().optional(),
  blocklist: BlocklistSettingsSchema.partial().optional(),
  working: WorkingSettingsSchema.partial().optional(),
  retention: RetentionSettingsSchema.partial().optional(),
  cvs: CvSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
