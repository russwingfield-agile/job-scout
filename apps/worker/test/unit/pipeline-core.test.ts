import type { SearchProfile } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { backoffSeconds } from '../../src/core/backoff.js';
import { jobEmbeddingText } from '../../src/core/embedText.js';
import { containsWord, evaluateAcrossProfiles, evaluateFilters } from '../../src/core/filters.js';
import { planQueries } from '../../src/core/queries.js';
import {
  bestCv,
  prefilterScore,
  simNorm,
  titleMatchesProfile,
} from '../../src/core/scoring/prefilter.js';
import { newUlid } from '../../src/lib/ids.js';

const profile = (over: Partial<SearchProfile> = {}): SearchProfile => ({
  id: 'p1',
  cvId: 'cv1',
  jobTitles: ['Agile Coach'],
  mustKeywords: [],
  excludeKeywords: [],
  locations: ['London'],
  radiusMiles: 25,
  employmentTypes: ['contract', 'permanent'],
  minDayRate: null,
  minSalary: null,
  ir35Preference: 'any',
  workModes: [],
  maxOnsiteDays: null,
  active: true,
  updatedAt: '2026-11-20T09:00:00.000Z',
  ...over,
});

describe('planQueries', () => {
  it('makes one query per title × location, treating "Remote" as no location', () => {
    const planned = planQueries([
      profile({ jobTitles: ['Agile Coach', 'Scrum Master'], locations: ['London', 'Remote'] }),
    ]);
    expect(planned.map((q) => [q.query.keywords, q.query.location])).toEqual([
      ['Agile Coach', 'London'],
      ['Agile Coach', null],
      ['Scrum Master', 'London'],
      ['Scrum Master', null],
    ]);
    expect(planned[0]?.query).toEqual({
      keywords: 'Agile Coach',
      location: 'London',
      radiusMiles: 25,
      employmentTypes: ['contract', 'permanent'],
      minSalary: null,
    });
  });

  it('merges identical queries from different profiles and keeps every profile id', () => {
    const planned = planQueries([
      profile({ id: 'a', jobTitles: ['agile coach '], locations: ['london'] }),
      profile({ id: 'b', cvId: 'cv2', jobTitles: ['Agile Coach'], locations: ['London'] }),
    ]);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.profileIds).toEqual(['a', 'b']);
  });

  it('keeps queries apart when any search parameter differs', () => {
    const base = profile({ id: 'a' });
    const variants = [
      profile({ id: 'b', radiusMiles: 10 }),
      profile({ id: 'c', employmentTypes: ['contract'] }),
      profile({ id: 'd', minSalary: 70_000 }),
    ];
    expect(planQueries([base, ...variants])).toHaveLength(4);
  });

  it('does not list a profile twice when it repeats a title', () => {
    const planned = planQueries([profile({ jobTitles: ['Agile Coach', 'agile coach'] })]);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.profileIds).toEqual(['p1']);
  });

  it('ignores the order of employment types, and plans nothing for no profiles', () => {
    const a = planQueries([profile({ employmentTypes: ['permanent', 'contract'] })]);
    const b = planQueries([profile({ id: 'q', employmentTypes: ['contract', 'permanent'] })]);
    expect(a[0]?.queryKey).toBe(b[0]?.queryKey);
    expect(planQueries([])).toEqual([]);
  });
});

describe('containsWord', () => {
  it.each([
    ['Graduate Scrum Master', 'graduate', true],
    ['graduate', 'GRADUATE', true],
    ['Juniper Networks engineer', 'junior', false],
    ['C++ developer', 'c++', true],
    ['SC cleared only', 'sc cleared only', true],
    ['mid-level', 'level', true],
    ['', 'x', false],
  ])('"%s" contains "%s": %s', (text, word, expected) => {
    expect(containsWord(text, word)).toBe(expected);
  });
});

type FilterJobInput = Parameters<typeof evaluateFilters>[0];
type Overrides = { [K in keyof FilterJobInput]?: FilterJobInput[K] | undefined };

describe('evaluateFilters', () => {
  const { blocklist, working } = DEFAULT_SETTINGS;
  const job: FilterJobInput = {
    title: 'Agile Coach',
    employerName: 'Acme Recruitment',
    descriptionText: 'Lead SAFe transformation.',
    employmentType: 'contract',
    payMin: 600,
    payMax: 650,
    payPeriod: 'day',
    workMode: 'hybrid',
    ir35: 'outside',
  };
  const check = (j: Overrides, p: Partial<SearchProfile> = {}, b = blocklist) =>
    evaluateFilters({ ...job, ...j } as FilterJobInput, profile(p), b, working);

  it('passes a job that meets every rule', () => {
    expect(
      check({}, { minDayRate: 550, ir35Preference: 'outside_only', workModes: ['hybrid'] }),
    ).toEqual({
      pass: true,
      reasons: [],
    });
  });

  it('rejects an employment type the profile did not ask for, but never an unknown one', () => {
    expect(check({ employmentType: 'temp' }).reasons).toEqual(['employment_type:temp']);
    expect(check({ employmentType: 'unknown' }).pass).toBe(true);
  });

  it('rejects exclude keywords in the title or description, as whole words', () => {
    expect(
      check({ title: 'Graduate Agile Coach' }, { excludeKeywords: ['graduate'] }).reasons,
    ).toEqual(['excluded_keyword:graduate']);
    expect(check({ descriptionText: 'junior role' }, { excludeKeywords: ['junior'] }).pass).toBe(
      false,
    );
    expect(check({ descriptionText: 'Juniper' }, { excludeKeywords: ['junior'] }).pass).toBe(true);
  });

  it('compares day rates on a yearly basis: the best rate on offer must reach the minimum', () => {
    expect(check({ payMin: 400, payMax: 450 }, { minDayRate: 500 }).reasons).toEqual([
      'below_min_day_rate',
    ]);
    expect(check({ payMin: 400, payMax: 550 }, { minDayRate: 500 }).pass).toBe(true);
    expect(check({ payMin: 500, payMax: 500 }, { minDayRate: 500 }).pass).toBe(true);
    expect(check({ payMin: 60, payMax: 60, payPeriod: 'hour' }, { minDayRate: 500 }).pass).toBe(
      false,
    );
    expect(check({ payMin: 80, payMax: 80, payPeriod: 'hour' }, { minDayRate: 500 }).pass).toBe(
      true,
    );
    // A contract quoted as a salary is compared with the day rate × working days.
    expect(
      check({ payMin: 50_000, payMax: 50_000, payPeriod: 'year' }, { minDayRate: 500 }).pass,
    ).toBe(false);
  });

  it('uses only max when min is missing, and ignores unknown pay', () => {
    const upTo: Overrides = { payMin: undefined, payMax: 450 };
    expect(check(upTo, { minDayRate: 500 }).pass).toBe(false);
    expect(
      check({ payMin: undefined, payMax: undefined, payPeriod: 'unknown' }, { minDayRate: 500 })
        .pass,
    ).toBe(true);
    expect(check({ payMin: 600, payMax: undefined }, { minDayRate: 500 }).pass).toBe(true);
  });

  it('applies the minimum salary to permanent roles only', () => {
    const perm = {
      employmentType: 'permanent' as const,
      payMin: 50_000,
      payMax: 60_000,
      payPeriod: 'year' as const,
    };
    expect(check(perm, { minSalary: 70_000 }).reasons).toEqual(['below_min_salary']);
    expect(check(perm, { minSalary: 55_000 }).pass).toBe(true);
    expect(check(perm, { minDayRate: 900 }).pass).toBe(true);
    expect(
      check(
        { ...perm, payMax: undefined, payMin: undefined, payPeriod: 'unknown' },
        { minSalary: 70_000 },
      ).pass,
    ).toBe(true);
    // A day-rate profile threshold is irrelevant to a perm role, and vice versa.
    expect(check({ payMin: 400, payMax: 450 }, { minSalary: 90_000 }).pass).toBe(true);
  });

  it('treats an unknown employment type with a yearly figure as permanent-like', () => {
    const yearly = {
      employmentType: 'unknown' as const,
      payMin: 50_000,
      payMax: 50_000,
      payPeriod: 'year' as const,
    };
    expect(check(yearly, { minSalary: 70_000 }).pass).toBe(false);
    expect(
      check({ ...yearly, payMin: 400, payMax: 400, payPeriod: 'day' }, { minDayRate: 500 }).pass,
    ).toBe(false);
  });

  it('rejects inside IR35 only for outside-only profiles, and never unknown IR35', () => {
    expect(check({ ir35: 'inside' }, { ir35Preference: 'outside_only' }).reasons).toEqual([
      'inside_ir35',
    ]);
    expect(check({ ir35: 'inside' }, { ir35Preference: 'prefer_outside' }).pass).toBe(true);
    expect(check({ ir35: 'inside' }, { ir35Preference: 'any' }).pass).toBe(true);
    expect(check({ ir35: 'unknown' }, { ir35Preference: 'outside_only' }).pass).toBe(true);
    expect(check({ ir35: undefined }, { ir35Preference: 'outside_only' }).pass).toBe(true);
  });

  it('applies work-mode preferences only when the mode is known', () => {
    expect(check({ workMode: 'onsite' }, { workModes: ['remote', 'hybrid'] }).reasons).toEqual([
      'work_mode:onsite',
    ]);
    expect(check({ workMode: 'unknown' }, { workModes: ['remote'] }).pass).toBe(true);
    expect(check({ workMode: 'onsite' }, { workModes: [] }).pass).toBe(true);
  });

  it('applies the global blocklist to employers, agencies and keywords', () => {
    const block = (b: Partial<typeof blocklist>) => ({ ...blocklist, ...b });
    expect(check({}, {}, block({ employers: ['acme'] })).reasons).toEqual([
      'blocked_employer:acme',
    ]);
    expect(check({}, {}, block({ agencies: ['Recruitment'] })).pass).toBe(false);
    expect(check({}, {}, block({ keywords: ['safe'] })).reasons).toEqual(['blocked_keyword:safe']);
    expect(check({}, {}, block({ employers: ['someone else'] })).pass).toBe(true);
  });

  describe('location (the location-free "Remote" search returns the whole country)', () => {
    const remoteProfile = { locations: ['London', 'Remote'] };
    const unscoped = (j: Overrides, p: Partial<SearchProfile> = remoteProfile) =>
      evaluateFilters({ ...job, ...j } as FilterJobInput, profile(p), blocklist, working, {
        scoped: false,
      });

    it('accepts a job found only by the Remote search if it is remote', () => {
      expect(unscoped({ workMode: 'remote' }).pass).toBe(true);
    });

    it.each(['hybrid', 'onsite', 'unknown'] as const)(
      'rejects a %s job found only by the Remote search',
      (workMode) => {
        expect(unscoped({ workMode }).reasons).toEqual(['not_remote']);
      },
    );

    it('never rejects a job found by a search restricted to one of the profile places', () => {
      expect(check({ workMode: 'onsite' }, remoteProfile).pass).toBe(true);
      expect(
        evaluateFilters(
          { ...job, workMode: 'hybrid' },
          profile(remoteProfile),
          blocklist,
          working,
          { scoped: true },
        ).pass,
      ).toBe(true);
    });

    it('does not accept remote work for a profile that did not ask for Remote', () => {
      expect(unscoped({ workMode: 'remote' }, { locations: ['London'] }).reasons).toEqual([
        'not_remote',
      ]);
    });

    it('is judged alongside the other rules', () => {
      expect(unscoped({ workMode: 'remote', employmentType: 'temp' }).reasons).toEqual([
        'employment_type:temp',
      ]);
    });
  });

  it('reports every reason at once', () => {
    const r = check(
      { employmentType: 'temp', ir35: 'inside', workMode: 'onsite' },
      { ir35Preference: 'outside_only', workModes: ['remote'] },
    );
    expect(r.reasons).toEqual(['employment_type:temp', 'inside_ir35', 'work_mode:onsite']);
  });
});

describe('evaluateAcrossProfiles', () => {
  const { blocklist, working } = DEFAULT_SETTINGS;
  const found = (...profiles: SearchProfile[]) =>
    profiles.map((p) => ({ profile: p, foundBy: { scoped: true } }));
  const job: FilterJobInput = {
    title: 'Delivery Manager',
    employerName: 'Acme',
    descriptionText: 'text',
    employmentType: 'contract',
    payMin: 450,
    payMax: 450,
    payPeriod: 'day',
    workMode: 'unknown',
    ir35: 'unknown',
  };

  it('passes when any profile that found the job accepts it', () => {
    const strict = profile({ id: 'strict', minDayRate: 600 });
    const lax = profile({ id: 'lax', minDayRate: 400 });
    expect(evaluateAcrossProfiles(job, found(strict, lax), blocklist, working).pass).toBe(true);
  });

  it('when none accept, explains with the profile that came closest', () => {
    const one = profile({ id: 'one', minDayRate: 600 });
    const two = profile({ id: 'two', minDayRate: 600, excludeKeywords: ['delivery'] });
    const r = evaluateAcrossProfiles(job, found(two, one), blocklist, working);
    expect(r).toEqual({ pass: false, reasons: ['below_min_day_rate'] });
  });

  it('a place-restricted find by one profile rescues a job the Remote search found for another', () => {
    const a = profile({ id: 'a', locations: ['London', 'Remote'] });
    const b = profile({ id: 'b', locations: ['London'] });
    const unscopedOnly = [{ profile: a, foundBy: { scoped: false } }];
    expect(evaluateAcrossProfiles(job, unscopedOnly, blocklist, working).reasons).toEqual([
      'not_remote',
    ]);
    const both = [...unscopedOnly, { profile: b, foundBy: { scoped: true } }];
    expect(evaluateAcrossProfiles(job, both, blocklist, working).pass).toBe(true);
  });

  it('rejects a job found by no known profile', () => {
    expect(evaluateAcrossProfiles(job, [], blocklist, working)).toEqual({
      pass: false,
      reasons: ['no_matching_profile'],
    });
  });
});

describe('prefilter scoring', () => {
  const weights = DEFAULT_SETTINGS.weights;

  it('maps similarity between the calibrated bounds onto 0–100', () => {
    expect(simNorm(0.55, weights)).toBe(0);
    expect(simNorm(0.4, weights)).toBe(0);
    expect(simNorm(0.85, weights)).toBeCloseTo(100, 10);
    expect(simNorm(0.95, weights)).toBeCloseTo(100, 10);
    expect(simNorm(0.7, weights)).toBeCloseTo(50, 10);
  });

  const input = {
    bestSimilarity: 0.7,
    titleMatch: false,
    payDisclosed: false,
    ir35Outside: false,
    feedbackAdj: 0,
  };
  it('adds the title, pay and IR35 bonuses and the feedback adjustment', () => {
    expect(prefilterScore(input, weights)).toBeCloseTo(50, 10);
    expect(prefilterScore({ ...input, titleMatch: true }, weights)).toBeCloseTo(55, 10);
    expect(prefilterScore({ ...input, payDisclosed: true }, weights)).toBeCloseTo(53, 10);
    expect(prefilterScore({ ...input, ir35Outside: true }, weights)).toBeCloseTo(53, 10);
    expect(
      prefilterScore(
        { ...input, titleMatch: true, payDisclosed: true, ir35Outside: true },
        weights,
      ),
    ).toBeCloseTo(61, 10);
    expect(prefilterScore({ ...input, feedbackAdj: -10 }, weights)).toBeCloseTo(40, 10);
  });

  it('clamps to 0–100 and handles a job with no CV to compare against', () => {
    expect(
      prefilterScore(
        { ...input, bestSimilarity: 0.99, titleMatch: true, feedbackAdj: 10 },
        weights,
      ),
    ).toBe(100);
    expect(prefilterScore({ ...input, bestSimilarity: 0.1, feedbackAdj: -10 }, weights)).toBe(0);
    expect(prefilterScore({ ...input, bestSimilarity: null, titleMatch: true }, weights)).toBe(5);
  });

  it('matches titles fuzzily against the profile titles', () => {
    expect(titleMatchesProfile('Senior Agile Coach - London', ['Agile Coach'], 0.8)).toBe(true);
    expect(titleMatchesProfile('Enterprise Agile Coach (Contract)', ['Agile Coach'], 0.8)).toBe(
      true,
    );
    expect(titleMatchesProfile('Data Engineer', ['Agile Coach', 'Scrum Master'], 0.8)).toBe(false);
    expect(titleMatchesProfile('Scrum Master', ['Agile Coach', 'Scrum Master'], 0.8)).toBe(true);
    expect(titleMatchesProfile('Anything', [], 0.8)).toBe(false);
  });

  it('picks the most similar CV', () => {
    expect(bestCv([])).toBeNull();
    expect(
      bestCv([
        { cvId: 'a', similarity: 0.5 },
        { cvId: 'b', similarity: 0.8 },
        { cvId: 'c', similarity: 0.6 },
      ]),
    ).toEqual({ cvId: 'b', similarity: 0.8 });
  });
});

describe('jobEmbeddingText', () => {
  it('joins the identifying facts and truncates the advert', () => {
    const text = jobEmbeddingText({
      title: 'Agile Coach',
      employerName: 'Acme',
      location: 'London',
      payText: '£600/day',
      descriptionText: 'x'.repeat(5_000),
    });
    expect(text.startsWith('Agile Coach\nAcme\nLondon\n£600/day\nxxx')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2_000);
  });

  it('skips empty parts', () => {
    expect(
      jobEmbeddingText({
        title: 'T',
        employerName: '',
        location: ' ',
        payText: 'Not stated',
        descriptionText: 'd',
      }),
    ).toBe('T\nNot stated\nd');
  });
});

describe('backoffSeconds', () => {
  it('doubles from 10s up to a 300s cap, plus up to 20% jitter', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((n) => backoffSeconds(n, () => 0))).toEqual([
      10, 20, 40, 80, 160, 300, 300, 300,
    ]);
    expect(backoffSeconds(0, () => 1)).toBe(12);
    expect(backoffSeconds(5, () => 1)).toBe(360);
    expect(backoffSeconds(0)).toBeGreaterThanOrEqual(10);
    expect(backoffSeconds(0)).toBeLessThanOrEqual(12);
  });
});

describe('newUlid', () => {
  const fixedRandom = (n: number) => new Uint8Array(n).fill(7);

  it('is 26 Crockford base-32 characters', () => {
    expect(newUlid(new Date('2026-11-20T09:00:00Z'))).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sorts by creation time', () => {
    const ids = [
      newUlid(new Date('2026-01-01T00:00:00Z'), fixedRandom),
      newUlid(new Date('2026-06-01T00:00:00Z'), fixedRandom),
      newUlid(new Date('2026-11-20T09:00:00Z'), fixedRandom),
    ];
    expect([...ids].sort()).toEqual(ids);
  });

  it('encodes the timestamp deterministically and varies with the random part', () => {
    const t = new Date('2026-11-20T09:00:00Z');
    expect(newUlid(t, fixedRandom).slice(0, 10)).toBe(newUlid(t).slice(0, 10));
    expect(newUlid(t)).not.toBe(newUlid(t));
  });
});
