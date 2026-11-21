import type { Settings } from '@job-scout/shared';

type Budgets = Settings['budgets'];

export type SpendDecision = { ok: true } | { ok: false; reason: 'daily_budget' | 'run_cap' };

/** May we make `n` more requests to a source today and within this run? Check before every call. */
export function canSpendCalls(
  usage: { usedToday: number; usedThisRun: number; n: number },
  limits: { daily: number; perRun: number },
): SpendDecision {
  if (usage.usedToday + usage.n > limits.daily) return { ok: false, reason: 'daily_budget' };
  if (usage.usedThisRun + usage.n > limits.perRun) return { ok: false, reason: 'run_cap' };
  return { ok: true };
}

/** Reed's version of {@link canSpendCalls}, using the Reed budgets from Settings. */
export function canSpendReed(
  usage: { usedToday: number; usedThisRun: number; n: number },
  budgets: Pick<Budgets, 'reedDailyRequestBudget' | 'reedCallsPerRunCap'>,
): SpendDecision {
  return canSpendCalls(usage, {
    daily: budgets.reedDailyRequestBudget,
    perRun: budgets.reedCallsPerRunCap,
  });
}

/** The daily and per-run request limits for a source; sources without their own use Adzuna's. */
export function callLimitsFor(
  source: string,
  budgets: Pick<
    Budgets,
    | 'reedDailyRequestBudget'
    | 'reedCallsPerRunCap'
    | 'adzunaDailyRequestBudget'
    | 'adzunaCallsPerRunCap'
  >,
): { daily: number; perRun: number } {
  return source === 'reed'
    ? { daily: budgets.reedDailyRequestBudget, perRun: budgets.reedCallsPerRunCap }
    : { daily: budgets.adzunaDailyRequestBudget, perRun: budgets.adzunaCallsPerRunCap };
}

/** Would an estimated `estimate` neurons still fit in today's Workers AI budget? */
export function canSpendNeurons(
  usedToday: number,
  estimate: number,
  budgets: Pick<Budgets, 'aiDailyNeuronBudget'>,
): boolean {
  return usedToday + estimate <= budgets.aiDailyNeuronBudget;
}

/** Switch to the cheap fallback model once enough of the daily neuron budget is spent. */
export function shouldUseFallbackModel(
  usedNeuronsToday: number,
  budgets: Pick<Budgets, 'aiDailyNeuronBudget' | 'fallbackModelAtFraction'>,
): boolean {
  return usedNeuronsToday > budgets.aiDailyNeuronBudget * budgets.fallbackModelAtFraction;
}
