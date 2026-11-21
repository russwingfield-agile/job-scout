import type { CoverNoteKind, CoverNoteTone } from '@job-scout/shared';
import { BANNED_PHRASES } from '../../core/coverNote.js';

/** Bump on any change to the wording so stored notes stay traceable. */
export const COVER_NOTE_PROMPT_VERSION = 'coverNote@1';

const CHARS_PER_TOKEN = 4;

const TONE: Record<CoverNoteTone, string> = {
  concise: 'Direct and efficient; short sentences; no filler.',
  warm: 'Friendly and personable while staying professional.',
  formal: 'Formal and measured, as for a senior, traditional employer.',
};

const KIND: Record<CoverNoteKind, string> = {
  cover_note: 'a cover note to accompany the application',
  recruiter_message:
    'a short message to send to the recruiter on LinkedIn or by email, asking to be put forward',
};

const clip = (text: string, maxTokens: number): string => {
  const limit = maxTokens * CHARS_PER_TOKEN;
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[…truncated]`;
};

export type CoverNotePromptInput = {
  kind: CoverNoteKind;
  tone: CoverNoteTone;
  maxWords: number;
  job: {
    title: string | null;
    employerName: string | null;
    location: string | null;
    payText: string;
    descriptionText: string | null;
  };
  cvText: string;
  /** Strengths the assessment found, to lead with. */
  strengths: string[];
  maxJobTokens: number;
  maxCvTokens: number;
};

/** Build the (versioned) prompt. Output is plain text, not JSON. */
export function buildCoverNotePrompt(input: CoverNotePromptInput): {
  system: string;
  user: string;
  version: string;
} {
  const system = `You write job application text for a UK-based contractor or permanent candidate.
Write ${KIND[input.kind]}, at most ${input.maxWords} words. Tone: ${TONE[input.tone]}
Rules:
- Use UK spelling.
- Use ONLY facts that appear in the CV below. Never invent employers, skills, numbers, qualifications or dates.
- Mirror 3 to 5 of the advert's own key terms where the CV genuinely supports them.
- Lead with the strongest relevant evidence from the CV.
- Never use these phrases: ${BANNED_PHRASES.join(', ')}.
- End with one clear call to action (for example, offering a call this week).
- Sign off with the candidate's name if it appears in the CV.
- Return ONLY the text itself: no subject line, no preamble, no quotation marks, no markdown.`;

  const { job } = input;
  const user = [
    '## Job advert',
    `Title: ${job.title ?? 'unknown'}`,
    `Employer: ${job.employerName ?? 'unknown'}`,
    `Location: ${job.location ?? 'unknown'}`,
    `Pay: ${job.payText}`,
    `Description:\n<<<\n${clip(job.descriptionText ?? '', input.maxJobTokens)}\n>>>`,
    '',
    input.strengths.length > 0
      ? `## Strengths to lead with\n${input.strengths.map((s) => `- ${s}`).join('\n')}\n`
      : '',
    '## Candidate CV',
    `<<<\n${clip(input.cvText, input.maxCvTokens)}\n>>>`,
  ]
    .filter((part) => part !== '')
    .join('\n');

  return { system, user, version: COVER_NOTE_PROMPT_VERSION };
}
