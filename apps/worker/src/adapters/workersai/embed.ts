import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { Embedder } from '../../ports/embed.js';
import { type AiLike, toAiError } from './binding.js';

/** Texts per Workers AI embedding request (the API takes batches; this keeps requests small). */
const EMBED_BATCH_SIZE = 50;

const EmbeddingResponse = z.looseObject({ data: z.array(z.array(z.number())) });

export class WorkersAiEmbedder implements Embedder {
  constructor(
    private readonly ai: AiLike,
    readonly model: string,
    readonly dims: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      vectors.push(...(await this.embedBatch(texts.slice(i, i + EMBED_BATCH_SIZE))));
    }
    return vectors;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    let raw: unknown;
    try {
      raw = await this.ai.run(this.model, { text: batch });
    } catch (err) {
      throw toAiError(err, `embedding (${this.model})`);
    }

    const parsed = EmbeddingResponse.safeParse(raw);
    const vectors = parsed.success ? parsed.data.data : null;
    if (
      !vectors ||
      vectors.length !== batch.length ||
      vectors.some((v) => v.length !== this.dims)
    ) {
      throw new AppError(
        'UPSTREAM_ERROR',
        `Embedding response from ${this.model} did not match ${batch.length} × ${this.dims}`,
        { retryable: false },
      );
    }
    return vectors;
  }
}
