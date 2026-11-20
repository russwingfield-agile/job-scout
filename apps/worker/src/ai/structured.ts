import { z } from 'zod';
import { neuronRateFor } from '../config/neuronRates.js';
import type { SettingsService } from '../config/settings.js';
import { canSpendNeurons, shouldUseFallbackModel } from '../core/budget.js';
import { parseLlmJson } from '../core/llmJson.js';
import { approxTokens, estimateNeurons } from '../core/neurons.js';
import type { Repos } from '../db/repos/index.js';
import type { Logger } from '../lib/log.js';
import { dayKey } from '../lib/time.js';
import type { Clock } from '../ports/clock.js';
import type { LlmClient } from '../ports/llm.js';
import { recordAiUsage } from './usage.js';

export type StructuredDeps = {
  llm: LlmClient;
  repos: Repos;
  clock: Clock;
  settings: SettingsService;
  log: Logger;
};

export type StructuredOptions<T> = {
  schema: z.ZodType<T>;
  prompt: { system: string; user: string; version: string };
  maxTokens: number;
  purpose: 'assess' | 'cv_summary' | 'cover_note';
  /** Overrides `settings.models.scoring`. */
  model?: string | undefined;
  temperature?: number | undefined;
};

export type StructuredResult<T> =
  | { ok: true; data: T; model: string; promptVersion: string }
  | { ok: false; reason: 'budget' | 'invalid_output' | 'llm_error'; error: string };

type Attempt<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'invalid'; output: string; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'budget' };

const MAX_ECHOED_OUTPUT_CHARS = 2_000;

const formatIssues = (error: z.ZodError): string =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

/** The JSON Schema we send to the model (the `$schema` URL is noise to Workers AI). */
function jsonSchemaOf(schema: z.ZodType): object {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/**
 * Call an LLM and return validated, typed output (plan §2.5). Order of attempts:
 * 1. the primary model (the fallback model if the daily neuron budget is >80% spent),
 * 2. one *repair* call on the same model quoting what was wrong,
 * 3. one call on the fallback model with the original prompt.
 * Every call is budget-checked first and counted in `usage_daily` afterwards. Never throws for
 * model misbehaviour: failures come back as `{ ok: false, reason }` so callers can degrade.
 */
export async function structured<T>(
  deps: StructuredDeps,
  opts: StructuredOptions<T>,
): Promise<StructuredResult<T>> {
  const { models, budgets } = await deps.settings.get();
  const usedToday = (await deps.repos.usage.get(dayKey(deps.clock.now())))?.neuronsEst ?? 0;
  const primary = shouldUseFallbackModel(usedToday, budgets)
    ? models.fallback
    : (opts.model ?? models.scoring);
  const jsonSchema = jsonSchemaOf(opts.schema);
  const { system, user } = opts.prompt;
  let spent = 0;

  async function attempt(model: string, userText: string): Promise<Attempt<T>> {
    const worstCase = estimateNeurons(
      neuronRateFor(model),
      approxTokens(system + userText),
      opts.maxTokens,
    );
    if (!canSpendNeurons(usedToday + spent, worstCase, budgets)) return { kind: 'budget' };

    let response: Awaited<ReturnType<LlmClient['complete']>>;
    try {
      response = await deps.llm.complete({
        model,
        system,
        user: userText,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        jsonSchema,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.log.warn({
        stage: 'ai',
        msg: 'LLM call failed',
        purpose: opts.purpose,
        model,
        error: message,
      });
      return { kind: 'error', message };
    }

    spent += await recordAiUsage(deps, {
      kind: 'llm',
      model,
      inTokens: response.usage?.in ?? approxTokens(system + userText),
      outTokens: response.usage?.out ?? approxTokens(response.text),
    });

    const json = parseLlmJson(response.text);
    const parsed = json.ok ? opts.schema.safeParse(json.value) : null;
    if (parsed?.success) return { kind: 'ok', data: parsed.data };

    const message = json.ok
      ? formatIssues((parsed as { success: false; error: z.ZodError }).error)
      : `not valid JSON (${json.error})`;
    deps.log.warn({
      stage: 'ai',
      msg: 'invalid LLM output',
      purpose: opts.purpose,
      model,
      error: message,
    });
    return { kind: 'invalid', output: response.text, message };
  }

  const success = (data: T, model: string): StructuredResult<T> => ({
    ok: true,
    data,
    model,
    promptVersion: opts.prompt.version,
  });

  const first = await attempt(primary, user);
  if (first.kind === 'ok') return success(first.data, primary);
  let last: Attempt<T> = first;
  let sawInvalid = first.kind === 'invalid';

  if (first.kind === 'invalid') {
    const repair = `${user}\n\nYour last output was invalid: ${first.message}\nLast output:\n${first.output.slice(0, MAX_ECHOED_OUTPUT_CHARS)}\n\nReturn corrected JSON only.`;
    const second = await attempt(primary, repair);
    if (second.kind === 'ok') return success(second.data, primary);
    last = second;
    sawInvalid = sawInvalid || second.kind === 'invalid';
  }
  // Reaching here means every attempt so far failed.

  if (last.kind !== 'budget' && primary !== models.fallback) {
    const third = await attempt(models.fallback, user);
    if (third.kind === 'ok') return success(third.data, models.fallback);
    last = third;
    sawInvalid = sawInvalid || third.kind === 'invalid';
  }

  if (last.kind === 'budget') {
    return { ok: false, reason: 'budget', error: 'Daily AI neuron budget exhausted' };
  }
  const detail = last.kind === 'error' || last.kind === 'invalid' ? last.message : '';
  return {
    ok: false,
    reason: sawInvalid ? 'invalid_output' : 'llm_error',
    error: detail,
  };
}
