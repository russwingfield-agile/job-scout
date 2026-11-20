import { describe, expect, it } from 'vitest';
import { describeFilterReason, postedAgo } from '../src/lib/jobFormat.js';

describe('postedAgo', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  it.each([
    [null, '—'],
    ['2026-11-20T01:00:00Z', 'today'],
    ['2026-11-21T01:00:00Z', 'today'], // clock skew: never "-1 days ago"
    ['2026-11-19T11:00:00Z', 'yesterday'],
    ['2026-11-17T12:00:00Z', '3 days ago'],
  ])('%s → %s', (iso, expected) => {
    expect(postedAgo(iso, now)).toBe(expected);
  });
});

describe('describeFilterReason', () => {
  it.each([
    [null, '—'],
    ['', '—'],
    ['below_min_day_rate', 'Below your minimum day rate'],
    ['below_min_salary', 'Below your minimum salary'],
    ['inside_ir35', 'Inside IR35'],
    ['too_old', 'Posted too long ago'],
    ['no_longer_available', 'No longer on Reed'],
    ['no_matching_profile', 'No matching search profile'],
    ['excluded_keyword:graduate', 'Contains "graduate"'],
    ['employment_type:temp', 'Not a type you want (temp)'],
    ['work_mode:onsite', 'Work mode: onsite'],
    ['blocked_employer:Spam Ltd', 'Blocked employer: Spam Ltd'],
    ['blocked_keyword:unpaid', 'Blocked word: unpaid'],
    [
      'below_min_day_rate; excluded_keyword:junior',
      'Below your minimum day rate; Contains "junior"',
    ],
    ['something_new', 'something_new'],
    ['mystery:detail', 'mystery:detail'],
    ['blocked_employer:a:b', 'Blocked employer: a:b'],
  ])('%s → %s', (reason, expected) => {
    expect(describeFilterReason(reason)).toBe(expected);
  });
});
