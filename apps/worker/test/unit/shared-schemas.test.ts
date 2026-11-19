import {
  AssessmentResultSchema,
  GroupStatusSchema,
  NormalisedJobSchema,
  SearchProfileInputSchema,
} from '@job-scout/shared';
import { describe, expect, it } from 'vitest';

const validAssessment = {
  fit_score: 82,
  best_cv_id: 'cv1',
  cv_scores: [{ cv_id: 'cv1', score: 82 }],
  headline: 'Strong SAFe coaching match for a transformation programme',
  strengths: ['Led SAFe rollout across 6 ARTs'],
  gaps: ['No public-sector experience'],
  red_flags: ['rate not stated'],
  seniority_match: 'match',
  extracted: {
    employment_type: 'contract',
    pay_min: 550,
    pay_max: 650,
    pay_period: 'day',
    ir35: 'outside',
    contract_length_months: 6,
    start: 'ASAP',
    work_mode: 'hybrid',
    onsite_days_per_week: 2,
    location: 'London',
    clearance: 'none',
    hiring_company: null,
    agency: 'Acme Recruitment',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    reference: null,
    closing_date: null,
  },
  apply_recommendation: 'strong_apply',
  confidence: 0.8,
};

describe('AssessmentResultSchema', () => {
  it('accepts a well-formed LLM result', () => {
    expect(AssessmentResultSchema.safeParse(validAssessment).success).toBe(true);
  });

  it.each([
    ['score above 100', { ...validAssessment, fit_score: 101 }],
    ['unknown recommendation', { ...validAssessment, apply_recommendation: 'definitely' }],
    ['headline over 140 chars', { ...validAssessment, headline: 'x'.repeat(141) }],
    ['more than 5 strengths', { ...validAssessment, strengths: Array(6).fill('s') }],
    ['confidence above 1', { ...validAssessment, confidence: 1.5 }],
    ['missing extracted block', { ...validAssessment, extracted: undefined }],
  ])('rejects %s', (_label, value) => {
    expect(AssessmentResultSchema.safeParse(value).success).toBe(false);
  });
});

describe('NormalisedJobSchema', () => {
  const job = {
    source: 'reed',
    sourceJobId: '123',
    url: 'https://www.reed.co.uk/jobs/123',
    title: 'Agile Coach',
    employerName: 'Acme',
    isAgency: null,
    location: 'London',
    workMode: 'unknown',
    employmentType: 'contract',
    payPeriod: 'day',
    currency: 'GBP',
    postedAt: '2026-11-19T07:00:00.000Z',
    descriptionHtml: '<p>Hi</p>',
    descriptionText: 'Hi',
  };

  it('accepts a minimal job with optional pay fields absent', () => {
    expect(NormalisedJobSchema.safeParse(job).success).toBe(true);
  });

  it('rejects a non-GBP currency', () => {
    expect(NormalisedJobSchema.safeParse({ ...job, currency: 'USD' }).success).toBe(false);
  });
});

describe('SearchProfileInputSchema', () => {
  it('applies spec defaults (25 miles, any IR35, active)', () => {
    const parsed = SearchProfileInputSchema.parse({
      cvId: 'cv1',
      jobTitles: ['Agile Coach'],
      locations: ['London'],
      employmentTypes: ['contract'],
    });
    expect(parsed).toMatchObject({ radiusMiles: 25, ir35Preference: 'any', active: true });
  });

  it('requires at least one job title', () => {
    const r = SearchProfileInputSchema.safeParse({
      cvId: 'cv1',
      jobTitles: [],
      locations: ['London'],
      employmentTypes: ['contract'],
    });
    expect(r.success).toBe(false);
  });
});

describe('GroupStatusSchema', () => {
  it('includes every SPEC §11 status plus the pipeline-internal ones', () => {
    for (const s of ['filtered', 'below_threshold', 'pending_llm', 'new', 'skipped', 'deferred']) {
      expect(GroupStatusSchema.safeParse(s).success).toBe(true);
    }
  });
});
