import { describe, expect, it } from 'vitest';
import { detectEmploymentType } from '../../../src/core/parse/employmentType.js';

describe('detectEmploymentType', () => {
  it.each([
    [{ contractType: 'Permanent' }, 'permanent'],
    [{ contractType: 'Contract' }, 'contract'],
    [{ contractType: 'Temporary' }, 'temp'],
    [{ contractType: 'Fixed Term' }, 'contract'],
    [{ jobType: 'Contract' }, 'contract'],
    [{ contractType: 'Full time', jobType: 'Permanent' }, 'permanent'],
  ] as const)('structured field %j → %s', (input, expected) => {
    expect(detectEmploymentType(input)).toBe(expected);
  });

  it('prefers contractType over contradicting text', () => {
    expect(detectEmploymentType({ contractType: 'Permanent', text: 'day rate £500' })).toBe(
      'permanent',
    );
  });

  it.each([
    ['£550 per day, outside IR35', 'contract'],
    ['6 month contract', 'contract'],
    ['Interim Programme Manager', 'contract'],
    ['Permanent role, £70k per annum', 'permanent'],
    ['A perm opportunity', 'permanent'],
    ['Temporary cover for 3 weeks', 'temp'],
    ['permanent contract of employment with 25 days holiday', 'permanent'],
    ['Permanent or contract considered', 'unknown'],
    ['Great opportunity in London', 'unknown'],
    ['', 'unknown'],
  ])('wording "%s" → %s', (text, expected) => {
    expect(detectEmploymentType({ text })).toBe(expected);
  });

  it('works with no text at all', () => {
    expect(detectEmploymentType({})).toBe('unknown');
  });

  it('falls back to a single requested type, never a pair', () => {
    expect(detectEmploymentType({ profileEmploymentTypes: ['contract'] })).toBe('contract');
    expect(detectEmploymentType({ profileEmploymentTypes: ['contract', 'permanent'] })).toBe(
      'unknown',
    );
    expect(detectEmploymentType({ profileEmploymentTypes: [] })).toBe('unknown');
  });

  it('uses wording before the profile fallback', () => {
    expect(
      detectEmploymentType({ text: 'permanent role', profileEmploymentTypes: ['contract'] }),
    ).toBe('permanent');
  });
});
