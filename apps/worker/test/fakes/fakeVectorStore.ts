import type { VectorMeta, VectorQueryFilter, VectorStore } from '../../src/ports/vector.js';

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [i, x] of a.entries()) {
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

/** In-memory brute-force vector store with metadata filtering. */
export class FakeVectorStore implements VectorStore {
  readonly items = new Map<string, { values: number[]; metadata: VectorMeta }>();

  async upsert(items: { id: string; values: number[]; metadata: VectorMeta }[]): Promise<void> {
    for (const { id, values, metadata } of items) this.items.set(id, { values, metadata });
  }

  async query(values: number[], opts: { topK: number; filter?: VectorQueryFilter | undefined }) {
    const { filter } = opts;
    return [...this.items.entries()]
      .filter(([, v]) => filter?.kind === undefined || v.metadata.kind === filter.kind)
      .filter(
        ([, v]) =>
          filter?.postedTsGte === undefined || (v.metadata.postedTs ?? 0) >= filter.postedTsGte,
      )
      .map(([id, v]) => ({ id, score: cosine(values, v.values), metadata: v.metadata }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK);
  }

  async getByIds(ids: string[]) {
    return ids.flatMap((id) => {
      const found = this.items.get(id);
      return found ? [{ id, values: found.values }] : [];
    });
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) this.items.delete(id);
  }
}
