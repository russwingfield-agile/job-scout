import { UpdateSearchProfileSchema } from '@job-scout/shared';
import { Hono } from 'hono';
import { AppError } from '../../lib/errors.js';
import { toIso } from '../../lib/time.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

const notFound = () => new AppError('NOT_FOUND', 'Search profile not found');

export const profilesRoute = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await c.var.deps.repos.profiles.list()))
  .get('/:id', async (c) => {
    const profile = await c.var.deps.repos.profiles.getById(c.req.param('id'));
    if (!profile) throw notFound();
    return c.json(profile);
  })
  .put('/:id', validate('json', UpdateSearchProfileSchema), async (c) => {
    const { repos, clock } = c.var.deps;
    const id = c.req.param('id');
    if (!(await repos.profiles.getById(id))) throw notFound();
    await repos.profiles.update(id, c.req.valid('json'), toIso(clock.now()));
    const updated = await repos.profiles.getById(id);
    if (!updated) throw notFound();
    return c.json(updated);
  });
