import { describe, expect, it } from 'vitest';
import { detectContractLengthMonths } from '../../../src/core/parse/contractLength.js';
import { parseSourceDate } from '../../../src/core/parse/date.js';

describe('detectContractLengthMonths', () => {
  it.each([
    ['6 month contract', 6],
    ['6-month contract', 6],
    ['12 months initial', 12],
    ['3 month rolling contract', 3],
    ['6 months+ contract', 6],
    ['3-6 months contract', 6],
    ['Contract duration: 6 months', 6],
    ['Initial 3 months with extensions', 3],
    ['contract length of 12 months', 12],
    ['Duration 1 year', 12],
    ['1 year contract', 12],
    ['2-year fixed term contract', 24],
    ['Six month contract', null],
    ['3 months notice period', null],
    ['Minimum 6 months experience', null],
    ['1 day per month on site', null],
    ['', null],
  ])('"%s" → %s', (text, expected) => {
    expect(detectContractLengthMonths(text)).toBe(expected);
  });
});

describe('parseSourceDate', () => {
  it('parses Reed day-first dates as midnight UTC', () => {
    expect(parseSourceDate('31/07/2026')).toBe('2026-07-31T00:00:00.000Z');
    expect(parseSourceDate(' 01/12/2026 ')).toBe('2026-12-01T00:00:00.000Z');
  });

  it('rejects impossible dates', () => {
    expect(parseSourceDate('31/02/2026')).toBeNull();
    expect(parseSourceDate('15/13/2026')).toBeNull();
  });

  it('parses ISO dates and datetimes', () => {
    expect(parseSourceDate('2026-11-17T09:30:00Z')).toBe('2026-11-17T09:30:00.000Z');
    expect(parseSourceDate('2026-11-17')).toBe('2026-11-17T00:00:00.000Z');
    expect(parseSourceDate('2026-13-45')).toBeNull();
  });

  it('returns null for missing or unreadable values', () => {
    expect(parseSourceDate(undefined)).toBeNull();
    expect(parseSourceDate(null)).toBeNull();
    expect(parseSourceDate('')).toBeNull();
    expect(parseSourceDate('yesterday')).toBeNull();
  });
});
