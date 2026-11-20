/** Bump on any change to the wording or schema so stored summaries stay traceable. */
export const CV_SUMMARY_PROMPT_VERSION = 'cvSummary@1';

/** ≈ 4,000 tokens of CV: enough for a long CV, bounded so one upload cannot burn the budget. */
const CV_SUMMARY_MAX_CHARS = 16_000;

const SYSTEM = `You are an expert UK recruitment consultant summarising a candidate's CV so it can be matched to job adverts.
Use only facts that appear in the CV text. Never invent employers, skills, qualifications or dates.
Return ONLY a JSON object with exactly these fields:
- headline: one line (at most 140 characters) saying who this person is professionally
- seniority: their level, e.g. "senior", "lead", "head of", "principal"
- yearsExperience: total years of relevant professional experience, as a number
- skills: up to 25 core skills, tools and frameworks named in the CV
- sectors: industries they have worked in
- suggestedTitles: 3 to 6 job titles this person should search for on the UK market
- suggestedKeywords: up to 10 search keywords (frameworks, methods, tools) useful in job searches`;

export function buildCvSummaryPrompt(cvText: string): {
  system: string;
  user: string;
  version: string;
} {
  const text = cvText.trim().slice(0, CV_SUMMARY_MAX_CHARS);
  return {
    system: SYSTEM,
    user: `CV text:\n<<<\n${text}\n>>>`,
    version: CV_SUMMARY_PROMPT_VERSION,
  };
}
