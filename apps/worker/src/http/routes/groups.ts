import {
  type GroupListItem,
  GroupListQuerySchema,
  type GroupListResponse,
  type GroupStatus,
} from '@job-scout/shared';
import { Hono } from 'hono';
import { formatPay } from '../../core/parse/pay.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

const STATUSES: Record<'shortlist' | 'filtered', GroupStatus[]> = {
  // Jobs that passed the hard filters and await the user (later milestones add actioned states).
  shortlist: ['prefiltered', 'pending_llm', 'new'],
  filtered: ['filtered'],
};

/** Temporary shortlist API (the plan's "early-value" view); M8 replaces it with the full Inbox API. */
export const groupsRoute = new Hono<AppEnv>().get(
  '/',
  validate('query', GroupListQuerySchema),
  async (c) => {
    const { show, limit } = c.req.valid('query');
    const statuses = STATUSES[show];
    const { groups } = c.var.deps.repos;

    const [rows, total] = await Promise.all([
      groups.listWithJobs(statuses, limit),
      groups.countByStatus(statuses),
    ]);
    const items: GroupListItem[] = rows.map(({ group, job, bestCv }) => ({
      id: group.id,
      status: group.status,
      prefilterScore: group.prefilterScore,
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
  },
);
