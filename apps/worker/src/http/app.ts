import { Hono } from 'hono';
import { createContainer, type Deps } from '../container.js';
import { auth } from './middleware/auth.js';
import { onError, onNotFound } from './middleware/errors.js';
import { requestId } from './middleware/requestId.js';
import { cvsRoute } from './routes/cvs.js';
import { devRoute } from './routes/dev.js';
import { groupsRoute } from './routes/groups.js';
import { healthRoute } from './routes/health.js';
import { profilesRoute } from './routes/profiles.js';
import { runsRoute } from './routes/runs.js';
import { settingsRoute } from './routes/settings.js';
import { statsRoute } from './routes/stats.js';
import { suggestionsRoute } from './routes/suggestions.js';
import type { AppEnv } from './types.js';

/** `makeDeps` lets tests inject fakes; production builds the container from the Worker env. */
export function createApp(makeDeps: (env: Env) => Deps = (env) => createContainer(env)) {
  const api = new Hono<AppEnv>().basePath('/api');

  api.use('*', requestId);
  api.use('*', async (c, next) => {
    c.set('deps', makeDeps(c.env));
    await next();
  });
  api.use('*', auth);
  api.onError(onError);
  api.notFound(onNotFound);

  return api
    .route('/health', healthRoute)
    .route('/settings', settingsRoute)
    .route('/cvs', cvsRoute)
    .route('/profiles', profilesRoute)
    .route('/groups', groupsRoute)
    .route('/stats', statsRoute)
    .route('/suggestions', suggestionsRoute)
    .route('/runs', runsRoute)
    .route('/dev', devRoute);
}

export const app = createApp();
export type AppType = typeof app;
