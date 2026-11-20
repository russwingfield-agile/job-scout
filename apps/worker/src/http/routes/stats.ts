import type { StatsResponse } from '@job-scout/shared';
import { Hono } from 'hono';
import { nextSlotTime } from '../../core/schedule.js';
import { dayKey } from '../../lib/time.js';
import type { AppEnv } from '../types.js';

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

/** The numbers in the page header: what is new, what you have in flight, when the next scan is. */
export const statsRoute = new Hono<AppEnv>().get('/', async (c) => {
  const { repos, clock, settings } = c.var.deps;
  const { schedule, budgets } = await settings.get();
  const now = clock.now();
  const startOfToday = `${dayKey(now)}T00:00:00.000Z`;
  const weekAgo = new Date(now.getTime() - WEEK_DAYS * DAY_MS).toISOString();

  const [newToday, inbox, shortlisted, appliedThisWeek, usage] = await Promise.all([
    repos.groups.countInboxSince(startOfToday),
    repos.groups.countByStatus(['new']),
    repos.groups.countByStatus(['shortlisted']),
    repos.applications.countMovesSince('applied', weekAgo),
    repos.usage.get(dayKey(now)),
  ]);
  const next = nextSlotTime(now, schedule);
  const body: StatsResponse = {
    newToday,
    inbox,
    shortlisted,
    appliedThisWeek,
    nextScanAt: next ? next.toISOString() : null,
    aiBudgetPercent:
      budgets.aiDailyNeuronBudget === 0
        ? 0
        : Math.min(100, Math.round(((usage?.neuronsEst ?? 0) / budgets.aiDailyNeuronBudget) * 100)),
  };
  return c.json(body);
});
