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
