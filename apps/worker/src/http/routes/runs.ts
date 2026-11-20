import type { RunDetail, RunSummary } from '@job-scout/shared';
import { Hono } from 'hono';
import type { RunRow } from '../../db/repos/runs.js';
import { AppError } from '../../lib/errors.js';
import { startRun } from '../../pipeline/startRun.js';
import type { AppEnv } from '../types.js';

/** How many runs the Runs page shows, and how many errors the detail view lists. */
const RUN_LIST_LIMIT = 30;
const RUN_ERROR_LIMIT = 50;

const summarise = (run: RunRow, reedCalls: number, errorCount: number): RunSummary => ({
  id: run.id,
  trigger: run.trigger,
  status: run.status,
  phase: run.phase,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  counts: run.countsJson ?? {},
  reedCalls,
  errorCount,
});

export const runsRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rows = await c.var.deps.repos.runs.listRecentWithStats(RUN_LIST_LIMIT);
    return c.json(rows.map((r) => summarise(r.run, r.reedCalls, r.errorCount)));
  })
  .get('/:id', async (c) => {
    const { repos } = c.var.deps;
    const run = await repos.runs.getById(c.req.param('id'));
    if (!run) throw new AppError('NOT_FOUND', 'Run not found');
    const [reedCalls, errors] = await Promise.all([
      repos.sourceCalls.countByRun(run.id),
      repos.runs.listErrors(run.id, RUN_ERROR_LIMIT),
    ]);
    const detail: RunDetail = {
      ...summarise(run, reedCalls, errors.length),
      pendingIngest: run.pendingIngest,
      pendingScore: run.pendingScore,
      errors: errors.map(({ id, stage, ref, message, createdAt }) => ({
        id,
        stage,
        ref,
        message,
        createdAt,
      })),
    };
    return c.json(detail);
  })
  /** "Run now": 202 with the new run's id. 409 while another run is still working. */
  .post('/', async (c) => {
    const started = await startRun(c.var.deps, { trigger: 'manual' });
    if (!started) throw new AppError('INTERNAL', 'Run was not created');
    return c.json(started, 202);
  });
