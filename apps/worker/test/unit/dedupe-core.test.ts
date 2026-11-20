import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import {
  isActioned,
  isDuplicate,
  looksLikeSameRole,
  olderGroup,
  payBandsOverlap,
  pickCanonical,
  sameCity,
} from '../../src/core/dedupe.js';

const D = DEFAULT_SETTINGS.dedupe;
const job = (over = {}) => ({
  title: 'Agile Coach',
  location: 'London',
  annualisedMin: 132_000,
  annualisedMax: 143_000,
  ...over,
});

describe('looksLikeSameRole', () => {
  it.each([
    ['same title, another agency', job(), job(), true, 'title'],
    [
      'seniority and contract noise ignored',
      job(),
      job({ title: 'Senior Agile Coach - Contract' }),
      true,
      'title',
    ],
    ['same title, different city', job(), job({ location: 'Leeds' }), true, 'title'],
    [
      'different role, different city',
      job(),
      job({ title: 'Data Engineer', location: 'Leeds' }),
      false,
      null,
    ],
    [
      'different role, pay far apart',
      job(),
      job({ title: 'Data Engineer', annualisedMin: 60_000, annualisedMax: 70_000 }),
      false,
      null,
    ],
    [
      'different title but same pay band and city',
      job(),
      job({ title: 'Transformation Lead', annualisedMin: 135_000, annualisedMax: 140_000 }),
      true,
      'pay_and_location',
    ],
    [
      'different title, same pay, different city',
      job(),
      job({ title: 'Transformation Lead', location: 'Leeds' }),
      false,
      null,
    ],
  ])('%s', (_name, a, b, match, why) => {
    const r = looksLikeSameRole(a, b, D);
    expect(r.match).toBe(match);
    expect(r.why).toBe(why);
  });
});

describe('isDuplicate', () => {
  it('needs both enough text similarity and a role match', () => {
    expect(isDuplicate(0.95, job(), job(), D)).toEqual({ dup: true, why: 'title' });
    expect(isDuplicate(0.91, job(), job(), D)).toEqual({ dup: false, why: null });
    expect(
      isDuplicate(0.99, job(), job({ title: 'Data Engineer', location: 'Leeds' }), D).dup,
    ).toBe(false);
  });
});

describe('payBandsOverlap and sameCity', () => {
  it('treats overlapping ranges within the tolerance as the same band', () => {
    const near = job({ annualisedMin: 150_000, annualisedMax: 160_000 });
    const far = job({ annualisedMin: 200_000, annualisedMax: 210_000 });
    expect(payBandsOverlap(job(), near, 0.1)).toBe(true);
    expect(payBandsOverlap(job(), far, 0.1)).toBe(false);
  });
  it('is false when either side has no pay, and uses a single figure as both ends', () => {
    const none = job({ annualisedMin: null, annualisedMax: null });
    expect(payBandsOverlap(job(), none, 0.1)).toBe(false);
    expect(payBandsOverlap(job({ annualisedMin: 140_000, annualisedMax: null }), job(), 0.1)).toBe(
      true,
    );
  });
  it('compares the first place name only, and never matches when a place is missing', () => {
    expect(sameCity(job({ location: 'London, Greater London' }), job({ location: 'london' }))).toBe(
      true,
    );
    expect(sameCity(job({ location: null }), job({ location: null }))).toBe(false);
    expect(sameCity(job({ location: 'Leeds' }), job())).toBe(false);
  });
});

describe('pickCanonical', () => {
  const c = (id: string, over = {}) => ({
    id,
    hasPay: false,
    ir35Known: false,
    descriptionLength: 100,
    postedAt: '2026-11-19T00:00:00.000Z',
    ...over,
  });
  it('prefers pay, then IR35, then the longest description, then the earliest', () => {
    expect(pickCanonical([c('a'), c('b', { hasPay: true })])).toBe('b');
    expect(
      pickCanonical([c('a', { hasPay: true }), c('b', { hasPay: true, ir35Known: true })]),
    ).toBe('b');
    expect(pickCanonical([c('a'), c('b', { descriptionLength: 500 })])).toBe('b');
    expect(pickCanonical([c('a', { postedAt: '2026-11-19T10:00:00Z' }), c('b')])).toBe('b');
    expect(pickCanonical([c('b'), c('a')])).toBe('a'); // fully tied: lowest id
    expect(pickCanonical([])).toBeNull();
  });
});

describe('olderGroup and isActioned', () => {
  it('keeps the group seen first, then the lowest id', () => {
    const a = { id: 'a', firstSeenAt: '2026-11-19T00:00:00Z' };
    const b = { id: 'b', firstSeenAt: '2026-11-20T00:00:00Z' };
    expect(olderGroup(a, b)).toBe('a');
    expect(olderGroup(b, a)).toBe('b');
    expect(olderGroup({ ...b, firstSeenAt: a.firstSeenAt }, a)).toBe('b');
    expect(olderGroup(a, { ...b, firstSeenAt: a.firstSeenAt })).toBe('a');
  });
  it('treats only states after the user acts as actioned', () => {
    expect(isActioned('new')).toBe(false);
    expect(isActioned('prefiltered')).toBe(false);
    expect(isActioned('applied')).toBe(true);
    expect(isActioned('skipped')).toBe(true);
  });
});
