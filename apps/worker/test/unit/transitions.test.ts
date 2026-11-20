import type { GroupStatus } from '@job-scout/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { nextSlotTime } from '../../src/core/schedule.js';
import {
  canTransition,
  isUserState,
  requiresCvSent,
  restoredStatus,
} from '../../src/core/transitions.js';

describe('canTransition', () => {
  const inbox: GroupStatus[] = ['new', 'prefiltered', 'deferred', 'below_threshold', 'filtered'];
  const mine: GroupStatus[] = [
    'shortlisted',
    'applied',
    'interview',
    'offer',
    'rejected',
    'skipped',
    'withdrawn',
  ];

  it('lets you act on any job you have not acted on', () => {
    for (const from of inbox) {
      for (const to of ['shortlisted', 'applied', 'skipped'] as const) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it('lets you move freely between your own states, but never to the same one', () => {
    for (const from of mine) {
      for (const to of mine) expect(canTransition(from, to)).toBe(from !== to);
    }
  });

  it('lets you send an acted-on job back to the Inbox, but not an Inbox job to itself', () => {
    for (const from of mine) expect(canTransition(from, 'new')).toBe(true);
    for (const from of inbox) expect(canTransition(from, 'new')).toBe(false);
  });

  it('never lets you move a job into a system state by hand', () => {
    for (const to of [
      'prefiltered',
      'pending_llm',
      'deferred',
      'below_threshold',
      'filtered',
    ] as const) {
      for (const from of [...inbox, ...mine]) expect(canTransition(from, to)).toBe(false);
    }
  });

  it('knows its own states, the CV rule and where undo returns to', () => {
    expect(isUserState('applied')).toBe(true);
    expect(isUserState('new')).toBe(false);
    expect(requiresCvSent('applied')).toBe(true);
    expect(requiresCvSent('interview')).toBe(false);
    expect(restoredStatus(true)).toBe('new');
    expect(restoredStatus(false)).toBe('prefiltered');
  });
});

describe('nextSlotTime', () => {
  const S = DEFAULT_SETTINGS.schedule; // weekdays 07:00, 12:00, 17:00; Sunday 17:00
  it('finds the next slot later the same day, then the next day', () => {
    expect(nextSlotTime(new Date('2026-11-20T08:30:00Z'), S)?.toISOString()).toBe(
      '2026-11-20T12:00:00.000Z',
    );
    expect(nextSlotTime(new Date('2026-11-20T17:00:00Z'), S)?.toISOString()).toBe(
      '2026-11-22T17:00:00.000Z',
    ); // Fri → Sunday
  });
  it('is after now, not at now', () => {
    expect(nextSlotTime(new Date('2026-11-20T07:00:00Z'), S)?.toISOString()).toBe(
      '2026-11-20T12:00:00.000Z',
    );
  });
  it('is null when nothing is scheduled', () => {
    expect(
      nextSlotTime(new Date('2026-11-20T08:00:00Z'), { ...S, 'mon-fri': [], sat: [], sun: [] }),
    ).toBeNull();
  });
});
