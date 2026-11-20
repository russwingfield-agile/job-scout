import {
  type ClearJobsResponse,
  type GroupDetail,
  type GroupListItem,
  GroupListQuerySchema,
  type GroupListResponse,
  type GroupStatus,
  type RescoreResponse,
  UpdateGroupRequestSchema,
  UpdateNotesRequestSchema,
} from '@job-scout/shared';
import { Hono } from 'hono';
import { formatPay } from '../../core/parse/pay.js';
import { canTransition, requiresCvSent, restoredStatus } from '../../core/transitions.js';
import type { ApplicationRow } from '../../db/repos/applications.js';
import type { AssessmentRow } from '../../db/repos/assessments.js';
import type { GroupRow } from '../../db/repos/groups.js';
import type { JobRow } from '../../db/repos/jobs.js';
import { AppError } from '../../lib/errors.js';
import { toIso } from '../../lib/time.js';
import { assessGroup } from '../../pipeline/assessGroup.js';
import { clearFoundJobs } from '../../pipeline/cleanup.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

const DAY_MS = 86_400_000;

const STATUSES: Record<'shortlist' | 'filtered' | 'more' | 'pipeline', GroupStatus[]> = {
  // Waiting for your decision.
  shortlist: ['prefiltered', 'pending_llm', 'deferred', 'new'],
  filtered: ['filtered'],
  // Passed the filters but a weaker first-pass match, so the AI never looked at them.
  more: ['below_threshold'],
  // Jobs you have acted on.
  pipeline: ['shortlisted', 'applied', 'interview', 'offer', 'rejected', 'skipped', 'withdrawn'],
};

const payTextOf = (job: JobRow): string =>
  formatPay({ min: job.payMin, max: job.payMax, period: job.payPeriod ?? 'unknown' });

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
    seniorityMatch: result?.seniority_match ?? null,
    onsiteDaysPerWeek: result?.extracted.onsite_days_per_week ?? null,
  };
};

const toApplication = (row: ApplicationRow | null): GroupListItem['application'] =>
  row
    ? {
        cvIdSent: row.cvIdSent,
        appliedAt: row.appliedAt,
        notes: row.notes,
        skipReason: row.skipReason,
      }
    : null;

type Row = {
  group: GroupRow;
  job: JobRow;
  bestCv: string | null;
  assessment: AssessmentRow | null;
  application: ApplicationRow | null;
};

/** The same role posted elsewhere, highest pay first, for the "Also posted by" line. */
const alsoPostedBy = (canonicalId: string, postings: JobRow[]): GroupListItem['alsoPostedBy'] =>
  postings
    .filter((p) => p.id !== canonicalId)
    .sort((a, b) => (b.annualisedMax ?? 0) - (a.annualisedMax ?? 0))
    .map((p) => ({ id: p.id, employerName: p.employerName, payText: payTextOf(p) }));

function toItem(row: Row, postings: JobRow[]): GroupListItem {
  const { group, job } = row;
  return {
    id: group.id,
    status: group.status,
    prefilterScore: group.prefilterScore,
    finalScore: group.finalScore,
    assessment: toAssessment(row.assessment),
    filterReason: job.filterReason,
    bestCv: row.bestCv,
    bestCvId: group.bestCvId,
    alsoPostedBy: alsoPostedBy(job.id, postings),
    newPostingsSinceAction: group.newPostingsSinceAction,
    application: toApplication(row.application),
    job: {
      title: job.title,
      employerName: job.employerName,
      location: job.location,
      employmentType: job.employmentType,
      workMode: job.workMode,
      payText: payTextOf(job),
      ir35: job.ir35,
      contractLengthMonths: job.contractLengthMonths,
      postedAt: job.postedAt,
      url: job.url,
    },
  };
}

export const groupsRoute = new Hono<AppEnv>()
  .get('/', validate('query', GroupListQuerySchema), async (c) => {
    const q = c.req.valid('query');
    const { repos, clock } = c.var.deps;
    const statuses = STATUSES[q.show];
    const filters = {
      type: q.type,
      cvId: q.cvId,
      minScore: q.minScore,
      workMode: q.workMode,
      ir35: q.ir35,
      postedSince:
        q.postedWithinDays === undefined
          ? undefined
          : toIso(new Date(clock.now().getTime() - q.postedWithinDays * DAY_MS)),
    };

    const [rows, total] = await Promise.all([
      repos.groups.listWithJobs(statuses, q.limit, filters),
      repos.groups.countByStatus(statuses, filters),
    ]);
    const postings = await repos.jobs.listByGroups(rows.map((r) => r.group.id));
    const items = rows.map((r) =>
      toItem(
        r,
        postings.filter((p) => p.groupId === r.group.id),
      ),
    );
    const body: GroupListResponse = { items, total };
    return c.json(body);
  })
  .get('/:id', async (c) => {
    const { repos } = c.var.deps;
    const id = c.req.param('id');
    const found = await repos.groups.getWithJob(id);
    if (!found) throw new AppError('NOT_FOUND', 'Job not found');
    const [postings, cvs, similarities, history] = await Promise.all([
      repos.jobs.listByGroup(id),
      repos.cvs.list(),
      repos.groups.similaritiesFor(id),
      repos.applications.historyFor(id),
    ]);
    const result = found.assessment?.resultJson ?? null;
    const detail: GroupDetail = {
      item: toItem(found, postings),
      postings: postings.map((p) => ({
        id: p.id,
        employerName: p.employerName,
        isAgency: p.isAgency,
        location: p.location,
        payText: payTextOf(p),
        postedAt: p.postedAt,
        url: p.url,
        externalApplyUrl: p.externalApplyUrl,
      })),
      descriptionText: found.job.descriptionText,
      assessment: result,
      cvScores: cvs
        .filter((cv) => cv.active)
        .map((cv) => ({
          cvId: cv.id,
          label: cv.label,
          similarity: similarities.find((s) => s.cvId === cv.id)?.similarity ?? null,
          score: result?.cv_scores.find((s) => s.cv_id === cv.id)?.score ?? null,
        })),
      history: history.map((h) => ({ id: h.id, from: h.fromStatus, to: h.toStatus, at: h.at })),
    };
    return c.json(detail);
  })
  /** Act on a job: shortlist, skip, apply, move along the pipeline, or send it back to the Inbox. */
  .patch('/:id', validate('json', UpdateGroupRequestSchema), async (c) => {
    const { repos, clock } = c.var.deps;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const group = await repos.groups.getById(id);
    if (!group) throw new AppError('NOT_FOUND', 'Job not found');
    if (!canTransition(group.status, body.status)) {
      throw new AppError('CONFLICT', `A job that is ${group.status} cannot become ${body.status}.`);
    }

    const existing = await repos.applications.getByGroup(id);
    const cvIdSent = body.cvIdSent ?? existing?.cvIdSent ?? null;
    if (requiresCvSent(body.status) && cvIdSent === null) {
      throw new AppError('VALIDATION', 'Say which CV you sent.', {
        issues: [{ path: 'cvIdSent', message: 'Required when applying' }],
      });
    }
    if (cvIdSent !== null && !(await repos.cvs.getById(cvIdSent))) {
      throw new AppError('VALIDATION', 'That CV does not exist.', {
        issues: [{ path: 'cvIdSent', message: 'Unknown CV' }],
      });
    }

    const now = toIso(clock.now());
    const target =
      body.status === 'new'
        ? restoredStatus((await repos.assessments.getByGroup(id)) !== undefined)
        : body.status;
    await repos.groups.setStatus(id, target);
    await repos.applications.addHistory(id, group.status, target, now);
    await repos.applications.upsert({
      groupId: id,
      cvIdSent,
      appliedAt:
        body.status === 'applied' ? (body.appliedAt ?? now) : (existing?.appliedAt ?? null),
      notes: body.notes ?? existing?.notes ?? null,
      skipReason:
        body.status === 'skipped' ? (body.skipReason ?? null) : (existing?.skipReason ?? null),
      updatedAt: now,
    });
    return c.json({ status: target });
  })
  /** Save your notes on a job without changing its state. */
  .put('/:id/notes', validate('json', UpdateNotesRequestSchema), async (c) => {
    const { repos, clock } = c.var.deps;
    const id = c.req.param('id');
    if (!(await repos.groups.getById(id))) throw new AppError('NOT_FOUND', 'Job not found');
    const existing = await repos.applications.getByGroup(id);
    await repos.applications.upsert({
      groupId: id,
      cvIdSent: existing?.cvIdSent ?? null,
      appliedAt: existing?.appliedAt ?? null,
      skipReason: existing?.skipReason ?? null,
      notes: c.req.valid('json').notes,
      updatedAt: toIso(clock.now()),
    });
    return c.json({ ok: true });
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
