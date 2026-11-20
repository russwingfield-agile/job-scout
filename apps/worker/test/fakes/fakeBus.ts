import { handleMessage, type MessageOutcome } from '../../src/pipeline/consume.js';
import type { PipelineMessage } from '../../src/pipeline/messages.js';
import type { PipelineDeps } from '../../src/pipeline/startRun.js';
import type { Bus } from '../../src/ports/queue.js';

/**
 * In-memory queue that delivers messages to the real handler. Models at-least-once delivery:
 * `duplicate` hands every message over twice, and a `retry` outcome re-queues it with the attempt
 * number bumped, exactly as Cloudflare Queues does.
 */
export class FakeBus implements Bus {
  queue: { msg: PipelineMessage; attempts: number }[] = [];
  readonly deliveries: {
    msg: PipelineMessage;
    attempt: number;
    outcome: MessageOutcome['outcome'];
  }[] = [];
  /** When set, the next send rejects with this error. */
  failSend: Error | null = null;

  private enqueue(msg: PipelineMessage) {
    if (this.failSend) {
      const err = this.failSend;
      this.failSend = null;
      throw err;
    }
    this.queue.push({ msg, attempts: 1 });
  }

  async send(msg: PipelineMessage): Promise<void> {
    this.enqueue(msg);
  }

  async sendBatch(msgs: PipelineMessage[]): Promise<void> {
    for (const msg of msgs) this.enqueue(msg);
  }

  /** Messages of one type still waiting. */
  pending(type: PipelineMessage['type']): PipelineMessage[] {
    return this.queue.filter((q) => q.msg.type === type).map((q) => q.msg);
  }

  /** Deliver until the queue is empty. Throws if it never settles (a message loop). */
  async drain(
    deps: PipelineDeps,
    opts: { duplicate?: boolean; maxDeliveries?: number } = {},
  ): Promise<void> {
    const limit = opts.maxDeliveries ?? 1_000;
    let total = 0;
    while (this.queue.length > 0) {
      const item = this.queue.shift() as { msg: PipelineMessage; attempts: number };
      for (let copy = 0; copy < (opts.duplicate ? 2 : 1); copy++) {
        if (++total > limit) throw new Error(`FakeBus.drain: more than ${limit} deliveries`);
        const result = await handleMessage(deps, item.msg, item.attempts);
        this.deliveries.push({ msg: item.msg, attempt: item.attempts, outcome: result.outcome });
        if (result.outcome === 'retry') {
          this.queue.push({ msg: item.msg, attempts: item.attempts + 1 });
          break;
        }
      }
    }
  }
}
