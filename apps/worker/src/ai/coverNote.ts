import type { CoverNoteKind, CoverNoteTone } from '@job-scout/shared';
import { neuronRateFor } from '../config/neuronRates.js';
import type { SettingsService } from '../config/settings.js';
import { canSpendNeurons, shouldUseFallbackModel } from '../core/budget.js';
import { cleanNote, limitWords } from '../core/coverNote.js';
import { approxTokens, estimateNeurons } from '../core/neurons.js';
import type { Repos } from '../db/repos/index.js';
import { AppError } from '../lib/errors.js';
import { dayKey } from '../lib/time.js';
import type { Clock } from '../ports/clock.js';
import type { LlmClient } from '../ports/llm.js';
import { buildCoverNotePrompt, type CoverNotePromptInput } from './prompts/coverNote.js';
import { recordAiUsage } from './usage.js';

export type CoverNoteDeps = {
  llm: LlmClient;
  repos: Repos;
  clock: Clock;
  settings: SettingsService;
};

/** Words are about 1.5 tokens each; leave room so the model is not cut off mid-sentence. */
const TOKENS_PER_WORD = 2;
const MIN_OUTPUT_TOKENS = 150;
const TEMPERATURE = 0.7;

export type DraftInput = Omit<CoverNotePromptInput, 'maxWords' | 'maxJobTokens' | 'maxCvTokens'> & {
  kind: CoverNoteKind;
  tone: CoverNoteTone;
};

/**
 * Draft a cover note or recruiter message as plain text (the "cover-note helper" the architecture
 * allows besides `structured()`). Budget-checked first; the result is tidied and held to its word
 * limit afterwards, because models overrun.
 */
export async function draftCoverNote(
  deps: CoverNoteDeps,
  input: DraftInput,
): Promise<{ text: string; model: string; promptVersion: string }> {
  const { models, budgets, coverNotes } = await deps.settings.get();
  const maxWords = input.kind === 'cover_note' ? coverNotes.noteWords : coverNotes.messageWords;
  const usedToday = (await deps.repos.usage.get(dayKey(deps.clock.now())))?.neuronsEst ?? 0;
  const model = shouldUseFallbackModel(usedToday, budgets) ? models.fallback : models.coverNote;
  const prompt = buildCoverNotePrompt({
    ...input,
    maxWords,
    maxJobTokens: coverNotes.maxJobTokens,
    maxCvTokens: coverNotes.maxCvTokens,
  });
  const maxTokens = Math.max(MIN_OUTPUT_TOKENS, maxWords * TOKENS_PER_WORD);

  const worstCase = estimateNeurons(
    neuronRateFor(model),
    approxTokens(prompt.system + prompt.user),
    maxTokens,
  );
  if (!canSpendNeurons(usedToday, worstCase, budgets)) {
    throw new AppError('BUDGET_EXHAUSTED', "Today's AI allowance is used up. Try again tomorrow.");
  }

  const response = await deps.llm.complete({
    model,
    system: prompt.system,
    user: prompt.user,
    maxTokens,
    temperature: TEMPERATURE,
  });
  await recordAiUsage(deps, {
    kind: 'llm',
    model,
    inTokens: response.usage?.in ?? approxTokens(prompt.system + prompt.user),
    outTokens: response.usage?.out ?? approxTokens(response.text),
  });

  const text = limitWords(cleanNote(response.text), maxWords);
  if (text === '')
    throw new AppError('LLM_INVALID_OUTPUT', 'The AI returned an empty note. Try again.');
  return { text, model, promptVersion: prompt.version };
}
