import { sql } from 'drizzle-orm';
import type { Deps } from '../container.js';

/** Tables emptied, children before parents so foreign keys never block. Settings are kept. */
const TABLES_IN_ORDER = [
  'cover_notes',
  'status_history',
  'applications',
  'assessments',
  'job_cv_similarity',
  'job_profile_hits',
  'jobs',
  'job_groups',
  'run_errors',
  'source_calls',
  'processed_messages',
  'runs',
  'usage_daily',
  'vectors',
  'search_profiles',
  'cvs',
] as const;

/**
 * "Delete all data": every job, assessment, note, run, CV (and its stored file) and search profile.
 * Your settings (schedule, limits, blocklist) stay. Vectors are removed by id, so this works the
 * same whether they live in D1 or in Vectorize.
 */
export async function deleteAllData(
  deps: Pick<Deps, 'db' | 'repos' | 'blobs' | 'vectors'>,
): Promise<{ cvs: number; jobs: number }> {
  const cvs = await deps.repos.cvs.list();
  for (const cv of cvs) await deps.blobs.delete(cv.r2Key);

  const jobIds = await deps.repos.jobs.listAllIds();
  await deps.vectors.deleteByIds([
    ...cvs.map((c) => `cv:${c.id}`),
    ...jobIds.map((id) => `job:${id}`),
  ]);

  for (const table of TABLES_IN_ORDER) await deps.db.run(sql.raw(`DELETE FROM ${table}`));
  return { cvs: cvs.length, jobs: jobIds.length };
}
