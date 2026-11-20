import type { EmploymentType, NormalisedJob, SearchProfile } from '@job-scout/shared';
import { recordAiUsage } from '../ai/usage.js';
import { canSpendReed } from '../core/budget.js';
import { jobEmbeddingText } from '../core/embedText.js';
import { evaluateAcrossProfiles } from '../core/filters.js';
import { approxTokens } from '../core/neurons.js';
import { annualise, formatPay } from '../core/parse/pay.js';
import { bestCv, prefilterScore, titleMatchesProfile } from '../core/scoring/prefilter.js';
import { cosine } from '../core/vectors.js';
import type { JobPatch } from '../db/repos/jobs.js';
import { AppError } from '../lib/errors.js';
import { dayKey, toIso } from '../lib/time.js';
import type { ProcessMessage } from './messages.js';
import type { PipelineDeps } from './startRun.js';

const defined = <T>(value: T | undefined): value is T => value !== undefined;

const CONTRACT_LIKE: EmploymentType[] = ['contract', 'temp'];

/** NormalisedJob → the columns we store (plus yearly-equivalent pay, for comparing day and year). */
function jobColumns(
  n: NormalisedJob,
  working: { workingDaysPerYear: number; hoursPerDay: number },
  rawJson: string,
): JobPatch {
  const annual = annualise(
    { min: n.payMin ?? null, max: n.payMax ?? null, period: n.payPeriod },
    working,
  );
  return {
    url: n.url,
    externalApplyUrl: n.externalApplyUrl ?? null,
    title: n.title,
    employerName: n.employerName,
    isAgency: n.isAgency,
    location: n.location,
    workMode: n.workMode,
    employmentType: n.employmentType,
    salaryText: n.salaryText ?? null,
    payMin: n.payMin ?? null,
    payMax: n.payMax ?? null,
    payPeriod: n.payPeriod,
    annualisedMin: annual.min,
    annualisedMax: annual.max,
    ir35: n.ir35 ?? null,
    contractLengthMonths: n.contractLengthMonths ?? null,
    postedAt: n.postedAt,
    expiresAt: n.expiresAt ?? null,
    descriptionText: n.descriptionText,
    descriptionHtml: n.descriptionHtml,
    applicationsCount: n.applicationsCount ?? null,
    rawJson,
    stage: 'detailed',
  };
}

/**
 * Stage C: full advert → normalise → hard filters → embed → prefilter score, for one job.
 * Resumable: `stage` records how far a previous attempt got, and the group is reused if it exists.
 * (De-duplication lands in M6: until then every job gets its own group.)
 */
export async function processJob(deps: PipelineDeps, msg: ProcessMessage): Promise<void> {
  const { repos, clock, source, embedder, vectors } = deps;
  const job = await repos.jobs.getById(msg.jobId);
  if (!job || job.stage === 'processed') return;

  const settings = await deps.settings.get();
  const now = toIso(clock.now());
  const profiles = (
    await Promise.all(
      (await repos.jobs.profileIdsFor(job.id)).map((id) => repos.profiles.getById(id)),
    )
  ).filter(defined);

  // 1. The full advert (one Reed call), or the copy stored by an earlier attempt.
  let raw: unknown;
  if (job.stage === 'ref' || job.rawJson === null) {
    const usage = await repos.usage.get(dayKey(clock.now()));
    const decision = canSpendReed(
      {
        usedToday: usage?.reedCalls ?? 0,
        usedThisRun: await repos.sourceCalls.countByRun(msg.runId),
        n: 1,
      },
      settings.budgets,
    );
    if (!decision.ok) {
      throw new AppError('BUDGET_EXHAUSTED', `Reed budget exhausted (${decision.reason})`);
    }
    try {
      raw = (await source.details(job.sourceJobId, { runId: msg.runId })).raw;
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') {
        await repos.jobs.update(job.id, {
          stage: 'processed',
          filterReason: 'no_longer_available',
        });
        return;
      }
      throw err;
    }
  } else {
    raw = JSON.parse(job.rawJson);
  }

  // 2. Normalise and store.
  const requestedTypes = [...new Set(profiles.flatMap((p) => p.employmentTypes))];
  const normalised = source.normalise(
    { sourceJobId: job.sourceJobId, raw },
    { profileEmploymentTypes: requestedTypes, now: clock.now() },
  );
  await repos.jobs.update(job.id, jobColumns(normalised, settings.working, JSON.stringify(raw)));

  // 3. Hard filters: a job passes if it passes for any profile that found it.
  const filter = evaluateAcrossProfiles(normalised, profiles, settings.blocklist, settings.working);

  // 4. Group (one per job until M6 adds de-duplication). Created even when filtered, so the job
  //    stays visible under "show filtered" with its reason.
  let groupId = job.groupId;
  if (!groupId) {
    groupId = crypto.randomUUID();
    await repos.groups.insert({
      id: groupId,
      canonicalJobId: job.id,
      status: filter.pass ? 'prefiltered' : 'filtered',
      firstSeenAt: now,
      lastSeenAt: now,
      runId: msg.runId,
    });
    await repos.jobs.update(job.id, { groupId });
  }

  if (!filter.pass) {
    await repos.jobs.update(job.id, {
      filterReason: filter.reasons.join('; '),
      stage: 'processed',
    });
    await repos.runs.bumpCount(msg.runId, 'filtered', 1);
    return;
  }

  // 5. Embed the job so it can be compared with the CVs (and, in M6, with other jobs).
  const text = jobEmbeddingText({
    title: normalised.title,
    employerName: normalised.employerName,
    location: normalised.location,
    payText: formatPay({
      min: normalised.payMin ?? null,
      max: normalised.payMax ?? null,
      period: normalised.payPeriod,
    }),
    descriptionText: normalised.descriptionText,
  });
  const [vector] = await embedder.embed([text]);
  if (!vector) throw new AppError('UPSTREAM_ERROR', 'Embedding service returned no vector');
  await recordAiUsage(deps, {
    kind: 'embed',
    model: embedder.model,
    inTokens: approxTokens(text),
    outTokens: 0,
  });
  await vectors.upsert([
    {
      id: `job:${job.id}`,
      values: vector,
      metadata: { kind: 'job', postedTs: Date.parse(normalised.postedAt), groupId },
    },
  ]);

  // 6. Similarity to each active CV, then the prefilter score.
  const activeCvs = (await repos.cvs.list()).filter((cv) => cv.active);
  const cvVectors = await vectors.getByIds(activeCvs.map((cv) => `cv:${cv.id}`));
  const similarities = cvVectors.map((v) => ({
    cvId: v.id.slice('cv:'.length),
    similarity: cosine(vector, v.values),
  }));
  await repos.groups.saveSimilarities(groupId, similarities);

  const best = bestCv(similarities);
  const score = prefilterScore(
    {
      bestSimilarity: best?.similarity ?? null,
      titleMatch: profiles.some((p: SearchProfile) =>
        titleMatchesProfile(normalised.title, p.jobTitles, settings.dedupe.titleTokenSetRatio),
      ),
      payDisclosed: normalised.payMin !== undefined || normalised.payMax !== undefined,
      ir35Outside:
        normalised.ir35 === 'outside' && CONTRACT_LIKE.includes(normalised.employmentType),
      feedbackAdj: 0,
    },
    settings.weights,
  );
  await repos.groups.update(groupId, {
    status: 'prefiltered',
    prefilterScore: score,
    bestCvId: best?.cvId ?? null,
    lastSeenAt: now,
  });
  await repos.jobs.update(job.id, { stage: 'processed' });
  await repos.runs.bumpCount(msg.runId, 'prefiltered', 1);
}
