import type { CvSummary, SearchProfile } from '@job-scout/shared';

/** Bump on any change to the wording, rubric or output schema so stored assessments stay traceable. */
export const ASSESS_PROMPT_VERSION = 'assess@2';

const CHARS_PER_TOKEN = 4;

const SYSTEM = `You are an expert UK recruitment consultant assessing fit between a job advert and a candidate's CVs.
Be strict and evidence-based. Only cite skills, employers and achievements that appear in the CV text. UK conventions apply: day rates, IR35, SC/DV clearance, hybrid days in the office.
Return ONLY a JSON object matching the schema you are given. No commentary.

Score fit_score from 0 to 100 for the best-matching CV using this rubric:
- 90-100: meets all essential requirements and most desirables, right seniority, the candidate's preferences are met
- 75-89: meets the essentials with minor gaps
- 60-74: meets most essentials, with notable gaps or conflicts with the candidate's preferences
- 40-59: partial fit
- below 40: poor fit
Location matters: if the job is not in or near one of the candidate's places and is not clearly remote, fit_score must be below 40 and red_flags must include "location mismatch", however good the skills match.
Give every CV a score in cv_scores and set best_cv_id to the id of the highest. Use the CV ids exactly as given.

Rules for the extracted fields:
- Fill them only from the advert text. Use null (or "unknown") when the advert does not say.
- contact_name, contact_email, contact_phone and reference must be written in the advert. Never invent them.
- hiring_company is the end client if the advert names one; agency is the recruitment agency if the advert is placed by one.
- pay_min and pay_max are numbers without currency symbols, for pay_period "day", "hour" or "year".
- red_flags: short phrases such as "inside IR35", "5 days on site", "rate not stated", "clearance required", "rate below your minimum".
- headline is one line (at most 140 characters) saying why this job fits or does not.
- strengths and gaps: at most 5 short bullets each, quoting evidence.
- confidence is 0 to 1: how sure you are given how much the advert says.`;

export type AssessJob = {
  title: string | null;
  employerName: string | null;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  payText: string;
  ir35: string | null;
  contractLengthMonths: number | null;
  descriptionText: string | null;
};

export type AssessCv = {
  id: string;
  label: string;
  summary: CvSummary | null;
  /** Full CV text; supplied only for the CVs most similar to the advert. */
  fullText: string | null;
  similarity: number | null;
};

export type AssessPromptInput = {
  job: AssessJob;
  cvs: AssessCv[];
  /** The profiles that found this job: their preferences are what the candidate wants. */
  profiles: SearchProfile[];
  maxJobTokens: number;
  maxCvTokens: number;
};

const clip = (text: string, maxTokens: number): string => {
  const limit = maxTokens * CHARS_PER_TOKEN;
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[…truncated]`;
};

const list = (items: string[]): string => (items.length > 0 ? items.join(', ') : 'none given');

function describeCv(cv: AssessCv, maxCvTokens: number): string {
  const s = cv.summary;
  const lines = [`CV id: ${cv.id}`, `Label: ${cv.label}`];
  if (s) {
    lines.push(
      `Headline: ${s.headline}`,
      `Seniority: ${s.seniority}; about ${s.yearsExperience} years of experience`,
      `Skills: ${list(s.skills)}`,
      `Sectors: ${list(s.sectors)}`,
    );
  }
  if (cv.fullText) lines.push(`Full text:\n<<<\n${clip(cv.fullText, maxCvTokens)}\n>>>`);
  return lines.join('\n');
}

function describePreferences(profiles: SearchProfile[]): string {
  if (profiles.length === 0) return 'No stated preferences.';
  return profiles
    .map((p) => {
      const parts = [
        `Target titles: ${list(p.jobTitles)}`,
        `Places: ${list(p.locations)}`,
        `Employment: ${list(p.employmentTypes)}`,
        p.minDayRate === null ? null : `Minimum day rate: £${p.minDayRate}`,
        p.minSalary === null ? null : `Minimum salary: £${p.minSalary}`,
        `IR35: ${p.ir35Preference.replace('_', ' ')}`,
        p.workModes.length > 0 ? `Work modes: ${list(p.workModes)}` : null,
        p.maxOnsiteDays === null ? null : `Max days on site: ${p.maxOnsiteDays}`,
      ];
      return `- ${parts.filter((x) => x !== null).join('; ')}`;
    })
    .join('\n');
}

/** Build the versioned assessment prompt. Pure: the same input always gives the same text. */
export function buildAssessPrompt(input: AssessPromptInput): {
  system: string;
  user: string;
  version: string;
} {
  const { job } = input;
  const advert = [
    `Title: ${job.title ?? 'unknown'}`,
    `Employer: ${job.employerName ?? 'unknown'}`,
    `Location: ${job.location ?? 'unknown'}`,
    `Work mode (parsed): ${job.workMode ?? 'unknown'}`,
    `Employment type (parsed): ${job.employmentType ?? 'unknown'}`,
    `Pay (parsed): ${job.payText}`,
    `IR35 (parsed): ${job.ir35 ?? 'unknown'}`,
    job.contractLengthMonths === null
      ? null
      : `Contract length: ${job.contractLengthMonths} months`,
    `Description:\n<<<\n${clip(job.descriptionText ?? '', input.maxJobTokens)}\n>>>`,
  ]
    .filter((x) => x !== null)
    .join('\n');

  const user = [
    '## Job advert',
    advert,
    '',
    '## Candidate preferences',
    describePreferences(input.profiles),
    '',
    '## Candidate CVs',
    ...input.cvs.map((cv) => describeCv(cv, input.maxCvTokens)),
  ].join('\n\n');

  return { system: SYSTEM, user, version: ASSESS_PROMPT_VERSION };
}
