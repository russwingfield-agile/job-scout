import { AssessmentResultSchema, type GroupStatus } from '@job-scout/shared';
import { ASSESS_PROMPT_VERSION, buildAssessPrompt } from '../ai/prompts/assess.js';
import { structured } from '../ai/structured.js';
import { mergeExtracted, sanitiseAssessment } from '../core/assessment.js';
import { annualise, formatPay } from '../core/parse/pay.js';
import { finalScore } from '../core/scoring/final.js';
import type { JobPatch } from '../db/repos/jobs.js';
import { toIso } from '../lib/time.js';
import type { PipelineDeps } from './startRun.js';

/** Room for the JSON answer: scores, bullets and the extracted fields. */
const ASSESS_MAX_OUTPUT_TOKENS = 1_500;
const ASSESS_TEMPERATURE = 0.2;

export type AssessOutcome = 'scored' | 'failed' | 'deferred' | 'missing';

/** Groups that have not been acted on: assessing them moves them to the Inbox ('new'). */
const NOT_YET_ACTIONED = new Set<GroupStatus>([
  'prefiltered',
  'pending_llm',
  'deferred',
  'below_threshold',
  'new',
]);

const defined = <T>(value: T | undefined): value is T => value !== undefined;

/**
 * Stage E for one group: ask the model, check what it says, store the assessment, fill in job
 * facts our parser missed, and compute the final score. Used by the score queue and by "rescore".
 * - budget exhausted → the group becomes `deferred` (a later run picks it up first);
 * - the model fails or breaks the schema → a `failed` assessment is stored and the job stays in the
 *   Inbox with its first-pass score only.
 * Run counters are the caller's business; `runId` is only used to count what was done.
 */
export async function assessGroup(
  deps: PipelineDeps,
  groupId: string,
  runId: string | null,
): Promise<AssessOutcome> {
  const { repos, clock } = deps;
  const group = await repos.groups.getById(groupId);
  const job = group?.canonicalJobId ? await repos.jobs.getById(group.canonicalJobId) : undefined;
  if (!group || !job) return 'missing';

  const settings = await deps.settings.get();
  const activeCvs = (await repos.cvs.list()).filter((cv) => cv.active);
  if (activeCvs.length === 0) return 'missing';

  // CVs ordered by similarity: the closest few are shown in full, the rest by summary only.
  const similarities = await repos.groups.similaritiesFor(groupId);
  const similarityOf = new Map(similarities.map((s) => [s.cvId, s.similarity]));
  const ranked = [...activeCvs].sort(
    (a, b) => (similarityOf.get(b.id) ?? -1) - (similarityOf.get(a.id) ?? -1),
  );
  const fullTextIds = new Set(
    ranked.slice(0, settings.assessment.fullTextCvCount).map((c) => c.id),
  );

  const hits = await repos.jobs.profileHitsFor(job.id);
  const profiles = (await Promise.all(hits.map((h) => repos.profiles.getById(h.profileId)))).filter(
    defined,
  );

  const prompt = buildAssessPrompt({
    job: {
      title: job.title,
      employerName: job.employerName,
      location: job.location,
      workMode: job.workMode,
      employmentType: job.employmentType,
      payText: formatPay({ min: job.payMin, max: job.payMax, period: job.payPeriod ?? 'unknown' }),
      ir35: job.ir35,
      contractLengthMonths: job.contractLengthMonths,
      descriptionText: job.descriptionText,
    },
    cvs: ranked.map((cv) => ({
      id: cv.id,
      label: cv.label,
      summary: cv.summary,
      fullText: fullTextIds.has(cv.id) ? cv.textMd : null,
      similarity: similarityOf.get(cv.id) ?? null,
    })),
    profiles,
    maxJobTokens: settings.assessment.maxJobTokens,
    maxCvTokens: settings.assessment.maxCvTokens,
  });

  const result = await structured(deps, {
    schema: AssessmentResultSchema,
    prompt,
    maxTokens: ASSESS_MAX_OUTPUT_TOKENS,
    temperature: ASSESS_TEMPERATURE,
    purpose: 'assess',
  });

  if (!result.ok && result.reason === 'budget') {
    // Only a run's own work is deferred; a manual rescore leaves the group as it was.
    if (runId) {
      await repos.groups.setStatus(groupId, 'deferred');
      await repos.runs.bumpCount(runId, 'deferred', 1);
    }
    return 'deferred';
  }

  const now = toIso(clock.now());
  const nextStatus: GroupStatus = NOT_YET_ACTIONED.has(group.status) ? 'new' : group.status;

  if (!result.ok) {
    await repos.assessments.upsert({
      groupId,
      model: null,
      fitScore: null,
      bestCvId: null,
      resultJson: null,
      status: 'failed',
      promptVersion: ASSESS_PROMPT_VERSION,
      createdAt: now,
    });
    deps.log.warn({
      stage: 'assess',
      ...(runId ? { runId } : {}),
      groupId,
      msg: 'assessment failed',
      error: result.error,
    });
    await repos.groups.update(groupId, { status: nextStatus, finalScore: null });
    if (runId && nextStatus === 'new') await repos.runs.bumpCount(runId, 'inboxAdded', 1);
    return 'failed';
  }

  const assessment = sanitiseAssessment(result.data, {
    advertText: `${job.title ?? ''}\n${job.descriptionText ?? ''}`,
    activeCvIds: activeCvs.map((c) => c.id),
    fallbackCvId: ranked[0]?.id ?? null,
  });
  await repos.assessments.upsert({
    groupId,
    model: result.model,
    fitScore: assessment.fit_score,
    bestCvId: assessment.best_cv_id,
    resultJson: assessment,
    status: 'ok',
    promptVersion: result.promptVersion,
    createdAt: now,
  });

  // Take the model's reading of the advert only where our own parsing found nothing.
  const facts = mergeExtracted(job, assessment.extracted);
  if (Object.keys(facts).length > 0) {
    const patch: JobPatch = { ...facts };
    if (facts.payMin !== undefined) {
      const annual = annualise(
        { min: facts.payMin, max: facts.payMax ?? null, period: facts.payPeriod ?? 'unknown' },
        settings.working,
      );
      patch.annualisedMin = annual.min;
      patch.annualisedMax = annual.max;
    }
    await repos.jobs.update(job.id, patch);
  }

  const bestSimilarity =
    similarityOf.get(assessment.best_cv_id) ?? similarities[0]?.similarity ?? null;
  await repos.groups.update(groupId, {
    status: nextStatus,
    bestCvId: assessment.best_cv_id,
    finalScore: finalScore(
      {
        fitScore: assessment.fit_score,
        bestSimilarity,
        postedAt: job.postedAt,
        feedbackAdj: group.feedbackAdj ?? 0,
      },
      settings.weights,
      clock.now(),
    ),
  });
  if (runId) {
    await repos.runs.bumpCount(runId, 'llmScored', 1);
    if (nextStatus === 'new') await repos.runs.bumpCount(runId, 'inboxAdded', 1);
  }
  return 'scored';
}
