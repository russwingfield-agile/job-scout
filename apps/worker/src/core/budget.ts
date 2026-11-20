import type { Settings } from '@job-scout/shared';

type Budgets = Settings['budgets'];

export type SpendDecision = { ok: true } | { ok: false; reason: 'daily_budget' | 'run_cap' };

/** May we make `n` more Reed requests today and within this run? Check before every call. */
export function canSpendReed(
  usage: { usedToday: number; usedThisRun: number; n: number },
  budgets: Pick<Budgets, 'reedDailyRequestBudget' | 'reedCallsPerRunCap'>,
): SpendDecision {
  if (usage.usedToday + usage.n > budgets.reedDailyRequestBudget) {
    return { ok: false, reason: 'daily_budget' };
  }
  if (usage.usedThisRun + usage.n > budgets.reedCallsPerRunCap) {
    return { ok: false, reason: 'run_cap' };
  }
  return { ok: true };
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
