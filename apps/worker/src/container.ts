import { systemClock } from './adapters/clock.js';
import { createSettingsService, type SettingsService } from './config/settings.js';
import { createDb, type Db } from './db/client.js';
import { createRepos, type Repos } from './db/repos/index.js';
import { createLogger, type Logger } from './lib/log.js';
import type { Clock } from './ports/clock.js';

export type Deps = {
  db: Db;
  repos: Repos;
  clock: Clock;
  log: Logger;
  settings: SettingsService;
};

/**
 * DI root: the only place adapters are constructed. Later milestones add source, vectors,
 * embedder, llm, docs, blobs and bus here. Tests pass `overrides` to inject fakes.
 */
export function createContainer(env: Env, overrides: Partial<Deps> = {}): Deps {
  const db = overrides.db ?? createDb(env.DB);
  const repos = overrides.repos ?? createRepos(db);
  const clock = overrides.clock ?? systemClock;
  const log = overrides.log ?? createLogger();
  const settings = overrides.settings ?? createSettingsService({ repos, clock, log });
  return { db, repos, clock, log, settings };
}
