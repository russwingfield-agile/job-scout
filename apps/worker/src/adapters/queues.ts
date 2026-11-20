import type { PipelineMessage } from '../pipeline/messages.js';
import type { Bus } from '../ports/queue.js';

/** The slice of a Cloudflare Queue producer binding we use. */
export interface QueueLike {
  send(body: unknown, options?: { delaySeconds?: number }): Promise<void>;
  sendBatch(messages: { body: unknown; delaySeconds?: number }[]): Promise<void>;
}

/** Cloudflare accepts at most 100 messages per sendBatch call. */
const SEND_BATCH_LIMIT = 100;

type Queues = { fetch: QueueLike; process: QueueLike };

export class QueueBus implements Bus {
  constructor(private readonly queues: Queues) {}

  private queueFor(msg: PipelineMessage): QueueLike {
    return msg.type === 'fetch' ? this.queues.fetch : this.queues.process;
  }

  async send(msg: PipelineMessage, opts: { delaySeconds?: number } = {}): Promise<void> {
    await this.queueFor(msg).send(msg, opts);
  }

  async sendBatch(msgs: PipelineMessage[]): Promise<void> {
    for (const type of ['fetch', 'process'] as const) {
      const bodies = msgs.filter((m) => m.type === type).map((body) => ({ body }));
      for (let i = 0; i < bodies.length; i += SEND_BATCH_LIMIT) {
        await this.queues[type].sendBatch(bodies.slice(i, i + SEND_BATCH_LIMIT));
      }
    }
  }
}
