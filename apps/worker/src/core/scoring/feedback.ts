import type { Settings } from '@job-scout/shared';

type Feedback = Settings['feedback'];

export type FeedbackInput = {
  /** Jobs from this employer or agency you skipped as agency spam. */
  agencySkips: number;
  /** You have applied to a job from this employer before. */
  appliedBefore: boolean;
  /** Best text similarity to jobs you applied for or shortlisted; null if there are none. */
  maxSimilarityToWanted: number | null;
  /** Best text similarity to jobs you skipped as "not my skills"; null if there are none. */
  maxSimilarityToUnwanted: number | null;
};

export type FeedbackResult = { adj: number; reasons: string[] };

const MAX_ADJUSTMENT = 10;

const signed = (n: number): string => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/**
 * Learn from what you have done (SPEC §10.2): a small, explained nudge to a job's score, always
 * between −10 and +10. Skips for rate, location or IR35 do not change scores silently; they
 * become suggestions on the Inbox instead.
 */
export function computeFeedbackAdj(input: FeedbackInput, s: Feedback): FeedbackResult {
  const parts: { points: number; why: string }[] = [];

  if (input.agencySkips >= s.agencySpamSkips) {
    parts.push({
      points: s.agencySpamPenalty,
      why: `you have skipped ${input.agencySkips} jobs from this employer as spam`,
    });
  }
  if (input.appliedBefore) {
    parts.push({ points: s.previousApplyBonus, why: 'you have applied to this employer before' });
  }
  if (
    input.maxSimilarityToWanted !== null &&
    input.maxSimilarityToWanted >= s.appliedSimilarityThreshold
  ) {
    parts.push({
      points: s.appliedSimilarityBonus,
      why: 'similar to jobs you applied for or shortlisted',
    });
  }
  if (
    input.maxSimilarityToUnwanted !== null &&
    input.maxSimilarityToUnwanted >= s.skippedSimilarityThreshold
  ) {
    parts.push({
      points: s.skippedSimilarityPenalty,
      why: 'similar to jobs you skipped as not your skills',
    });
  }

  const total = parts.reduce((sum, p) => sum + p.points, 0);
  return {
    adj: Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, total)),
    reasons: parts.map((p) => `${signed(p.points)}: ${p.why}`),
  };
}
