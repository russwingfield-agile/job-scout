import type {
  AssessmentResult,
  AssessmentStatus,
  CoverNoteKind,
  CoverNoteTone,
  CvSummary,
  EmploymentType,
  GroupStatus,
  Ir35,
  Ir35Preference,
  PayPeriod,
  RunPhase,
  RunStatus,
  RunTrigger,
  SkipReason,
  WorkMode,
} from '@job-scout/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Single source of truth for the database (SPEC §11). Timestamps are ISO-8601 UTC strings. */

/**
 * Embedding vectors for CVs and jobs (the D1-backed `VectorStore`). Used instead of Vectorize so no
 * extra Cloudflare resource is needed; at our scale (hundreds of recent jobs, a few CVs) a scan with
 * cosine in code is fast. `embedding` is base64 Float32 (see core/vectors.ts).
 */
export const vectors = sqliteTable(
  'vectors',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<'job' | 'cv'>().notNull(),
    /** Posting time, epoch milliseconds (jobs only). */
    postedTs: integer('posted_ts'),
    groupId: text('group_id'),
    embedding: text('embedding').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_vectors_kind_posted_ts').on(t.kind, t.postedTs)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const cvs = sqliteTable('cvs', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  filename: text('filename'),
  textMd: text('text_md').notNull(),
  summaryJson: text('summary_json', { mode: 'json' }).$type<CvSummary>(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const searchProfiles = sqliteTable('search_profiles', {
  id: text('id').primaryKey(),
  cvId: text('cv_id')
    .notNull()
    .references(() => cvs.id, { onDelete: 'cascade' }),
  jobTitlesJson: text('job_titles_json', { mode: 'json' }).$type<string[]>().notNull(),
  mustKeywordsJson: text('must_keywords_json', { mode: 'json' }).$type<string[]>(),
  excludeKeywordsJson: text('exclude_keywords_json', { mode: 'json' }).$type<string[]>(),
  locationsJson: text('locations_json', { mode: 'json' }).$type<string[]>().notNull(),
  radiusMiles: integer('radius_miles').default(25),
  employmentTypesJson: text('employment_types_json', { mode: 'json' })
    .$type<EmploymentType[]>()
    .notNull(),
  minDayRate: integer('min_day_rate'),
  minSalary: integer('min_salary'),
  ir35Preference: text('ir35_preference').$type<Ir35Preference>().default('any'),
  workModesJson: text('work_modes_json', { mode: 'json' }).$type<WorkMode[]>(),
  maxOnsiteDays: integer('max_onsite_days'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    slotKey: text('slot_key').unique(),
    trigger: text('trigger').$type<RunTrigger>().notNull(),
    status: text('status').$type<RunStatus>().notNull(),
    /** ingest → scoring → done; the single handler that wins the phase UPDATE advances the run. */
    phase: text('phase').$type<RunPhase>().notNull().default('ingest'),
    pendingIngest: integer('pending_ingest').notNull().default(0),
    pendingScore: integer('pending_score').notNull().default(0),
    countsJson: text('counts_json', { mode: 'json' }).$type<Record<string, number>>(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('idx_runs_started_at').on(t.startedAt)],
);

/** Exactly-once guard for queue handlers: INSERT OR IGNORE, skip work and decrement if present. */
export const processedMessages = sqliteTable('processed_messages', {
  key: text('key').primaryKey(),
  createdAt: text('created_at').notNull(),
});

export const runErrors = sqliteTable(
  'run_errors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id'),
    stage: text('stage'),
    ref: text('ref'),
    message: text('message'),
    createdAt: text('created_at'),
  },
  (t) => [index('idx_run_errors_run_id').on(t.runId)],
);

export const sourceCalls = sqliteTable('source_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id'),
  source: text('source'),
  endpoint: text('endpoint'),
  status: integer('status'),
  ms: integer('ms'),
  createdAt: text('created_at'),
});

export const usageDaily = sqliteTable('usage_daily', {
  day: text('day').primaryKey(),
  reedCalls: integer('reed_calls').default(0),
  llmCalls: integer('llm_calls').default(0),
  embedCalls: integer('embed_calls').default(0),
  neuronsEst: integer('neurons_est').default(0),
});

export const jobGroups = sqliteTable(
  'job_groups',
  {
    id: text('id').primaryKey(),
    canonicalJobId: text('canonical_job_id'),
    status: text('status').$type<GroupStatus>().notNull(),
    prefilterScore: real('prefilter_score'),
    finalScore: real('final_score'),
    feedbackAdj: real('feedback_adj').default(0),
    feedbackReasonsJson: text('feedback_reasons_json', { mode: 'json' }).$type<string[]>(),
    bestCvId: text('best_cv_id'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    runId: text('run_id'),
    /** Postings that joined after the user actioned the group (shown on Pipeline cards, M6/M8). */
    newPostingsSinceAction: integer('new_postings_since_action').notNull().default(0),
  },
  (t) => [
    index('idx_groups_status_score').on(t.status, sql`${t.finalScore} DESC`),
    index('idx_groups_first_seen_at').on(t.firstSeenAt),
  ],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').references(() => jobGroups.id),
    source: text('source').notNull(),
    sourceJobId: text('source_job_id').notNull(),
    url: text('url'),
    externalApplyUrl: text('external_apply_url'),
    title: text('title'),
    employerName: text('employer_name'),
    isAgency: integer('is_agency', { mode: 'boolean' }),
    location: text('location'),
    workMode: text('work_mode').$type<WorkMode>(),
    employmentType: text('employment_type').$type<EmploymentType>(),
    salaryText: text('salary_text'),
    payMin: real('pay_min'),
    payMax: real('pay_max'),
    payPeriod: text('pay_period').$type<PayPeriod>(),
    annualisedMin: real('annualised_min'),
    annualisedMax: real('annualised_max'),
    ir35: text('ir35').$type<Ir35>(),
    contractLengthMonths: real('contract_length_months'),
    postedAt: text('posted_at'),
    expiresAt: text('expires_at'),
    descriptionText: text('description_text'),
    descriptionHtml: text('description_html'),
    applicationsCount: integer('applications_count'),
    filterReason: text('filter_reason'),
    rawJson: text('raw_json'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_jobs_source_job').on(t.source, t.sourceJobId),
    index('idx_jobs_group_id').on(t.groupId),
    index('idx_jobs_posted_at').on(t.postedAt),
  ],
);

export const jobProfileHits = sqliteTable(
  'job_profile_hits',
  {
    jobId: text('job_id').notNull(),
    profileId: text('profile_id').notNull(),
    runId: text('run_id'),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.profileId] })],
);

export const jobCvSimilarity = sqliteTable(
  'job_cv_similarity',
  {
    groupId: text('group_id').notNull(),
    cvId: text('cv_id').notNull(),
    similarity: real('similarity'),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.cvId] })],
);

export const assessments = sqliteTable('assessments', {
  groupId: text('group_id').primaryKey(),
  model: text('model'),
  fitScore: real('fit_score'),
  bestCvId: text('best_cv_id'),
  resultJson: text('result_json', { mode: 'json' }).$type<AssessmentResult | null>().notNull(),
  status: text('status').$type<AssessmentStatus>().notNull(),
  promptVersion: text('prompt_version'),
  createdAt: text('created_at').notNull(),
});

export const applications = sqliteTable('applications', {
  groupId: text('group_id').primaryKey(),
  cvIdSent: text('cv_id_sent'),
  appliedAt: text('applied_at'),
  notes: text('notes'),
  skipReason: text('skip_reason').$type<SkipReason>(),
  updatedAt: text('updated_at').notNull(),
});

export const statusHistory = sqliteTable(
  'status_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: text('group_id'),
    fromStatus: text('from_status').$type<GroupStatus>(),
    toStatus: text('to_status').$type<GroupStatus>(),
    at: text('at'),
  },
  (t) => [index('idx_status_history_group_id').on(t.groupId)],
);

export const coverNotes = sqliteTable('cover_notes', {
  id: text('id').primaryKey(),
  groupId: text('group_id'),
  cvId: text('cv_id'),
  kind: text('kind').$type<CoverNoteKind>(),
  tone: text('tone').$type<CoverNoteTone>(),
  text: text('text'),
  createdAt: text('created_at'),
});
