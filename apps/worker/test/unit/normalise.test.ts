import { NormalisedJobSchema, ReedJobDetailsSchema } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { normaliseReedJob } from '../../src/core/normalise.js';
import contractInside from '../fixtures/reed/contract-inside.json';
import contractOutside from '../fixtures/reed/contract-outside.json';
import permCompetitive from '../fixtures/reed/perm-competitive.json';
import permSalary from '../fixtures/reed/perm-salary.json';
import remoteContract from '../fixtures/reed/remote-contract.json';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const ctx = { profileEmploymentTypes: ['contract', 'permanent'] as const, now: NOW };
const normalise = (raw: unknown) =>
  normaliseReedJob(ReedJobDetailsSchema.parse(raw), {
    ...ctx,
    profileEmploymentTypes: [...ctx.profileEmploymentTypes],
  });

describe('normaliseReedJob', () => {
  it('contract outside IR35 (agency, hybrid, 6 months)', () => {
    const job = normalise(contractOutside);
    expect(job).toMatchObject({
      source: 'reed',
      sourceJobId: '51000001',
      url: 'https://www.reed.co.uk/jobs/agile-coach/51000001',
      externalApplyUrl: 'https://brightpath.example/jobs/ac-114',
      employerName: 'Brightpath Recruitment',
      isAgency: true,
      location: 'London',
      employmentType: 'contract',
      salaryText: '£550 - £650 per day',
      payMin: 550,
      payMax: 650,
      payPeriod: 'day',
      currency: 'GBP',
      ir35: 'outside',
      workMode: 'hybrid',
      onsiteDaysPerWeek: 2,
      contractLengthMonths: 6,
      postedAt: '2026-11-12T00:00:00.000Z',
      expiresAt: '2026-12-31T00:00:00.000Z',
      applicationsCount: 14,
    });
    expect(job.descriptionText).toContain("major retail bank's transformation programme");
    expect(job.descriptionText).toContain('- Coach 6 SAFe Agile Release Trains');
    expect(NormalisedJobSchema.safeParse(job).success).toBe(true);
  });

  it('contract inside IR35 (onsite, ISO dates, applications field)', () => {
    const job = normalise(contractInside);
    expect(job).toMatchObject({
      employmentType: 'contract',
      payMin: 450,
      payMax: 480,
      payPeriod: 'day',
      ir35: 'inside',
      workMode: 'onsite',
      contractLengthMonths: 12,
      postedAt: '2026-11-17T09:30:00.000Z',
      expiresAt: '2026-12-30T00:00:00.000Z',
      applicationsCount: 3,
      isAgency: null,
      url: 'https://www.reed.co.uk/jobs/51000002',
    });
    expect(job).not.toHaveProperty('externalApplyUrl');
    expect(NormalisedJobSchema.safeParse(job).success).toBe(true);
  });

  it('permanent with a salary (no IR35 or contract length)', () => {
    const job = normalise(permSalary);
    expect(job).toMatchObject({
      employmentType: 'permanent',
      payMin: 60000,
      payMax: 70000,
      payPeriod: 'year',
      workMode: 'hybrid',
      onsiteDaysPerWeek: 3,
      isAgency: null,
    });
    expect(job).not.toHaveProperty('ir35');
    expect(job).not.toHaveProperty('contractLengthMonths');
    expect(NormalisedJobSchema.safeParse(job).success).toBe(true);
  });

  it('permanent with "competitive" salary leaves pay unknown', () => {
    const job = normalise(permCompetitive);
    expect(job).toMatchObject({
      employmentType: 'permanent',
      payPeriod: 'unknown',
      salaryText: 'Competitive',
    });
    expect(job).not.toHaveProperty('payMin');
    expect(job).not.toHaveProperty('payMax');
    expect(job).not.toHaveProperty('applicationsCount');
    expect(job.workMode).toBe('unknown');
    expect(NormalisedJobSchema.safeParse(job).success).toBe(true);
  });

  it('reads an explicit-period rate quoted in the advert when Reed gives no pay at all', () => {
    const job = normalise({
      jobId: 8,
      jobTitle: 'Programme Manager',
      jobDescription: '<p>Rate: £500 - £550 per day. Contract role.</p>',
    });
    expect(job).toMatchObject({
      payMin: 500,
      payMax: 550,
      payPeriod: 'day',
      employmentType: 'contract',
    });
  });

  it('remote contract with no salary field: pay from Reed min/max, type from the profile hint', () => {
    const job = normaliseReedJob(ReedJobDetailsSchema.parse(remoteContract), {
      profileEmploymentTypes: ['contract'],
      now: NOW,
    });
    expect(job).toMatchObject({
      employmentType: 'contract',
      workMode: 'remote',
      payMin: 600,
      payMax: 700,
      payPeriod: 'day',
      ir35: 'outside',
      contractLengthMonths: 3,
      isAgency: true,
      postedAt: NOW.toISOString(),
    });
    expect(job).not.toHaveProperty('salaryText');
    expect(job).not.toHaveProperty('expiresAt');
    expect(NormalisedJobSchema.safeParse(job).success).toBe(true);
  });

  it('falls back to structured min/max when salary text has no amount', () => {
    const job = normalise({ ...permCompetitive, minimumSalary: 80000, maximumSalary: 95000 });
    expect(job).toMatchObject({ payMin: 80000, payMax: 95000, payPeriod: 'year' });
  });

  it('ignores a low-confidence amount in the advert body', () => {
    const job = normalise({
      jobId: 1,
      jobTitle: 'Delivery Manager',
      jobDescription: '<p>Our turnover is £50m. Permanent.</p>',
    });
    expect(job.payPeriod).toBe('unknown');
    expect(job).not.toHaveProperty('payMin');
  });

  it('tolerates a nearly empty Reed payload', () => {
    const job = normalise({ jobId: 7 });
    expect(job).toMatchObject({
      sourceJobId: '7',
      title: '',
      employmentType: 'unknown',
      workMode: 'unknown',
      payPeriod: 'unknown',
      postedAt: NOW.toISOString(),
    });
    expect(NormalisedJobSchema.safeParse(job).success).toBe(true);
  });

  it('omits applicationsCount when Reed sends explicit nulls', () => {
    const job = normalise({ ...permCompetitive, applicationCount: null, applications: null });
    expect(job).not.toHaveProperty('applicationsCount');
  });

  it('keeps unknown fields out of the normalised shape', () => {
    expect(normalise({ ...contractOutside, somethingNew: 'x' })).not.toHaveProperty('somethingNew');
  });
});
