import { accessVerifierFromEnv } from './adapters/access.js';
import { systemClock } from './adapters/clock.js';
import { ReedAdapter } from './adapters/reed/adapter.js';
import { ReedClient } from './adapters/reed/client.js';
import { createSourceCallRecorder } from './adapters/sourceCallRecorder.js';
import { createSettingsService, type SettingsService } from './config/settings.js';
import { createDb, type Db } from './db/client.js';
import { createRepos, type Repos } from './db/repos/index.js';
import { createLogger, type Logger } from './lib/log.js';
import type { AccessVerifier } from './ports/access.js';
import type { Clock } from './ports/clock.js';
import type { SourceAdapter } from './ports/source.js';

export type Deps = {
  db: Db;
  repos: Repos;
  clock: Clock;
  log: Logger;
  settings: SettingsService;
  /** Null when Cloudflare Access is not configured (the API then rejects all non-public calls). */
  access: AccessVerifier | null;
  source: SourceAdapter;
};

/**
 * DI root: the only place adapters are constructed. Later milestones add vectors, embedder, llm,
 * docs, blobs and bus here. Tests pass `overrides` to inject fakes.
 */
export function createContainer(env: Env, overrides: Partial<Deps> = {}): Deps {
  const db = overrides.db ?? createDb(env.DB);
  const repos = overrides.repos ?? createRepos(db);
  const clock = overrides.clock ?? systemClock;
  const log = overrides.log ?? createLogger();
  const settings = overrides.settings ?? createSettingsService({ repos, clock, log });
  const access = 'access' in overrides ? (overrides.access ?? null) : accessVerifierFromEnv(env);
  const source =
    overrides.source ??
    new ReedAdapter(
      new ReedClient({
        // Unset in deployments until `wrangler secret put REED_API_KEY`; the client then fails
        // clearly on first use instead of at startup.
        apiKey: env.REED_API_KEY ?? '',
        recorder: createSourceCallRecorder({ repos, clock }),
        log,
      }),
    );
  return { db, repos, clock, log, settings, access, source };
}
