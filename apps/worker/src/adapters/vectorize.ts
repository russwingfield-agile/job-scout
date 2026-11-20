import type { VectorMeta, VectorQueryFilter, VectorStore } from '../ports/vector.js';

type Metadata = Record<string, string | number | boolean>;

/** The slice of a Vectorize index binding we use. */
export interface VectorizeLike {
  upsert(vectors: { id: string; values: number[]; metadata?: Metadata }[]): Promise<unknown>;
  query(
    vector: number[],
    options: {
      topK: number;
      filter?: Record<string, unknown>;
      returnMetadata?: 'all' | 'indexed' | 'none';
    },
  ): Promise<{ matches: { id: string; score: number; metadata?: Metadata | null }[] }>;
  getByIds(ids: string[]): Promise<{ id: string; values?: ArrayLike<number> | null }[]>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

// Metadata keys match the index's metadata indexes: `kind` (string) and `posted_ts` (number).
const toMetadata = (m: VectorMeta): Metadata => ({
  kind: m.kind,
  ...(m.postedTs === undefined ? {} : { posted_ts: m.postedTs }),
  ...(m.groupId === undefined ? {} : { group_id: m.groupId }),
});

const toFilter = (f: VectorQueryFilter | undefined): Record<string, unknown> | undefined => {
  if (!f) return undefined;
  return {
    ...(f.kind === undefined ? {} : { kind: f.kind }),
    ...(f.postedTsGte === undefined ? {} : { posted_ts: { $gte: f.postedTsGte } }),
  };
};

const fromMetadata = (m: Metadata | null | undefined): VectorMeta => ({
  kind: m?.kind === 'cv' ? 'cv' : 'job',
  ...(typeof m?.posted_ts === 'number' ? { postedTs: m.posted_ts } : {}),
  ...(typeof m?.group_id === 'string' ? { groupId: m.group_id } : {}),
});

export class VectorizeStore implements VectorStore {
  constructor(private readonly index: VectorizeLike) {}

  async upsert(items: { id: string; values: number[]; metadata: VectorMeta }[]): Promise<void> {
    await this.index.upsert(
      items.map((i) => ({ id: i.id, values: i.values, metadata: toMetadata(i.metadata) })),
    );
  }

  async query(values: number[], opts: { topK: number; filter?: VectorQueryFilter | undefined }) {
    const filter = toFilter(opts.filter);
    const { matches } = await this.index.query(values, {
      topK: opts.topK,
      returnMetadata: 'all',
      ...(filter === undefined ? {} : { filter }),
    });
    return matches.map((m) => ({ id: m.id, score: m.score, metadata: fromMetadata(m.metadata) }));
  }

  async getByIds(ids: string[]): Promise<{ id: string; values: number[] }[]> {
    const found = await this.index.getByIds(ids);
    return found.flatMap((v) => (v.values ? [{ id: v.id, values: Array.from(v.values) }] : []));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    await this.index.deleteByIds(ids);
  }
}
