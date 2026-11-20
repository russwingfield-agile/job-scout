import type { AssessmentExtracted, AssessmentResult } from '@job-scout/shared';

const digitsOnly = (s: string): string => s.replace(/\D/g, '');

/** Is this email written in the advert? Case-insensitive; the model must not invent contacts. */
export const emailAppearsIn = (email: string, advert: string): boolean =>
  email.trim() !== '' && advert.toLowerCase().includes(email.trim().toLowerCase());

/** Is this phone number in the advert, ignoring spaces, dashes and brackets? */
export function phoneAppearsIn(phone: string, advert: string): boolean {
  const wanted = digitsOnly(phone);
  return wanted.length >= 7 && digitsOnly(advert).includes(wanted);
}

export type SanitiseContext = {
  /** Text of the advert the model was shown. */
  advertText: string;
  activeCvIds: string[];
  /** Used when the model names a CV that is not an active one. */
  fallbackCvId: string | null;
};

/**
 * Check the model's output against what we know (SPEC §7.3):
 * - contact email/phone must appear in the advert, otherwise they are dropped;
 * - `best_cv_id` must be an active CV, otherwise the highest-scoring valid CV (or the most
 *   similar one) is used;
 * - per-CV scores for unknown CVs are dropped.
 */
export function sanitiseAssessment(
  result: AssessmentResult,
  ctx: SanitiseContext,
): AssessmentResult {
  const active = new Set(ctx.activeCvIds);
  const cvScores = result.cv_scores.filter((s) => active.has(s.cv_id));
  const topScored = [...cvScores].sort((a, b) => b.score - a.score)[0]?.cv_id ?? null;
  const bestCvId = active.has(result.best_cv_id)
    ? result.best_cv_id
    : (topScored ?? ctx.fallbackCvId ?? result.best_cv_id);

  const { contact_email, contact_phone } = result.extracted;
  return {
    ...result,
    best_cv_id: bestCvId,
    cv_scores: cvScores,
    extracted: {
      ...result.extracted,
      contact_email:
        contact_email !== null && emailAppearsIn(contact_email, ctx.advertText)
          ? contact_email
          : null,
      contact_phone:
        contact_phone !== null && phoneAppearsIn(contact_phone, ctx.advertText)
          ? contact_phone
          : null,
    },
  };
}

/** The stored job fields the model may fill in when our own parsing could not. */
export type JobFacts = {
  employmentType: string | null;
  workMode: string | null;
  ir35: string | null;
  payMin: number | null;
  payMax: number | null;
  payPeriod: string | null;
  contractLengthMonths: number | null;
};

export type JobFactsPatch = Partial<{
  employmentType: AssessmentExtracted['employment_type'];
  workMode: AssessmentExtracted['work_mode'];
  ir35: AssessmentExtracted['ir35'];
  payMin: number;
  payMax: number;
  payPeriod: AssessmentExtracted['pay_period'];
  contractLengthMonths: number;
}>;

const isUnknown = (v: string | null): boolean => v === null || v === 'unknown';

/**
 * Prefer our own parsed values; take the model's only where ours was `unknown` (SPEC §7.3).
 * Pay is filled as a whole (both bounds and the period) and only when nothing was parsed.
 */
export function mergeExtracted(job: JobFacts, extracted: AssessmentExtracted): JobFactsPatch {
  const patch: JobFactsPatch = {};
  if (isUnknown(job.employmentType) && extracted.employment_type !== 'unknown') {
    patch.employmentType = extracted.employment_type;
  }
  if (isUnknown(job.workMode) && extracted.work_mode !== 'unknown') {
    patch.workMode = extracted.work_mode;
  }
  if (isUnknown(job.ir35) && extracted.ir35 !== 'unknown') patch.ir35 = extracted.ir35;
  if (job.contractLengthMonths === null && extracted.contract_length_months !== null) {
    patch.contractLengthMonths = extracted.contract_length_months;
  }
  const noPay = job.payMin === null && job.payMax === null;
  const payKnown = extracted.pay_period !== 'unknown';
  if (noPay && payKnown && (extracted.pay_min !== null || extracted.pay_max !== null)) {
    const min = extracted.pay_min ?? extracted.pay_max;
    const max = extracted.pay_max ?? extracted.pay_min;
    if (min !== null && max !== null) {
      patch.payMin = min;
      patch.payMax = max;
      patch.payPeriod = extracted.pay_period;
    }
  }
  return patch;
}
