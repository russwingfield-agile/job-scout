export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  readonly dims: number;
  readonly model: string;
}
