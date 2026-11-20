import { describe, expect, it } from 'vitest';
import { canSpendNeurons, canSpendReed, shouldUseFallbackModel } from '../../src/core/budget.js';

const reedBudgets = { reedDailyRequestBudget: 900, reedCallsPerRunCap: 60 };

describe('canSpendReed', () => {
  it.each([
    [{ usedToday: 0, usedThisRun: 0, n: 1 }, { ok: true }],
    [{ usedToday: 899, usedThisRun: 0, n: 1 }, { ok: true }],
    [
      { usedToday: 900, usedThisRun: 0, n: 1 },
      { ok: false, reason: 'daily_budget' },
    ],
    [
      { usedToday: 895, usedThisRun: 0, n: 6 },
      { ok: false, reason: 'daily_budget' },
    ],
    [{ usedToday: 10, usedThisRun: 59, n: 1 }, { ok: true }],
    [
      { usedToday: 10, usedThisRun: 60, n: 1 },
      { ok: false, reason: 'run_cap' },
    ],
    [
      { usedToday: 10, usedThisRun: 55, n: 6 },
      { ok: false, reason: 'run_cap' },
    ],
    // The daily budget is reported first when both are exceeded.
    [
      { usedToday: 900, usedThisRun: 60, n: 1 },
      { ok: false, reason: 'daily_budget' },
    ],
  ])('%j → %j', (usage, expected) => {
    expect(canSpendReed(usage, reedBudgets)).toEqual(expected);
  });

  it('refuses everything when the budget is zero', () => {
    const zero = { reedDailyRequestBudget: 0, reedCallsPerRunCap: 0 };
    expect(canSpendReed({ usedToday: 0, usedThisRun: 0, n: 1 }, zero).ok).toBe(false);
  });
});

describe('canSpendNeurons', () => {
  const budgets = { aiDailyNeuronBudget: 10_000 };

  it('allows spend up to and including the budget', () => {
    expect(canSpendNeurons(9_000, 1_000, budgets)).toBe(true);
    expect(canSpendNeurons(9_000, 1_001, budgets)).toBe(false);
    expect(canSpendNeurons(0, 200, budgets)).toBe(true);
  });
});

describe('shouldUseFallbackModel', () => {
  const budgets = { aiDailyNeuronBudget: 10_000, fallbackModelAtFraction: 0.8 };

  it('switches strictly above the configured fraction', () => {
    expect(shouldUseFallbackModel(0, budgets)).toBe(false);
    expect(shouldUseFallbackModel(8_000, budgets)).toBe(false);
    expect(shouldUseFallbackModel(8_001, budgets)).toBe(true);
    expect(shouldUseFallbackModel(20_000, budgets)).toBe(true);
  });
});
