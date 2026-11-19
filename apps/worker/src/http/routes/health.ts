import type { HealthResponse } from '@job-scout/shared';
import { Hono } from 'hono';
import { VERSION } from '../../version.js';

export const healthRoute = new Hono().get('/', (c) => {
  const body: HealthResponse = { ok: true, version: VERSION, time: new Date().toISOString() };
  return c.json(body);
});
