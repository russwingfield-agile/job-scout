import { cosine, decodeVector, encodeVector } from '../core/vectors.js';
import type { Repos } from '../db/repos/index.js';
import { toIso } from '../lib/time.js';
import type { Clock } from '../ports/clock.js';
import type { VectorMeta, VectorQueryFilter, VectorStore } from '../ports/vector.js';

/**
 * VectorStore backed by D1: exact nearest-neighbour by scanning the candidate rows and ranking with
 * cosine similarity. Needs no extra Cloudflare resource, and for a few CVs plus a few hundred recent
 * jobs it is fast. If volumes ever outgrow it, swap in `VectorizeStore` behind the same port.
 */
export class D1VectorStore implements VectorStore {
  constructor(
    private readonly repo: Repos['vectors'],
    private readonly clock: Clock,
  ) {}

  async upsert(items: { id: string; values: number[]; metadata: VectorMeta }[]): Promise<void> {
    const createdAt = toIso(this.clock.now());
    await this.repo.upsertMany(
      items.map((i) => ({
        id: i.id,
        kind: i.metadata.kind,
        postedTs: i.metadata.postedTs ?? null,
        groupId: i.metadata.groupId ?? null,
        embedding: encodeVector(i.values),
        createdAt,
      })),
    );
  }

  async query(values: number[], opts: { topK: number; filter?: VectorQueryFilter | undefined }) {
    const rows = await this.repo.listCandidates(opts.filter ?? {});
    return rows
      .map((row) => ({
        id: row.id,
        score: cosine(values, decodeVector(row.embedding)),
        metadata: {
          kind: row.kind,
          ...(row.postedTs === null ? {} : { postedTs: row.postedTs }),
          ...(row.groupId === null ? {} : { groupId: row.groupId }),
        } satisfies VectorMeta,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK);
  }

  async getByIds(ids: string[]): Promise<{ id: string; values: number[] }[]> {
    const rows = await this.repo.getByIds(ids);
    return rows.map((row) => ({ id: row.id, values: decodeVector(row.embedding) }));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    await this.repo.deleteByIds(ids);
  }
}
