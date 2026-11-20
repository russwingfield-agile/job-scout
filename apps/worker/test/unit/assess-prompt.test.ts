import { describe, expect, it } from 'vitest';
import { ASSESS_PROMPT_VERSION, buildAssessPrompt } from '../../src/ai/prompts/assess.js';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { isLastSlotOfDay } from '../../src/core/schedule.js';

const job = {
  title: 'Agile Coach',
  employerName: 'Acme',
  location: 'London',
  workMode: 'hybrid',
  employmentType: 'contract',
  payText: '£600-£650/day',
  ir35: 'outside',
  contractLengthMonths: 6,
  descriptionText: 'Coach SAFe teams.',
};
const summary = {
  headline: 'Enterprise agile coach',
  seniority: 'lead',
  yearsExperience: 12,
  skills: ['SAFe', 'Kanban'],
  sectors: ['Banking'],
  suggestedTitles: [],
  suggestedKeywords: [],
};
const cv = (id: string, over = {}) => ({
  id,
  label: `CV ${id}`,
  summary,
  fullText: null,
  similarity: 0.7,
  ...over,
});
const profile = {
  id: 'p1',
  cvId: 'cv1',
  jobTitles: ['Agile Coach'],
  mustKeywords: [],
  excludeKeywords: [],
  locations: ['London', 'Remote'],
  radiusMiles: 25,
  employmentTypes: ['contract' as const],
  minDayRate: 500,
  minSalary: null,
  ir35Preference: 'prefer_outside' as const,
  workModes: ['hybrid' as const],
  maxOnsiteDays: 2,
  active: true,
  updatedAt: '2026-11-20T00:00:00.000Z',
};
const base = {
  job,
  cvs: [cv('cv1'), cv('cv2')],
  profiles: [profile],
  maxJobTokens: 3500,
  maxCvTokens: 2000,
};

describe('buildAssessPrompt', () => {
  it('is versioned and deterministic', () => {
    const a = buildAssessPrompt(base);
    const b = buildAssessPrompt(base);
    expect(a).toEqual(b);
    expect(a.version).toBe(ASSESS_PROMPT_VERSION);
    expect(ASSESS_PROMPT_VERSION).toBe('assess@2');
  });

  it('states the scoring rubric and the no-invention rule', () => {
    const { system } = buildAssessPrompt(base);
    expect(system).toContain('90-100');
    expect(system).toContain('below 40');
    expect(system).toContain('Never invent them');
  });

  it('includes the advert, the preferences and every CV by id', () => {
    const { user } = buildAssessPrompt(base);
    expect(user).toContain('Title: Agile Coach');
    expect(user).toContain('Pay (parsed): £600-£650/day');
    expect(user).toContain('Contract length: 6 months');
    expect(user).toContain('Minimum day rate: £500');
    expect(user).toContain('IR35: prefer outside');
    expect(user).toContain('Max days on site: 2');
    expect(user).toContain('CV id: cv1');
    expect(user).toContain('CV id: cv2');
    expect(user).toContain('Skills: SAFe, Kanban');
  });

  it('shows full text only for the CVs that carry it, and truncates long text', () => {
    const long = 'x'.repeat(20_000);
    const { user } = buildAssessPrompt({
      ...base,
      cvs: [cv('cv1', { fullText: long }), cv('cv2')],
      job: { ...job, descriptionText: long },
      maxJobTokens: 100,
      maxCvTokens: 50,
    });
    expect(user.match(/Full text:/g)).toHaveLength(1);
    expect(user.match(/\[…truncated\]/g)).toHaveLength(2);
    expect(user.length).toBeLessThan(2_000);
  });

  it('copes with a CV that has no summary and a job with no description or preferences', () => {
    const { user } = buildAssessPrompt({
      ...base,
      cvs: [cv('cv1', { summary: null })],
      job: { ...job, descriptionText: null, contractLengthMonths: null },
      profiles: [],
    });
    expect(user).toContain('No stated preferences.');
    expect(user).toContain('CV id: cv1');
    expect(user).not.toContain('Contract length');
  });
});

describe('isLastSlotOfDay', () => {
  const S = DEFAULT_SETTINGS.schedule; // weekdays 07:00, 12:00, 17:00; Sunday 17:00; Saturday none
  const friday = new Date('2026-11-20T17:00:00Z');
  it('is true only for the last slot of the day', () => {
    expect(isLastSlotOfDay('2026-11-20T17:00', friday, S)).toBe(true);
    expect(isLastSlotOfDay('2026-11-20T12:00', friday, S)).toBe(false);
    expect(isLastSlotOfDay('2026-11-22T17:00', new Date('2026-11-22T17:00:00Z'), S)).toBe(true);
  });

  it('is false for manual runs, junk keys and days with no slots', () => {
    expect(isLastSlotOfDay('manual:01ABC', friday, S)).toBe(false);
    expect(isLastSlotOfDay('', friday, S)).toBe(false);
    expect(isLastSlotOfDay('2026-11-21T17:00', new Date('2026-11-21T17:00:00Z'), S)).toBe(false);
  });
});
