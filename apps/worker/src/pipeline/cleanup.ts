import { toIso } from '../lib/time.js';
import type { PipelineDeps } from './startRun.js';

const DAY_MS = 86_400_000;

/**
 * Retention (SPEC §11): drop filtered jobs older than `retention.filteredDays`, with their stored
 * vectors. Jobs the user has seen or acted on are never touched. Returns how many groups went.
 */
export async function cleanup(deps: PipelineDeps): Promise<number> {
  const { retention } = await deps.settings.get();
  const cutoff = toIso(new Date(deps.clock.now().getTime() - retention.filteredDays * DAY_MS));
  const groupIds = await deps.repos.groups.listFilteredBefore(cutoff);
  if (groupIds.length === 0) return 0;
  const jobIds = await deps.repos.groups.deleteWithJobs(groupIds);
  await deps.vectors.deleteByIds(jobIds.map((id) => `job:${id}`));
  return groupIds.length;
}
