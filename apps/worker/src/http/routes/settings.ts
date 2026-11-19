import { SettingsPatchSchema } from '@job-scout/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

export const settingsRoute = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await c.var.deps.settings.get()))
  .put('/', validate('json', SettingsPatchSchema), async (c) =>
    c.json(await c.var.deps.settings.update(c.req.valid('json'))),
  );
