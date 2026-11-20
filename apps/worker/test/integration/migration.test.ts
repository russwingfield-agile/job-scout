import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const EXPECTED_TABLES = [
  'applications',
  'assessments',
  'cover_notes',
  'cvs',
  'job_cv_similarity',
  'job_groups',
  'job_profile_hits',
  'jobs',
  'processed_messages',
  'run_errors',
  'runs',
  'search_profiles',
  'settings',
  'source_calls',
  'status_history',
  'usage_daily',
  'vectors',
];

const EXPECTED_INDEXES = [
  'idx_groups_first_seen_at',
  'idx_groups_status_score',
  'idx_jobs_group_id',
  'idx_jobs_posted_at',
  'idx_run_errors_run_id',
  'idx_vectors_kind_posted_ts',
  'idx_status_history_group_id',
  'uq_jobs_source_job',
];

async function names(type: 'table' | 'index'): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
  )
    .bind(type)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

describe('migrations', () => {
  it('create every table from SPEC §11 plus run accounting', async () => {
    expect(await names('table')).toEqual(expect.arrayContaining(EXPECTED_TABLES));
  });

  it('create the planned indexes', async () => {
    expect(await names('index')).toEqual(expect.arrayContaining(EXPECTED_INDEXES));
  });
});
