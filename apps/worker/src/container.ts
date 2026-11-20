import { accessVerifierFromEnv } from './adapters/access.js';
import { systemClock } from './adapters/clock.js';
import { D1VectorStore } from './adapters/d1Vectors.js';
import { QueueBus, type QueueLike } from './adapters/queues.js';
import { R2Blobs, type R2BucketLike } from './adapters/r2.js';
import { ReedAdapter } from './adapters/reed/adapter.js';
import { ReedClient } from './adapters/reed/client.js';
import { createSourceCallRecorder } from './adapters/sourceCallRecorder.js';
import { unavailable } from './adapters/unavailable.js';
import { type VectorizeLike, VectorizeStore } from './adapters/vectorize.js';
import type { AiLike } from './adapters/workersai/binding.js';
import { WorkersAiEmbedder } from './adapters/workersai/embed.js';
import { WorkersAiLlm } from './adapters/workersai/llm.js';
import { WorkersAiDocParser } from './adapters/workersai/toMarkdown.js';
import { DEFAULT_SETTINGS } from './config/defaults.js';
import { createSettingsService, type SettingsService } from './config/settings.js';
import { createDb, type Db } from './db/client.js';
import { createRepos, type Repos } from './db/repos/index.js';
import { createLogger, type Logger } from './lib/log.js';
import type { AccessVerifier } from './ports/access.js';
import type { BlobStore } from './ports/blob.js';
import type { Clock } from './ports/clock.js';
import type { DocParser } from './ports/docparse.js';
import type { Embedder } from './ports/embed.js';
import type { LlmClient } from './ports/llm.js';
import type { Bus } from './ports/queue.js';
import type { SourceAdapter } from './ports/source.js';
import type { VectorStore } from './ports/vector.js';

export type Deps = {
  db: Db;
  repos: Repos;
  clock: Clock;
  log: Logger;
  settings: SettingsService;
  /** Null when Cloudflare Access is not configured (the API then rejects all non-public calls). */
  access: AccessVerifier | null;
  source: SourceAdapter;
  blobs: BlobStore;
  docs: DocParser;
  embedder: Embedder;
  llm: LlmClient;
  vectors: VectorStore;
  bus: Bus;
};

/** Bindings that only exist once the matching resource is created and enabled in wrangler.jsonc. */
type OptionalBindings = {
  CVS?: R2BucketLike;
  VEC?: VectorizeLike;
  FETCH_Q?: QueueLike;
  PROCESS_Q?: QueueLike;
  SCORE_Q?: QueueLike;
};

/**
 * DI root: the only place adapters are constructed. Tests pass `overrides` to inject fakes.
 * R2 is an optional binding: until it is configured, CV storage fails with a clear NOT_CONFIGURED
 * error (HTTP 503) instead of the whole Worker failing to start. Vectors use Vectorize when bound,
 * otherwise D1.
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

  const optional = env as unknown as OptionalBindings;
  const ai = env.AI as unknown as AiLike;
  // The embedding model is fixed at construction: changing it invalidates every stored vector, so
  // it is deliberately not hot-swappable through Settings.
  const { embedding, embeddingDims } = DEFAULT_SETTINGS.models;

  return {
    db,
    repos,
    clock,
    log,
    settings,
    access,
    source,
    blobs:
      overrides.blobs ??
      (optional.CVS ? new R2Blobs(optional.CVS) : unavailable<BlobStore>('CV storage (R2)')),
    docs: overrides.docs ?? new WorkersAiDocParser(ai),
    embedder: overrides.embedder ?? new WorkersAiEmbedder(ai, embedding, embeddingDims),
    llm: overrides.llm ?? new WorkersAiLlm(ai),
    // Vectorize if its binding is configured, otherwise the built-in D1 store (no extra resource).
    vectors:
      overrides.vectors ??
      (optional.VEC ? new VectorizeStore(optional.VEC) : new D1VectorStore(repos.vectors, clock)),
    // Job queues: until all three are bound, starting a run fails with NOT_CONFIGURED.
    bus:
      overrides.bus ??
      (optional.FETCH_Q && optional.PROCESS_Q && optional.SCORE_Q
        ? new QueueBus({
            fetch: optional.FETCH_Q,
            process: optional.PROCESS_Q,
            score: optional.SCORE_Q,
          })
        : unavailable<Bus>('Job queues')),
  };
}
