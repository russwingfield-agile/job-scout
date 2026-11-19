import { SettingsSchema } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { applyPatch, deepMerge, mergeSettings } from '../../src/core/settingsMerge.js';

describe('DEFAULT_SETTINGS', () => {
  it('is valid against the shared schema', () => {
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('matches the SPEC defaults', () => {
    expect(DEFAULT_SETTINGS.schedule['mon-fri']).toEqual(['07:00', '12:00', '17:00']);
    expect(DEFAULT_SETTINGS.budgets).toMatchObject({
      maxLlmPerRun: 30,
      reedDailyRequestBudget: 900,
      maxPagesPerQuery: 3,
    });
    expect(DEFAULT_SETTINGS.dedupe.similarity).toBe(0.92);
    expect(DEFAULT_SETTINGS.thresholds.prefilterMin).toBe(55);
    expect(DEFAULT_SETTINGS.working.workingDaysPerYear).toBe(220);
  });
});

describe('deepMerge', () => {
  it('merges plain objects recursively and replaces arrays and scalars', () => {
    const merged = deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: undefined });
    expect(merged).toEqual({ a: { b: 1, c: [3] }, d: 1 });
  });
});

describe('mergeSettings', () => {
  it('returns defaults when there are no overrides', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual({
      settings: DEFAULT_SETTINGS,
      invalidSections: [],
    });
  });

  it('merges a partial override over defaults', () => {
    const { settings } = mergeSettings(DEFAULT_SETTINGS, { budgets: { maxLlmPerRun: 5 } });
    expect(settings.budgets.maxLlmPerRun).toBe(5);
    expect(settings.budgets.maxPagesPerQuery).toBe(3);
  });

  it('ignores an invalid stored section and reports it, keeping the others', () => {
    const { settings, invalidSections } = mergeSettings(DEFAULT_SETTINGS, {
      thresholds: { prefilterMin: 999 },
      working: { workingDaysPerYear: 200 },
    });
    expect(invalidSections).toEqual(['thresholds']);
    expect(settings.thresholds).toEqual(DEFAULT_SETTINGS.thresholds);
    expect(settings.working.workingDaysPerYear).toBe(200);
  });
});

describe('applyPatch', () => {
  it('accepts a valid patch and returns only the patched sections as overrides', () => {
    const result = applyPatch(DEFAULT_SETTINGS, {}, { retention: { filteredDays: 14 } });
    expect(result).toMatchObject({ ok: true, overrides: { retention: { filteredDays: 14 } } });
    if (result.ok) expect(Object.keys(result.overrides)).toEqual(['retention']);
  });

  it('accumulates onto previously stored overrides', () => {
    const result = applyPatch(
      DEFAULT_SETTINGS,
      { budgets: { maxLlmPerRun: 10 } },
      { budgets: { maxPagesPerQuery: 5 } },
    );
    expect(result).toMatchObject({
      ok: true,
      overrides: { budgets: { maxLlmPerRun: 10, maxPagesPerQuery: 5 } },
    });
  });

  it('rejects out-of-range values with a path', () => {
    const result = applyPatch(DEFAULT_SETTINGS, {}, { dedupe: { similarity: 1.5 } });
    expect(result).toMatchObject({ ok: false, issues: [{ path: 'dedupe.similarity' }] });
  });

  it('rejects weights that do not sum to 1', () => {
    const result = applyPatch(DEFAULT_SETTINGS, {}, { weights: { finalFit: 0.9 } });
    expect(result.ok).toBe(false);
  });

  it('accepts weights that are rebalanced together', () => {
    const result = applyPatch(
      DEFAULT_SETTINGS,
      {},
      { weights: { finalFit: 0.6, finalPrefilterSim: 0.3, finalFreshness: 0.1 } },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects badge thresholds that are not strictly ordered', () => {
    const result = applyPatch(DEFAULT_SETTINGS, {}, { thresholds: { badgeGood: 85 } });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed schedule slots', () => {
    expect(applyPatch(DEFAULT_SETTINGS, {}, { schedule: { sat: ['7am'] } }).ok).toBe(false);
    expect(applyPatch(DEFAULT_SETTINGS, {}, { schedule: { sat: ['25:00'] } }).ok).toBe(false);
    expect(applyPatch(DEFAULT_SETTINGS, {}, { schedule: { sat: ['09:30'] } }).ok).toBe(true);
  });
});
