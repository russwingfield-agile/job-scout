import {
  type CvDetail,
  type CvListItem,
  type CvMutationResponse,
  CvSummarySchema,
  type UpdateCvRequest,
  type UpdateSearchProfile,
} from '@job-scout/shared';
import { buildCvSummaryPrompt } from '../ai/prompts/cvSummary.js';
import { structured } from '../ai/structured.js';
import { recordAiUsage } from '../ai/usage.js';
import type { Deps } from '../container.js';
import {
  CV_MIME_TYPES,
  checkCvUpload,
  labelFromFilename,
  sanitiseFilename,
} from '../core/cvFile.js';
import { cvEmbeddingText } from '../core/embedText.js';
import { approxTokens } from '../core/neurons.js';
import { AppError } from '../lib/errors.js';
import { toIso } from '../lib/time.js';

export type CvDeps = Pick<
  Deps,
  'repos' | 'clock' | 'log' | 'settings' | 'blobs' | 'docs' | 'embedder' | 'llm' | 'vectors'
>;

/** Below this many characters, extraction is treated as having failed (scanned/image-only PDFs). */
const MIN_TEXT_CHARS = 50;
const MAX_SUGGESTED_TITLES = 6;
const SUMMARY_MAX_OUTPUT_TOKENS = 1_200;
const NO_TEXT_WARNING =
  'No readable text was found in this CV. Paste your CV text into the editor, then click Re-analyse.';

export const cvVectorId = (cvId: string): string => `cv:${cvId}`;

const REASON_TEXT = {
  budget: 'the daily AI budget is used up',
  invalid_output: 'the model returned unusable output',
} as const;

async function requireCv(deps: CvDeps, id: string) {
  const cv = await deps.repos.cvs.getById(id);
  if (!cv) throw new AppError('NOT_FOUND', 'CV not found');
  return cv;
}

async function assertRoomForActiveCv(deps: CvDeps): Promise<void> {
  const { cvs } = await deps.settings.get();
  if ((await deps.repos.cvs.countActive()) >= cvs.maxActive) {
    throw new AppError(
      'CONFLICT',
      `You already have ${cvs.maxActive} active CVs. Deactivate or delete one first.`,
    );
  }
}

async function detail(deps: CvDeps, id: string): Promise<CvDetail> {
  const cv = await requireCv(deps, id);
  const { r2Key: _storageKey, ...rest } = cv;
  return { ...rest, profile: (await deps.repos.profiles.getByCvId(id)) ?? null };
}

/** Summarise with the LLM and embed into Vectorize. Failures become warnings, never lose the CV. */
async function analyse(deps: CvDeps, id: string): Promise<string[]> {
  const cv = await requireCv(deps, id);
  if (cv.textMd.trim().length < MIN_TEXT_CHARS) return [NO_TEXT_WARNING];

  const warnings: string[] = [];
  const prompt = buildCvSummaryPrompt(cv.textMd);
  const summaryResult = await structured(deps, {
    schema: CvSummarySchema,
    prompt,
    maxTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    purpose: 'cv_summary',
  });

  let summary = cv.summary;
  if (summaryResult.ok) {
    summary = summaryResult.data;
    await deps.repos.cvs.update(id, {
      summaryJson: summary,
      updatedAt: toIso(deps.clock.now()),
    });
  } else {
    const why =
      summaryResult.reason === 'llm_error'
        ? summaryResult.error
        : REASON_TEXT[summaryResult.reason];
    warnings.push(`Could not summarise this CV: ${why}. Click Re-analyse to retry.`);
  }

  try {
    const text = cvEmbeddingText({ label: cv.label, textMd: cv.textMd, summary });
    const [values] = await deps.embedder.embed([text]);
    if (!values) throw new Error('no embedding returned');
    await recordAiUsage(deps, {
      kind: 'embed',
      model: deps.embedder.model,
      inTokens: approxTokens(text),
      outTokens: 0,
    });
    await deps.vectors.upsert([{ id: cvVectorId(id), values, metadata: { kind: 'cv' } }]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.warn({ stage: 'cv', msg: 'embedding failed', cvId: id, error: message });
    warnings.push(`Could not embed this CV: ${message}. Click Re-analyse to retry.`);
  }
  return warnings;
}

/** Create the CV's search profile from its summary and the global defaults, if it has none yet. */
async function ensureProfile(deps: CvDeps, cvId: string): Promise<void> {
  if (await deps.repos.profiles.getByCvId(cvId)) return;
  const cv = await requireCv(deps, cvId);
  const { cvs } = await deps.settings.get();

  const suggested = (cv.summary?.suggestedTitles ?? [])
    .map((t) => t.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, MAX_SUGGESTED_TITLES);
  const profile: UpdateSearchProfile = {
    jobTitles: suggested.length > 0 ? suggested : [cv.label],
    mustKeywords: [],
    excludeKeywords: [],
    locations: cvs.profileDefaults.locations,
    radiusMiles: cvs.profileDefaults.radiusMiles,
    employmentTypes: cvs.profileDefaults.employmentTypes,
    minDayRate: null,
    minSalary: null,
    ir35Preference: 'any',
    workModes: [],
    maxOnsiteDays: null,
    active: true,
  };
  await deps.repos.profiles.insert(crypto.randomUUID(), cvId, profile, toIso(deps.clock.now()));
}

export async function listCvs(deps: CvDeps): Promise<CvListItem[]> {
  const [cvs, profiles] = await Promise.all([deps.repos.cvs.list(), deps.repos.profiles.list()]);
  const profileByCv = new Map(profiles.map((p) => [p.cvId, p.id]));
  return cvs.map(({ r2Key: _k, textMd: _t, ...rest }) => ({
    ...rest,
    profileId: profileByCv.get(rest.id) ?? null,
  }));
}

export const getCv = detail;

/** Validate, store, extract text, summarise, embed, and pre-fill a search profile. */
export async function createCv(
  deps: CvDeps,
  input: { filename: string; mime: string; bytes: ArrayBuffer; label?: string | undefined },
): Promise<CvMutationResponse> {
  const { cvs } = await deps.settings.get();
  const check = checkCvUpload(
    { mime: input.mime, size: input.bytes.byteLength, bytes: new Uint8Array(input.bytes) },
    cvs.maxUploadBytes,
  );
  if (!check.ok) throw new AppError('VALIDATION', check.error);
  await assertRoomForActiveCv(deps);

  const id = crypto.randomUUID();
  const now = toIso(deps.clock.now());
  const filename = sanitiseFilename(input.filename);
  const mime = CV_MIME_TYPES[check.kind];
  const r2Key = `cvs/${id}/${filename}`;
  await deps.blobs.put(r2Key, input.bytes, mime);

  // A document we cannot read still becomes a CV: the user can paste the text themselves.
  const warnings: string[] = [];
  let textMd = '';
  try {
    textMd = await deps.docs.toMarkdown({ name: filename, bytes: input.bytes, mime });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.warn({ stage: 'cv', msg: 'text extraction failed', cvId: id, error: message });
    warnings.push(`${message}. Paste your CV text into the editor, then click Re-analyse.`);
  }

  await deps.repos.cvs.insert({
    id,
    label: input.label?.trim() || labelFromFilename(input.filename),
    r2Key,
    filename,
    textMd,
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  const analysis = await analyse(deps, id);
  warnings.push(...analysis.filter((w) => w !== NO_TEXT_WARNING || warnings.length === 0));
  await ensureProfile(deps, id);
  return { cv: await detail(deps, id), warnings };
}

/** Edit label, text or active flag. Changed text is re-summarised and re-embedded. */
export async function updateCv(
  deps: CvDeps,
  id: string,
  patch: UpdateCvRequest,
): Promise<CvMutationResponse> {
  const cv = await requireCv(deps, id);
  if (patch.active === true && !cv.active) await assertRoomForActiveCv(deps);

  const textChanged = patch.textMd !== undefined && patch.textMd !== cv.textMd;
  await deps.repos.cvs.update(id, {
    ...(patch.label === undefined ? {} : { label: patch.label }),
    ...(patch.textMd === undefined ? {} : { textMd: patch.textMd }),
    ...(patch.active === undefined ? {} : { active: patch.active }),
    updatedAt: toIso(deps.clock.now()),
  });

  const warnings = textChanged ? await analyse(deps, id) : [];
  return { cv: await detail(deps, id), warnings };
}

/** Re-run summary + embedding on the stored text (the "Re-analyse" button). */
export async function reanalyseCv(deps: CvDeps, id: string): Promise<CvMutationResponse> {
  await requireCv(deps, id);
  const warnings = await analyse(deps, id);
  await ensureProfile(deps, id);
  return { cv: await detail(deps, id), warnings };
}

/** Remove the CV everywhere: vector, stored file, profile, row. */
export async function deleteCv(deps: CvDeps, id: string): Promise<void> {
  const cv = await requireCv(deps, id);
  await deps.vectors.deleteByIds([cvVectorId(id)]);
  await deps.blobs.delete(cv.r2Key);
  await deps.repos.profiles.deleteByCvId(id);
  await deps.repos.cvs.delete(id);
}
