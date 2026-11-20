import type { Settings } from '@job-scout/shared';
import { normaliseTitle, tokenSetRatio } from '../parse/title.js';

type Weights = Settings['weights'];

export { cosine } from '../vectors.js';

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Map cosine similarity onto 0–100 between the calibrated bounds (SPEC §7.2). */
export function simNorm(similarity: number, weights: Pick<Weights, 'simLow' | 'simHigh'>): number {
  return clamp((similarity - weights.simLow) / (weights.simHigh - weights.simLow), 0, 1) * 100;
}

export type PrefilterInput = {
  /** Best cosine similarity to any active CV; null when there is no CV vector to compare with. */
  bestSimilarity: number | null;
  titleMatch: boolean;
  payDisclosed: boolean;
  ir35Outside: boolean;
  /** Learned adjustment, −10..+10 (M9); 0 until then. */
  feedbackAdj: number;
};

/** prefilter = clamp(sim_norm + bonuses + feedback_adj, 0, 100) — SPEC §7.2. */
export function prefilterScore(
  input: PrefilterInput,
  weights: Pick<
    Weights,
    'simLow' | 'simHigh' | 'bonusTitleMatch' | 'bonusPayDisclosed' | 'bonusIr35Outside'
  >,
): number {
  const base = input.bestSimilarity === null ? 0 : simNorm(input.bestSimilarity, weights);
  const bonus =
    (input.titleMatch ? weights.bonusTitleMatch : 0) +
    (input.payDisclosed ? weights.bonusPayDisclosed : 0) +
    (input.ir35Outside ? weights.bonusIr35Outside : 0);
  return clamp(base + bonus + input.feedbackAdj, 0, 100);
}

/** Does the job title fuzzily match any of the profile's target titles? */
export function titleMatchesProfile(
  jobTitle: string,
  profileTitles: string[],
  minRatio: number,
): boolean {
  const job = normaliseTitle(jobTitle).normalised;
  return profileTitles.some((t) => tokenSetRatio(job, normaliseTitle(t).normalised) >= minRatio);
}

/** The CV most similar to the job, or null if none were compared. */
export function bestCv(
  similarities: { cvId: string; similarity: number }[],
): { cvId: string; similarity: number } | null {
  return similarities.reduce<{ cvId: string; similarity: number } | null>(
    (best, s) => (best === null || s.similarity > best.similarity ? s : best),
    null,
  );
}
