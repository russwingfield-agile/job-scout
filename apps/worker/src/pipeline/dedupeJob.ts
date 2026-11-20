import {
  type DedupeJob,
  isActioned,
  isDuplicate,
  looksLikeSameRole,
  pickCanonical,
} from '../core/dedupe.js';
import { cosine } from '../core/vectors.js';
import { toIso } from '../lib/time.js';
import type { PipelineDeps } from './startRun.js';

const DAY_MS = 86_400_000;

/** Posting candidates read from D1 per check; far more than a few weeks of one search produce. */
const CANDIDATE_POOL = 500;

export type DuplicateMatch = { groupId: string; jobId: string; similarity: number };

/**
 * Is this posting the same role as one we already hold (SPEC §8.2)? Cheap checks on titles, pay and
 * place run over recent postings first, and only the few survivors have their vectors compared, so
 * the work stays small enough for a short-lived Worker invocation.
 */
export async function findDuplicate(
  deps: PipelineDeps,
  job: { id: string } & DedupeJob,
  vector: number[],
): Promise<DuplicateMatch | null> {
  const { dedupe } = await deps.settings.get();
  const since = toIso(new Date(deps.clock.now().getTime() - dedupe.lookbackDays * DAY_MS));
  const pool = await deps.repos.jobs.listDedupeCandidates(since, job.id, CANDIDATE_POOL);

  const shortlist = pool
    .filter((c): c is typeof c & { groupId: string } => c.groupId !== null)
    .map((c) => ({ c, verdict: looksLikeSameRole(job, { ...c, title: c.title ?? '' }, dedupe) }))
    .filter((x) => x.verdict.match)
    .sort((a, b) => b.verdict.titleScore - a.verdict.titleScore)
    .slice(0, dedupe.topK);
  if (shortlist.length === 0) return null;

  const vectors = await deps.vectors.getByIds(shortlist.map((x) => `job:${x.c.id}`));
  const byId = new Map(vectors.map((v) => [v.id, v.values]));
  let best: DuplicateMatch | null = null;
  for (const { c } of shortlist) {
    const values = byId.get(`job:${c.id}`);
    if (!values) continue;
    const similarity = cosine(vector, values);
    if (!isDuplicate(similarity, job, { ...c, title: c.title ?? '' }, dedupe).dup) continue;
    if (best === null || similarity > best.similarity) {
      best = { groupId: c.groupId, jobId: c.id, similarity };
    }
  }
  return best;
}

/** Point the group at its most complete posting (SPEC §8: pay, then IR35, then description, then earliest). */
export async function refreshCanonical(deps: PipelineDeps, groupId: string): Promise<void> {
  const postings = await deps.repos.jobs.listByGroup(groupId);
  const canonicalJobId = pickCanonical(
    postings
      .filter((p) => p.filterReason === null)
      .map((p) => ({
        id: p.id,
        hasPay: p.payMin !== null || p.payMax !== null,
        ir35Known: p.ir35 !== null && p.ir35 !== 'unknown',
        descriptionLength: p.descriptionText?.length ?? 0,
        postedAt: p.postedAt,
      })),
  );
  if (canonicalJobId !== null) await deps.repos.groups.update(groupId, { canonicalJobId });
}

/** Attach a posting to an existing group; if the user already acted on the group, count it as news. */
export async function joinGroup(
  deps: PipelineDeps,
  args: { jobId: string; groupId: string; now: string },
): Promise<void> {
  const group = await deps.repos.groups.getById(args.groupId);
  await deps.repos.jobs.update(args.jobId, { groupId: args.groupId });
  await deps.repos.groups.notePosting(
    args.groupId,
    args.now,
    group ? isActioned(group.status) : false,
  );
  await refreshCanonical(deps, args.groupId);
}
