export type VectorMeta = {
  kind: 'job' | 'cv';
  /** Posting time, epoch milliseconds (jobs only). */
  postedTs?: number | undefined;
  groupId?: string | undefined;
};

export type VectorQueryFilter = {
  kind?: VectorMeta['kind'] | undefined;
  postedTsGte?: number | undefined;
};

export interface VectorStore {
  upsert(items: { id: string; values: number[]; metadata: VectorMeta }[]): Promise<void>;
  query(
    values: number[],
    opts: { topK: number; filter?: VectorQueryFilter | undefined },
  ): Promise<{ id: string; score: number; metadata: VectorMeta }[]>;
  getByIds(ids: string[]): Promise<{ id: string; values: number[] }[]>;
  deleteByIds(ids: string[]): Promise<void>;
}
