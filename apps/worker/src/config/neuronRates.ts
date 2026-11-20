import type { NeuronRate } from '../core/neurons.js';

/**
 * Workers AI neuron rates per million tokens, used to estimate spend against the daily budget.
 * Cloudflare publishes these as prices ($0.011 per 1,000 neurons); see docs/DECISIONS.md for which
 * figures are verified.
 */
export const NEURON_RATES: Record<string, NeuronRate> = {
  // Verified against the Workers AI pricing page, 2026-11-20.
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { inPerMillion: 26_668, outPerMillion: 204_805 },
  // UNVERIFIED (from memory of the pricing table) — confirm before relying on budget accuracy.
  '@cf/meta/llama-3.1-8b-instruct': { inPerMillion: 25_608, outPerMillion: 75_147 },
  '@cf/baai/bge-base-en-v1.5': { inPerMillion: 6_058, outPerMillion: 0 },
};

/** Unknown models are costed like the most expensive one, so the budget never under-counts. */
const UNKNOWN_MODEL_RATE = NEURON_RATES['@cf/meta/llama-3.3-70b-instruct-fp8-fast'] as NeuronRate;

export const neuronRateFor = (model: string): NeuronRate =>
  NEURON_RATES[model] ?? UNKNOWN_MODEL_RATE;
