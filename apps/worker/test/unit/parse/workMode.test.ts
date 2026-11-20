import { describe, expect, it } from 'vitest';
import { detectWorkMode, type WorkModeDetection } from '../../../src/core/parse/workMode.js';

type Case = [text: string, expected: WorkModeDetection];

const cases: Case[] = [
  ['Fully remote', { mode: 'remote', confidence: 'high' }],
  ['100% remote working', { mode: 'remote', confidence: 'high' }],
  ['Remote-first company', { mode: 'remote', confidence: 'high' }],
  ['You can work from home', { mode: 'remote', confidence: 'high' }],
  ['WFH', { mode: 'remote', confidence: 'high' }],
  ['Home-based role', { mode: 'remote', confidence: 'high' }],
  ['Location: Remote', { mode: 'remote', confidence: 'high' }],
  ['Agile Coach (remote)', { mode: 'remote', confidence: 'high' }],
  ['Hybrid', { mode: 'hybrid', confidence: 'high' }],
  ['Hybrid or fully remote', { mode: 'hybrid', confidence: 'high' }],
  [
    'Hybrid working: 2 days a week in the office',
    { mode: 'hybrid', onsiteDaysPerWeek: 2, confidence: 'high' },
  ],
  ['3 days per week on site', { mode: 'hybrid', onsiteDaysPerWeek: 3, confidence: 'high' }],
  ['1 day per month on site', { mode: 'hybrid', onsiteDaysPerWeek: 0.23, confidence: 'high' }],
  ['2-3 days in office', { mode: 'hybrid', onsiteDaysPerWeek: 3, confidence: 'high' }],
  [
    'two days a week at the client site',
    { mode: 'hybrid', onsiteDaysPerWeek: 2, confidence: 'high' },
  ],
  [
    'One day a week in the London office',
    { mode: 'hybrid', onsiteDaysPerWeek: 1, confidence: 'high' },
  ],
  ['Onsite 2 days per week', { mode: 'hybrid', onsiteDaysPerWeek: 2, confidence: 'high' }],
  ['In the office: 3 days a week', { mode: 'hybrid', onsiteDaysPerWeek: 3, confidence: 'high' }],
  ['Attend the office 2 days a week', { mode: 'hybrid', onsiteDaysPerWeek: 2, confidence: 'high' }],
  ['On site 5 days a week', { mode: 'onsite', onsiteDaysPerWeek: 5, confidence: 'high' }],
  ['Office-based role', { mode: 'onsite', confidence: 'high' }],
  ['Fully on-site', { mode: 'onsite', confidence: 'high' }],
  ['Full-time in the office', { mode: 'onsite', confidence: 'high' }],
  ['Onsite', { mode: 'onsite', confidence: 'low' }],
  ['Based in London', { mode: 'unknown', confidence: 'none' }],
  ['Flexible working available', { mode: 'unknown', confidence: 'none' }],
  ['', { mode: 'unknown', confidence: 'none' }],
];

describe('detectWorkMode', () => {
  it('covers at least 15 phrases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it.each(cases)('%s', (text, expected) => {
    expect(detectWorkMode(text)).toEqual(expected);
  });

  it('reads a location field of "Remote" as remote', () => {
    expect(detectWorkMode('Agile Coach', { location: 'Remote' })).toEqual({
      mode: 'remote',
      confidence: 'high',
    });
    expect(detectWorkMode('Agile Coach', { location: ' Home Working ' }).mode).toBe('remote');
    expect(detectWorkMode('Agile Coach', { location: 'London' }).mode).toBe('unknown');
  });

  it('lets stated office days override remote wording', () => {
    expect(detectWorkMode('Remote-first, but 2 days a week in the office').mode).toBe('hybrid');
  });

  it('is case- and dash-insensitive', () => {
    expect(detectWorkMode('FULLY REMOTE').mode).toBe('remote');
    expect(detectWorkMode('Hybrid – 2 days on‑site').onsiteDaysPerWeek).toBe(2);
  });
});
