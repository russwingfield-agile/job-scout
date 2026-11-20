import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { dueSlot, localParts } from '../../src/core/schedule.js';

const schedule = DEFAULT_SETTINGS.schedule;
const at = (iso: string) => new Date(iso);

describe('dueSlot (default schedule: Mon–Fri 07/12/17, Sun 17, Sat none, Europe/London)', () => {
  it.each([
    ['Friday 07:00 GMT', '2026-11-20T07:00:00Z', '2026-11-20T07:00'],
    ['Friday 07:59 GMT (late cron)', '2026-11-20T07:59:59Z', '2026-11-20T07:00'],
    ['Friday 12:00 GMT', '2026-11-20T12:00:00Z', '2026-11-20T12:00'],
    ['Friday 17:00 GMT', '2026-11-20T17:00:00Z', '2026-11-20T17:00'],
    ['Monday 07:00 BST is 06:00 UTC', '2026-06-15T06:00:00Z', '2026-06-15T07:00'],
    ['Sunday 17:00 GMT', '2026-11-22T17:00:00Z', '2026-11-22T17:00'],
  ])('%s → due', (_label, iso, slotKey) => {
    expect(dueSlot(at(iso), schedule)?.slotKey).toBe(slotKey);
  });

  it.each([
    ['Friday 06:00 GMT', '2026-11-20T06:00:00Z'],
    ['Friday 08:00 GMT', '2026-11-20T08:00:00Z'],
    ['Friday midnight', '2026-11-20T00:00:00Z'],
    ['Monday 07:00 UTC is 08:00 BST', '2026-06-15T07:00:00Z'],
    ['Saturday 07:00 (no Saturday slots)', '2026-11-21T07:00:00Z'],
    ['Saturday 12:00', '2026-11-21T12:00:00Z'],
    ['Sunday 12:00 (Sunday has only 17:00)', '2026-11-22T12:00:00Z'],
    ['Sunday 07:00', '2026-11-22T07:00:00Z'],
  ])('%s → not due', (_label, iso) => {
    expect(dueSlot(at(iso), schedule)).toBeNull();
  });

  it('returns the matching configured slot as well as its key', () => {
    expect(dueSlot(at('2026-11-20T12:00:00Z'), schedule)).toEqual({
      slotKey: '2026-11-20T12:00',
      slot: '12:00',
    });
  });
});

describe('dueSlot across the clock changes', () => {
  it('spring forward (Sunday 29 March 2026, 01:00 UTC): 17:00 local is 16:00 UTC', () => {
    expect(dueSlot(at('2026-03-29T16:00:00Z'), schedule)?.slotKey).toBe('2026-03-29T17:00');
    expect(dueSlot(at('2026-03-29T17:00:00Z'), schedule)).toBeNull(); // 18:00 BST
    expect(dueSlot(at('2026-03-29T15:00:00Z'), schedule)).toBeNull(); // 16:00 BST
  });

  it('the weekdays either side keep their local times', () => {
    expect(dueSlot(at('2026-03-27T07:00:00Z'), schedule)?.slotKey).toBe('2026-03-27T07:00'); // Fri GMT
    expect(dueSlot(at('2026-03-30T06:00:00Z'), schedule)?.slotKey).toBe('2026-03-30T07:00'); // Mon BST
    expect(dueSlot(at('2026-03-30T07:00:00Z'), schedule)).toBeNull();
  });

  it('fall back (Sunday 25 October 2026, 01:00 UTC): 17:00 local is 17:00 UTC', () => {
    expect(dueSlot(at('2026-10-25T17:00:00Z'), schedule)?.slotKey).toBe('2026-10-25T17:00');
    expect(dueSlot(at('2026-10-25T16:00:00Z'), schedule)).toBeNull(); // 16:00 GMT
    expect(dueSlot(at('2026-10-24T11:00:00Z'), schedule)).toBeNull(); // Saturday
    expect(dueSlot(at('2026-10-26T07:00:00Z'), schedule)?.slotKey).toBe('2026-10-26T07:00'); // Mon GMT
    expect(dueSlot(at('2026-10-26T06:00:00Z'), schedule)).toBeNull(); // 06:00 GMT
  });

  it('an hour that happens twice yields the same slot key both times (so one run)', () => {
    const early = { ...schedule, sun: ['01:00'] };
    const first = dueSlot(at('2026-10-25T00:00:00Z'), early); // 01:00 BST
    const second = dueSlot(at('2026-10-25T01:00:00Z'), early); // 01:00 GMT
    expect(first?.slotKey).toBe('2026-10-25T01:00');
    expect(second?.slotKey).toBe(first?.slotKey);
  });

  it('an hour that never happens is skipped rather than shifted', () => {
    const skipped = { ...schedule, sun: ['01:00'] };
    // 29 March 2026: 01:00 UTC jumps straight to 02:00 BST, so local 01:xx does not exist.
    for (const hour of ['00', '01', '02']) {
      expect(dueSlot(at(`2026-03-29T${hour}:30:00Z`), skipped)?.slotKey).toBeUndefined();
    }
  });
});

describe('dueSlot details', () => {
  it('ignores minutes in a slot but keeps them in the key', () => {
    const half = { ...schedule, 'mon-fri': ['07:30'] };
    expect(dueSlot(at('2026-11-20T07:05:00Z'), half)?.slotKey).toBe('2026-11-20T07:30');
  });

  it('handles the midnight hour (hourCycle h23, never "24")', () => {
    const night = { ...schedule, 'mon-fri': ['00:00'] };
    expect(dueSlot(at('2026-11-20T00:20:00Z'), night)?.slotKey).toBe('2026-11-20T00:00');
  });

  it('respects the configured time zone', () => {
    const ny = { ...schedule, timezone: 'America/New_York', 'mon-fri': ['07:00'] };
    expect(dueSlot(at('2026-11-20T12:00:00Z'), ny)?.slotKey).toBe('2026-11-20T07:00'); // EST
    expect(dueSlot(at('2026-11-20T07:00:00Z'), ny)).toBeNull();
  });

  it('can have several slots per day and an empty schedule', () => {
    expect(dueSlot(at('2026-11-20T07:00:00Z'), { ...schedule, 'mon-fri': [] })).toBeNull();
    const many = { ...schedule, 'mon-fri': ['07:00', '08:00', '09:00'] };
    expect(dueSlot(at('2026-11-20T08:10:00Z'), many)?.slot).toBe('08:00');
  });

  it('localParts reports date, hour and weekday in the zone', () => {
    expect(localParts(at('2026-06-15T23:30:00Z'), 'Europe/London')).toEqual({
      date: '2026-06-16',
      hour: '00',
      weekday: 'Tue',
    });
  });
});
