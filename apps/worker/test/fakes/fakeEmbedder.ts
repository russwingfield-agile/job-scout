import type { Embedder } from '../../src/ports/embed.js';

const DIMS = 768;

/** FNV-1a: a small, stable string hash. */
function hash(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic embedder: hashes each word into a 768-d bag-of-words vector, L2-normalised, so
 * similar texts really are similar (dedupe/similarity tests stay meaningful) and no AI is needed.
 */
export class FakeEmbedder implements Embedder {
  readonly dims = DIMS;
  readonly model = 'fake-embedder';
  readonly calls: string[][] = [];
  /** Make the next `embed` call reject with this error. */
  failNext: Error | null = null;

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    return texts.map((text) => {
      const vector = new Array<number>(DIMS).fill(0);
      for (const token of text
        .toLowerCase()
        .split(/[^a-z0-9+#]+/)
        .filter(Boolean)) {
        const index = hash(token) % DIMS;
        vector[index] = (vector[index] as number) + 1;
      }
      const norm = Math.hypot(...vector) || 1;
      return vector.map((v) => v / norm);
    });
  }
}
