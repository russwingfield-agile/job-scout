import type { VectorMeta, VectorQueryFilter, VectorStore } from '../ports/vector.js';

type Metadata = Record<string, string | number | boolean>;

/** The slice of a Vectorize index binding we use. */
export interface VectorizeLike {
  upsert(vectors: { id: string; values: number[]; metadata?: Metadata }[]): Promise<unknown>;
  query(
    vector: number[],
    options: { topK: number; returnMetadata?: 'all' | 'indexed' | 'none' },
  ): Promise<{ matches: { id: string; score: number; metadata?: Metadata | null }[] }>;
  getByIds(ids: string[]): Promise<{ id: string; values?: ArrayLike<number> | null }[]>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** Vectorize returns at most this many matches when metadata is requested. */
const MAX_TOPK_WITH_METADATA = 20;
/** When filtering after the query, fetch this many times the wanted matches so enough survive. */
const OVERFETCH_FACTOR = 4;

const toMetadata = (m: VectorMeta): Metadata => ({
  kind: m.kind,
  ...(m.postedTs === undefined ? {} : { posted_ts: m.postedTs }),
  ...(m.groupId === undefined ? {} : { group_id: m.groupId }),
});

const fromMetadata = (m: Metadata | null | undefined): VectorMeta => ({
  kind: m?.kind === 'cv' ? 'cv' : 'job',
  ...(typeof m?.posted_ts === 'number' ? { postedTs: m.posted_ts } : {}),
  ...(typeof m?.group_id === 'string' ? { groupId: m.group_id } : {}),
});

const passes = (meta: VectorMeta, filter: VectorQueryFilter | undefined): boolean =>
  (filter?.kind === undefined || meta.kind === filter.kind) &&
  (filter?.postedTsGte === undefined || (meta.postedTs ?? 0) >= filter.postedTsGte);

/**
 * Vectorize-backed store. Filtering (kind, posting date) is done here after the query rather than
 * inside Vectorize: server-side filters need metadata indexes created up front with the CLI, and
 * our result sets are tiny (a handful of near neighbours), so over-fetching and filtering locally
 * is simpler and gives the same answer.
 */
export class VectorizeStore implements VectorStore {
  constructor(private readonly index: VectorizeLike) {}

  async upsert(items: { id: string; values: number[]; metadata: VectorMeta }[]): Promise<void> {
    await this.index.upsert(
      items.map((i) => ({ id: i.id, values: i.values, metadata: toMetadata(i.metadata) })),
    );
  }

  async query(values: number[], opts: { topK: number; filter?: VectorQueryFilter | undefined }) {
    const fetchK = opts.filter
      ? Math.min(opts.topK * OVERFETCH_FACTOR, MAX_TOPK_WITH_METADATA)
      : Math.min(opts.topK, MAX_TOPK_WITH_METADATA);
    const { matches } = await this.index.query(values, { topK: fetchK, returnMetadata: 'all' });
    return matches
      .map((m) => ({ id: m.id, score: m.score, metadata: fromMetadata(m.metadata) }))
      .filter((m) => passes(m.metadata, opts.filter))
      .slice(0, opts.topK);
  }

  async getByIds(ids: string[]): Promise<{ id: string; values: number[] }[]> {
    const found = await this.index.getByIds(ids);
    return found.flatMap((v) => (v.values ? [{ id: v.id, values: Array.from(v.values) }] : []));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    await this.index.deleteByIds(ids);
  }
}
