import type { Settings } from '@job-scout/shared';
import { simNorm } from './prefilter.js';

type Weights = Settings['weights'];

const HOUR_MS = 3_600_000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** How recent the advert is, 0–100: the first tier the advert is younger than, else the floor (SPEC §7.4). */
export function freshness(
  postedAt: string | null,
  now: Date,
  weights: Pick<Weights, 'freshnessTiers' | 'freshnessFloor'>,
): number {
  const posted = postedAt === null ? Number.NaN : Date.parse(postedAt);
  if (Number.isNaN(posted)) return weights.freshnessFloor;
  const ageHours = Math.max(0, (now.getTime() - posted) / HOUR_MS);
  const tiers = [...weights.freshnessTiers].sort((a, b) => a.maxHours - b.maxHours);
  return tiers.find((t) => ageHours < t.maxHours)?.score ?? weights.freshnessFloor;
}

export type FinalScoreInput = {
  /** The model's 0–100 fit score. */
  fitScore: number;
  /** Best cosine similarity to an active CV; null when none was compared. */
  bestSimilarity: number | null;
  postedAt: string | null;
  /** Learned adjustment, −10..+10 (M9); 0 until then. */
  feedbackAdj: number;
};

/** final = round(w·fit + w·sim_norm + w·freshness) + feedback_adj, kept within 0–100 (SPEC §7.4). */
export function finalScore(input: FinalScoreInput, weights: Weights, now: Date): number {
  const sim = input.bestSimilarity === null ? 0 : simNorm(input.bestSimilarity, weights);
  const blended =
    weights.finalFit * input.fitScore +
    weights.finalPrefilterSim * sim +
    weights.finalFreshness * freshness(input.postedAt, now, weights);
  return clamp(Math.round(blended) + input.feedbackAdj, 0, 100);
}
