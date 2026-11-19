import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';

const db = createDb(env.DB);
const repos = createRepos(db);
const NOW = '2026-11-19T07:00:00.000Z';

beforeEach(async () => {
  for (const table of ['runs', 'jobs', 'job_groups', 'cvs', 'search_profiles', 'usage_daily']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('runs repo', () => {
  const run = (id: string, slotKey: string | null) => ({
    id,
    slotKey,
    trigger: 'cron' as const,
    status: 'running' as const,
    startedAt: NOW,
  });

  it('inserts and reads back a run with phase and counter defaults', async () => {
    expect(await repos.runs.insertIfNew(run('r1', '2026-11-19T07:00'))).toBe(true);
    const row = await repos.runs.getById('r1');
    expect(row).toMatchObject({ phase: 'ingest', pendingIngest: 0, pendingScore: 0 });
  });

  it('rejects a second run for the same slot_key (cron double-fire)', async () => {
    await repos.runs.insertIfNew(run('r1', 'slot'));
    expect(await repos.runs.insertIfNew(run('r2', 'slot'))).toBe(false);
    expect((await repos.runs.getBySlotKey('slot'))?.id).toBe('r1');
  });
});

describe('jobs repo', () => {
  const job = (id: string, sourceJobId: string) => ({
    id,
    source: 'reed',
    sourceJobId,
    title: 'Agile Coach',
    createdAt: NOW,
  });

  it('enforces UNIQUE(source, source_job_id) via insertIfNew', async () => {
    expect(await repos.jobs.insertIfNew(job('j1', '123'))).toBe(true);
    expect(await repos.jobs.insertIfNew(job('j2', '123'))).toBe(false);
    expect(await repos.jobs.insertIfNew(job('j3', '456'))).toBe(true);
    expect((await repos.jobs.getBySource('reed', '123'))?.id).toBe('j1');
  });

  it('rejects a raw duplicate insert at the database level', async () => {
    await repos.jobs.insertIfNew(job('j1', '123'));
    await expect(
      db.insert((await import('../../src/db/schema.js')).jobs).values(job('j2', '123')),
    ).rejects.toThrow();
  });
});

describe('cvs and profiles repos', () => {
  it('cascades profile deletion when a CV is deleted', async () => {
    await repos.cvs.insert({
      id: 'cv1',
      label: 'Agile Coach',
      r2Key: 'cvs/cv1/a.pdf',
      textMd: '# CV',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repos.profiles.insert(
      'p1',
      'cv1',
      {
        jobTitles: ['Agile Coach'],
        mustKeywords: [],
        excludeKeywords: [],
        locations: ['London'],
        radiusMiles: 25,
        employmentTypes: ['contract'],
        minDayRate: 500,
        minSalary: null,
        ir35Preference: 'any',
        workModes: [],
        maxOnsiteDays: null,
        active: true,
      },
      NOW,
    );
    expect((await repos.profiles.getByCvId('cv1'))?.minDayRate).toBe(500);
    expect(await repos.cvs.countActive()).toBe(1);

    await env.DB.prepare('PRAGMA foreign_keys = ON').run();
    await repos.cvs.delete('cv1');
    expect(await repos.profiles.getById('p1')).toBeUndefined();
  });
});

describe('usage repo', () => {
  it('increments counters atomically per day', async () => {
    await repos.usage.increment('2026-11-19', 'reedCalls', 2);
    await repos.usage.increment('2026-11-19', 'reedCalls', 3);
    await repos.usage.increment('2026-11-19', 'llmCalls', 1);
    expect(await repos.usage.get('2026-11-19')).toMatchObject({ reedCalls: 5, llmCalls: 1 });
  });
});
