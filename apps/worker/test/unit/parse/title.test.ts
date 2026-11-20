import { describe, expect, it } from 'vitest';
import { normaliseTitle, tokenSetRatio } from '../../../src/core/parse/title.js';

describe('normaliseTitle', () => {
  it.each([
    ['Agile Coach', 'agile coach', null],
    ['Senior Agile Coach', 'agile coach', 'senior'],
    ['Sr. Agile Coach', 'agile coach', 'senior'],
    ['Junior Scrum Master', 'scrum master', 'junior'],
    ['Jr Scrum Master', 'scrum master', 'junior'],
    ['Principal Agile Coach', 'agile coach', 'principal'],
    ['Lead Agile Coach', 'agile coach', 'lead'],
    ['Delivery Lead', 'delivery lead', null],
    ['Senior Principal Delivery Manager', 'delivery manager', 'senior'],
    ['Agile Coach - London', 'agile coach', null],
    ['Agile Coach – Milton Keynes', 'agile coach', null],
    ['Agile Coach | Remote', 'agile coach', null],
    ['Agile Coach - £600pd - Outside IR35', 'agile coach', null],
    ['Agile Coach (6 Month Contract)', 'agile coach', null],
    ['Agile Coach [URGENT]', 'agile coach', null],
    ['URGENT Contract Agile Coach', 'agile coach', null],
    ['Agile Coach - Transformation - London', 'agile coach transformation', null],
    ['Scrum & Agile Coach, Hybrid', 'scrum and agile coach', null],
    ['C++ Delivery Manager', 'c++ delivery manager', null],
    ['  Programme   Manager ', 'programme manager', null],
    ['', '', null],
  ])('"%s" → "%s" (%s)', (title, normalised, seniority) => {
    expect(normaliseTitle(title)).toEqual({ normalised, seniority });
  });
});

describe('tokenSetRatio', () => {
  it('is 1 for identical titles and ignores word order', () => {
    expect(tokenSetRatio('agile coach', 'agile coach')).toBe(1);
    expect(tokenSetRatio('agile coach', 'coach agile')).toBe(1);
  });

  it('is 1 when one title is a subset of the other', () => {
    expect(tokenSetRatio('agile coach', 'enterprise agile coach')).toBe(1);
    expect(tokenSetRatio('enterprise agile coach', 'agile coach')).toBe(1);
  });

  it('scores near-misses high and unrelated titles low', () => {
    expect(tokenSetRatio('agile coach', 'agile coaches')).toBeGreaterThan(0.8);
    expect(tokenSetRatio('agile coach', 'data engineer')).toBeLessThan(0.4);
  });

  it('is 0 when either title is empty', () => {
    expect(tokenSetRatio('', 'agile coach')).toBe(0);
    expect(tokenSetRatio('agile coach', '')).toBe(0);
    expect(tokenSetRatio('', '')).toBe(0);
  });

  it('is symmetric', () => {
    const a = 'scrum master agile';
    const b = 'agile delivery manager';
    expect(tokenSetRatio(a, b)).toBeCloseTo(tokenSetRatio(b, a), 10);
  });
});
