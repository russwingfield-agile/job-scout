import { describe, expect, it } from 'vitest';
import {
  emailAppearsIn,
  type JobFacts,
  mergeExtracted,
  phoneAppearsIn,
  sanitiseAssessment,
} from '../../src/core/assessment.js';
import { validAssessment } from '../fixtures/assessment.js';

const ADVERT =
  'Agile coach wanted. Contact Sam Jones: Sam.Jones@Acme-Recruit.co.uk or call +44 (0)20 7946 0958 today.';

const withExtracted = (over: Record<string, unknown>) => {
  const a = validAssessment();
  return { ...a, extracted: { ...a.extracted, ...over } };
};

const ctx = { advertText: ADVERT, activeCvIds: ['cv1', 'cv2'], fallbackCvId: 'cv2' };

describe('contact checks', () => {
  it('finds an email in the advert regardless of case', () => {
    expect(emailAppearsIn('sam.jones@acme-recruit.co.uk', ADVERT)).toBe(true);
    expect(emailAppearsIn('someone@else.com', ADVERT)).toBe(false);
    expect(emailAppearsIn('  ', ADVERT)).toBe(false);
  });

  it('finds a phone number whatever its spacing, but not a short or absent one', () => {
    expect(phoneAppearsIn('020 7946 0958', ADVERT)).toBe(true);
    expect(phoneAppearsIn('+44 20 7946 0958', ADVERT)).toBe(false); // the advert has a (0) in it
    expect(phoneAppearsIn('0161 496 0000', ADVERT)).toBe(false);
    expect(phoneAppearsIn('123', '123 456')).toBe(false);
  });
});

describe('sanitiseAssessment', () => {
  it('keeps contacts that are written in the advert', () => {
    const out = sanitiseAssessment(
      withExtracted({
        contact_email: 'Sam.Jones@Acme-Recruit.co.uk',
        contact_phone: '020 7946 0958',
      }),
      ctx,
    );
    expect(out.extracted).toMatchObject({
      contact_email: 'Sam.Jones@Acme-Recruit.co.uk',
      contact_phone: '020 7946 0958',
    });
  });

  it('drops an email or phone the advert does not contain (hallucination)', () => {
    const out = sanitiseAssessment(
      withExtracted({ contact_email: 'recruiter@made-up.com', contact_phone: '07700 900123' }),
      ctx,
    );
    expect(out.extracted.contact_email).toBeNull();
    expect(out.extracted.contact_phone).toBeNull();
  });

  it('accepts a best CV that is active, and drops scores for CVs that are not', () => {
    const out = sanitiseAssessment(
      {
        ...validAssessment(),
        best_cv_id: 'cv1',
        cv_scores: [
          { cv_id: 'cv1', score: 70 },
          { cv_id: 'ghost', score: 99 },
        ],
      },
      ctx,
    );
    expect(out.best_cv_id).toBe('cv1');
    expect(out.cv_scores).toEqual([{ cv_id: 'cv1', score: 70 }]);
  });

  it('replaces an unknown best CV with the best-scoring valid one, else the most similar', () => {
    const scored = sanitiseAssessment(
      {
        ...validAssessment(),
        best_cv_id: 'made-up',
        cv_scores: [
          { cv_id: 'cv1', score: 50 },
          { cv_id: 'cv2', score: 60 },
        ],
      },
      ctx,
    );
    expect(scored.best_cv_id).toBe('cv2');

    const unscored = sanitiseAssessment(
      { ...validAssessment(), best_cv_id: 'made-up', cv_scores: [] },
      ctx,
    );
    expect(unscored.best_cv_id).toBe('cv2'); // the fallback
  });
});

describe('mergeExtracted', () => {
  const unknownJob: JobFacts = {
    employmentType: 'unknown',
    workMode: null,
    ir35: 'unknown',
    payMin: null,
    payMax: null,
    payPeriod: 'unknown',
    contractLengthMonths: null,
  };
  const extracted = {
    ...validAssessment().extracted,
    employment_type: 'contract',
    work_mode: 'hybrid',
    ir35: 'outside',
    pay_min: 550,
    pay_max: 650,
    pay_period: 'day',
    contract_length_months: 6,
  } as const;

  it('fills in everything our parser left unknown', () => {
    expect(mergeExtracted(unknownJob, extracted)).toEqual({
      employmentType: 'contract',
      workMode: 'hybrid',
      ir35: 'outside',
      contractLengthMonths: 6,
      payMin: 550,
      payMax: 650,
      payPeriod: 'day',
    });
  });

  it('never overrides a value our parser found', () => {
    const known: JobFacts = {
      employmentType: 'permanent',
      workMode: 'remote',
      ir35: 'inside',
      payMin: 500,
      payMax: 500,
      payPeriod: 'day',
      contractLengthMonths: 3,
    };
    expect(mergeExtracted(known, extracted)).toEqual({});
  });

  it('ignores "unknown" from the model', () => {
    expect(mergeExtracted(unknownJob, validAssessment().extracted)).toEqual({
      employmentType: 'contract', // the fixture says contract
    });
  });

  it('fills a one-sided pay figure into both bounds, and needs a pay period', () => {
    expect(mergeExtracted(unknownJob, { ...extracted, pay_min: null, pay_max: 700 })).toMatchObject(
      { payMin: 700, payMax: 700, payPeriod: 'day' },
    );
    expect(mergeExtracted(unknownJob, { ...extracted, pay_period: 'unknown' })).not.toHaveProperty(
      'payMin',
    );
    expect(
      mergeExtracted(unknownJob, { ...extracted, pay_min: null, pay_max: null }),
    ).not.toHaveProperty('payMin');
  });
});
