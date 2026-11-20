import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { structured } from '../../src/ai/structured.js';
import { DEFAULT_SETTINGS } from '../../src/config/defaults.js';
import { createSettingsService } from '../../src/config/settings.js';
import { createDb } from '../../src/db/client.js';
import { createRepos } from '../../src/db/repos/index.js';
import { createLogger } from '../../src/lib/log.js';
import type { Clock } from '../../src/ports/clock.js';
import { FakeLlm, type ScriptedReply } from '../fakes/fakeLlm.js';

const repos = createRepos(createDb(env.DB));
const clock: Clock = { now: () => new Date('2026-11-20T09:00:00.000Z') };
const TODAY = '2026-11-20';
const { scoring: PRIMARY, fallback: FALLBACK } = DEFAULT_SETTINGS.models;

const schema = z.object({ answer: z.string(), score: z.number().min(0).max(100) });
const VALID = JSON.stringify({ answer: 'yes', score: 80 });
const prompt = { system: 'You are a tester.', user: 'Rate this.', version: 'test@1' };

function run(replies: ScriptedReply[], extra: { model?: string } = {}) {
  const llm = new FakeLlm(replies);
  const log = createLogger();
  const settings = createSettingsService({ repos, clock, log });
  const result = structured(
    { llm, repos, clock, settings, log },
    { schema, prompt, maxTokens: 500, purpose: 'cv_summary', ...extra },
  );
  return { llm, result };
}

beforeEach(async () => {
  for (const table of ['usage_daily', 'settings']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('structured()', () => {
  it('returns validated data from a clean JSON reply and counts the usage', async () => {
    const { llm, result } = run([{ text: VALID, usage: { in: 1_000, out: 200 } }]);
    expect(await result).toEqual({
      ok: true,
      data: { answer: 'yes', score: 80 },
      model: PRIMARY,
      promptVersion: 'test@1',
    });
    expect(llm.requests).toHaveLength(1);

    const usage = await repos.usage.get(TODAY);
    // 70B: 1,000 in × 26,668/M + 200 out × 204,805/M ≈ 68 neurons
    expect(usage).toMatchObject({ llmCalls: 1, neuronsEst: 68 });
  });

  it('sends the JSON schema (without $schema) and honours a model override', async () => {
    const { llm, result } = run([VALID], { model: FALLBACK });
    expect((await result).ok).toBe(true);
    const req = llm.requests[0];
    expect(req?.model).toBe(FALLBACK);
    expect(req?.jsonSchema).toMatchObject({
      type: 'object',
      properties: { answer: { type: 'string' }, score: { type: 'number' } },
    });
    expect(req?.jsonSchema).not.toHaveProperty('$schema');
    expect(req?.maxTokens).toBe(500);
  });

  it('accepts JSON wrapped in a code fence or prose', async () => {
    const fenced = ['```json', VALID, '```'].join('\n');
    expect((await run([fenced]).result).ok).toBe(true);
    expect((await run([`Here you go: ${VALID} Hope that helps.`]).result).ok).toBe(true);
  });

  it('repairs invalid output with one more call that quotes the problem', async () => {
    const { llm, result } = run([JSON.stringify({ answer: 'yes', score: 500 }), VALID]);
    const out = await result;
    expect(out).toMatchObject({ ok: true, model: PRIMARY });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]?.user).toContain('Your last output was invalid');
    expect(llm.requests[1]?.user).toContain('score');
    expect(llm.requests[1]?.user).toContain('Return corrected JSON only');
    expect(llm.requests[1]?.model).toBe(PRIMARY);
  });

  it('falls back to the cheap model when repair also fails', async () => {
    const { llm, result } = run(['not json at all', '{"answer": 1}', VALID]);
    expect(await result).toMatchObject({ ok: true, model: FALLBACK });
    expect(llm.requests.map((r) => r.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
    // The fallback call gets the original prompt, not the repair text.
    expect(llm.requests[2]?.user).toBe(prompt.user);
  });

  it('fails with invalid_output after every attempt is unusable', async () => {
    const { llm, result } = run(['nope', 'still nope', 'never']);
    expect(await result).toMatchObject({ ok: false, reason: 'invalid_output' });
    expect(llm.requests).toHaveLength(3);
  });

  it('goes straight to the fallback model when the primary call throws', async () => {
    const { llm, result } = run([new Error('503 upstream'), VALID]);
    expect(await result).toMatchObject({ ok: true, model: FALLBACK });
    expect(llm.requests.map((r) => r.model)).toEqual([PRIMARY, FALLBACK]);
  });

  it('reports llm_error with the cause when every call throws', async () => {
    const { result } = run([new Error('boom 1'), new Error('boom 2')]);
    expect(await result).toEqual({ ok: false, reason: 'llm_error', error: 'boom 2' });
  });

  it('prefers invalid_output over llm_error if any reply was readable but wrong', async () => {
    const { result } = run(['nonsense', 'more nonsense', new Error('fallback down')]);
    expect(await result).toMatchObject({ ok: false, reason: 'invalid_output' });
  });

  it('refuses to call the model when the daily neuron budget is spent', async () => {
    await repos.usage.increment(TODAY, 'neuronsEst', 10_000);
    const { llm, result } = run([VALID]);
    expect(await result).toMatchObject({ ok: false, reason: 'budget' });
    expect(llm.requests).toHaveLength(0);
  });

  it('stops mid-way when a retry would no longer fit the budget', async () => {
    // Below the 80% fallback line, but one expensive reply leaves no room for a retry.
    await repos.usage.increment(TODAY, 'neuronsEst', 7_900);
    const { llm, result } = run([{ text: 'garbage', usage: { in: 10_000, out: 10_000 } }, VALID]);
    expect(await result).toMatchObject({ ok: false, reason: 'budget' });
    expect(llm.requests).toHaveLength(1);
  });

  it('starts on the cheap model once over 80% of the budget is used, with no extra fallback hop', async () => {
    await repos.usage.increment(TODAY, 'neuronsEst', 8_500);
    const { llm, result } = run(['junk', 'junk again', VALID]);
    expect(await result).toMatchObject({ ok: false, reason: 'invalid_output' });
    expect(llm.requests.map((r) => r.model)).toEqual([FALLBACK, FALLBACK]);
  });

  it('estimates usage from text length when the provider reports none', async () => {
    const { result } = run([VALID]);
    await result;
    expect((await repos.usage.get(TODAY))?.neuronsEst).toBeGreaterThan(0);
  });
});
