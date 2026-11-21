import { computeFeedbackAdj, type FeedbackResult } from '../core/scoring/feedback.js';
import { cosine } from '../core/vectors.js';
import type { PipelineDeps } from './startRun.js';

/**
 * What your past choices say about this job (SPEC §10.2). Reads only a handful of rows and, when
 * you have acted on anything, the vectors of your most recent wanted/unwanted jobs.
 */
export async function feedbackFor(
  deps: PipelineDeps,
  job: { employerName: string; vector: number[] },
): Promise<FeedbackResult> {
  const { feedback } = await deps.settings.get();
  const { applications } = deps.repos;
  const [agencySkips, appliedBefore, wantedIds, unwantedIds] = await Promise.all([
    applications.countAgencySpamSkips(job.employerName),
    applications.hasAppliedTo(job.employerName),
    applications.recentJobIds('wanted', feedback.recentVectorCount),
    applications.recentJobIds('unwanted', feedback.recentVectorCount),
  ]);

  const best = async (ids: string[]): Promise<number | null> => {
    if (ids.length === 0) return null;
    const vectors = await deps.vectors.getByIds(ids.map((id) => `job:${id}`));
    return vectors.length === 0
      ? null
      : Math.max(...vectors.map((v) => cosine(job.vector, v.values)));
  };

  return computeFeedbackAdj(
    {
      agencySkips,
      appliedBefore,
      maxSimilarityToWanted: await best(wantedIds),
      maxSimilarityToUnwanted: await best(unwantedIds),
    },
    feedback,
  );
}
