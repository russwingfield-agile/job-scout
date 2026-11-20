export type NeuronRate = {
  /** Neurons per million input tokens. */
  inPerMillion: number;
  /** Neurons per million output tokens. */
  outPerMillion: number;
};

const CHARS_PER_TOKEN = 4;

/** Rough token count when the provider does not report one. */
export const approxTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** Neurons for a call, rounded up so the daily budget errs on the cautious side. */
export const estimateNeurons = (rate: NeuronRate, inTokens: number, outTokens: number): number =>
  Math.ceil((inTokens * rate.inPerMillion + outTokens * rate.outPerMillion) / 1_000_000);
