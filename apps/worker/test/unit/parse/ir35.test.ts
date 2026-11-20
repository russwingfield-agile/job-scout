import { describe, expect, it } from 'vitest';
import { detectIr35 } from '../../../src/core/parse/ir35.js';

const cases: [string, string, 'high' | 'medium' | 'low' | 'none'][] = [
  ['Outside IR35', 'outside', 'high'],
  ['outside of IR35', 'outside', 'high'],
  ['This role is outside the IR35 legislation', 'outside', 'high'],
  ['Inside IR35', 'inside', 'high'],
  ['inside of ir35', 'inside', 'high'],
  ['IR35: Outside', 'outside', 'high'],
  ['IR35 status: Inside', 'inside', 'high'],
  ['IR35 - outside', 'outside', 'high'],
  ['IR 35: outside', 'outside', 'high'],
  ['IR-35 inside', 'inside', 'high'],
  ['This role falls outside IR35', 'outside', 'high'],
  ['Not caught by IR35', 'outside', 'high'],
  ['The role is caught by IR35', 'inside', 'high'],
  ['Engagement is within IR35', 'inside', 'high'],
  ['non-IR35 contract', 'outside', 'high'],
  ['Inside IR35 (umbrella)', 'inside', 'high'],
  ['IR35 determination TBC', 'unknown', 'low'],
  ['IR35 status to be confirmed', 'unknown', 'low'],
  ['Determination TBC', 'unknown', 'low'],
  ['PAYE / umbrella only', 'inside', 'medium'],
  ['Payment via umbrella company', 'inside', 'medium'],
  ['Contract via your own Ltd company', 'outside', 'low'],
  ['Work via Ltd company', 'outside', 'low'],
  ['Outside IR35, though some roles are inside IR35', 'unknown', 'low'],
  ['Paid via PAYE or your own limited company', 'unknown', 'low'],
  ['Six month contract in London', 'unknown', 'none'],
  ['', 'unknown', 'none'],
];

describe('detectIr35', () => {
  it('covers at least 15 phrases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it.each(cases)('%s → %s (%s)', (text, value, confidence) => {
    expect(detectIr35(text)).toEqual({ value, confidence });
  });
});
