import { z } from 'zod';
import { AssessmentResultSchema } from './assessment.js';
import {
  ApplyRecommendationSchema,
  AssessmentStatusSchema,
  EmploymentTypeSchema,
  GroupStatusSchema,
  Ir35Schema,
  RunPhaseSchema,
  RunStatusSchema,
  RunTriggerSchema,
  SeniorityMatchSchema,
  SkipReasonSchema,
  WorkModeSchema,
} from './enums.js';
import { SettingsPatchSchema, SettingsSchema } from './settings.js';

/** Error envelope returned by every failing /api route (IMPLEMENTATION_PLAN §2.7). */
export const ApiErrorCodeSchema = z.enum([
  'VALIDATION',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'UPSTREAM_RATE_LIMIT',
  'UPSTREAM_ERROR',
  'BUDGET_EXHAUSTED',
  'LLM_INVALID_OUTPUT',
  'CONFLICT',
  'NOT_CONFIGURED',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** POST /api/dev/reed-probe (dev only): run a real Reed search and normalise the first few hits. */
export const ReedProbeRequestSchema = z.object({
  keywords: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(100).nullable().default(null),
  radiusMiles: z.number().int().min(0).max(200).default(25),
  employmentTypes: z.array(EmploymentTypeSchema).default(['contract', 'permanent']),
  minSalary: z.number().int().min(0).nullable().default(null),
  page: z.number().int().min(0).max(50).default(0),
  /** How many hits to fetch full details for (each costs one Reed call). */
  detailsCount: z.number().int().min(0).max(5).default(3),
});
export type ReedProbeRequest = z.input<typeof ReedProbeRequestSchema>;

export const GetSettingsResponseSchema = SettingsSchema;
export const UpdateSettingsRequestSchema = SettingsPatchSchema;
export const UpdateSettingsResponseSchema = SettingsSchema;

/** One row of the Runs page. `counts` keys: fetched, new, filtered, dupes, prefiltered, llmScored, inboxAdded. */
export const RunSummarySchema = z.object({
  id: z.string(),
  trigger: RunTriggerSchema,
  status: RunStatusSchema,
  phase: RunPhaseSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  counts: z.record(z.string(), z.number()),
  reedCalls: z.number().int(),
  errorCount: z.number().int(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunErrorSchema = z.object({
  id: z.number().int(),
  stage: z.string().nullable(),
  ref: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type RunError = z.infer<typeof RunErrorSchema>;

export const RunDetailSchema = RunSummarySchema.extend({
  pendingIngest: z.number().int(),
  pendingScore: z.number().int(),
  errors: z.array(RunErrorSchema),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const RunListResponseSchema = z.array(RunSummarySchema);

export const StartRunResponseSchema = z.object({
  runId: z.string(),
  /** How many searches were queued (0 when no profile is active). */
  queries: z.number().int(),
});
export type StartRunResponse = z.infer<typeof StartRunResponseSchema>;

/** One job (group) in the temporary shortlist view; the full Inbox of M8 replaces it. */
export const GroupListItemSchema = z.object({
  id: z.string(),
  status: GroupStatusSchema,
  /** First-pass similarity to the best CV, 0–100. Null for filtered jobs. */
  prefilterScore: z.number().nullable(),
  /** Overall score after the AI assessment, 0–100. Null until the job has been assessed. */
  finalScore: z.number().nullable(),
  /** The AI's read of the job; null until assessed. `failed` means the AI could not assess it. */
  assessment: z
    .object({
      status: AssessmentStatusSchema,
      fitScore: z.number().nullable(),
      headline: z.string().nullable(),
      strengths: z.array(z.string()),
      gaps: z.array(z.string()),
      redFlags: z.array(z.string()),
      recommendation: ApplyRecommendationSchema.nullable(),
      seniorityMatch: SeniorityMatchSchema.nullable().default(null),
      onsiteDaysPerWeek: z.number().nullable().default(null),
    })
    .nullable(),
  /** Why a filtered job was hidden, e.g. "below_min_day_rate". */
  filterReason: z.string().nullable(),
  bestCv: z.string().nullable(),
  bestCvId: z.string().nullable().default(null),
  /** The same role posted elsewhere (other agencies), best pay first. Empty for a single posting. */
  alsoPostedBy: z
    .array(z.object({ id: z.string(), employerName: z.string().nullable(), payText: z.string() }))
    .default([]),
  /** Postings that appeared after you acted on this job. */
  newPostingsSinceAction: z.number().int().default(0),
  /** What you recorded when you acted on it. */
  application: z
    .object({
      cvIdSent: z.string().nullable(),
      appliedAt: z.string().nullable(),
      notes: z.string().nullable(),
      skipReason: SkipReasonSchema.nullable(),
    })
    .nullable()
    .default(null),
  job: z.object({
    title: z.string().nullable(),
    employerName: z.string().nullable(),
    location: z.string().nullable(),
    employmentType: EmploymentTypeSchema.nullable(),
    workMode: WorkModeSchema.nullable(),
    /** Normalised, e.g. "£600/day", "£85k" or "Not stated". */
    payText: z.string(),
    ir35: Ir35Schema.nullable(),
    contractLengthMonths: z.number().nullable(),
    postedAt: z.string().nullable(),
    /** The advert on Reed (attribution and the place to apply). */
    url: z.string().nullable(),
  }),
});
export type GroupListItem = z.infer<typeof GroupListItemSchema>;

export const GroupListResponseSchema = z.object({
  items: z.array(GroupListItemSchema),
  /** How many jobs match, which can exceed `items.length` (the page limit). */
  total: z.number().int(),
});
export type GroupListResponse = z.infer<typeof GroupListResponseSchema>;

/** POST /api/groups/:id/rescore: what happened to the group. */
export const RescoreResponseSchema = z.object({
  outcome: z.enum(['scored', 'failed']),
});
export type RescoreResponse = z.infer<typeof RescoreResponseSchema>;

export const GroupListQuerySchema = z.object({
  /** shortlist = awaiting your decision; more = weaker first-pass matches; pipeline = acted on. */
  show: z.enum(['shortlist', 'filtered', 'more', 'pipeline']).default('shortlist'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  type: z.enum(['contract', 'permanent']).optional(),
  cvId: z.string().min(1).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  workMode: WorkModeSchema.exclude(['unknown']).optional(),
  ir35: Ir35Schema.exclude(['unknown']).optional(),
  postedWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type GroupListQuery = z.infer<typeof GroupListQuerySchema>;

/** PATCH /api/groups/:id — move a job between states, with what you want to record. */
export const UpdateGroupRequestSchema = z.object({
  status: GroupStatusSchema.extract([
    'new',
    'shortlisted',
    'applied',
    'interview',
    'offer',
    'rejected',
    'skipped',
    'withdrawn',
  ]),
  /** Required when moving to `applied`: which CV you sent. */
  cvIdSent: z.string().min(1).optional(),
  appliedAt: z.iso.datetime().optional(),
  skipReason: SkipReasonSchema.optional(),
  notes: z.string().max(5_000).optional(),
});
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequestSchema>;

/** GET /api/groups/:id — everything about one job. */
export const GroupDetailSchema = z.object({
  item: GroupListItemSchema,
  postings: z.array(
    z.object({
      id: z.string(),
      employerName: z.string().nullable(),
      isAgency: z.boolean().nullable(),
      location: z.string().nullable(),
      payText: z.string(),
      postedAt: z.string().nullable(),
      url: z.string().nullable(),
      externalApplyUrl: z.string().nullable(),
    }),
  ),
  descriptionText: z.string().nullable(),
  assessment: AssessmentResultSchema.nullable(),
  cvScores: z.array(
    z.object({
      cvId: z.string(),
      label: z.string(),
      similarity: z.number().nullable(),
      score: z.number().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.number().int(),
      from: GroupStatusSchema.nullable(),
      to: GroupStatusSchema.nullable(),
      at: z.string().nullable(),
    }),
  ),
});
export type GroupDetail = z.infer<typeof GroupDetailSchema>;

/** GET /api/stats — the numbers in the page header. */
export const StatsResponseSchema = z.object({
  newToday: z.number().int(),
  inbox: z.number().int(),
  shortlisted: z.number().int(),
  appliedThisWeek: z.number().int(),
  /** ISO time of the next scheduled scan, or null when nothing is scheduled. */
  nextScanAt: z.string().nullable(),
  /** Share of today's AI allowance used, 0–100. */
  aiBudgetPercent: z.number(),
});
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

/** POST /api/groups/clear: how many jobs were forgotten. */
export const ClearJobsResponseSchema = z.object({ removed: z.number().int() });
export type ClearJobsResponse = z.infer<typeof ClearJobsResponseSchema>;

/** PUT /api/groups/:id/notes */
export const UpdateNotesRequestSchema = z.object({ notes: z.string().max(5_000) });
export type UpdateNotesRequest = z.infer<typeof UpdateNotesRequestSchema>;
