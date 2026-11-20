import type { LlmClient, LlmRequest, LlmResponse } from '../../src/ports/llm.js';

export type ScriptedReply = string | { text: string; usage: { in: number; out: number } } | Error;

/**
 * LLM that plays back scripted replies in order and records every request, so tests can assert on
 * prompts, models and call counts. An empty script rejects, which surfaces unexpected calls.
 */
export class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly queue: ScriptedReply[];
  private readonly repeat: ScriptedReply | null;

  constructor(replies: ScriptedReply[] = [], opts: { repeat?: ScriptedReply } = {}) {
    this.queue = [...replies];
    this.repeat = opts.repeat ?? null;
  }

  /** Reply with the same thing to every call. */
  static always(reply: ScriptedReply): FakeLlm {
    return new FakeLlm([], { repeat: reply });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const reply = this.queue.shift() ?? this.repeat;
    if (reply === null) throw new Error('FakeLlm: no scripted reply left');
    if (reply instanceof Error) throw reply;
    return typeof reply === 'string' ? { text: reply } : reply;
  }
}
