import type { CvSummary } from '@job-scout/shared';

/** ~500 tokens (SPEC §3.3): embeddings are cheap, and a longer text adds noise, not signal. */
export const EMBED_MAX_CHARS = 2_000;

/**
 * The text we embed for a CV: headline, skills, sectors and target titles from the summary when we
 * have one (the signal), then the start of the CV itself, truncated to the embedding budget.
 */
export function cvEmbeddingText(cv: {
  label: string;
  textMd: string;
  summary: CvSummary | null;
}): string {
  const { label, textMd, summary } = cv;
  const parts = summary
    ? [
        summary.headline,
        `Seniority: ${summary.seniority}`,
        `Skills: ${summary.skills.join(', ')}`,
        `Sectors: ${summary.sectors.join(', ')}`,
        `Roles: ${summary.suggestedTitles.join(', ')}`,
      ]
    : [label];
  return [...parts, textMd.trim()].join('\n').slice(0, EMBED_MAX_CHARS);
}

/** How much of a job advert goes into its embedding, after title/employer/location/pay (plan M5). */
export const JOB_DESCRIPTION_CHARS = 1_500;

/** The text we embed for a job: the facts that identify the role, then the start of the advert. */
export function jobEmbeddingText(job: {
  title: string;
  employerName: string;
  location: string;
  payText: string;
  descriptionText: string;
}): string {
  return [
    job.title,
    job.employerName,
    job.location,
    job.payText,
    job.descriptionText.slice(0, JOB_DESCRIPTION_CHARS),
  ]
    .filter((part) => part.trim() !== '')
    .join('\n')
    .slice(0, EMBED_MAX_CHARS);
}
