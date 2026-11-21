import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { BANNED_PHRASES, cleanNote, limitWords, wordCount } from '../../src/core/coverNote.js';
import { computeFeedbackAdj } from '../../src/core/scoring/feedback.js';
import { suggestChanges } from '../../src/core/suggestions.js';

const F = DEFAULT_SETTINGS.feedback;
const none = {
  agencySkips: 0,
  appliedBefore: false,
  maxSimilarityToWanted: null,
  maxSimilarityToUnwanted: null,
};

describe('computeFeedbackAdj', () => {
  it('does nothing when there is no history', () => {
    expect(computeFeedbackAdj(none, F)).toEqual({ adj: 0, reasons: [] });
  });

  it.each([
    ['agency skipped 3 times', { agencySkips: 3 }, -10, /−10.*skipped 3 jobs from this employer/],
    ['agency skipped twice (below the limit)', { agencySkips: 2 }, 0, null],
    ['applied there before', { appliedBefore: true }, 5, /\+5.*applied to this employer before/],
    [
      'like a job you applied for',
      { maxSimilarityToWanted: 0.88 },
      5,
      /\+5.*similar to jobs you applied for/,
    ],
    ['just under the wanted threshold', { maxSimilarityToWanted: 0.87 }, 0, null],
    [
      'like a job skipped as not your skills',
      { maxSimilarityToUnwanted: 0.9 },
      -5,
      /−5.*not your skills/,
    ],
    ['just under the unwanted threshold', { maxSimilarityToUnwanted: 0.89 }, 0, null],
  ])('%s', (_name, over, adj, reason) => {
    const r = computeFeedbackAdj({ ...none, ...over }, F);
    expect(r.adj).toBe(adj);
    if (reason) expect(r.reasons[0]).toMatch(reason);
    else expect(r.reasons).toEqual([]);
  });

  it('adds reasons together and always stays within −10 and +10', () => {
    const good = computeFeedbackAdj(
      { ...none, appliedBefore: true, maxSimilarityToWanted: 0.95 },
      { ...F, previousApplyBonus: 8 },
    );
    expect(good.adj).toBe(10);
    expect(good.reasons).toHaveLength(2);
    const bad = computeFeedbackAdj({ ...none, agencySkips: 5, maxSimilarityToUnwanted: 0.95 }, F);
    expect(bad.adj).toBe(-10); // −10 + −5, clamped
    expect(bad.reasons).toHaveLength(2);
  });
});

describe('suggestChanges', () => {
  const profile = {
    id: 'p1',
    cvId: 'cv1',
    jobTitles: [],
    mustKeywords: [],
    excludeKeywords: [],
    locations: ['London'],
    radiusMiles: 25,
    employmentTypes: ['contract' as const],
    minDayRate: 550,
    minSalary: null,
    ir35Preference: 'any' as const,
    workModes: [],
    maxOnsiteDays: null,
    active: true,
    updatedAt: '2026-11-20T00:00:00.000Z',
  };
  const skip = (reason: string, over = {}) => ({
    reason: reason as never,
    profileId: 'p1',
    dayRate: null,
    ...over,
  });
  const many = (n: number, make: () => ReturnType<typeof skip>) => Array.from({ length: n }, make);

  it('suggests a higher minimum when low-rate skips all sit just above it', () => {
    const skips = many(5, () => skip('rate_too_low', { dayRate: 575 }));
    const [s] = suggestChanges(skips, [profile], F);
    expect(s).toMatchObject({
      id: 'min_day_rate:p1:600',
      kind: 'min_day_rate',
      patch: { minDayRate: 600 },
      actionLabel: 'Raise minimum to £600/day',
    });
    expect(s?.message).toContain('5 jobs');
  });

  it('stays quiet with too few skips, rates far above the minimum, or unknown rates', () => {
    const rate = (n: number, dayRate?: number) =>
      many(n, () => skip('rate_too_low', dayRate === undefined ? {} : { dayRate }));
    expect(suggestChanges(rate(4, 575), [profile], F)).toEqual([]);
    expect(suggestChanges(rate(5, 700), [profile], F)).toEqual([]);
    expect(suggestChanges(rate(5), [profile], F)).toEqual([]);
    expect(suggestChanges(rate(5, 575), [{ ...profile, minDayRate: null }], F)).toEqual([]);
  });

  it('suggests a smaller search area after location skips, down to a floor', () => {
    const skips = many(5, () => skip('location'));
    expect(suggestChanges(skips, [profile], F)[0]).toMatchObject({
      kind: 'radius',
      patch: { radiusMiles: 12 },
    });
    expect(suggestChanges(skips, [{ ...profile, radiusMiles: 5 }], F)).toEqual([]);
  });

  it('suggests outside-IR35 only after inside-IR35 skips, and not if already set', () => {
    const skips = many(5, () => skip('inside_ir35'));
    expect(suggestChanges(skips, [profile], F)[0]).toMatchObject({
      kind: 'ir35',
      patch: { ir35Preference: 'outside_only' },
    });
    expect(suggestChanges(skips, [{ ...profile, ir35Preference: 'outside_only' }], F)).toEqual([]);
  });

  it('counts each profile’s skips separately', () => {
    const skips = [
      ...many(3, () => skip('location')),
      ...many(3, () => skip('location', { profileId: 'p2' })),
    ];
    expect(suggestChanges(skips, [profile, { ...profile, id: 'p2' }], F)).toEqual([]);
  });
});

describe('cover note text', () => {
  it('counts words', () => {
    expect(wordCount('  one  two\nthree ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });

  it('removes a chatty first line, quotes and markdown', () => {
    expect(cleanNote('Here is your cover note:\n\nDear Sam,\nHello.')).toBe('Dear Sam,\nHello.');
    expect(cleanNote('"Hello **there**."')).toBe('Hello there.');
    expect(cleanNote('Plain note.')).toBe('Plain note.');
  });

  it('leaves a note within its limit alone, and trims an over-long one at a full sentence', () => {
    const note = 'One two three. Four five six. Seven eight nine. Ten eleven twelve.';
    expect(limitWords(note, 20)).toBe(note);
    const cut = limitWords(note, 8);
    expect(cut).toBe('One two three. Four five six.');
    expect(wordCount(cut)).toBeLessThanOrEqual(8);
  });

  it('cuts at the word limit when there is no sentence to stop at, keeping paragraphs', () => {
    expect(limitWords('alpha beta gamma delta epsilon', 3)).toBe('alpha beta gamma');
    const two = limitWords('First para here.\n\nSecond para goes on and on without stopping', 6);
    expect(wordCount(two)).toBeLessThanOrEqual(6);
    expect(two.startsWith('First para here.')).toBe(true);
  });

  it('lists the phrases the prompt forbids', () => {
    expect(BANNED_PHRASES).toContain('passionate');
  });
});
