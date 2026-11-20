import type { AssessmentResult } from '@job-scout/shared';

/** A valid model answer for one CV ("cv1"); tests override the parts they care about. */
export const validAssessment = (over: Partial<AssessmentResult> = {}): AssessmentResult => ({
  fit_score: 80,
  best_cv_id: 'cv1',
  cv_scores: [{ cv_id: 'cv1', score: 80 }],
  headline: 'Strong SAFe coaching match',
  strengths: ['Led a SAFe transformation at a bank'],
  gaps: ['No public-sector experience'],
  red_flags: [],
  seniority_match: 'match',
  extracted: {
    employment_type: 'contract',
    pay_min: null,
    pay_max: null,
    pay_period: 'unknown',
    ir35: 'unknown',
    contract_length_months: null,
    start: null,
    work_mode: 'unknown',
    onsite_days_per_week: null,
    location: null,
    clearance: 'none',
    hiring_company: null,
    agency: null,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    reference: null,
    closing_date: null,
  },
  apply_recommendation: 'apply',
  confidence: 0.8,
  ...over,
});

/** The same, as the JSON text a model would return. */
export const assessmentJson = (over: Partial<AssessmentResult> = {}): string =>
  JSON.stringify(validAssessment(over));
