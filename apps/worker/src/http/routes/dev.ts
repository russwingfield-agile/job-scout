import { ReedProbeRequestSchema } from '@job-scout/shared';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { canSpendReed } from '../../core/budget.js';
import { AppError } from '../../lib/errors.js';
import { dayKey } from '../../lib/time.js';
import type { SearchQuery } from '../../ports/source.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

/** Dev-only routes do not exist in production: 404 before any validation or work happens. */
const devOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.ENV !== 'dev') throw new AppError('NOT_FOUND', 'Not found');
  await next();
});

export const devRoute = new Hono<AppEnv>()
  .use('*', devOnly)
  /**
   * Run one real Reed search plus details for the first few hits, and return the normalised jobs.
   * For eyeballing real data and deciding what to record as fixtures. Counts against the budget.
   */
  .post('/reed-probe', validate('json', ReedProbeRequestSchema), async (c) => {
    const body = c.req.valid('json');
    const { source, settings, repos, clock } = c.var.deps;

    const budgets = (await settings.get()).budgets;
    const usage = await repos.usage.get(dayKey(clock.now()));
    const decision = canSpendReed(
      { usedToday: usage?.reedCalls ?? 0, usedThisRun: 0, n: 1 + body.detailsCount },
      budgets,
    );
    if (!decision.ok) {
      throw new AppError('BUDGET_EXHAUSTED', `Reed budget exhausted (${decision.reason})`);
    }

    const query: SearchQuery = {
      keywords: body.keywords,
      location: body.location,
      radiusMiles: body.radiusMiles,
      employmentTypes: body.employmentTypes,
      minSalary: body.minSalary,
    };
    const { refs, total } = await source.search(query, body.page);

    const ctx = { profileEmploymentTypes: body.employmentTypes, now: clock.now() };
    const jobs = await Promise.all(
      refs
        .slice(0, body.detailsCount)
        .map(async (ref) => source.normalise(await source.details(ref.sourceJobId), ctx)),
    );
    return c.json({ total, refs, jobs });
  });
