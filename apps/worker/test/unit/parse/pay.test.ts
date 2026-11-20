import { describe, expect, it } from 'vitest';
import {
  annualise,
  formatPay,
  inferPeriod,
  type PayHints,
  type PayParse,
  parsePay,
} from '../../../src/core/parse/pay.js';
import salaries from '../../fixtures/salaries.json';

type SalaryCase = { input: string; hints?: PayHints; expected: PayParse };

describe('parsePay — real-world UK salary strings', () => {
  it('has at least 40 fixture cases', () => {
    expect(salaries.length).toBeGreaterThanOrEqual(40);
  });

  it.each(salaries as SalaryCase[])('parses "$input" $hints', ({ input, hints, expected }) => {
    expect(parsePay(input, hints)).toEqual(expected);
  });
});

describe('inferPeriod', () => {
  it.each([
    [85_000, undefined, 'year', 'medium'],
    [10_000, 'contract', 'year', 'medium'],
    [5_000, 'contract', 'unknown', 'low'],
    [600, 'permanent', 'unknown', 'low'],
    [600, 'contract', 'day', 'medium'],
    [600, undefined, 'day', 'medium'],
    [45, 'temp', 'hour', 'medium'],
    [99.99, 'contract', 'hour', 'medium'],
    [100, 'contract', 'day', 'medium'],
  ] as const)('%s (%s) → %s/%s', (value, type, period, confidence) => {
    expect(inferPeriod(value, type)).toEqual({ period, confidence });
  });
});

describe('annualise', () => {
  const working = { workingDaysPerYear: 220, hoursPerDay: 8 };

  it('multiplies day rates by working days', () => {
    expect(annualise({ min: 550, max: 650, period: 'day' }, working)).toEqual({
      min: 121_000,
      max: 143_000,
    });
  });

  it('multiplies hourly rates by hours per day and working days', () => {
    expect(annualise({ min: 50, max: 50, period: 'hour' }, working)).toEqual({
      min: 88_000,
      max: 88_000,
    });
  });

  it('leaves yearly pay unchanged and keeps nulls', () => {
    expect(annualise({ min: null, max: 90_000, period: 'year' }, working)).toEqual({
      min: null,
      max: 90_000,
    });
    expect(annualise({ min: 70_000, max: null, period: 'year' }, working)).toEqual({
      min: 70_000,
      max: null,
    });
  });

  it('cannot annualise an unknown period', () => {
    expect(annualise({ min: 600, max: 600, period: 'unknown' }, working)).toEqual({
      min: null,
      max: null,
    });
  });

  it('honours custom working-time settings', () => {
    expect(
      annualise(
        { min: 500, max: 500, period: 'day' },
        { workingDaysPerYear: 200, hoursPerDay: 7.5 },
      ),
    ).toEqual({ min: 100_000, max: 100_000 });
  });
});

describe('formatPay', () => {
  it.each([
    [{ min: 600, max: 600, period: 'day' }, '£600/day'],
    [{ min: 550, max: 650, period: 'day' }, '£550-£650/day'],
    [{ min: null, max: 700, period: 'day' }, 'up to £700/day'],
    [{ min: 500, max: null, period: 'day' }, 'from £500/day'],
    [{ min: 45, max: 45, period: 'hour' }, '£45/hr'],
    [{ min: 45.5, max: 45.5, period: 'hour' }, '£45.50/hr'],
    [{ min: 85_000, max: 85_000, period: 'year' }, '£85k'],
    [{ min: 80_000, max: 95_000, period: 'year' }, '£80k-£95k'],
    [{ min: 82_500, max: 82_500, period: 'year' }, '£82.5k'],
    [{ min: 500, max: 500, period: 'year' }, '£500'],
    [{ min: 5_000, max: 5_000, period: 'unknown' }, '£5,000'],
    [{ min: null, max: null, period: 'unknown' }, 'Not stated'],
  ] as const)('%j → %s', (pay, expected) => {
    expect(formatPay(pay)).toBe(expected);
  });
});

describe('parsePay — behaviour details', () => {
  it('only accepts amounts with £/k when requireCurrency is set', () => {
    expect(parsePay('2 days at 550 per day', { requireCurrency: true }).confidence).toBe('none');
    expect(parsePay('rate £550 per day', { requireCurrency: true }).confidence).toBe('high');
    expect(parsePay('85k negotiable', { requireCurrency: true }).min).toBe(85_000);
  });

  it('does not read IR35, dates or headcounts as pay', () => {
    expect(parsePay('IR35 determination pending, 5 stakeholders, start 2026').confidence).toBe(
      'none',
    );
  });

  it('prefers the text over structured hints', () => {
    const r = parsePay('£500 per day', { minHint: 1, maxHint: 2, employmentType: 'contract' });
    expect(r).toMatchObject({ min: 500, max: 500, period: 'day' });
  });

  it('uses the earliest period keyword near the amount', () => {
    expect(parsePay('£45 per hour or £360 per day').period).toBe('hour');
    expect(parsePay('£360 per day or £45 per hour').period).toBe('day');
  });

  it('treats a hint-only minimum as open-ended', () => {
    expect(parsePay('', { minHint: 500, employmentType: 'contract' })).toEqual({
      min: 500,
      max: null,
      period: 'day',
      confidence: 'medium',
    });
  });

  it('copes with non-breaking spaces and mixed case', () => {
    expect(parsePay('£550 - £650 PER DAY').min).toBe(550);
    expect(parsePay('UP TO £700 P/D').max).toBe(700);
  });
});
