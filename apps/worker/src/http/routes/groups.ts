import {
  type ClearJobsResponse,
  type GroupListItem,
  GroupListQuerySchema,
  type GroupListResponse,
  type GroupStatus,
  type RescoreResponse,
} from '@job-scout/shared';
import { Hono } from 'hono';
import { formatPay } from '../../core/parse/pay.js';
import type { AssessmentRow } from '../../db/repos/assessments.js';
import { AppError } from '../../lib/errors.js';
import { assessGroup } from '../../pipeline/assessGroup.js';
import { clearFoundJobs } from '../../pipeline/cleanup.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

const STATUSES: Record<'shortlist' | 'filtered', GroupStatus[]> = {
  // Jobs that passed the hard filters and await the user (later milestones add actioned states).
  shortlist: ['prefiltered', 'pending_llm', 'deferred', 'new'],
  filtered: ['filtered'],
};

const toAssessment = (row: AssessmentRow | null): GroupListItem['assessment'] => {
  if (!row) return null;
  const result = row.resultJson;
  return {
    status: row.status,
    fitScore: row.fitScore,
    headline: result?.headline ?? null,
    strengths: result?.strengths ?? [],
    gaps: result?.gaps ?? [],
    redFlags: result?.red_flags ?? [],
    recommendation: result?.apply_recommendation ?? null,
  };
};

/** Temporary shortlist API (the plan's "early-value" view); M8 replaces it with the full Inbox API. */
export const groupsRoute = new Hono<AppEnv>()
  .get('/', validate('query', GroupListQuerySchema), async (c) => {
    const { show, limit } = c.req.valid('query');
    const statuses = STATUSES[show];
    const { groups } = c.var.deps.repos;

    const [rows, total] = await Promise.all([
      groups.listWithJobs(statuses, limit),
      groups.countByStatus(statuses),
    ]);
    const items: GroupListItem[] = rows.map(({ group, job, bestCv, assessment }) => ({
      id: group.id,
      status: group.status,
      prefilterScore: group.prefilterScore,
      finalScore: group.finalScore,
      assessment: toAssessment(assessment),
      filterReason: job.filterReason,
      bestCv,
      job: {
        title: job.title,
        employerName: job.employerName,
        location: job.location,
        employmentType: job.employmentType,
        workMode: job.workMode,
        payText: formatPay({
          min: job.payMin,
          max: job.payMax,
          period: job.payPeriod ?? 'unknown',
        }),
        ir35: job.ir35,
        contractLengthMonths: job.contractLengthMonths,
        postedAt: job.postedAt,
        url: job.url,
      },
    }));
    const body: GroupListResponse = { items, total };
    return c.json(body);
  })
  /** Forget all jobs you have not acted on, so the next run starts fresh. 409 while a run is working. */
  .post('/clear', async (c) => {
    const deps = c.var.deps;
    if (await deps.repos.runs.findActive()) {
      throw new AppError(
        'CONFLICT',
        'A run is in progress. Wait for it to finish, then try again.',
      );
    }
    const body: ClearJobsResponse = { removed: await clearFoundJobs(deps) };
    return c.json(body);
  })
  /** Assess this job again now (one AI call, counted against the daily AI budget). */
  .post('/:id/rescore', async (c) => {
    const deps = c.var.deps;
    const outcome = await assessGroup(deps, c.req.param('id'), null);
    if (outcome === 'missing') throw new AppError('NOT_FOUND', 'Job not found');
    if (outcome === 'deferred') {
      throw new AppError(
        'BUDGET_EXHAUSTED',
        "Today's AI allowance is used up. Try again tomorrow.",
      );
    }
    const body: RescoreResponse = { outcome };
    return c.json(body);
  });
