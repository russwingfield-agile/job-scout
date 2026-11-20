import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { LlmClient, LlmRequest, LlmResponse } from '../../ports/llm.js';
import { type AiLike, toAiError } from './binding.js';

// `response` is a string, or already-parsed JSON when JSON mode is on; some models answer in the
// OpenAI chat shape instead. Accept all three.
const AiTextResponse = z.looseObject({
  response: z
    .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .nullish(),
  choices: z
    .array(z.looseObject({ message: z.looseObject({ content: z.string().nullish() }).nullish() }))
    .nullish(),
  usage: z
    .looseObject({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
    })
    .nullish(),
});

export class WorkersAiLlm implements LlmClient {
  constructor(private readonly ai: AiLike) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let raw: unknown;
    try {
      raw = await this.ai.run(req.model, {
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        ...(req.jsonSchema === undefined
          ? {}
          : { response_format: { type: 'json_schema', json_schema: req.jsonSchema } }),
      });
    } catch (err) {
      throw toAiError(err, `LLM call (${req.model})`);
    }

    const parsed = AiTextResponse.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('UPSTREAM_ERROR', `Unexpected Workers AI response from ${req.model}`, {
        retryable: false,
        cause: parsed.error,
      });
    }

    const { response, choices, usage } = parsed.data;
    const text =
      typeof response === 'string'
        ? response
        : response
          ? JSON.stringify(response)
          : (choices?.[0]?.message?.content ?? '');
    if (!text) {
      throw new AppError('UPSTREAM_ERROR', `Empty Workers AI response from ${req.model}`, {
        retryable: true,
      });
    }

    const inTokens = usage?.prompt_tokens;
    const outTokens = usage?.completion_tokens;
    return {
      text,
      ...(typeof inTokens === 'number' && typeof outTokens === 'number'
        ? { usage: { in: inTokens, out: outTokens } }
        : {}),
    };
  }
}
