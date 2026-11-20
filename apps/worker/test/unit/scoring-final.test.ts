import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { finalScore, freshness } from '../../src/core/scoring/final.js';

const W = DEFAULT_SETTINGS.weights;
const NOW = new Date('2026-11-20T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('freshness', () => {
  it.each([
    [0, 100],
    [23.9, 100],
    [24, 70],
    [71, 70],
    [72, 40],
    [167, 40],
    [168, 10],
    [1000, 10],
  ])('%s hours old → %s', (hours, expected) => {
    expect(freshness(hoursAgo(hours), NOW, W)).toBe(expected);
  });

  it('uses the floor for a missing or unreadable date, and treats a future date as brand new', () => {
    expect(freshness(null, NOW, W)).toBe(10);
    expect(freshness('not a date', NOW, W)).toBe(10);
    expect(freshness(hoursAgo(-5), NOW, W)).toBe(100);
  });

  it('does not depend on the order of the tiers', () => {
    const shuffled = { ...W, freshnessTiers: [...W.freshnessTiers].reverse() };
    expect(freshness(hoursAgo(30), NOW, shuffled)).toBe(70);
  });
});

describe('finalScore', () => {
  // sim 0.85 is the top of the calibrated range → sim_norm 100
  const base = { fitScore: 80, bestSimilarity: 0.85, postedAt: hoursAgo(2), feedbackAdj: 0 };

  it('blends fit, similarity and freshness by the configured weights', () => {
    // 0.75×80 + 0.2×100 + 0.05×100 = 60 + 20 + 5
    expect(finalScore(base, W, NOW)).toBe(85);
  });

  it('rounds, then adds the feedback adjustment', () => {
    // 0.75×77 = 57.75 → 0.2×0 + 0.05×10 = 0.5 → 58.25 → 58, then −5
    const input = { fitScore: 77, bestSimilarity: 0.5, postedAt: hoursAgo(500), feedbackAdj: -5 };
    expect(finalScore(input, W, NOW)).toBe(53);
  });

  it('counts a missing similarity as zero', () => {
    expect(finalScore({ ...base, bestSimilarity: null }, W, NOW)).toBe(65);
  });

  it('stays within 0 to 100', () => {
    expect(finalScore({ ...base, fitScore: 100, feedbackAdj: 10 }, W, NOW)).toBe(100);
    expect(finalScore({ ...base, fitScore: 0, bestSimilarity: 0, feedbackAdj: -10 }, W, NOW)).toBe(
      0,
    );
  });

  it('follows changed weights', () => {
    const fitOnly = { ...W, finalFit: 1, finalPrefilterSim: 0, finalFreshness: 0 };
    expect(finalScore(base, fitOnly, NOW)).toBe(80);
  });
});
